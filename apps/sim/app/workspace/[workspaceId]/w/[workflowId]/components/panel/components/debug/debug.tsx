'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  AlertCircle,
  Check,
  Circle,
  CircleDot,
  FastForward,
  Play,
  RotateCcw,
  Square,
  X,
  Flag,
  Undo2,
  StepBack,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { BlockPathCalculator } from '@/lib/block-path-calculator'
import { extractFieldsFromSchema, parseResponseFormatSafely } from '@/lib/response-format'
import { cn } from '@/lib/utils'
import { useCurrentWorkflow } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-current-workflow'
import { useWorkflowExecution } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-workflow-execution'
import { getBlock } from '@/blocks'
import { useExecutionStore } from '@/stores/execution/store'
import { useVariablesStore } from '@/stores/panel/variables/store'
import { useEnvironmentStore } from '@/stores/settings/environment/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { getTool } from '@/tools/utils'
import { getTrigger, getTriggersByProvider } from '@/triggers'
import { useDebugSnapshotStore } from '@/stores/execution/debug-snapshots/store'

// Token render cache (LRU-style)
const TOKEN_CACHE_MAX = 500
const tokenRenderCache: Map<string, React.ReactNode> = new Map()

export function DebugPanel() {
  const {
    isDebugging,
    isExecuting,
    pendingBlocks,
    debugContext,
    executor,
    activeBlockIds,
    setActiveBlocks,
    setPanelFocusedBlockId,
    panelFocusedBlockId,
    setExecutingBlockIds,
    setIsExecuting,
    setDebugContext,
    setPendingBlocks,
    breakpointId,
    setBreakpointId,
    startPositionIds,
    toggleStartPosition,
  } = useExecutionStore()
  const executingIds = useExecutionStore((s) => s.executingBlockIds)
  const { activeWorkflowId, workflows } = useWorkflowRegistry()
  const { handleStepDebug, handleResumeDebug, handleCancelDebug, handleRunWorkflow } =
    useWorkflowExecution()
  const currentWorkflow = useCurrentWorkflow()

  const [chatMessage, setChatMessage] = useState('')
  const [scopedVariables, setScopedVariables] = useState(true)
  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set())
  const [revealedEnvVars, setRevealedEnvVars] = useState<Set<string>>(new Set())
  const hasStartedRef = useRef(false)
  const lastFocusedIdRef = useRef<string | null>(null)
  const [isInitPending, setIsInitPending] = useState(false)

  // Track bottom variables tab and row highlighting for navigation from tokens
  const [bottomTab, setBottomTab] = useState<'reference' | 'workflow' | 'environment'>('reference')
  const workflowVarRowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map())
  const envVarRowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map())
  const [highlightedWorkflowVar, setHighlightedWorkflowVar] = useState<string | null>(null)
  const [highlightedEnvVar, setHighlightedEnvVar] = useState<string | null>(null)
  const refVarRowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map())
  const [highlightedRefVar, setHighlightedRefVar] = useState<string | null>(null)

  // Helper to force re-trigger highlight even when clicking the same key
  const flashHighlight = (
    setter: (updater: any) => void,
    key: string,
    durationMs: number
  ) => {
    try {
      setter((prev: any) => (prev === key ? null : prev))
      requestAnimationFrame(() => {
        setter(key)
        window.setTimeout(() => setter((prev: any) => (prev === key ? null : prev)), durationMs)
      })
    } catch {}
  }

  // Graph helpers for start position constraints
  const edgesList = currentWorkflow.edges || []
  const forwardAdj = useMemo(() => {
    const adj: Record<string, string[]> = {}
    for (const e of edgesList) {
      const s = (e as any).source
      const t = (e as any).target
      if (!adj[s]) adj[s] = []
      adj[s].push(t)
    }
    return adj
  }, [edgesList])
  const hasPath = useCallback(
    (from: string, to: string) => {
      if (!from || !to) return false
      if (from === to) return true
      const visited = new Set<string>()
      const q: string[] = [from]
      while (q.length) {
        const n = q.shift() as string
        if (n === to) return true
        if (visited.has(n)) continue
        visited.add(n)
        const next = forwardAdj[n] || []
        for (const m of next) if (!visited.has(m)) q.push(m)
      }
      return false
    },
    [forwardAdj]
  )

  const handleRevertToStartPos = () => {
    const snapshot = useDebugSnapshotStore.getState()
    if (!debugContext) return
    const startIds = Array.from(startPositionIds)
    if (startIds.length !== 1) {
      // Require exactly one start position to revert deterministically
      return
    }
    
    // Build a fresh context based on last snapshot, resolving everything except downstream of start positions
    try {
      const newCtx = { ...debugContext }
      // Reset executed flags for all blocks
      newCtx.executedBlocks = new Set<string>()
      newCtx.activeExecutionPath = new Set<string>()

      // Reapply environment/workflow vars from snapshot if present
      if (snapshot.envVarValues) newCtx.environmentVariables = snapshot.envVarValues
      if (snapshot.workflowVariables) newCtx.workflowVariables = snapshot.workflowVariables

      // Rebuild blockStates from snapshot outputs
      const rebuilt = new Map(debugContext.blockStates)
      // Mark everything as executed initially based on snapshot
      snapshot.blockSnapshots.forEach((snap, id) => {
        rebuilt.set(id, {
          output: snap.output,
          executed: true,
          executionTime: snap.executionTime ?? 0,
        })
      })

      // Compute all downstream of start positions; they will become pending and not executed
      const downstream = new Set<string>()
      const queue = [...startIds]
      const visited = new Set<string>()
      while (queue.length) {
        const n = queue.shift() as string
        if (visited.has(n)) continue
        visited.add(n)
        const next = forwardAdj[n] || []
        for (const m of next) {
          if (!visited.has(m)) {
            downstream.add(m)
            queue.push(m)
          }
        }
      }

      // Unset executed for start positions and their downstream; keep outputs from snapshot but mark not executed
      const startSet = new Set(startIds)
      for (const id of startIds) {
        const prev = rebuilt.get(id)
        rebuilt.set(id, { output: prev?.output ?? {}, executed: false, executionTime: 0 })
      }
      downstream.forEach((id) => {
        const prev = rebuilt.get(id)
        rebuilt.set(id, { output: prev?.output ?? {}, executed: false, executionTime: 0 })
      })

      // Active execution path should include all nodes reachable from any start
      const path = new Set<string>()
      const q2 = [...startIds]
      const seen2 = new Set<string>()
      while (q2.length) {
        const n = q2.shift() as string
        if (seen2.has(n)) continue
        seen2.add(n)
        path.add(n)
        const next = forwardAdj[n] || []
        for (const m of next) if (!seen2.has(m)) q2.push(m)
      }
      newCtx.activeExecutionPath = path

      // Set executedBlocks set to upstream executed nodes (not in start or downstream)
      const executedSet = new Set<string>()
      snapshot.blockSnapshots.forEach((_snap, id) => {
        if (!startSet.has(id) && !downstream.has(id)) executedSet.add(id)
      })
      newCtx.executedBlocks = executedSet

      // Active execution path: union of downstream from starts and downstream from executed upstream nodes
      const pathFromStarts = path
      const pathFromExecuted = new Set<string>()
      const q3 = Array.from(executedSet)
      const seen3 = new Set<string>()
      while (q3.length) {
        const n = q3.shift() as string
        if (seen3.has(n)) continue
        seen3.add(n)
        pathFromExecuted.add(n)
        const next = forwardAdj[n] || []
        for (const m of next) if (!seen3.has(m)) q3.push(m)
      }
      newCtx.activeExecutionPath = new Set<string>([...pathFromStarts, ...pathFromExecuted])

      // Compute minimal ready layer if any start is not ready (due to unmet dependencies)
      const reverseAdj: Record<string, string[]> = {}
      for (const e of edgesList) {
        const s = (e as any).source
        const t = (e as any).target
        if (!reverseAdj[t]) reverseAdj[t] = []
        reverseAdj[t].push(s)
      }
      const isExecuted = (id: string) => (rebuilt.get(id)?.executed ? true : false)
      const memoReady = new Map<string, Set<string>>()
      const visiting = new Set<string>()
      const collectReadyLayerFor = (id: string): Set<string> => {
        if (memoReady.has(id)) return memoReady.get(id) as Set<string>
        if (visiting.has(id)) return new Set<string>()
        visiting.add(id)
        const incoming = reverseAdj[id] || []
        if (incoming.length === 0) {
          const base = isExecuted(id) ? new Set<string>() : new Set<string>([id])
          memoReady.set(id, base)
          visiting.delete(id)
          return base
        }
        let allParentsExecuted = true
        const need: Set<string> = new Set()
        for (const src of incoming) {
          if (!isExecuted(src)) {
            allParentsExecuted = false
            const sub = collectReadyLayerFor(src)
            sub.forEach((n) => need.add(n))
          }
        }
        const result = allParentsExecuted && !isExecuted(id) ? new Set<string>([id]) : need
        memoReady.set(id, result)
        visiting.delete(id)
        return result
      }

      const initialReady = new Set<string>()
      for (const sid of startIds) {
        const ready = collectReadyLayerFor(sid)
        ready.forEach((n) => initialReady.add(n))
      }

      // If there is a non-empty ready layer different from direct starts, use it as pending and include in path
      let initialPending = startIds
      if (initialReady.size > 0) {
        initialPending = Array.from(initialReady)
        for (const n of initialReady) newCtx.activeExecutionPath.add(n)
      }

      // Depth-based reset: reset all branches to the same depth as initialPending
      // Compute BFS depth map from starter
      const depthMap = new Map<string, number>()
      const qd: string[] = []
      if (starterId) {
        depthMap.set(starterId, 0)
        qd.push(starterId)
      }
      while (qd.length) {
        const u = qd.shift() as string
        const du = depthMap.get(u) || 0
        const nexts = forwardAdj[u] || []
        for (const v of nexts) {
          if (!depthMap.has(v)) {
            depthMap.set(v, du + 1)
            qd.push(v)
          }
        }
      }
      // Determine target depth from initialPending (fallback to min depth of startIds)
      const idsForDepth = initialPending.length > 0 ? initialPending : startIds
      let targetDepth = Infinity
      for (const nid of idsForDepth) {
        const d = depthMap.get(nid)
        if (d !== undefined && d < targetDepth) targetDepth = d
      }
      if (!Number.isFinite(targetDepth)) targetDepth = 0

      // Apply depth-based execution state across all branches
      const newExecutedSet = new Set<string>()
      rebuilt.forEach((_state, id) => {
        const d = depthMap.get(id)
        const snap = snapshot.blockSnapshots.get(id)
        const shouldBeExecuted = !!snap?.executed && (d === undefined ? false : d < (targetDepth as number))
        const prev = rebuilt.get(id)
        rebuilt.set(id, {
          output: prev?.output ?? snap?.output ?? {},
          executed: shouldBeExecuted,
          executionTime: shouldBeExecuted ? (prev?.executionTime ?? snap?.executionTime ?? 0) : 0,
        } as any)
        if (shouldBeExecuted) newExecutedSet.add(id)
      })
      newCtx.executedBlocks = newExecutedSet

      // Active execution path: all nodes at or beyond target depth
      const futurePath = new Set<string>()
      depthMap.forEach((d, id) => {
        if (d >= (targetDepth as number)) futurePath.add(id)
      })
      newCtx.activeExecutionPath = new Set<string>([...newCtx.activeExecutionPath, ...futurePath])

      // Compute global ready layer at target depth so parallel branches at same depth are included
      const globalReady: string[] = []
      depthMap.forEach((d, id) => {
        if (d === (targetDepth as number)) {
          const parents = reverseAdj[id] || []
          const allParentsExec = parents.every((p) => (rebuilt.get(p)?.executed ? true : false))
          if (allParentsExec) globalReady.push(id)
        }
      })

      // Pending selection: prefer global ready layer if available; else minimal chain-based ready
      const pendingSelection = globalReady.length > 0 ? globalReady : initialPending

      // Clear pending-and-downstream nodes so outputs refresh on next runs
      const toClear = new Set<string>()
      const qc: string[] = [...pendingSelection]
      const seenC = new Set<string>()
      while (qc.length) {
        const n = qc.shift() as string
        if (seenC.has(n)) continue
        seenC.add(n)
        toClear.add(n)
        const next = forwardAdj[n] || []
        for (const m of next) if (!seenC.has(m)) qc.push(m)
      }
      toClear.forEach((id) => {
        const prev = rebuilt.get(id)
        rebuilt.set(id, { output: {}, executed: false, executionTime: 0 } as any)
      })
      // Remove cleared from executed set
      const adjustedExecuted = new Set<string>(Array.from(newCtx.executedBlocks || new Set()).filter((id) => !toClear.has(id)))
      newCtx.executedBlocks = adjustedExecuted

      // Apply rebuilt block states and clear parallel mapping current id
      newCtx.blockStates = rebuilt as any
      newCtx.currentVirtualBlockId = undefined

      // Pending are either the global layer or the minimal ready layer/start positions
      setPendingBlocks(pendingSelection)
      setDebugContext(newCtx)
      // Also update panel focus to first pending for clarity
      setPanelFocusedBlockId(pendingSelection[0] || null)
    } catch {}
  }

  const handleBackstep = () => {
    const snapshotStore = useDebugSnapshotStore.getState()
    let prev = snapshotStore.stepBack()
    if (!prev) {
      const hist = snapshotStore.history
      if (hist && hist.length === 1) {
        prev = hist[0]
      }
    }
    if (!prev || !debugContext) return
    try {
      const newCtx = { ...debugContext }
      // Rebuild block states from previous snapshot
      const rebuilt = new Map<string, any>()
      prev.blockSnapshots.forEach((snap, id) => {
        rebuilt.set(id, {
          output: snap.output,
          executed: snap.executed,
          executionTime: snap.executionTime ?? 0,
        })
      })
      newCtx.blockStates = rebuilt as any
      if (prev.envVarValues) newCtx.environmentVariables = prev.envVarValues
      if (prev.workflowVariables) newCtx.workflowVariables = prev.workflowVariables
      // Determine pending set; if stepping back to base, use starterId
      const pending = prev.pendingBlocks && prev.pendingBlocks.length > 0 ? prev.pendingBlocks : (starterId ? [starterId] : [])

      // Recompute active execution path from pending
      const path = new Set<string>()
      const q: string[] = [...pending]
      const seen = new Set<string>()
      while (q.length) {
        const n = q.shift() as string
        if (seen.has(n)) continue
        seen.add(n)
        path.add(n)
        const next = forwardAdj[n] || []
        for (const m of next) if (!seen.has(m)) q.push(m)
      }
      newCtx.activeExecutionPath = path
      setDebugContext(newCtx)
      setPendingBlocks(pending)
      setPanelFocusedBlockId(pending[0] || null)
    } catch {}
  }

  const handleStopExecutionOnly = () => {
    try {
      useExecutionStore.getState().executor?.cancel()
    } catch {}

    // Prefer stopping at the currently executing blocks and making them current
    const execIdsArr = Array.from(useExecutionStore.getState().executingBlockIds || new Set<string>())

    if (debugContext && execIdsArr.length > 0) {
      try {
        const newCtx = { ...debugContext }
        const rebuilt = new Map<string, any>(debugContext.blockStates as any)

        // Clear executing-and-downstream so next run is fresh
        const toClear = new Set<string>()
        const qc: string[] = [...execIdsArr]
        const seenC = new Set<string>()
        while (qc.length) {
          const n = qc.shift() as string
          if (seenC.has(n)) continue
          seenC.add(n)
          toClear.add(n)
          const next = forwardAdj[n] || []
          for (const m of next) if (!seenC.has(m)) qc.push(m)
        }
        toClear.forEach((id) => {
          rebuilt.set(id, { output: {}, executed: false, executionTime: 0 } as any)
        })
        const adjustedExecuted = new Set<string>(
          Array.from(newCtx.executedBlocks || new Set()).filter((id) => !toClear.has(id))
        )
        newCtx.executedBlocks = adjustedExecuted
        newCtx.blockStates = rebuilt as any

        // Recompute execution path from executing blocks
        const path = new Set<string>()
        const q: string[] = [...execIdsArr]
        const seen = new Set<string>()
        while (q.length) {
          const n = q.shift() as string
          if (seen.has(n)) continue
          seen.add(n)
          path.add(n)
          const next = forwardAdj[n] || []
          for (const m of next) if (!seen.has(m)) q.push(m)
        }
        newCtx.activeExecutionPath = path

        setDebugContext(newCtx)
        setPendingBlocks(execIdsArr)
        setPanelFocusedBlockId(execIdsArr[0] || null)
      } catch {}
    } else {
      // Revert to last snapshot before current executing block
      const snapshotStore = useDebugSnapshotStore.getState()
      const hist = snapshotStore.history
      const prev = hist && hist.length > 0 ? hist[hist.length - 1] : null

      if (debugContext && prev) {
        try {
          const newCtx = { ...debugContext }
          // Rebuild block states from previous snapshot
          const rebuilt = new Map<string, any>()
          prev.blockSnapshots.forEach((snap, id) => {
            rebuilt.set(id, {
              output: snap.output,
              executed: snap.executed,
              executionTime: snap.executionTime ?? 0,
            })
          })
          newCtx.blockStates = rebuilt as any
          if (prev.envVarValues) newCtx.environmentVariables = prev.envVarValues
          if (prev.workflowVariables) newCtx.workflowVariables = prev.workflowVariables

          const pending = prev.pendingBlocks && prev.pendingBlocks.length > 0 ? prev.pendingBlocks : (starterId ? [starterId] : [])

          // Clear pending-and-downstream so next run is fresh
          const toClear = new Set<string>()
          const qc: string[] = [...pending]
          const seenC = new Set<string>()
          while (qc.length) {
            const n = qc.shift() as string
            if (seenC.has(n)) continue
            seenC.add(n)
            toClear.add(n)
            const next = forwardAdj[n] || []
            for (const m of next) if (!seenC.has(m)) qc.push(m)
          }
          toClear.forEach((id) => {
            rebuilt.set(id, { output: {}, executed: false, executionTime: 0 } as any)
          })
          const adjustedExecuted = new Set<string>(Array.from(newCtx.executedBlocks || new Set()).filter((id) => !toClear.has(id)))
          newCtx.executedBlocks = adjustedExecuted
          newCtx.blockStates = rebuilt as any

          // Recompute execution path from pending
          const path = new Set<string>()
          const q: string[] = [...pending]
          const seen = new Set<string>()
          while (q.length) {
            const n = q.shift() as string
            if (seen.has(n)) continue
            seen.add(n)
            path.add(n)
            const next = forwardAdj[n] || []
            for (const m of next) if (!seen.has(m)) q.push(m)
          }
          newCtx.activeExecutionPath = path

          setDebugContext(newCtx)
          setPendingBlocks(pending)
          setPanelFocusedBlockId(pending[0] || null)
        } catch {}
      }
    }

    setIsExecuting(false)
    setExecutingBlockIds(new Set())
    setActiveBlocks(new Set())
    // Keep panel open
  }

  // Helper to format strings with clickable var/env tokens
  const renderWithTokens = (text: string, options?: { truncateAt?: number }) => {
    const truncateAt = options?.truncateAt
    const cacheKey = `${truncateAt ?? -1}|${text}`
    if (tokenRenderCache.has(cacheKey)) {
      return tokenRenderCache.get(cacheKey) as React.ReactNode
    }

    let displayText = text
    let truncated = false
    if (typeof truncateAt === 'number' && text.length > truncateAt) {
      displayText = `${text.slice(0, truncateAt)}...`
      truncated = true
    }

    // Build combined matches for env ({{VAR}}), workflow vars (<variable.name>), and references (<block.path>)
    const matches: Array<{
      start: number
      end: number
      type: 'env' | 'var' | 'ref'
      value: string
      raw?: string
    }> = []

    const envRe = /\{\{([^{}]+)\}\}/g
    const varRe = /<variable\.([^>]+)>/g
    const refRe = /<([^>]+)>/g

    let m: RegExpExecArray | null
    while ((m = envRe.exec(displayText)) !== null) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        type: 'env',
        value: m[1],
        raw: m[0],
      })
    }
    while ((m = varRe.exec(displayText)) !== null) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        type: 'var',
        value: m[1],
        raw: m[0],
      })
    }
    while ((m = refRe.exec(displayText)) !== null) {
      const inner = m[1]
      // Skip workflow variable tokens since already captured
      if (inner.startsWith('variable.')) continue
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        type: 'ref',
        value: inner,
        raw: m[0],
      })
    }

    if (matches.length === 0) {
      const node = (
        <span className='break-words font-mono text-[11px] text-foreground/70'>{displayText}</span>
      )
      if (tokenRenderCache.size >= TOKEN_CACHE_MAX) {
        const iter = tokenRenderCache.keys().next()
        if (!iter.done) {
          tokenRenderCache.delete(iter.value as string)
        }
      }
      tokenRenderCache.set(cacheKey, node)
      return node
    }

    // Sort by start index
    matches.sort((a, b) => a.start - b.start)

    const parts: React.ReactNode[] = []
    let cursor = 0

    const handleTokenClick = (kind: 'env' | 'var' | 'ref', rawName: string, rawToken?: string) => {
      if (kind === 'env') {
        setBottomTab('environment')
        // Scroll and highlight
        requestAnimationFrame(() => {
          const row = envVarRowRefs.current.get(rawName)
          if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' })
          flashHighlight(setHighlightedEnvVar, rawName, 2500)
        })
      } else {
        if (kind === 'var') {
          const normalized = (rawName || '').replace(/\s+/g, '')
          setBottomTab('workflow')
          requestAnimationFrame(() => {
            const row = workflowVarRowRefs.current.get(normalized)
            if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' })
            flashHighlight(setHighlightedWorkflowVar, normalized, 2500)
          })
        } else {
          // Reference variable token
          const refKey = rawToken || `<${rawName}>`
          setBottomTab('reference')
          // Keep current scoped state to match the same set user is seeing
          requestAnimationFrame(() => {
            const row = refVarRowRefs.current.get(refKey)
            if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' })
            flashHighlight(setHighlightedRefVar, refKey, 4000)
          })
        }
      }
    }

    for (const match of matches) {
      if (match.start > cursor) {
        parts.push(
          <span
            key={`t-${cursor}`}
            className='break-words font-mono text-[11px] text-foreground/70'
          >
            {displayText.slice(cursor, match.start)}
          </span>
        )
      }

      const chip = (
        <button
          key={`m-${match.start}`}
          type='button'
          className='rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[11px] text-blue-700 transition-colors hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/30'
          onClick={(e) => {
            e.stopPropagation()
            handleTokenClick(match.type as any, match.value, match.raw)
          }}
        >
          {match.type === 'env'
            ? `{{${match.value}}}`
            : match.type === 'var'
              ? `<variable.${match.value}>`
              : `<${match.value}>`}
        </button>
      )

      parts.push(chip)
      cursor = match.end
    }

    if (cursor < displayText.length) {
      parts.push(
        <span key={`t-end`} className='break-words font-mono text-[11px] text-foreground/70'>
          {displayText.slice(cursor)}
        </span>
      )
    }

    const node = <span className='break-words'>{parts}</span>
    if (tokenRenderCache.size >= TOKEN_CACHE_MAX) {
      const iter = tokenRenderCache.keys().next()
      if (!iter.done) {
        tokenRenderCache.delete(iter.value as string)
      }
    }
    tokenRenderCache.set(cacheKey, node)
    return node
  }

  // Helper to toggle field expansion
  const toggleFieldExpansion = (fieldKey: string) => {
    setExpandedFields((prev) => {
      const next = new Set(prev)
      if (next.has(fieldKey)) {
        next.delete(fieldKey)
      } else {
        next.add(fieldKey)
      }
      return next
    })
  }

  // Helper to toggle env var reveal
  const toggleEnvVarReveal = (key: string) => {
    setRevealedEnvVars((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  // Helper to consistently resolve a human-readable block name
  const getDisplayName = (block: any | null | undefined): string => {
    if (!block) return ''
    return block.name || block.metadata?.name || block.type || block.id || ''
  }

  // Always use current workflow blocks as the source of truth
  // This ensures consistency whether debugContext exists or not
  const blocksList = useMemo(() => {
    const blocks = Object.values(currentWorkflow.blocks || {}) as any[]
    return blocks.filter((b) => b?.type) // Filter out invalid blocks
  }, [currentWorkflow.blocks])

  const blockById = useMemo(() => {
    const map = new Map<string, any>()
    for (const b of blocksList) map.set(b.id, b)
    return map
  }, [blocksList])

  // Helpers for infra/virtual handling (parallel & loop)
  const isInfraBlockType = (t?: string) => t === 'loop' || t === 'parallel'
  const resolveOriginalBlockId = (id: string | null): string | null => {
    if (!id) return null
    try {
      const mapping = debugContext?.parallelBlockMapping?.get(id)
      return mapping?.originalBlockId || id
    } catch {
      return id
    }
  }
  const isVirtualForBlock = (id: string, baseId: string) => {
    // Matches executor virtual id scheme: `${baseId}_parallel_${parallelId}_iteration_${i}`
    return id.startsWith(`${baseId}_parallel_`)
  }

  const starter = useMemo(
    () => blocksList.find((b: any) => b.metadata?.id === 'starter' || b.type === 'starter'),
    [blocksList]
  )
  const starterId = starter?.id || null

  // determine if starter is chat mode in editor state (registry/workflow store keeps subblock values)
  const isChatMode = useMemo(() => {
    if (!activeWorkflowId) return false
    const wf = workflows[activeWorkflowId]
    try {
      const stateBlocks = (wf as any)?.state?.blocks || {}
      const startBlock = Object.values(stateBlocks).find((b: any) => b.type === 'starter') as any
      const value = startBlock?.subBlocks?.startWorkflow?.value
      return value === 'chat'
    } catch {
      return false
    }
  }, [activeWorkflowId, workflows])

  // Determine focused block: prefer explicitly panel-focused (clicked) block,
  // else show first pending; when list empties, keep showing the last focused; initial fallback to starter
  const focusedBlockId = useMemo(() => {
    const pickResolvedNonInfra = (ids: string[]): string | null => {
      for (const rawId of ids) {
        const realId = resolveOriginalBlockId(rawId)
        const blk = realId ? blockById.get(realId) : null
        if (blk && !isInfraBlockType(blk.type)) return realId
      }
      return null
    }

    // 1) Prefer explicit focus if it's not infra (resolve virtuals)
    if (panelFocusedBlockId) {
      const real = resolveOriginalBlockId(panelFocusedBlockId)
      const blk = real ? blockById.get(real) : null
      if (blk && !isInfraBlockType(blk.type)) return real
    }
    // 2) Next, choose first pending that resolves to non-infra
    if (pendingBlocks.length > 0) {
      const chosen = pickResolvedNonInfra(pendingBlocks)
      if (chosen) return chosen
    }
    // 3) Otherwise keep last focused if still valid
    if (lastFocusedIdRef.current) {
      const real = resolveOriginalBlockId(lastFocusedIdRef.current)
      const blk = real ? blockById.get(real) : null
      if (blk && !isInfraBlockType(blk.type)) return real
    }
    // 4) Fallback to starter
    if (starterId) return starterId
    return null
  }, [panelFocusedBlockId, pendingBlocks, starterId, blockById, debugContext?.parallelBlockMapping])

  // Remember last focused and publish highlight when pending list changes
  useEffect(() => {
    if (pendingBlocks.length > 0) {
      // Set focus to first non-infra resolved pending if available
      const nextReal = (() => {
        for (const rawId of pendingBlocks) {
          const real = resolveOriginalBlockId(rawId)
          const blk = real ? blockById.get(real) : null
          if (blk && !isInfraBlockType(blk.type)) return real
        }
        return pendingBlocks[0] || null
      })()
      if (nextReal) {
        lastFocusedIdRef.current = nextReal
        setPanelFocusedBlockId(nextReal)
      }
    }
  }, [pendingBlocks, setPanelFocusedBlockId, blockById])

  // Get the focused block from our consistent data source
  const focusedBlock = focusedBlockId ? blockById.get(focusedBlockId) : null

  // Start position toggle with path constraint enforcement
  const isStartPosActive = !!(focusedBlockId && startPositionIds.has(focusedBlockId))
  const hasStartPosConflict = useMemo(() => {
    if (!focusedBlockId) return false
    for (const id of startPositionIds) {
      if (id === focusedBlockId) continue
      if (hasPath(focusedBlockId, id) || hasPath(id, focusedBlockId)) return true
    }
    return false
  }, [focusedBlockId, startPositionIds, hasPath])
  const handleToggleStartPos = () => {
    if (!focusedBlockId) return
    if (!startPositionIds.has(focusedBlockId)) {
      // adding: enforce no upstream/downstream conflicts
      for (const id of startPositionIds) {
        if (hasPath(focusedBlockId, id) || hasPath(id, focusedBlockId)) {
          return
        }
      }
    }
    toggleStartPosition(focusedBlockId)
  }

  // Compute visible subblock values for the focused block based on block state (conditions),
  // not UI modes
  const visibleSubblockValues = useMemo(() => {
    if (!focusedBlockId || !focusedBlock) return {}

    const cfg = getBlock(focusedBlock.type)
    const subBlocks = cfg?.subBlocks || []

    // Get merged state for conditional evaluation
    const allBlocks = useWorkflowStore.getState().blocks
    const merged = mergeSubblockState(allBlocks, activeWorkflowId || undefined, focusedBlockId)[
      focusedBlockId
    ]
    const stateToUse: Record<string, any> = merged?.subBlocks || {}

    const outputs: Record<string, any> = {}

    for (const sb of subBlocks) {
      // Hidden handling
      if ((sb as any).hidden) continue

      // Only show trigger-config automatically for pure trigger blocks
      if ((sb as any).type === 'trigger-config') {
        const isPureTriggerBlock = (cfg as any)?.triggers?.enabled && cfg?.category === 'triggers'
        if (!isPureTriggerBlock) continue
      }

      // Condition evaluation based on current block state
      const cond =
        typeof (sb as any).condition === 'function'
          ? (sb as any).condition()
          : (sb as any).condition
      if (cond) {
        const fieldValue = stateToUse[cond.field]?.value
        const andFieldValue = cond.and ? stateToUse[cond.and.field]?.value : undefined

        const isValueMatch = Array.isArray(cond.value)
          ? fieldValue != null &&
            (cond.not
              ? !(cond.value as any[]).includes(fieldValue)
              : (cond.value as any[]).includes(fieldValue))
          : cond.not
            ? fieldValue !== cond.value
            : fieldValue === cond.value

        const isAndValueMatch = !cond.and
          ? true
          : Array.isArray(cond.and.value)
            ? andFieldValue != null &&
              (cond.and.not
                ? !(cond.and.value as any[]).includes(andFieldValue)
                : (cond.and.value as any[]).includes(andFieldValue))
            : cond.and.not
              ? andFieldValue !== cond.and.value
              : andFieldValue === cond.and.value

        if (!(isValueMatch && isAndValueMatch)) continue
      }

      // Include only visible subblock values (use the .value for display)
      if (stateToUse[sb.id] && 'value' in stateToUse[sb.id]) {
        outputs[sb.id] = stateToUse[sb.id].value
      }
    }

    return outputs
  }, [focusedBlockId, focusedBlock, activeWorkflowId])

  // Latest log for selected block (for input) - requires debugContext
  const focusedLog = useMemo(() => {
    if (!debugContext?.blockLogs || !focusedBlockId) return null
    const logs = debugContext.blockLogs.filter((l) => l.blockId === focusedBlockId)
    if (logs.length === 0) return null
    return logs.reduce((a, b) => (new Date(a.startedAt) > new Date(b.startedAt) ? a : b))
  }, [debugContext?.blockLogs, focusedBlockId])

  // Upstream executed outputs to approximate available inputs for non-executed blocks
  const upstreamExecuted = useMemo(() => {
    if (!focusedBlockId || !debugContext)
      return [] as Array<{ id: string; name: string; output: any }>

    // Use currentWorkflow.edges for connections (consistent with block source)
    const connections = currentWorkflow.edges || []
    const incoming = connections.filter((c: any) => c.target === focusedBlockId)
    const upstreamIds = new Set<string>(incoming.map((c: any) => c.source))
    const items: Array<{ id: string; name: string; output: any }> = []
    upstreamIds.forEach((id) => {
      const state = debugContext.blockStates.get(id)
      if (state?.executed) {
        const blk = blockById.get(id)
        items.push({ id, name: blk?.metadata?.name || blk?.id || id, output: state.output })
      }
    })
    return items
  }, [focusedBlockId, debugContext, blockById, currentWorkflow.edges])

  const envVars = debugContext?.environmentVariables || {}
  const workflowVars = debugContext?.workflowVariables || {}

  // Get environment variables from the store (for before execution starts)
  const envVarsFromStore = useEnvironmentStore((state) => state.getAllVariables())
  const loadEnvironmentVariables = useEnvironmentStore((state) => state.loadEnvironmentVariables)

  // Load environment variables when component mounts
  useEffect(() => {
    loadEnvironmentVariables()
  }, [loadEnvironmentVariables])

  // Use debugContext env vars if available (during execution), otherwise use store
  const allEnvVars = useMemo(() => {
    // If we have debugContext with env vars, use those (they're decrypted)
    if (debugContext && Object.keys(envVars).length > 0) {
      return envVars
    }

    // Otherwise, use the env vars from the store
    // Convert from store format to simple key-value pairs
    const storeVars: Record<string, string> = {}
    Object.entries(envVarsFromStore).forEach(([key, variable]) => {
      storeVars[key] = variable.value
    })
    return storeVars
  }, [debugContext, envVars, envVarsFromStore])

  // Get workflow variables from the variables store
  const workflowVariablesFromStore = useVariablesStore((state) =>
    activeWorkflowId ? state.getVariablesByWorkflowId(activeWorkflowId) : []
  )

  const isFocusedExecuted = debugContext
    ? (() => {
        const id = focusedBlockId || ''
        if (!id) return false
        const direct = debugContext.blockStates.get(id)?.executed
        if (direct) return true
        // Consider parallel virtual executions for this block
        for (const key of debugContext.blockStates.keys()) {
          if (isVirtualForBlock(String(key), id) && debugContext.blockStates.get(key)?.executed) {
            return true
          }
        }
        return false
      })()
    : false

  const isFocusedErrored = debugContext
    ? (() => {
        const id = focusedBlockId || ''
        if (!id) return false
        // Check direct block state for error
        const directState = debugContext.blockStates.get(id)
        if (
          directState?.output &&
          typeof directState.output === 'object' &&
          'error' in directState.output
        ) {
          return true
        }
        // Check virtual executions for errors
        for (const [key, state] of debugContext.blockStates.entries()) {
          if (
            isVirtualForBlock(String(key), id) &&
            state?.output &&
            typeof state.output === 'object' &&
            'error' in state.output
          ) {
            return true
          }
        }
        // Also check block logs for this block
        const hasErrorLog = debugContext.blockLogs?.some(
          (log) =>
            (log.blockId === id || resolveOriginalBlockId(log.blockId) === id) && !log.success
        )
        return hasErrorLog || false
      })()
    : false

  const isStarterFocused =
    focusedBlock?.metadata?.id === 'starter' || focusedBlock?.type === 'starter'
  const isFocusedCurrent = useMemo(() => {
    const id = focusedBlockId || ''
    if (!id) return false
    return pendingBlocks.some((rawId) => {
      if (rawId === id) return true
      const real = resolveOriginalBlockId(rawId)
      return real === id
    })
  }, [pendingBlocks, focusedBlockId, debugContext?.parallelBlockMapping])

  // Bump when execution progresses to refresh dependent memos
  const executionVersion = useMemo(() => {
    const logsCount = debugContext?.blockLogs?.length || 0
    const statesCount = debugContext?.blockStates?.size || 0
    return logsCount + statesCount
  }, [debugContext?.blockLogs?.length, debugContext?.blockStates?.size])

  // Resolved output key-value pairs: keys from schema (or actual output if schema empty),
  // values from debugContext if available, else null
  const resolvedOutputKVs = useMemo(() => {
    if (!focusedBlock) return {}
    const cfg = getBlock(focusedBlock.type)
    const schema = cfg?.outputs || {}
    const stateOutput = debugContext?.blockStates.get(focusedBlockId || '')?.output || {}

    const keys = Object.keys(schema).length > 0 ? Object.keys(schema) : Object.keys(stateOutput)
    const result: Record<string, any> = {}
    keys.forEach((k) => {
      result[k] = Object.hasOwn(stateOutput, k) ? stateOutput[k] : null
    })
    return result
  }, [focusedBlock, focusedBlockId, executionVersion])

  // Compute accessible output variables for the focused block with tag-style references
  const outputVariableEntries = useMemo(() => {
    if (!focusedBlockId) return [] as Array<{ ref: string; value: any }>

    const normalizeBlockName = (name: string) => (name || '').replace(/\s+/g, '').toLowerCase()
    const getSubBlockValue = (blockId: string, property: string): any => {
      return useSubBlockStore.getState().getValue(blockId, property)
    }
    const generateOutputPaths = (outputs: Record<string, any>, prefix = ''): string[] => {
      const paths: string[] = []
      for (const [key, value] of Object.entries(outputs || {})) {
        const current = prefix ? `${prefix}.${key}` : key
        if (typeof value === 'string') {
          paths.push(current)
        } else if (value && typeof value === 'object') {
          if ('type' in value && typeof (value as any).type === 'string') {
            paths.push(current)
            if ((value as any).type === 'object' && (value as any).properties) {
              paths.push(...generateOutputPaths((value as any).properties, current))
            } else if ((value as any).type === 'array' && (value as any).items?.properties) {
              paths.push(...generateOutputPaths((value as any).items.properties, current))
            }
          } else {
            paths.push(...generateOutputPaths(value as Record<string, any>, current))
          }
        } else {
          paths.push(current)
        }
      }
      return paths
    }

    const getAccessiblePathsForBlock = (blockId: string): string[] => {
      const blk = blockById.get(blockId)
      if (!blk) return []
      const cfg = getBlock(blk.type)
      if (!cfg) return []

      // Response format overrides
      const responseFormatValue = getSubBlockValue(blockId, 'responseFormat')
      const responseFormat = parseResponseFormatSafely(responseFormatValue, blockId)
      if (responseFormat) {
        const fields = extractFieldsFromSchema(responseFormat)
        if (fields.length > 0) return fields.map((f: any) => f.name)
      }

      if (blk.type === 'evaluator') {
        const metricsValue = getSubBlockValue(blockId, 'metrics')
        if (metricsValue && Array.isArray(metricsValue) && metricsValue.length > 0) {
          const valid = metricsValue.filter((m: { name?: string }) => m?.name)
          return valid.map((m: { name: string }) => m.name.toLowerCase())
        }
        return generateOutputPaths(cfg.outputs || {})
      }

      if (blk.type === 'starter') {
        const startWorkflowValue = getSubBlockValue(blockId, 'startWorkflow')
        if (startWorkflowValue === 'chat') {
          return ['input', 'conversationId', 'files']
        }
        const inputFormatValue = getSubBlockValue(blockId, 'inputFormat')
        if (inputFormatValue && Array.isArray(inputFormatValue)) {
          return inputFormatValue
            .filter((f: { name?: string }) => f.name && f.name.trim() !== '')
            .map((f: { name: string }) => f.name)
        }
        return []
      }

      if (blk.triggerMode && cfg.triggers?.enabled) {
        const triggerId = cfg?.triggers?.available?.[0]
        const firstTrigger = triggerId ? getTrigger(triggerId) : getTriggersByProvider(blk.type)[0]
        if (firstTrigger?.outputs) {
          return generateOutputPaths(firstTrigger.outputs)
        }
      }

      const operationValue = getSubBlockValue(blockId, 'operation')
      if (operationValue && cfg?.tools?.config?.tool) {
        try {
          const toolId = cfg.tools.config.tool({ operation: operationValue })
          const toolConfig = toolId ? getTool(toolId) : null
          if (toolConfig?.outputs) return generateOutputPaths(toolConfig.outputs)
        } catch {}
      }

      return generateOutputPaths(cfg.outputs || {})
    }

    const edges = currentWorkflow.edges || []
    const accessibleIds = new Set<string>(
      BlockPathCalculator.findAllPathNodes(edges, focusedBlockId)
    )

    // Always allow referencing the starter block
    if (starterId && starterId !== focusedBlockId) accessibleIds.add(starterId)

    const entries: Array<{ ref: string; value: any }> = []

    // Helper: collect executed outputs including virtual parallel iterations and loop/parallel context items
    const collectExecutedOutputs = (baseId: string): Record<string, any>[] => {
      const collected: Record<string, any>[] = []
      const bs = debugContext?.blockStates
      if (bs) {
        const direct = bs.get(baseId)?.output
        if (direct && typeof direct === 'object') collected.push(direct)
        // Include virtual executions for parallels
        try {
          for (const [key, state] of bs.entries()) {
            const mapping = debugContext?.parallelBlockMapping?.get(key as any)
            if (mapping && mapping.originalBlockId === baseId && state?.output) {
              collected.push(state.output as any)
            }
          }
        } catch {}
      }
      return collected
    }

    // Add loop/parallel special variables if block is inside a loop or parallel
    const addLoopParallelVariables = () => {
      if (!debugContext) return

      // Check if focused block is inside a loop
      for (const [loopId, loop] of Object.entries(currentWorkflow.loops || {})) {
        if ((loop as any).nodes?.includes(focusedBlockId)) {
          // Add loop.item and loop.index references
          const loopItem = debugContext.loopItems?.get(loopId)
          const loopIndex = debugContext.loopIterations?.get(loopId)
          const loopItems = debugContext.loopItems?.get(`${loopId}_items`)

          if (loopItem !== undefined) {
            entries.push({ ref: '<loop.item>', value: loopItem })
          }
          if (loopIndex !== undefined) {
            entries.push({ ref: '<loop.index>', value: loopIndex })
          }
          if (loopItems !== undefined) {
            entries.push({ ref: '<loop.items>', value: loopItems })
          }

          // Also add references for the loop block itself if it has executed
          const loopBlock = blockById.get(loopId)
          if (loopBlock) {
            const loopName = normalizeBlockName(getDisplayName(loopBlock))
            if (loopItem !== undefined) {
              entries.push({ ref: `<${loopName}.item>`, value: loopItem })
            }
            if (loopIndex !== undefined) {
              entries.push({ ref: `<${loopName}.index>`, value: loopIndex })
            }
            if (loopItems !== undefined) {
              entries.push({ ref: `<${loopName}.items>`, value: loopItems })
            }
          }
        }
      }

      // Check if focused block is inside a parallel
      for (const [parallelId, parallel] of Object.entries(currentWorkflow.parallels || {})) {
        if ((parallel as any).nodes?.includes(focusedBlockId)) {
          // Check for virtual block execution to get iteration info
          const parallelState = debugContext.parallelExecutions?.get(parallelId)
          if (parallelState) {
            // Get current iteration context
            const currentVirtualId = debugContext.currentVirtualBlockId
            if (currentVirtualId) {
              const mapping = debugContext.parallelBlockMapping?.get(currentVirtualId)
              if (mapping) {
                const iterationIndex = mapping.iterationIndex
                const parallelItems = debugContext.loopItems?.get(`${parallelId}_items`)
                const parallelItem = parallelItems
                  ? Array.isArray(parallelItems)
                    ? parallelItems[iterationIndex]
                    : Object.values(parallelItems)[iterationIndex]
                  : undefined

                if (parallelItem !== undefined) {
                  entries.push({ ref: '<parallel.item>', value: parallelItem })
                }
                entries.push({ ref: '<parallel.index>', value: iterationIndex })
                if (parallelItems !== undefined) {
                  entries.push({ ref: '<parallel.items>', value: parallelItems })
                }

                // Also add references for the parallel block itself
                const parallelBlock = blockById.get(parallelId)
                if (parallelBlock) {
                  const parallelName = normalizeBlockName(getDisplayName(parallelBlock))
                  if (parallelItem !== undefined) {
                    entries.push({ ref: `<${parallelName}.item>`, value: parallelItem })
                  }
                  entries.push({ ref: `<${parallelName}.index>`, value: iterationIndex })
                  if (parallelItems !== undefined) {
                    entries.push({ ref: `<${parallelName}.items>`, value: parallelItems })
                  }
                }
              }
            }
          }
        }
      }
    }

    for (const id of accessibleIds) {
      const blk = blockById.get(id)
      if (!blk) continue

      const allowedPathsSet = new Set<string>(getAccessiblePathsForBlock(id))
      if (allowedPathsSet.size === 0) continue

      const displayName = getDisplayName(blk)
      const normalizedName = normalizeBlockName(displayName)

      // Gather executed outputs (direct and virtual)
      const executedOutputs = collectExecutedOutputs(id)

      // Flatten helper over multiple outputs with last-wins per path
      const pathToValue = new Map<string, any>()
      const flatten = (obj: any, prefix = ''): Array<{ path: string; value: any }> => {
        if (obj == null || typeof obj !== 'object') return []
        const items: Array<{ path: string; value: any }> = []
        for (const [k, v] of Object.entries(obj)) {
          const current = prefix ? `${prefix}.${k}` : k
          if (v && typeof v === 'object' && !Array.isArray(v)) {
            if (allowedPathsSet.has(current)) items.push({ path: current, value: v })
            items.push(...flatten(v, current))
          } else {
            if (allowedPathsSet.has(current)) items.push({ path: current, value: v })
          }
        }
        return items
      }

      for (const out of executedOutputs) {
        const pairs = flatten(out)
        for (const { path, value } of pairs) {
          pathToValue.set(path, value)
        }
      }

      for (const [path, value] of pathToValue.entries()) {
        entries.push({ ref: `<${normalizedName}.${path}>`, value })
      }
    }

    // Add loop/parallel context variables
    addLoopParallelVariables()

    // Sort for stable UI (by ref)
    entries.sort((a, b) => a.ref.localeCompare(b.ref))
    return entries
  }, [
    focusedBlockId,
    currentWorkflow.edges,
    currentWorkflow.loops,
    currentWorkflow.parallels,
    starterId,
    blockById,
    executionVersion,
    debugContext,
  ])

  // Compute all possible refs from accessible blocks regardless of execution state
  const allPossibleVariableRefs = useMemo(() => {
    if (!focusedBlockId) return new Set<string>()

    const normalizeBlockName = (name: string) => (name || '').replace(/\s+/g, '').toLowerCase()
    const edges = currentWorkflow.edges || []
    const accessibleIds = new Set<string>(
      BlockPathCalculator.findAllPathNodes(edges, focusedBlockId)
    )
    if (starterId && starterId !== focusedBlockId) accessibleIds.add(starterId)

    const refs = new Set<string>()

    const getAccessiblePathsForBlock = (blockId: string): string[] => {
      const blk = blockById.get(blockId)
      if (!blk) return []
      const cfg = getBlock(blk.type)
      if (!cfg) return []

      const getSubBlockValue = (id: string, property: string): any => {
        return useSubBlockStore.getState().getValue(id, property)
      }

      const generateOutputPaths = (outputs: Record<string, any>, prefix = ''): string[] => {
        const paths: string[] = []
        for (const [key, value] of Object.entries(outputs || {})) {
          const current = prefix ? `${prefix}.${key}` : key
          if (typeof value === 'string') {
            paths.push(current)
          } else if (value && typeof value === 'object') {
            if ('type' in value && typeof (value as any).type === 'string') {
              paths.push(current)
              if ((value as any).type === 'object' && (value as any).properties) {
                paths.push(...generateOutputPaths((value as any).properties, current))
              } else if ((value as any).type === 'array' && (value as any).items?.properties) {
                paths.push(...generateOutputPaths((value as any).items.properties, current))
              }
            } else {
              paths.push(...generateOutputPaths(value as Record<string, any>, current))
            }
          } else {
            paths.push(current)
          }
        }
        return paths
      }

      // Response format overrides
      const responseFormatValue = getSubBlockValue(blockId, 'responseFormat')
      const responseFormat = parseResponseFormatSafely(responseFormatValue, blockId)
      if (responseFormat) {
        const fields = extractFieldsFromSchema(responseFormat)
        if (fields.length > 0) return fields.map((f: any) => f.name)
      }

      if (blk.type === 'evaluator') {
        const metricsValue = getSubBlockValue(blockId, 'metrics')
        if (metricsValue && Array.isArray(metricsValue) && metricsValue.length > 0) {
          const valid = metricsValue.filter((m: { name?: string }) => m?.name)
          return valid.map((m: { name: string }) => m.name.toLowerCase())
        }
        return generateOutputPaths(cfg.outputs || {})
      }

      if (blk.type === 'starter') {
        const startWorkflowValue = getSubBlockValue(blockId, 'startWorkflow')
        if (startWorkflowValue === 'chat') {
          return ['input', 'conversationId', 'files']
        }
        const inputFormatValue = getSubBlockValue(blockId, 'inputFormat')
        if (inputFormatValue && Array.isArray(inputFormatValue)) {
          return inputFormatValue
            .filter((f: { name?: string }) => f.name && f.name.trim() !== '')
            .map((f: { name: string }) => f.name)
        }
        return []
      }

      if (blk.triggerMode && cfg.triggers?.enabled) {
        const triggerId = cfg?.triggers?.available?.[0]
        const firstTrigger = triggerId ? getTrigger(triggerId) : getTriggersByProvider(blk.type)[0]
        if (firstTrigger?.outputs) {
          return generateOutputPaths(firstTrigger.outputs)
        }
      }

      const operationValue = getSubBlockValue(blockId, 'operation')
      if (operationValue && cfg?.tools?.config?.tool) {
        try {
          const toolId = cfg.tools.config.tool({ operation: operationValue })
          const toolConfig = toolId ? getTool(toolId) : null
          if (toolConfig?.outputs) return generateOutputPaths(toolConfig.outputs)
        } catch {}
      }

      return generateOutputPaths(cfg.outputs || {})
    }

    for (const id of accessibleIds) {
      const blk = blockById.get(id)
      if (!blk) continue
      const displayName = getDisplayName(blk)
      const normalizedName = normalizeBlockName(displayName)
      const paths = getAccessiblePathsForBlock(id)
      for (const path of paths) refs.add(`<${normalizedName}.${path}>`)
    }

    return refs
  }, [focusedBlockId, currentWorkflow.edges, starterId, blockById])

  // Filter output variables based on whether they're referenced in the input
  const filteredOutputVariables = useMemo(() => {
    // Build map of available executed entries for quick lookup
    const availableVarsMap = new Map(outputVariableEntries.map((entry) => [entry.ref, entry]))

    if (!scopedVariables) {
      // Show all possible upstream refs; mark as resolved if present in executed outputs
      const result: Array<{ ref: string; value: any; resolved: boolean }> = []
      allPossibleVariableRefs.forEach((ref) => {
        const available = availableVarsMap.get(ref)
        if (available) {
          result.push({ ...available, resolved: true })
        } else {
          result.push({ ref, value: undefined, resolved: false })
        }
      })
      result.sort((a, b) => {
        if (a.resolved !== b.resolved) return a.resolved ? -1 : 1
        return a.ref.localeCompare(b.ref)
      })
      return result
    }

    // Get the JSON string of visible subblock values to search for references
    const inputValuesStr = JSON.stringify(visibleSubblockValues)

    // Extract all variable references from the input using regex
    // Matches patterns like <blockname.property> or <blockname.nested.property>
    const referencePattern = /<([^>]+)>/g
    const referencedVars = new Set<string>()
    let match
    while ((match = referencePattern.exec(inputValuesStr)) !== null) {
      const fullMatch = match[0] // Full reference including < >
      const innerContent = match[1] // Content between < >

      // Exclude workflow variable references (pattern: variable.something)
      if (!innerContent.startsWith('variable.')) {
        referencedVars.add(fullMatch)
      }
    }

    // Build the final list with both resolved and unresolved variables
    const result: Array<{ ref: string; value: any; resolved: boolean }> = []

    // Add all referenced variables (excluding workflow variables)
    for (const ref of referencedVars) {
      const available = availableVarsMap.get(ref)
      if (available) {
        // Variable is resolved (has a value)
        result.push({ ...available, resolved: true })
      } else {
        // Variable is unresolved (referenced but no value yet)
        result.push({ ref, value: undefined, resolved: false })
      }
    }

    // Sort: resolved first, then unresolved, then alphabetically by ref
    result.sort((a, b) => {
      if (a.resolved !== b.resolved) {
        return a.resolved ? -1 : 1
      }
      return a.ref.localeCompare(b.ref)
    })
    return result
  }, [
    outputVariableEntries,
    scopedVariables,
    visibleSubblockValues,
    executionVersion,
    allPossibleVariableRefs,
  ])

  // Filter workflow variables based on whether they're referenced in the input
  const filteredWorkflowVariables = useMemo(() => {
    // Get all workflow variables from the store
    const storeVariables = workflowVariablesFromStore

    if (!scopedVariables) {
      // Show all workflow variables from the store
      return storeVariables.map((variable) => ({
        id: variable.id,
        name: variable.name,
        value: variable.value,
        type: variable.type,
      }))
    }

    // For scoped view, look at the entire focused block's data
    // This includes all subBlocks values, not just the visible ones
    if (!focusedBlock) {
      return []
    }

    // Get all subblock values from the store for this block
    const allSubBlockValues: Record<string, any> = {}
    if (focusedBlockId && activeWorkflowId) {
      const allBlocks = useWorkflowStore.getState().blocks
      const merged = mergeSubblockState(allBlocks, activeWorkflowId, focusedBlockId)[focusedBlockId]
      const stateToUse = merged?.subBlocks || {}

      // Extract all values from subBlocks
      for (const [key, subBlock] of Object.entries(stateToUse)) {
        if (subBlock && typeof subBlock === 'object' && 'value' in subBlock) {
          allSubBlockValues[key] = subBlock.value
        }
      }
    }

    // Search for workflow variable references in all subblock values
    const blockDataStr = JSON.stringify(allSubBlockValues)

    // Extract workflow variable references using pattern <variable.name>
    const variablePattern = /<variable\.([^>]+)>/g
    const referencedVarNames = new Set<string>()
    let match
    while ((match = variablePattern.exec(blockDataStr)) !== null) {
      referencedVarNames.add(match[1]) // Add just the variable name part
    }

    // Filter workflow variables to only those referenced
    return storeVariables
      .filter((variable) => {
        // Normalize the variable name (remove spaces) to match how it's referenced
        const normalizedName = (variable.name || '').replace(/\s+/g, '')
        return referencedVarNames.has(normalizedName)
      })
      .map((variable) => ({
        id: variable.id,
        name: variable.name,
        value: variable.value,
        type: variable.type,
      }))
  }, [workflowVariablesFromStore, scopedVariables, focusedBlock, focusedBlockId, activeWorkflowId])

  // Filter environment variables based on whether they're referenced in the input
  const filteredEnvVariables = useMemo(() => {
    // Helper function to recursively extract env var references from any value
    const extractEnvVarReferences = (value: any, fieldName?: string): Set<string> => {
      const refs = new Set<string>()

      if (typeof value === 'string') {
        // Check if this is an API key field (by field name)
        const isApiKeyField =
          fieldName &&
          (fieldName.toLowerCase().includes('apikey') ||
            fieldName.toLowerCase().includes('api_key') ||
            fieldName.toLowerCase().includes('secretkey') ||
            fieldName.toLowerCase().includes('secret_key') ||
            fieldName.toLowerCase().includes('accesskey') ||
            fieldName.toLowerCase().includes('access_key') ||
            fieldName.toLowerCase().includes('token'))

        // Check if entire string is just {{ENV_VAR}}
        const isExplicitEnvVar = value.trim().match(/^\{\{[^{}]+\}\}$/)

        // Check for env vars in specific contexts (Bearer tokens, URLs, headers, etc.)
        const hasProperContext =
          /Bearer\s+\{\{[^{}]+\}\}/i.test(value) ||
          /Authorization:\s+Bearer\s+\{\{[^{}]+\}\}/i.test(value) ||
          /Authorization:\s+\{\{[^{}]+\}\}/i.test(value) ||
          /[?&]api[_-]?key=\{\{[^{}]+\}\}/i.test(value) ||
          /[?&]key=\{\{[^{}]+\}\}/i.test(value) ||
          /[?&]token=\{\{[^{}]+\}\}/i.test(value) ||
          /X-API-Key:\s+\{\{[^{}]+\}\}/i.test(value) ||
          /api[_-]?key:\s+\{\{[^{}]+\}\}/i.test(value)

        // Extract env vars if this field should be processed
        if (isApiKeyField || isExplicitEnvVar || hasProperContext) {
          const envPattern = /\{\{([^}]+)\}\}/g
          let match
          while ((match = envPattern.exec(value)) !== null) {
            refs.add(match[1])
          }
        }
      } else if (Array.isArray(value)) {
        // Recursively process arrays
        value.forEach((item, index) => {
          const itemRefs = extractEnvVarReferences(
            item,
            fieldName ? `${fieldName}[${index}]` : undefined
          )
          itemRefs.forEach((ref) => refs.add(ref))
        })
      } else if (value && typeof value === 'object') {
        // Recursively process objects
        Object.entries(value).forEach(([key, val]) => {
          const itemRefs = extractEnvVarReferences(val, key)
          itemRefs.forEach((ref) => refs.add(ref))
        })
      }

      return refs
    }

    if (!scopedVariables) {
      // Show all environment variables that are referenced anywhere in the workflow
      const allEnvVarRefs = new Set<string>()

      for (const block of blocksList) {
        if (activeWorkflowId) {
          const allBlocks = useWorkflowStore.getState().blocks
          const merged = mergeSubblockState(allBlocks, activeWorkflowId, block.id)[block.id]
          const stateToUse = merged?.subBlocks || {}

          // Process each subblock value with its field name
          for (const [key, subBlock] of Object.entries(stateToUse)) {
            if (subBlock && typeof subBlock === 'object' && 'value' in subBlock) {
              const refs = extractEnvVarReferences(subBlock.value, key)
              refs.forEach((ref) => allEnvVarRefs.add(ref))
            }
          }
        }
      }

      // Return only env vars that are referenced somewhere in the workflow
      return Object.entries(allEnvVars).filter(([key]) => allEnvVarRefs.has(key))
    }

    // For scoped view, look at the entire focused block's data
    if (!focusedBlock) {
      return []
    }

    // Get all subblock values from the store for this block
    const blockEnvVarRefs = new Set<string>()
    if (focusedBlockId && activeWorkflowId) {
      const allBlocks = useWorkflowStore.getState().blocks
      const merged = mergeSubblockState(allBlocks, activeWorkflowId, focusedBlockId)[focusedBlockId]
      const stateToUse = merged?.subBlocks || {}

      // Process each subblock value with its field name
      for (const [key, subBlock] of Object.entries(stateToUse)) {
        if (subBlock && typeof subBlock === 'object' && 'value' in subBlock) {
          const refs = extractEnvVarReferences(subBlock.value, key)
          refs.forEach((ref) => blockEnvVarRefs.add(ref))
        }
      }
    }

    // Filter environment variables to only those referenced
    return Object.entries(allEnvVars).filter(([key]) => blockEnvVarRefs.has(key))
  }, [allEnvVars, scopedVariables, focusedBlock, focusedBlockId, activeWorkflowId, blocksList])

  // Reset hasStartedRef when debug mode is deactivated
  useEffect(() => {
    if (!isDebugging) {
      hasStartedRef.current = false
      setPanelFocusedBlockId(null)
    }
  }, [isDebugging, setPanelFocusedBlockId])

  // Clear init pending when debug context and initial pending arrive
  useEffect(() => {
    if (hasStartedRef.current && debugContext && Array.isArray(pendingBlocks)) {
      setIsInitPending(false)
    }
  }, [debugContext, pendingBlocks])

  if (!isDebugging) {
    return (
      <div className='flex h-full flex-col items-center justify-center px-6'>
        <div className='flex flex-col items-center gap-3'>
          <div className='rounded-full bg-muted/50 p-4'>
            <AlertCircle className='h-8 w-8 text-muted-foreground/60' />
          </div>
          <p className='font-medium text-muted-foreground text-sm'>Debug mode inactive</p>
          <p className='text-center text-muted-foreground/70 text-xs'>
            Enable debug mode to step through workflow execution
          </p>
        </div>
      </div>
    )
  }

  // Step handler: handles both initial and subsequent steps
  const handleStep = async () => {
    if (!hasStartedRef.current && !debugContext) {
      hasStartedRef.current = true
      setIsInitPending(true)
      if (isChatMode) {
        const text = chatMessage.trim()
        if (!text) {
          hasStartedRef.current = false
          setIsInitPending(false)
          return
        }
        await handleRunWorkflow({ input: text, conversationId: crypto.randomUUID() }, true)
      } else {
        await handleRunWorkflow(undefined, true)
      }
      return
    }

    await handleStepDebug()
  }

  // Restart handler: reset to initial state without starting execution
  const handleRestart = async () => {
    // Do not toggle debug mode off; just reset execution/debug state
    hasStartedRef.current = false
    lastFocusedIdRef.current = null
    setExecutingBlockIds(new Set())
    setActiveBlocks(new Set())
    setPendingBlocks([])
    setDebugContext(null)
    setPanelFocusedBlockId(starterId || null)
    // Ensure executor is cleared so next Step re-initializes fresh
    useExecutionStore.getState().setExecutor(null)
    // Mark starter as current pending for UI so it shows as Current (no execution started)
    if (starterId) {
      setPendingBlocks([starterId])
    }
  }

  // Resume-until-breakpoint handler
  const handleResumeUntilBreakpoint = async () => {
    // If not started yet, initialize the executor (same as first Step)
    if (!useExecutionStore.getState().debugContext && !hasStartedRef.current) {
      hasStartedRef.current = true
      setIsInitPending(true)
      if (isChatMode) {
        const text = chatMessage.trim()
        if (!text) {
          hasStartedRef.current = false
          setIsInitPending(false)
          return
        }
        await handleRunWorkflow({ input: text, conversationId: crypto.randomUUID() }, true)
      } else {
        await handleRunWorkflow(undefined, true)
      }
      // Wait for initialization to populate executor/debugContext/pendingBlocks
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
      let attempts = 0
      while (attempts < 40) {
        // ~2s max
        const st = useExecutionStore.getState()
        if (st.executor && st.debugContext && Array.isArray(st.pendingBlocks)) break
        await wait(50)
        attempts++
      }
    }

    // Use freshest store state after init
    let exec = useExecutionStore.getState().executor
    let ctx = useExecutionStore.getState().debugContext
    let pend = [...useExecutionStore.getState().pendingBlocks]

    if (!exec || !ctx) return

    try {
      let iteration = 0
      const maxIterations = 1000
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

      while (iteration < maxIterations) {
        // Refresh latest state each iteration to avoid stale refs
        const st = useExecutionStore.getState()
        exec = st.executor
        ctx = st.debugContext
        pend = [...st.pendingBlocks]
        if (!exec || !ctx) break

        // Determine executable set
        const executable = breakpointId
          ? pend.filter((id) => {
              if (id === breakpointId) return false
              try {
                const mapping = ctx?.parallelBlockMapping?.get(id)
                if (mapping && mapping.originalBlockId === breakpointId) return false
              } catch {}
              return true
            })
          : pend
        if (executable.length === 0) break

        setExecutingBlockIds(new Set(executable))
        const result = await exec.continueExecution(executable, ctx)
        setExecutingBlockIds(new Set())

        if (result?.metadata?.context) {
          setDebugContext(result.metadata.context)
        }
        if (result?.metadata?.pendingBlocks) {
          setPendingBlocks(result.metadata.pendingBlocks)
        } else {
          break
        }
        if (!result?.metadata?.isDebugSession) break

        iteration++
        // allow UI/state to settle
        await wait(10)
      }
    } catch (e) {
      // Swallow to avoid double error surfaces in UI
    }
  }

  const getStatusIcon = () => {
    if (isFocusedErrored) return <Circle className='h-2 w-2 fill-red-500 text-red-500' />
    if (isFocusedCurrent) return <Circle className='h-2 w-2 fill-emerald-500 text-emerald-500' />
    if (isFocusedExecuted) return <Circle className='h-2 w-2 fill-blue-500 text-blue-500' />
    return <Circle className='h-2 w-2 fill-muted-foreground/40 text-muted-foreground/40' />
  }

  const getStatusText = () => {
    if (isFocusedErrored) return 'Error'
    if (isFocusedCurrent) return 'Current'
    if (isFocusedExecuted) return 'Executed'
    return 'Pending'
  }

  const getResolutionIcon = () => {
    const resolvedCount = filteredOutputVariables.filter((v) => v.resolved).length
    const unresolvedCount = filteredOutputVariables.filter((v) => !v.resolved).length

    if (unresolvedCount === 0) {
      // All resolved - green check
      return <Check className='h-3 w-3 text-emerald-500' />
    }
    if (isFocusedCurrent) {
      // Current block with unresolved variables - red X
      return <X className='h-3 w-3 text-destructive' />
    }
    // Not current but has unresolved variables - yellow dot
    return <Circle className='h-3 w-3 fill-yellow-500 text-yellow-500' />
  }

  return (
    <div className='flex h-full flex-col'>
      {/* Controls Section */}
      <div className='border-border/50 border-b p-3'>
        {isChatMode && !hasStartedRef.current && (
          <div className='mb-3'>
            <Textarea
              placeholder='Enter message to start debugging...'
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              className='min-h-[60px] resize-none border-border/50 bg-background/50 placeholder:text-muted-foreground/50'
            />
          </div>
        )}
        <div className='flex items-center gap-2'>
          <TooltipProvider>
            {/* Revert to Start Pos - leftmost */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size='icon'
                  variant='ghost'
                  onClick={handleRevertToStartPos}
                  aria-label='Revert to Start Pos'
                  className='h-8 w-8 rounded-md bg-purple-500/10 text-purple-600 hover:bg-purple-600 hover:text-white disabled:opacity-40'
                  disabled={isInitPending || executingIds.size > 0}
                >
                  <Undo2 className='h-4 w-4' />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Revert to Start Position</TooltipContent>
            </Tooltip>

            {/* Backstep */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size='icon'
                  variant='ghost'
                  onClick={handleBackstep}
                  aria-label='Backstep'
                  className='h-8 w-8 rounded-md bg-slate-500/10 text-slate-600 hover:bg-slate-600 hover:text-white disabled:opacity-40'
                  disabled={isInitPending || executingIds.size > 0}
                >
                  <StepBack className='h-4 w-4' />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Step back</TooltipContent>
            </Tooltip>

            {/* Divider */}
            <div className='mx-1 h-4 w-px bg-border/50' />

            {/* Step */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size='icon'
                  variant='ghost'
                  onClick={handleStep}
                  aria-label='Step'
                  className='h-8 w-8 rounded-md bg-blue-500/10 text-blue-600 hover:bg-blue-600 hover:text-white disabled:opacity-40'
                  disabled={isInitPending || executingIds.size > 0}
                >
                  <Play className='h-4 w-4' />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Execute next step</TooltipContent>
            </Tooltip>

            {/* Resume */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size='icon'
                  variant='ghost'
                  onClick={handleResumeUntilBreakpoint}
                  disabled={(isInitPending || executingIds.size > 0) || (isChatMode ? !hasStartedRef.current && chatMessage.trim() === '' : false)}
                  aria-label='Resume'
                  className='h-8 w-8 rounded-md bg-indigo-500/10 text-indigo-600 hover:bg-indigo-600 hover:text-white disabled:opacity-40'
                >
                  <FastForward className='h-4 w-4' />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {breakpointId ? 'Continue until breakpoint' : 'Continue execution'}
              </TooltipContent>
            </Tooltip>

            {/* Divider */}
            <div className='mx-1 h-4 w-px bg-border/50' />

            {/* Restart */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size='icon'
                  variant='ghost'
                  onClick={handleRestart}
                  aria-label='Restart'
                  className='h-8 w-8 rounded-md bg-amber-500/10 text-amber-600 hover:bg-amber-600 hover:text-white disabled:opacity-40'
                  disabled={isInitPending || executingIds.size > 0}
                >
                  <RotateCcw className='h-4 w-4' />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Restart from the beginning</TooltipContent>
            </Tooltip>

            {/* Stop */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size='icon'
                  variant='ghost'
                  onClick={handleStopExecutionOnly}
                  aria-label='Stop'
                  className='h-8 w-8 rounded-md bg-red-500/10 text-red-600 hover:bg-red-600 hover:text-white'
                >
                  <Square className='h-4 w-4' />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Stop debugging</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Header Section - Single Line */}
      <div
        className={cn(
          'flex items-center justify-between border-border/50 border-b px-3 py-2.5',
          isFocusedErrored && 'border-red-500'
        )}
      >
        <div className='flex items-center gap-2'>
          <span
            className={cn(
              'truncate font-semibold text-sm',
              isFocusedErrored && 'text-red-600 dark:text-red-400'
            )}
          >
            {focusedBlock ? getDisplayName(focusedBlock) : 'Debug Panel'}
          </span>
          {focusedBlockId && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type='button'
                    onClick={() =>
                      setBreakpointId(breakpointId === focusedBlockId ? null : focusedBlockId)
                    }
                    className='rounded p-0.5 transition-colors hover:bg-muted/50'
                  >
                    <CircleDot
                      className={cn(
                        'h-4 w-4',
                        breakpointId === focusedBlockId
                          ? 'fill-orange-600/20 text-orange-600'
                          : 'text-muted-foreground/50'
                      )}
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {breakpointId === focusedBlockId ? 'Remove breakpoint' : 'Set breakpoint'}
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type='button'
                    onClick={handleToggleStartPos}
                    className='rounded p-0.5 transition-colors hover:bg-muted/50'
                    aria-label='Start Position'
                  >
                    <Flag
                      className={cn(
                        'h-4 w-4',
                        isStartPosActive
                          ? 'text-purple-600'
                          : hasStartPosConflict
                            ? 'text-amber-500'
                            : 'text-muted-foreground/50'
                      )}
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {isStartPosActive
                    ? 'Remove start position'
                    : hasStartPosConflict
                      ? 'Cannot set: conflicts with existing start position'
                      : 'Set start position'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <div className='flex flex-shrink-0 items-center gap-1.5'>
          {getStatusIcon()}
          <span className='text-muted-foreground text-xs'>{getStatusText()}</span>
        </div>
      </div>

      {/* Error Display - Right below header */}
      {isFocusedErrored && (
        <div className='border-red-500 border-b bg-red-50 p-3 dark:bg-red-900/10'>
          <div className='flex items-start gap-2.5'>
            <AlertCircle className='mt-0.5 h-4 w-4 flex-shrink-0 text-red-600 dark:text-red-400' />
            <div className='min-w-0 flex-1'>
              <p className='mb-1 font-medium text-red-900 text-xs dark:text-red-200'>
                Execution Error
              </p>
              <div className='text-red-800 text-xs dark:text-red-300'>
                {(() => {
                  // Get error message from block state or logs
                  const id = focusedBlockId || ''
                  const directState = debugContext?.blockStates.get(id)
                  if (
                    directState?.output &&
                    typeof directState.output === 'object' &&
                    'error' in directState.output
                  ) {
                    return (
                      <pre className='whitespace-pre-wrap break-words font-mono text-[11px]'>
                        {String(directState.output.error)}
                      </pre>
                    )
                  }
                  // Check virtual executions
                  for (const [key, state] of debugContext?.blockStates?.entries() || []) {
                    if (
                      isVirtualForBlock(String(key), id) &&
                      state?.output &&
                      typeof state.output === 'object' &&
                      'error' in state.output
                    ) {
                      return (
                        <pre className='whitespace-pre-wrap break-words font-mono text-[11px]'>
                          {String(state.output.error)}
                        </pre>
                      )
                    }
                  }
                  // Check logs
                  const errorLog = debugContext?.blockLogs?.find(
                    (log) =>
                      (log.blockId === id || resolveOriginalBlockId(log.blockId) === id) && !log.success
                  )
                  if (errorLog?.error) {
                    return (
                      <pre className='whitespace-pre-wrap break-words font-mono text-[11px]'>
                        {String(errorLog.error)}
                      </pre>
                    )
                  }
                  return <span className='text-[11px]'>Unknown error occurred</span>
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area - Split into two sections */}
      <div className='flex flex-1 flex-col overflow-hidden'>
        {/* Top Section - Input/Output */}
        <div className='min-h-0 flex-1 border-border/50 border-b'>
          <Tabs defaultValue='input' className='flex h-full flex-col'>
            <div className='border-border/50 border-b px-3'>
              <TabsList className='h-10 gap-6 bg-transparent p-0'>
                <TabsTrigger
                  value='input'
                  className='h-10 rounded-none border-transparent border-b-2 px-0 pt-3 pb-2.5 font-medium text-muted-foreground text-xs transition-all data-[state=active]:border-foreground data-[state=active]:text-foreground data-[state=active]:shadow-none'
                >
                  Input
                </TabsTrigger>
                <TabsTrigger
                  value='output'
                  className='h-10 rounded-none border-transparent border-b-2 px-0 pt-3 pb-2.5 font-medium text-muted-foreground text-xs transition-all data-[state=active]:border-foreground data-[state=active]:text-foreground data-[state=active]:shadow-none'
                >
                  Output
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value='input' className='m-0 flex-1 overflow-auto p-3'>
              {Object.keys(visibleSubblockValues).length > 0 ? (
                <div className='h-full overflow-x-hidden overflow-y-scroll'>
                  <table className='w-full table-fixed'>
                    <colgroup>
                      <col className='w-[30%] min-w-[120px]' />
                      <col className='w-[70%]' />
                    </colgroup>
                    <thead className='sticky top-0 z-10 bg-background'>
                      <tr className='border-border/50 border-b'>
                        <th className='bg-background px-3 py-2 text-left font-medium text-muted-foreground text-xs'>
                          Field
                        </th>
                        <th className='bg-background px-3 py-2 text-left font-medium text-muted-foreground text-xs'>
                          Value
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(visibleSubblockValues).map(([key, value]) => {
                        const fieldKey = `input-${key}`
                        const isExpanded = expandedFields.has(fieldKey)

                        return (
                          <tr key={key} className='border-border/30 border-b hover:bg-muted/20'>
                            <td className='px-3 py-2 align-top'>
                              <code className='break-words font-mono text-[11px] text-foreground/80'>
                                {key}
                              </code>
                            </td>
                            <td className='px-3 py-2'>
                              <div className='w-full overflow-hidden'>
                                {typeof value === 'object' && value !== null ? (
                                  <div
                                    className='cursor-pointer'
                                    onClick={() => toggleFieldExpansion(fieldKey)}
                                  >
                                    {isExpanded ? (
                                      <pre className='overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-foreground/70'>
                                        {JSON.stringify(value, null, 2)}
                                      </pre>
                                    ) : (
                                      <span className='block truncate font-mono text-[11px] text-muted-foreground hover:text-foreground'>
                                        {JSON.stringify(value).slice(0, 100)}...
                                      </span>
                                    )}
                                  </div>
                                ) : typeof value === 'boolean' ? (
                                  <span
                                    className={cn(
                                      'inline-flex items-center rounded-full px-2 py-0.5 font-medium text-[10px]',
                                      value
                                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                        : 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400'
                                    )}
                                  >
                                    {String(value)}
                                  </span>
                                ) : value === null || value === undefined ? (
                                  <span className='text-[11px] text-muted-foreground italic'>
                                    null
                                  </span>
                                ) : String(value).length > 100 ? (
                                  <div
                                    className='cursor-pointer'
                                    onClick={() => toggleFieldExpansion(fieldKey)}
                                  >
                                    {isExpanded ? (
                                      <span className='whitespace-pre-wrap break-words font-mono text-[11px] text-foreground/70'>
                                        {renderWithTokens(String(value))}
                                      </span>
                                    ) : (
                                      <span className='block truncate font-mono text-[11px] text-muted-foreground hover:text-foreground'>
                                        {renderWithTokens(String(value), { truncateAt: 100 })}
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className='break-words font-mono text-[11px] text-foreground/70'>
                                    {renderWithTokens(String(value))}
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className='flex h-32 items-center justify-center rounded-lg border border-border/50 border-dashed'>
                  <p className='text-muted-foreground/60 text-xs'>No input data available</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value='output' className='m-0 flex-1 overflow-auto p-3'>
              {resolvedOutputKVs && Object.keys(resolvedOutputKVs).length > 0 ? (
                <div className='h-full overflow-x-hidden overflow-y-scroll'>
                  <table className='w-full table-fixed'>
                    <colgroup>
                      <col className='w-[30%] min-w-[120px]' />
                      <col className='w-[70%]' />
                    </colgroup>
                    <thead className='sticky top-0 z-10 bg-background'>
                      <tr className='border-border/50 border-b'>
                        <th className='bg-background px-3 py-2 text-left font-medium text-muted-foreground text-xs'>
                          Field
                        </th>
                        <th className='bg-background px-3 py-2 text-left font-medium text-muted-foreground text-xs'>
                          Value
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(resolvedOutputKVs).map(([key, value]) => {
                        const fieldKey = `output-${key}`
                        const isExpanded = expandedFields.has(fieldKey)

                        return (
                          <tr key={key} className='border-border/30 border-b hover:bg-muted/20'>
                            <td className='px-3 py-2 align-top'>
                              <code className='break-words font-mono text-[11px] text-foreground/80'>
                                {key}
                              </code>
                            </td>
                            <td className='px-3 py-2'>
                              <div className='w-full overflow-hidden'>
                                {typeof value === 'object' && value !== null ? (
                                  <div
                                    className='cursor-pointer'
                                    onClick={() => toggleFieldExpansion(fieldKey)}
                                  >
                                    {isExpanded ? (
                                      <pre className='overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-foreground/70'>
                                        {JSON.stringify(value, null, 2)}
                                      </pre>
                                    ) : (
                                      <span className='block truncate font-mono text-[11px] text-muted-foreground hover:text-foreground'>
                                        {JSON.stringify(value).slice(0, 100)}...
                                      </span>
                                    )}
                                  </div>
                                ) : typeof value === 'boolean' ? (
                                  <span
                                    className={cn(
                                      'inline-flex items-center rounded-full px-2 py-0.5 font-medium text-[10px]',
                                      value
                                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                        : 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400'
                                    )}
                                  >
                                    {String(value)}
                                  </span>
                                ) : value === null || value === undefined ? (
                                  <span className='text-[11px] text-muted-foreground italic'>
                                    {value === null ? 'null' : 'undefined'}
                                  </span>
                                ) : String(value).length > 100 ? (
                                  <div
                                    className='cursor-pointer'
                                    onClick={() => toggleFieldExpansion(fieldKey)}
                                  >
                                    {isExpanded ? (
                                      <span className='whitespace-pre-wrap break-words font-mono text-[11px] text-foreground/70'>
                                        {renderWithTokens(String(value))}
                                      </span>
                                    ) : (
                                      <span className='block truncate font-mono text-[11px] text-muted-foreground hover:text-foreground'>
                                        {renderWithTokens(String(value), { truncateAt: 100 })}
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className='break-words font-mono text-[11px] text-foreground/70'>
                                    {renderWithTokens(String(value))}
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className='flex h-32 items-center justify-center rounded-lg border border-border/50 border-dashed'>
                  <p className='text-muted-foreground/60 text-xs'>No output data available</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        {/* Bottom Section - Variables Tables */}
        <div className='min-h-0 flex-1'>
          <Tabs
            value={bottomTab}
            onValueChange={(v) => setBottomTab(v as any)}
            className='flex h-full flex-col'
          >
            <div className='flex items-center justify-between border-border/50 border-b px-3'>
              <TabsList className='h-10 gap-6 bg-transparent p-0'>
                <TabsTrigger
                  value='reference'
                  className='h-10 rounded-none border-transparent border-b-2 px-0 pt-3 pb-2.5 font-medium text-muted-foreground text-xs transition-all data-[state=active]:border-foreground data-[state=active]:text-foreground data-[state=active]:shadow-none'
                >
                  Reference Variables
                  <span className='ml-1.5 text-[10px] text-muted-foreground'>
                    ({filteredOutputVariables.length})
                  </span>
                </TabsTrigger>
                <TabsTrigger
                  value='workflow'
                  className='h-10 rounded-none border-transparent border-b-2 px-0 pt-3 pb-2.5 font-medium text-muted-foreground text-xs transition-all data-[state=active]:border-foreground data-[state=active]:text-foreground data-[state=active]:shadow-none'
                >
                  Workflow Variables
                  <span className='ml-1.5 text-[10px] text-muted-foreground'>
                    ({filteredWorkflowVariables.length})
                  </span>
                </TabsTrigger>
                <TabsTrigger
                  value='environment'
                  className='h-10 rounded-none border-transparent border-b-2 px-0 pt-3 pb-2.5 font-medium text-muted-foreground text-xs transition-all data-[state=active]:border-foreground data-[state=active]:text-foreground data-[state=active]:shadow-none'
                >
                  Environment Variables
                  <span className='ml-1.5 text-[10px] text-muted-foreground'>
                    ({filteredEnvVariables.length})
                  </span>
                </TabsTrigger>
              </TabsList>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className='flex cursor-pointer items-center gap-2 text-xs'
                      onClick={() => setScopedVariables(!scopedVariables)}
                    >
                      <Checkbox
                        checked={scopedVariables}
                        onCheckedChange={(checked) => setScopedVariables(checked as boolean)}
                        className='h-3.5 w-3.5'
                        id='scoped-variables-checkbox'
                      />
                      <label
                        htmlFor='scoped-variables-checkbox'
                        className='cursor-pointer text-muted-foreground'
                      >
                        Scoped
                      </label>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    Only shows relevant references
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            <TabsContent value='reference' className='m-0 flex-1 overflow-auto'>
              <div className='flex h-full flex-col'>
                <div className='flex items-center justify-end border-border/50 border-b px-3 py-2'>
                  <div className='flex items-center gap-1.5'>
                    {scopedVariables && filteredOutputVariables.length > 0 && getResolutionIcon()}
                    <span className='text-[10px] text-muted-foreground'>
                      {scopedVariables
                        ? `${filteredOutputVariables.filter((v) => v.resolved).length} of ${filteredOutputVariables.length}`
                        : `${outputVariableEntries.length}`}{' '}
                      variables
                    </span>
                  </div>
                </div>
                {filteredOutputVariables.length > 0 ? (
                  <div className='flex-1 overflow-x-hidden overflow-y-scroll'>
                    <table className='w-full table-fixed'>
                      <colgroup>
                        <col className='w-[35%] min-w-[150px]' />
                        <col className='w-[65%]' />
                      </colgroup>
                      <thead className='sticky top-0 z-10 bg-background'>
                        <tr className='border-border/50 border-b'>
                          <th className='bg-background px-3 py-2 text-left font-medium text-muted-foreground text-xs'>
                            Reference
                          </th>
                          <th className='bg-background px-3 py-2 text-left font-medium text-muted-foreground text-xs'>
                            Value
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredOutputVariables.map(({ ref, value, resolved }) => {
                          const fieldKey = `ref-${ref}`
                          const isExpanded = expandedFields.has(fieldKey)
                          const valueStr =
                            value !== undefined ? JSON.stringify(value, null, 2) : 'undefined'
                          const shouldTruncate = valueStr.length > 600

                          return (
                            <tr
                              key={ref}
                              ref={(el) => {
                                if (el) refVarRowRefs.current.set(ref, el)
                              }}
                              className={cn(
                                'border-border/30 border-b',
                                resolved ? 'hover:bg-muted/20' : 'opacity-50',
                                highlightedRefVar === ref && 'bg-amber-100 dark:bg-amber-900/30'
                              )}
                            >
                              <td className='px-3 py-2 align-top'>
                                <code
                                  className={cn(
                                    'break-words rounded px-1.5 py-0.5 font-mono text-[11px]',
                                    resolved
                                      ? 'bg-muted/50 text-foreground/80'
                                      : 'bg-muted/30 text-muted-foreground'
                                  )}
                                >
                                  {ref}
                                </code>
                              </td>
                              <td className='px-3 py-2'>
                                {resolved ? (
                                  shouldTruncate ? (
                                    <div
                                      className='cursor-pointer'
                                      onClick={() => toggleFieldExpansion(fieldKey)}
                                    >
                                      <pre className='overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-foreground/70'>
                                        {isExpanded ? valueStr : `${valueStr.slice(0, 600)}...`}
                                      </pre>
                                    </div>
                                  ) : (
                                    <pre className='overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-foreground/70'>
                                      {valueStr}
                                    </pre>
                                  )
                                ) : (
                                  <span className='font-mono text-[11px] text-muted-foreground italic'>
                                    Unresolved
                                  </span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className='flex flex-1 items-center justify-center'>
                    <p className='text-muted-foreground/60 text-xs'>
                      {scopedVariables && outputVariableEntries.length > 0
                        ? 'No variables referenced in input'
                        : 'No reference variables available'}
                    </p>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value='workflow' className='m-0 flex-1 overflow-auto'>
              {filteredWorkflowVariables.length > 0 ? (
                <div className='h-full overflow-x-hidden overflow-y-scroll'>
                  <table className='w-full table-fixed'>
                    <colgroup>
                      <col className='w-[35%] min-w-[150px]' />
                      <col className='w-[65%]' />
                    </colgroup>
                    <thead className='sticky top-0 z-10 bg-background'>
                      <tr className='border-border/50 border-b'>
                        <th className='bg-background px-3 py-2 text-left font-medium text-muted-foreground text-xs'>
                          Variable
                        </th>
                        <th className='bg-background px-3 py-2 text-left font-medium text-muted-foreground text-xs'>
                          Value
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredWorkflowVariables.map((variable) => {
                        const normalizedName = (variable.name || '').replace(/\s+/g, '')
                        const fieldKey = `workflow-${variable.id}`
                        const isExpanded = expandedFields.has(fieldKey)
                        const value = variable.value
                        const valueStr =
                          value !== undefined && value !== null
                            ? JSON.stringify(value, null, 2)
                            : String(value)
                        const shouldTruncate = valueStr.length > 100

                        return (
                          <tr
                            key={variable.id}
                            ref={(el) => {
                              if (el) workflowVarRowRefs.current.set(normalizedName, el)
                            }}
                            className={cn(
                              'border-border/30 border-b hover:bg-muted/20',
                              highlightedWorkflowVar === normalizedName &&
                                'bg-amber-100 dark:bg-amber-900/30'
                            )}
                          >
                            <td className='px-3 py-2 align-top'>
                              <code className='break-words font-mono text-[11px] text-foreground/80'>
                                {variable.name}
                              </code>
                            </td>
                            <td className='px-3 py-2'>
                              {shouldTruncate ? (
                                <div
                                  className='cursor-pointer'
                                  onClick={() => toggleFieldExpansion(fieldKey)}
                                >
                                  <div className='min-w-0 flex-1'>
                                    <pre className='overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-foreground/70'>
                                      {isExpanded ? valueStr : `${valueStr.slice(0, 100)}...`}
                                    </pre>
                                  </div>
                                </div>
                              ) : (
                                <pre className='overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-foreground/70'>
                                  {valueStr}
                                </pre>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className='flex h-full items-center justify-center'>
                  <p className='text-muted-foreground/60 text-xs'>
                    {scopedVariables && workflowVariablesFromStore.length > 0
                      ? 'No workflow variables referenced in input'
                      : 'No workflow variables'}
                  </p>
                </div>
              )}
            </TabsContent>

            <TabsContent value='environment' className='m-0 flex-1 overflow-auto'>
              {filteredEnvVariables.length > 0 ? (
                <div className='h-full overflow-x-hidden overflow-y-scroll'>
                  <table className='w-full table-fixed'>
                    <colgroup>
                      <col className='w-[35%] min-w-[150px]' />
                      <col className='w-[65%]' />
                    </colgroup>
                    <thead className='sticky top-0 z-10 bg-background'>
                      <tr className='border-border/50 border-b'>
                        <th className='bg-background px-3 py-2 text-left font-medium text-muted-foreground text-xs'>
                          Variable
                        </th>
                        <th className='bg-background px-3 py-2 text-left font-medium text-muted-foreground text-xs'>
                          Value
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEnvVariables.map(([key, value]) => {
                        const isRevealed = revealedEnvVars.has(key)
                        const valueStr =
                          value !== undefined && value !== null
                            ? JSON.stringify(value, null, 2)
                            : String(value)
                        const maskedValue = '••••••••'

                        return (
                          <tr
                            key={key}
                            ref={(el) => {
                              if (el) envVarRowRefs.current.set(key, el)
                            }}
                            className={cn(
                              'border-border/30 border-b hover:bg-muted/20',
                              highlightedEnvVar === key && 'bg-amber-100 dark:bg-amber-900/30'
                            )}
                          >
                            <td className='px-3 py-2 align-top'>
                              <code className='break-words font-mono text-[11px] text-foreground/80'>
                                {key}
                              </code>
                            </td>
                            <td className='px-3 py-2'>
                              <button
                                type='button'
                                onClick={() => toggleEnvVarReveal(key)}
                                className='group w-full text-left'
                              >
                                <pre className='overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-foreground/70 transition-colors group-hover:text-foreground'>
                                  {isRevealed ? valueStr : maskedValue}
                                </pre>
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className='flex h-full items-center justify-center'>
                  <p className='text-muted-foreground/60 text-xs'>
                    {scopedVariables && Object.keys(allEnvVars).length > 0
                      ? 'No environment variables referenced in input'
                      : 'No environment variables'}
                  </p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  )
}
