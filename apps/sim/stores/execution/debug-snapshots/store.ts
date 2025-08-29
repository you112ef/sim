import { create } from 'zustand'
import type { ExecutionContext } from '@/executor/types'

interface BlockSnapshot {
  output: any
  executed: boolean
  executionTime?: number
}

interface SnapshotEntry {
  blockSnapshots: Map<string, BlockSnapshot>
  envVarValues?: Record<string, string>
  workflowVariables?: Record<string, any>
  pendingBlocks: string[]
  createdAt: number
}

interface DebugSnapshotState {
  blockSnapshots: Map<string, BlockSnapshot>
  envVarValues?: Record<string, string>
  workflowVariables?: Record<string, any>
  history: SnapshotEntry[]
}

interface DebugSnapshotActions {
  captureFromContext: (ctx: ExecutionContext) => void
  pushFromContext: (ctx: ExecutionContext, pendingBlocks: string[]) => void
  stepBack: () => SnapshotEntry | null
  clear: () => void
}

function buildBlockSnapshots(ctx: ExecutionContext): Map<string, BlockSnapshot> {
  const next = new Map<string, BlockSnapshot>()
  try {
    ctx.blockStates.forEach((state, key) => {
      next.set(String(key), {
        output: state?.output ?? {},
        executed: !!state?.executed,
        executionTime: state?.executionTime,
      })
    })
  } catch {}
  return next
}

export const useDebugSnapshotStore = create<DebugSnapshotState & DebugSnapshotActions>()(
  (set, get) => ({
    blockSnapshots: new Map<string, BlockSnapshot>(),
    envVarValues: undefined,
    workflowVariables: undefined,
    history: [],

    captureFromContext: (ctx: ExecutionContext) => {
      const next = buildBlockSnapshots(ctx)
      set({
        blockSnapshots: next,
        envVarValues: ctx.environmentVariables || undefined,
        workflowVariables: ctx.workflowVariables || undefined,
      })
    },

    pushFromContext: (ctx: ExecutionContext, pendingBlocks: string[]) => {
      const entry: SnapshotEntry = {
        blockSnapshots: buildBlockSnapshots(ctx),
        envVarValues: ctx.environmentVariables || undefined,
        workflowVariables: ctx.workflowVariables || undefined,
        pendingBlocks: [...pendingBlocks],
        createdAt: Date.now(),
      }
      set((state) => ({ history: [...state.history, entry] }))
    },

    stepBack: () => {
      const { history } = get()
      if (history.length <= 1) return null
      const nextHistory = history.slice(0, -1)
      const prev = nextHistory[nextHistory.length - 1]
      set({
        history: nextHistory,
        blockSnapshots: prev.blockSnapshots,
        envVarValues: prev.envVarValues,
        workflowVariables: prev.workflowVariables,
      })
      return prev
    },

    clear: () =>
      set({
        blockSnapshots: new Map(),
        envVarValues: undefined,
        workflowVariables: undefined,
        history: [],
      }),
  })
)
