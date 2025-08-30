import type { BlockState, Loop, Parallel, While } from '@/stores/workflows/workflow/types'

const DEFAULT_LOOP_ITERATIONS = 5
const DEFAULT_WHILE_ITERATIONS = 1000

/**
 * Convert UI loop block to executor Loop format
 *
 * @param loopBlockId - ID of the loop block to convert
 * @param blocks - Record of all blocks in the workflow
 * @returns Loop object for execution engine or undefined if not a valid loop
 */
export function convertLoopBlockToLoop(
  loopBlockId: string,
  blocks: Record<string, BlockState>
): Loop | undefined {
  const loopBlock = blocks[loopBlockId]
  if (!loopBlock || loopBlock.type !== 'loop') return undefined

  // Parse collection if it's a string representation of an array/object
  let forEachItems: any = loopBlock.data?.collection || ''
  if (typeof forEachItems === 'string' && forEachItems.trim()) {
    const trimmed = forEachItems.trim()
    // Try to parse if it looks like JSON
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        forEachItems = JSON.parse(trimmed)
      } catch {
        // Keep as string if parsing fails - will be evaluated at runtime
      }
    }
  }

  return {
    id: loopBlockId,
    nodes: findChildNodes(loopBlockId, blocks),
    iterations: loopBlock.data?.count || DEFAULT_LOOP_ITERATIONS,
    loopType: loopBlock.data?.loopType || 'for',
    forEachItems,
  }
}

/**
 * Convert UI while block to executor While format
 *
 * @param whileBlockId - ID of the while block to convert
 * @param blocks - Record of all blocks in the workflow
 * @returns While object for execution engine or undefined if not a valid while
 */
export function convertWhileBlockToWhile(
  whileBlockId: string,
  blocks: Record<string, BlockState>
): While | undefined {
  const whileBlock = blocks[whileBlockId]
  if (!whileBlock || whileBlock.type !== 'while') return undefined

  // Default iterations as a safety cap; higher for whiles
  const iterations =
    (whileBlock.data as any)?.iterations ||
    (whileBlock.data as any)?.count ||
    DEFAULT_WHILE_ITERATIONS

  // Default whileType to 'while' when not provided
  const whileType = (whileBlock.data as any)?.whileType || 'while'

  return {
    id: whileBlockId,
    nodes: findChildNodes(whileBlockId, blocks),
    iterations,
    whileType,
  }
}

/**
 * Convert UI parallel block to executor Parallel format
 *
 * @param parallelBlockId - ID of the parallel block to convert
 * @param blocks - Record of all blocks in the workflow
 * @returns Parallel object for execution engine or undefined if not a valid parallel block
 */
export function convertParallelBlockToParallel(
  parallelBlockId: string,
  blocks: Record<string, BlockState>
): Parallel | undefined {
  const parallelBlock = blocks[parallelBlockId]
  if (!parallelBlock || parallelBlock.type !== 'parallel') return undefined

  // Get the parallel type from block data, defaulting to 'count' for consistency
  const parallelType = parallelBlock.data?.parallelType || 'count'

  // Validate parallelType against allowed values
  const validParallelTypes = ['collection', 'count'] as const
  const validatedParallelType = validParallelTypes.includes(parallelType as any)
    ? parallelType
    : 'collection'

  // Only set distribution if it's a collection-based parallel
  const distribution =
    validatedParallelType === 'collection' ? parallelBlock.data?.collection || '' : ''

  const count = parallelBlock.data?.count || 5

  return {
    id: parallelBlockId,
    nodes: findChildNodes(parallelBlockId, blocks),
    distribution,
    count,
    parallelType: validatedParallelType,
  }
}

/**
 * Find all nodes that are children of this container (loop or parallel)
 *
 * @param containerId - ID of the container to find children for
 * @param blocks - Record of all blocks in the workflow
 * @returns Array of node IDs that are direct children of this container
 */
export function findChildNodes(containerId: string, blocks: Record<string, BlockState>): string[] {
  return Object.values(blocks)
    .filter((block) => block.data?.parentId === containerId)
    .map((block) => block.id)
}

/**
 * Find all descendant nodes, including children, grandchildren, etc.
 *
 * @param containerId - ID of the container to find descendants for
 * @param blocks - Record of all blocks in the workflow
 * @returns Array of node IDs that are descendants of this container
 */
export function findAllDescendantNodes(
  containerId: string,
  blocks: Record<string, BlockState>
): string[] {
  const descendants: string[] = []
  const findDescendants = (parentId: string) => {
    const children = Object.values(blocks)
      .filter((block) => block.data?.parentId === parentId)
      .map((block) => block.id)

    children.forEach((childId) => {
      descendants.push(childId)
      findDescendants(childId)
    })
  }

  findDescendants(containerId)
  return descendants
}

/**
 * Builds a complete collection of loops from the UI blocks
 *
 * @param blocks - Record of all blocks in the workflow
 * @returns Record of Loop objects for execution engine
 */
export function generateLoopBlocks(blocks: Record<string, BlockState>): Record<string, Loop> {
  const loops: Record<string, Loop> = {}

  // Find all loop nodes
  Object.entries(blocks)
    .filter(([_, block]) => block.type === 'loop')
    .forEach(([id, block]) => {
      const loop = convertLoopBlockToLoop(id, blocks)
      if (loop) {
        loops[id] = loop
      }
    })

  return loops
}

/**
 * Builds a complete collection of parallel blocks from the UI blocks
 *
 * @param blocks - Record of all blocks in the workflow
 * @returns Record of Parallel objects for execution engine
 */
export function generateParallelBlocks(
  blocks: Record<string, BlockState>
): Record<string, Parallel> {
  const parallels: Record<string, Parallel> = {}

  // Find all parallel nodes
  Object.entries(blocks)
    .filter(([_, block]) => block.type === 'parallel')
    .forEach(([id, block]) => {
      const parallel = convertParallelBlockToParallel(id, blocks)
      if (parallel) {
        parallels[id] = parallel
      }
    })

  return parallels
}

/**
 * Builds a complete collection of while blocks from the UI blocks
 *
 * @param blocks - Record of all blocks in the workflow
 * @returns Record of While objects for execution engine
 */
export function generateWhileBlocks(blocks: Record<string, BlockState>): Record<string, While> {
  const whiles: Record<string, While> = {}

  // Find all while nodes
  Object.entries(blocks)
    .filter(([_, block]) => block.type === 'while')
    .forEach(([id]) => {
      const whileCfg = convertWhileBlockToWhile(id, blocks)
      if (whileCfg) {
        whiles[id] = whileCfg
      }
    })

  return whiles
}
