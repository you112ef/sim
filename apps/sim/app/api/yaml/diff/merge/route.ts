import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { SIM_AGENT_API_URL_DEFAULT } from '@/lib/sim-agent'
import { generateRequestId } from '@/lib/utils'
import { getAllBlocks } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'
import { resolveOutputType } from '@/blocks/utils'
import {
  convertLoopBlockToLoop,
  convertParallelBlockToParallel,
  findAllDescendantNodes,
  findChildNodes,
  generateLoopBlocks,
  generateParallelBlocks,
} from '@/stores/workflows/workflow/utils'

const logger = createLogger('YamlDiffMergeAPI')

// Sim Agent API configuration
const SIM_AGENT_API_URL = env.SIM_AGENT_API_URL || SIM_AGENT_API_URL_DEFAULT

const MergeDiffRequestSchema = z.object({
  existingDiff: z.object({
    proposedState: z.object({
      blocks: z.record(z.any()),
      edges: z.array(z.any()),
      loops: z.record(z.any()).optional(),
      parallels: z.record(z.any()).optional(),
    }),
    diffAnalysis: z.any().optional(),
    metadata: z.object({
      source: z.string(),
      timestamp: z.number(),
    }),
  }),
  yamlContent: z.string().min(1),
  diffAnalysis: z.any().optional(),
  options: z
    .object({
      applyAutoLayout: z.boolean().optional(),
      layoutOptions: z.any().optional(),
    })
    .optional(),
})

/**
 * Preserve positions from a baseline workflow for unchanged/edited blocks.
 * Place new blocks relative to their nearest preserved neighbors.
 */
function preserveBlockPositions(
  proposedState: any,
  baselineState: any,
  diffAnalysis?: {
    new_blocks?: string[]
    edited_blocks?: string[]
    deleted_blocks?: string[]
  }
) {
  if (!proposedState || !baselineState) return

  const proposedBlocks: Record<string, any> = proposedState.blocks || {}
  const baselineBlocks: Record<string, any> = baselineState.blocks || {}
  const edges: any[] = proposedState.edges || []

  const baselineIds = new Set(Object.keys(baselineBlocks))
  const proposedIds = new Set(Object.keys(proposedBlocks))

  const newBlocks = new Set(
    diffAnalysis?.new_blocks && diffAnalysis.new_blocks.length > 0
      ? diffAnalysis.new_blocks
      : Array.from(proposedIds).filter((id) => !baselineIds.has(id))
  )

  const NODE_WIDTH_DEFAULT = 350
  const NODE_WIDTH_WIDE = 450
  const NODE_HEIGHT_MIN = 100
  const H = 500 // preferred horizontal spacing
  const V = 200 // preferred vertical spacing
  const MIN_H_GAP = 400 // minimal acceptable horizontal gap

  const getParent = (b: any) => b?.data?.parentId || b?.parentId || null
  const getWidth = (b: any) => (b?.isWide ? NODE_WIDTH_WIDE : NODE_WIDTH_DEFAULT)
  const getHeight = (b: any) => Math.max(Number(b?.height || 0), NODE_HEIGHT_MIN)

  // First pass: preserve positions for surviving (non-new) blocks where parent hasn't changed
  for (const id of proposedIds) {
    if (newBlocks.has(id)) continue
    const base = baselineBlocks[id]
    const prop = proposedBlocks[id]
    if (!base || !prop) continue

    const baseParent = getParent(base)
    const propParent = getParent(prop)

    if (base?.position && (baseParent === propParent || (!baseParent && !propParent))) {
      prop.position = { x: Number(base.position.x) || 0, y: Number(base.position.y) || 0 }
    }
  }

  // Occupied positions set (grid-based) for quick collision avoidance of new placements
  const occupied = new Set<string>()
  const keyOf = (x: number, y: number) => `${Math.round(x)}:${Math.round(y)}`
  Object.values(proposedBlocks).forEach((b: any) => {
    if (b?.position) occupied.add(keyOf(b.position.x, b.position.y))
  })

  const preservedPositions = Object.values(proposedBlocks)
    .filter((b: any) => b?.position && !newBlocks.has(b.id))
    .map((b: any) => b.position)

  let bboxMaxX = preservedPositions.length > 0 ? Math.max(...preservedPositions.map((p: any) => p.x)) : 0
  let bboxMinY = preservedPositions.length > 0 ? Math.min(...preservedPositions.map((p: any) => p.y)) : 0
  let appendRowIndex = 0

  // Graph helpers
  const incoming = new Map<string, any[]>()
  const outgoing = new Map<string, any[]>()
  edges.forEach((e: any) => {
    if (!incoming.has(e.target)) incoming.set(e.target, [])
    if (!outgoing.has(e.source)) outgoing.set(e.source, [])
    incoming.get(e.target)!.push(e)
    outgoing.get(e.source)!.push(e)
  })

  // Place a new block near preserved neighbors and return final position
  const placeNewBlock = (id: string) => {
    const block = proposedBlocks[id]
    if (!block) return

    const preds = (incoming.get(id) || [])
      .map((e) => proposedBlocks[e.source])
      .filter((b) => b && !newBlocks.has(b.id))
    const succs = (outgoing.get(id) || [])
      .map((e) => proposedBlocks[e.target])
      .filter((b) => b && !newBlocks.has(b.id))

    const parentId = getParent(block)
    const leftRef = preds
      .filter((b) => getParent(b) === parentId)
      .sort((a, b) => a.position.x - b.position.x)
      .slice(-1)[0]
    const rightRef = succs
      .filter((b) => getParent(b) === parentId)
      .sort((a, b) => a.position.x - b.position.x)[0]

    let x: number
    let y: number

    if (leftRef) {
      x = leftRef.position.x + H
      y = leftRef.position.y
    } else if (succs.length > 0) {
      // If only right neighbor exists, place to its left if possible
      const r = rightRef
      x = r ? r.position.x - H : bboxMaxX + H
      y = r ? r.position.y : bboxMinY + appendRowIndex * V
    } else if (preservedPositions.length > 0) {
      // Append to the right of the current bbox
      x = bboxMaxX + H
      y = bboxMinY + appendRowIndex * V
      appendRowIndex += 1
      if (appendRowIndex > 5) {
        appendRowIndex = 0
        bboxMaxX += H
      }
    } else {
      // Fallback origin for an empty canvas
      x = 150
      y = 300
    }

    // Nudge down to avoid exact grid collisions
    let attempts = 0
    while (occupied.has(keyOf(x, y)) && attempts < 10) {
      y += V
      attempts += 1
    }

    block.position = { x, y }
    occupied.add(keyOf(x, y))
  }

  // Shift a chain of nodes to the right within the same parent container
  const shiftChainRight = (startId: string, deltaX: number, parentId: string | null, visited = new Set<string>()) => {
    const queue: string[] = [startId]
    while (queue.length) {
      const id = queue.shift()!
      if (visited.has(id)) continue
      visited.add(id)
      const node = proposedBlocks[id]
      if (!node) continue
      if (getParent(node) !== parentId) continue
      if (!node.position) continue
      node.position = { x: Number(node.position.x || 0) + deltaX, y: Number(node.position.y || 0) }
      ;(outgoing.get(id) || []).forEach((e) => queue.push(e.target))
    }
  }

  // Place new blocks first
  for (const id of newBlocks) {
    placeNewBlock(id)
  }

  // For each new block inserted between preserved neighbors, ensure right neighbor chain is shifted to maintain min gap
  for (const id of newBlocks) {
    const block = proposedBlocks[id]
    if (!block?.position) continue
    const parentId = getParent(block)

    const preds = (incoming.get(id) || [])
      .map((e) => proposedBlocks[e.source])
      .filter((b) => b && !newBlocks.has(b.id) && getParent(b) === parentId)
      .sort((a, b) => a.position.x - b.position.x)
    const succs = (outgoing.get(id) || [])
      .map((e) => proposedBlocks[e.target])
      .filter((b) => b && !newBlocks.has(b.id) && getParent(b) === parentId)
      .sort((a, b) => a.position.x - b.position.x)

    const leftRef = preds.slice(-1)[0]
    const rightRef = succs[0]

    // If we have a right neighbor, enforce minimal horizontal gap by shifting its chain
    if (rightRef?.position) {
      const neededRight = block.position.x + Math.max(MIN_H_GAP, getWidth(block))
      if (rightRef.position.x < neededRight) {
        const delta = neededRight - rightRef.position.x
        shiftChainRight(rightRef.id, delta, parentId)
      }
    }

    // If leftRef exists and block was placed too close, push the block right
    if (leftRef?.position) {
      const minX = leftRef.position.x + Math.max(MIN_H_GAP, getWidth(leftRef))
      if (block.position.x < minX) {
        const delta = minX - block.position.x
        block.position.x += delta
      }
    }
  }

  // Lightweight collision resolver within same parent: left-to-right pass
  const byX = Object.values(proposedBlocks)
    .filter((b: any) => b?.position)
    .sort((a: any, b: any) => a.position.x - b.position.x)

  for (let i = 0; i < byX.length; i++) {
    const a = byX[i]
    const parentA = getParent(a)
    for (let j = i + 1; j < byX.length; j++) {
      const b = byX[j]
      if (getParent(b) !== parentA) continue
      const ax1 = a.position.x
      const ax2 = a.position.x + getWidth(a)
      const bx1 = b.position.x
      const bw = getWidth(b)
      const ay1 = a.position.y
      const ay2 = a.position.y + getHeight(a)
      const by1 = b.position.y
      const by2 = b.position.y + getHeight(b)
      const verticalOverlap = !(ay2 <= by1 || by2 <= ay1)
      if (!verticalOverlap) continue
      const desiredBx = Math.max(bx1, ax2 + (MIN_H_GAP - (ax2 - ax1)))
      if (bx1 < desiredBx) {
        const delta = desiredBx - bx1
        shiftChainRight(b.id, delta, parentA)
      }
    }
  }

  // Global vertical-overlap resolver (handles overlaps across different parents/branches)
  const getRect = (n: any) => ({
    x1: Number(n.position.x || 0),
    x2: Number(n.position.x || 0) + getWidth(n),
    y1: Number(n.position.y || 0),
    y2: Number(n.position.y || 0) + getHeight(n),
    id: n.id,
  })

  // Just shift the single node, not a whole column
  const shiftNodeDown = (node: any, deltaY: number) => {
    if (!node?.position || deltaY <= 0) return
    node.position = { 
      x: node.position.x, 
      y: node.position.y + deltaY 
    }
  }

  let changed = true
  let safeGuard = 0
  while (changed && safeGuard < 12) {
    changed = false
    safeGuard += 1
    const nodes = Object.values(proposedBlocks).filter((b: any) => b?.position)
    nodes.sort((a: any, b: any) => a.position.x - b.position.x)
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i]
      const ra = getRect(a)
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j]
        const rb = getRect(b)
        const overlapX = !(ra.x2 <= rb.x1 || rb.x2 <= ra.x1)
        const overlapY = !(ra.y2 <= rb.y1 || rb.y2 <= ra.y1)
        if (overlapX && overlapY) {
          const typeOf = (n: any) => (proposedBlocks[n.id]?.type || '').toString()
          const aIsContainer = typeOf(a) === 'loop' || typeOf(a) === 'parallel'
          const bIsContainer = typeOf(b) === 'loop' || typeOf(b) === 'parallel'
          const aIsNew = newBlocks.has(a.id)
          const bIsNew = newBlocks.has(b.id)

          // Pick target to move: prefer moving the branch with new blocks; avoid moving containers if possible; otherwise move the right-most
          let target = b
          if (bIsNew && !aIsNew) target = b
          else if (aIsNew && !bIsNew) target = a
          else if (!aIsContainer && bIsContainer) target = a
          else if (aIsContainer && !bIsContainer) target = b
          else target = ra.x1 <= rb.x1 ? b : a

          // Compute minimal downward delta to clear vertical overlap
          const minVerticalGap = Math.ceil(V / 4)
          let deltaY = 0
          if (target === b) {
            deltaY = Math.max(ra.y2 - rb.y1 + minVerticalGap, 0)
          } else {
            deltaY = Math.max(rb.y2 - ra.y1 + minVerticalGap, 0)
          }

          if (deltaY > 0) {
            shiftNodeDown(target, deltaY)
            changed = true
          }

          break
        }
      }
      if (changed) break
    }
  }

  // Final global overlap removal - simple brute force approach
  // Sort all blocks by position and ensure no overlaps
  const allNodes = Object.values(proposedBlocks)
    .filter((n: any) => n?.position)
    .map((n: any) => ({ node: n, rect: getRect(n) }))
  
  // Sort by x then y
  allNodes.sort((a, b) => {
    if (Math.abs(a.rect.x1 - b.rect.x1) < 10) {
      return a.rect.y1 - b.rect.y1
    }
    return a.rect.x1 - b.rect.x1
  })

  // Check each pair and fix overlaps
  for (let iter = 0; iter < 10; iter++) {
    let hasOverlap = false
    
    for (let i = 0; i < allNodes.length; i++) {
      for (let j = i + 1; j < allNodes.length; j++) {
        const a = allNodes[i]
        const b = allNodes[j]
        
        const overlapX = !(a.rect.x2 <= b.rect.x1 || b.rect.x2 <= a.rect.x1)
        const overlapY = !(a.rect.y2 <= b.rect.y1 || b.rect.y2 <= a.rect.y1)
        
        if (overlapX && overlapY) {
          hasOverlap = true
          // Move the second node down to clear the overlap
          const deltaY = a.rect.y2 - b.rect.y1 + V / 2
          b.node.position.y += deltaY
          b.rect.y1 += deltaY
          b.rect.y2 += deltaY
        }
      }
    }
    
    if (!hasOverlap) break
  }
}

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const body = await request.json()
    const { existingDiff, yamlContent, diffAnalysis, options } = MergeDiffRequestSchema.parse(body)

    // Ensure existingDiff.proposedState has all required properties with proper defaults
    if (!existingDiff.proposedState.loops) {
      existingDiff.proposedState.loops = {}
    }
    if (!existingDiff.proposedState.parallels) {
      existingDiff.proposedState.parallels = {}
    }

    logger.info(`[${requestId}] Merging diff from YAML`, {
      contentLength: yamlContent.length,
      existingBlockCount: Object.keys(existingDiff.proposedState.blocks).length,
      hasDiffAnalysis: !!diffAnalysis,
      hasOptions: !!options,
      options: options,
    })

    // Gather block registry
    const blocks = getAllBlocks()
    const blockRegistry = blocks.reduce(
      (acc, block) => {
        const blockType = block.type
        acc[blockType] = {
          ...block,
          id: blockType,
          subBlocks: block.subBlocks || [],
          outputs: block.outputs || {},
        } as any
        return acc
      },
      {} as Record<string, BlockConfig>
    )

    // Call sim-agent API
    const response = await fetch(`${SIM_AGENT_API_URL}/api/yaml/diff/merge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        existingDiff,
        yamlContent,
        diffAnalysis,
        blockRegistry,

        utilities: {
          generateLoopBlocks: generateLoopBlocks.toString(),
          generateParallelBlocks: generateParallelBlocks.toString(),
          resolveOutputType: resolveOutputType.toString(),
          convertLoopBlockToLoop: convertLoopBlockToLoop.toString(),
          convertParallelBlockToParallel: convertParallelBlockToParallel.toString(),
          findChildNodes: findChildNodes.toString(),
          findAllDescendantNodes: findAllDescendantNodes.toString(),
        },
        options,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(`[${requestId}] Sim agent API error:`, {
        status: response.status,
        error: errorText,
      })
      return NextResponse.json(
        { success: false, errors: [`Sim agent API error: ${response.statusText}`] },
        { status: response.status }
      )
    }

    const result = await response.json()

    // Log the full response to see if auto-layout is happening
    logger.info(`[${requestId}] Full sim agent response:`, JSON.stringify(result, null, 2))

    // Log detailed block information to debug parent-child relationships
    if (result.success) {
      const blocks = result.diff?.proposedState?.blocks || result.blocks || {}
      logger.info(`[${requestId}] Sim agent blocks with parent-child info:`)
      Object.entries(blocks).forEach(([blockId, block]: [string, any]) => {
        if (block.data?.parentId || block.parentId) {
          logger.info(`[${requestId}] Child block ${blockId} (${block.name}):`, {
            type: block.type,
            parentId: block.data?.parentId || block.parentId,
            extent: block.data?.extent || block.extent,
            hasDataField: !!block.data,
            dataKeys: block.data ? Object.keys(block.data) : [],
          })
        }
        if (block.type === 'loop' || block.type === 'parallel') {
          logger.info(`[${requestId}] Container block ${blockId} (${block.name}):`, {
            type: block.type,
            hasData: !!block.data,
            dataKeys: block.data ? Object.keys(block.data) : [],
          })
        }
      })

      // Log existing loops/parallels from sim-agent
      const loops = result.diff?.proposedState?.loops || result.loops || {}
      const parallels = result.diff?.proposedState?.parallels || result.parallels || {}
      logger.info(`[${requestId}] Sim agent loops:`, loops)
      logger.info(`[${requestId}] Sim agent parallels:`, parallels)
    }

    // Post-process the result to ensure loops and parallels are properly generated
    const finalResult = result

    if (result.success && result.diff?.proposedState) {
      // First, fix parent-child relationships based on edges
      const blocks = result.diff.proposedState.blocks
      const edges = result.diff.proposedState.edges || []

      // Find all loop and parallel blocks
      const containerBlocks = Object.values(blocks).filter(
        (block: any) => block.type === 'loop' || block.type === 'parallel'
      )

      // For each container, find its children based on loop-start edges
      containerBlocks.forEach((container: any) => {
        const childEdges = edges.filter(
          (edge: any) => edge.source === container.id && edge.sourceHandle === 'loop-start-source'
        )

        childEdges.forEach((edge: any) => {
          const childBlock = blocks[edge.target]
          if (childBlock) {
            // Ensure data field exists
            if (!childBlock.data) {
              childBlock.data = {}
            }
            // Set parentId and extent
            childBlock.data.parentId = container.id
            childBlock.data.extent = 'parent'

            logger.info(`[${requestId}] Fixed parent-child relationship:`, {
              parent: container.id,
              parentName: container.name,
              child: childBlock.id,
              childName: childBlock.name,
            })
          }
        })
      })

      // Now regenerate loops and parallels with the fixed relationships
      const loops = generateLoopBlocks(result.diff.proposedState.blocks)
      const parallels = generateParallelBlocks(result.diff.proposedState.blocks)

      result.diff.proposedState.loops = loops
      result.diff.proposedState.parallels = parallels

      logger.info(`[${requestId}] Regenerated loops and parallels after fixing parent-child:`, {
        loopsCount: Object.keys(loops).length,
        parallelsCount: Object.keys(parallels).length,
        loops: Object.keys(loops).map((id) => ({
          id,
          nodes: loops[id].nodes,
        })),
      })

      // Preserve positions from prior proposed state for unchanged/edited blocks
      try {
        preserveBlockPositions(result.diff.proposedState, existingDiff.proposedState, diffAnalysis)
      } catch (e) {
        logger.warn(`[${requestId}] Position preservation failed (merge)`, e as any)
      }
    }

    // If the sim agent returned blocks directly (when auto-layout is applied),
    // transform it to the expected diff format
    if (result.success && result.blocks && !result.diff) {
      logger.info(`[${requestId}] Transforming sim agent blocks response to diff format`)

      // First, fix parent-child relationships based on edges
      const blocks = result.blocks
      const edges = result.edges || []

      // Find all loop and parallel blocks
      const containerBlocks = Object.values(blocks).filter(
        (block: any) => block.type === 'loop' || block.type === 'parallel'
      )

      // For each container, find its children based on loop-start edges
      containerBlocks.forEach((container: any) => {
        const childEdges = edges.filter(
          (edge: any) => edge.source === container.id && edge.sourceHandle === 'loop-start-source'
        )

        childEdges.forEach((edge: any) => {
          const childBlock = blocks[edge.target]
          if (childBlock) {
            // Ensure data field exists
            if (!childBlock.data) {
              childBlock.data = {}
            }
            // Set parentId and extent
            childBlock.data.parentId = container.id
            childBlock.data.extent = 'parent'

            logger.info(`[${requestId}] Fixed parent-child relationship (auto-layout):`, {
              parent: container.id,
              parentName: container.name,
              child: childBlock.id,
              childName: childBlock.name,
            })
          }
        })
      })

      // Generate loops and parallels for the blocks with fixed relationships
      const loops = generateLoopBlocks(result.blocks)
      const parallels = generateParallelBlocks(result.blocks)

      const transformedResult = {
        success: result.success,
        diff: {
          proposedState: {
            blocks: result.blocks,
            edges: result.edges || existingDiff.proposedState.edges || [],
            loops: loops,
            parallels: parallels,
          },
          diffAnalysis: diffAnalysis,
          metadata: result.metadata || {
            source: 'sim-agent',
            timestamp: Date.now(),
          },
        },
        errors: result.errors || [],
      }

      // Preserve positions from prior proposed state for unchanged/edited blocks
      try {
        preserveBlockPositions(transformedResult.diff.proposedState, existingDiff.proposedState, diffAnalysis)
      } catch (e) {
        logger.warn(`[${requestId}] Position preservation failed (transformed merge)`, e as any)
      }

      return NextResponse.json(transformedResult)
    }

    return NextResponse.json(finalResult)
  } catch (error) {
    logger.error(`[${requestId}] Diff merge failed:`, error)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, errors: error.errors.map((e) => e.message) },
        { status: 400 }
      )
    }

    return NextResponse.json(
      {
        success: false,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      },
      { status: 500 }
    )
  }
}
