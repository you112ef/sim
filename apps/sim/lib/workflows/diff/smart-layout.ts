import { type BlockState, type WorkflowState } from '@/stores/workflows/workflow/types'
import { createLogger } from '@/lib/logs/console/logger'
import type { DiffStatus } from './types'

const logger = createLogger('SmartLayout')

interface LayoutOptions {
  spacing: {
    horizontal: number
    vertical: number
    layer: number
  }
  padding: {
    x: number
    y: number
  }
  preserveExisting: boolean
  // Maximum pixels an existing/edited node is allowed to move to accommodate layout
  maxShiftY?: number
  maxShiftX?: number
  // When compressing large gaps from deletions, only close up to this much per node
  compressThreshold?: number
}

interface BlockWithDiffStatus extends BlockState {
  is_diff?: DiffStatus
}

interface LayoutNode {
  id: string
  block: BlockWithDiffStatus
  position: { x: number; y: number }
  width: number
  height: number
  isNew: boolean
  isDeleted: boolean
  isEdited: boolean
  connections: {
    incoming: string[]
    outgoing: string[]
  }
}

/**
 * Smart layout algorithm that preserves positions as much as possible
 * and applies bounded, minimal adjustments to maintain a clean structure.
 */
export class SmartLayoutEngine {
  private readonly defaultOptions: LayoutOptions = {
    spacing: {
      horizontal: 500,
      vertical: 200,
      layer: 700,
    },
    padding: {
      x: 250,
      y: 250,
    },
    preserveExisting: true,
    maxShiftY: 120,
    maxShiftX: 80,
    compressThreshold: 120,
  }

  applySmartLayout(
    currentState: WorkflowState,
    diffState: WorkflowState,
    options: Partial<LayoutOptions> = {}
  ): WorkflowState {
    const layoutOptions = { ...this.defaultOptions, ...options }

    logger.info('Applying smart layout', {
      currentBlockCount: Object.keys(currentState.blocks).length,
      diffBlockCount: Object.keys(diffState.blocks).length,
      preserveExisting: layoutOptions.preserveExisting,
    })

    const layoutNodes = this.createLayoutNodes(currentState, diffState)
    const graph = this.buildDependencyGraph(layoutNodes, diffState.edges)
    const layers = this.calculateLayers(layoutNodes, graph)

    const positionedNodes = this.applySmartPositioning(
      layoutNodes,
      layers,
      layoutOptions
    )

    const updatedDiffState = this.updateStateWithPositions(
      diffState,
      positionedNodes
    )

    return updatedDiffState
  }

  private createLayoutNodes(
    currentState: WorkflowState,
    diffState: WorkflowState
  ): Map<string, LayoutNode> {
    const nodes = new Map<string, LayoutNode>()

    Object.entries(diffState.blocks).forEach(([id, block]) => {
      const diffBlock = block as BlockWithDiffStatus
      const currentBlock = currentState.blocks[id]

      nodes.set(id, {
        id,
        block: diffBlock,
        position: currentBlock?.position || block.position,
        width: diffBlock.isWide ? 480 : 320,
        height: Math.max(diffBlock.height || 100, 100),
        isNew: diffBlock.is_diff === 'new',
        isDeleted: false,
        isEdited: diffBlock.is_diff === 'edited',
        connections: {
          incoming: [],
          outgoing: [],
        },
      })
    })

    Object.entries(currentState.blocks).forEach(([id, block]) => {
      if (!diffState.blocks[id]) {
        nodes.set(id, {
          id,
          block: { ...block, is_diff: 'deleted' } as BlockWithDiffStatus,
          position: block.position,
          width: block.isWide ? 480 : 320,
          height: Math.max(block.height || 100, 100),
          isNew: false,
          isDeleted: true,
          isEdited: false,
          connections: {
            incoming: [],
            outgoing: [],
          },
        })
      }
    })

    return nodes
  }

  private buildDependencyGraph(
    nodes: Map<string, LayoutNode>,
    edges: any[]
  ): Map<string, LayoutNode> {
    edges.forEach((edge) => {
      const sourceNode = nodes.get(edge.source)
      const targetNode = nodes.get(edge.target)

      if (sourceNode && targetNode) {
        sourceNode.connections.outgoing.push(edge.target)
        targetNode.connections.incoming.push(edge.source)
      }
    })

    return nodes
  }

  private calculateLayers(
    nodes: Map<string, LayoutNode>,
    _graph: Map<string, LayoutNode>
  ): Map<number, string[]> {
    const layers = new Map<number, string[]>()
    const visited = new Set<string>()

    const starters = Array.from(nodes.values()).filter(
      (node) => node.connections.incoming.length === 0 && !node.isDeleted
    )

    const queue: { id: string; layer: number }[] = starters.map((node) => ({
      id: node.id,
      layer: 0,
    }))

    while (queue.length > 0) {
      const { id, layer } = queue.shift()!

      if (visited.has(id)) continue
      visited.add(id)

      if (!layers.has(layer)) {
        layers.set(layer, [])
      }
      layers.get(layer)!.push(id)

      const node = nodes.get(id)
      if (node) {
        node.connections.outgoing.forEach((targetId) => {
          const targetNode = nodes.get(targetId)
          if (targetNode && !targetNode.isDeleted && !visited.has(targetId)) {
            queue.push({ id: targetId, layer: layer + 1 })
          }
        })
      }
    }

    nodes.forEach((node) => {
      if (!visited.has(node.id) && !node.isDeleted) {
        const lastLayer = Math.max(...layers.keys(), -1) + 1
        if (!layers.has(lastLayer)) {
          layers.set(lastLayer, [])
        }
        layers.get(lastLayer)!.push(node.id)
      }
    })

    return layers
  }

  private applySmartPositioning(
    nodes: Map<string, LayoutNode>,
    layers: Map<number, string[]>,
    options: LayoutOptions
  ): Map<string, LayoutNode> {
    const positionedNodes = new Map<string, LayoutNode>()

    const minGap = Math.max(100, options.spacing.vertical)
    const maxShiftY = options.maxShiftY ?? 120
    const maxShiftX = options.maxShiftX ?? 80
    const compressThreshold = options.compressThreshold ?? 120

    Array.from(layers.entries())
      .sort(([a], [b]) => a - b)
      .forEach(([_, nodeIds]) => {
        const existingIds = nodeIds.filter((id) => {
          const n = nodes.get(id)!
          return !n.isNew && !n.isDeleted
        })
        const newIds = nodeIds.filter((id) => nodes.get(id)!.isNew)

        // Desired positions
        const items: Array<{
          id: string
          desiredX: number
          desiredY: number
          height: number
          isNew: boolean
          isEdited: boolean
        }> = []

        // Existing nodes: keep current as desired
        existingIds.forEach((id) => {
          const n = nodes.get(id)!
          items.push({
            id,
            desiredX: n.position.x,
            desiredY: n.position.y,
            height: n.height,
            isNew: false,
            isEdited: n.isEdited,
          })
        })

        // Compute initial desired for new nodes (between gaps or below)
        const existingYSorted = existingIds
          .map((id) => ({ id, y: nodes.get(id)!.position.y }))
          .sort((a, b) => a.y - b.y)
        const gaps = this.findPositionGaps(existingYSorted, nodes, options)

        newIds.forEach((id, index) => {
          const n = nodes.get(id)!
          const sourceId = n.connections.incoming[0]
          const sourceX = sourceId ? (nodes.get(sourceId)?.position.x ?? options.padding.x) : options.padding.x
          const desiredX = Math.max(sourceX + options.spacing.horizontal, n.position.x || 0)
          const desiredY = index < gaps.length
            ? gaps[index]
            : (existingYSorted.length
                ? Math.max(...existingYSorted.map((e) => nodes.get(e.id)!.position.y + nodes.get(e.id)!.height)) + options.spacing.vertical + (index - gaps.length) * (n.height + options.spacing.vertical)
                : options.padding.y + index * (n.height + options.spacing.vertical))
          items.push({ id, desiredX, desiredY, height: n.height, isNew: true, isEdited: false })
        })

        // Sort by desiredY to preserve relative order
        items.sort((a, b) => a.desiredY - b.desiredY)

        // Forward pass: enforce min gaps by pushing down minimally
        let prevBottom = -Infinity
        const forwardY: Record<string, number> = {}
        for (const it of items) {
          const base = Math.max(it.desiredY, prevBottom + minGap)
          // Bound movement for existing/edited nodes
          const lowerBound = it.isNew ? -Infinity : it.desiredY - maxShiftY
          const upperBound = it.isNew ? Infinity : it.desiredY + maxShiftY
          const y = Math.min(Math.max(base, lowerBound), upperBound)
          forwardY[it.id] = y
          prevBottom = y + it.height
        }

        // Backward pass: compress large gaps upward within bounds (handle deletions)
        const finalY: Record<string, number> = { ...forwardY }
        let nextTop = Infinity
        for (let i = items.length - 1; i >= 0; i--) {
          const it = items[i]
          const y = finalY[it.id]
          const top = y
          const bottom = y + it.height
          if (nextTop !== Infinity) {
            const gap = nextTop - bottom
            if (gap > minGap + compressThreshold) {
              const closeBy = Math.min(gap - minGap, maxShiftY)
              const candidate = y + closeBy
              const upperBound = it.isNew ? Infinity : it.desiredY + maxShiftY
              finalY[it.id] = Math.min(candidate, upperBound, nextTop - minGap - it.height)
            }
          }
          nextTop = top
        }

        // Write positions back with bounded X shift for existing nodes (optional gentle alignment)
        items.forEach((it) => {
          const node = nodes.get(it.id)!
          let finalX = it.desiredX
          if (!it.isNew) {
            // Gentle horizontal alignment toward the median X of predecessors
            const srcId = node.connections.incoming[0]
            if (srcId) {
              const srcX = nodes.get(srcId)?.position.x ?? node.position.x
              const targetX = Math.max(srcX + options.spacing.horizontal, node.position.x)
              const delta = targetX - node.position.x
              // Only nudge if beneficial and within bounds
              if (Math.abs(delta) > 0 && Math.abs(delta) <= maxShiftX) {
                finalX = node.position.x + delta
              } else {
                finalX = node.position.x
              }
            } else {
              finalX = node.position.x
            }
          }

          positionedNodes.set(it.id, {
            ...node,
            position: { x: finalX, y: finalY[it.id] },
          })
        })
      })

    nodes.forEach((node) => {
      if (node.isDeleted && !positionedNodes.has(node.id)) {
        positionedNodes.set(node.id, node)
      }
    })

    return positionedNodes
  }

  private findPositionGaps(
    existingPositions: { id: string; y: number }[],
    nodes: Map<string, LayoutNode>,
    options: LayoutOptions
  ): number[] {
    const gaps: number[] = []

    if (existingPositions.length === 0) {
      return [options.padding.y]
    }

    const firstY = existingPositions[0].y
    if (firstY > options.padding.y + 150) {
      gaps.push(options.padding.y)
    }

    for (let i = 0; i < existingPositions.length - 1; i++) {
      const currentNode = nodes.get(existingPositions[i].id)!
      const nextY = existingPositions[i + 1].y
      const currentBottom = existingPositions[i].y + currentNode.height

      const gapSize = nextY - currentBottom
      if (gapSize > options.spacing.vertical + 100) {
        gaps.push(currentBottom + options.spacing.vertical)
      }
    }

    return gaps
  }

  private updateStateWithPositions(
    diffState: WorkflowState,
    positionedNodes: Map<string, LayoutNode>
  ): WorkflowState {
    const updatedBlocks = { ...diffState.blocks }

    positionedNodes.forEach((node) => {
      if (updatedBlocks[node.id] && !node.isDeleted) {
        updatedBlocks[node.id] = {
          ...updatedBlocks[node.id],
          position: node.position,
        }
      }
    })

    return {
      ...diffState,
      blocks: updatedBlocks,
    }
  }
} 