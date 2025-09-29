import { WorkflowState } from '../workflow/types'
import { createLogger } from '@/lib/logs/console/logger'
import { v4 as uuidv4 } from 'uuid'

const logger = createLogger('WorkflowJsonImporter')

/**
 * Generate new IDs for all blocks and edges to avoid conflicts
 */
function regenerateIds(workflowState: WorkflowState): WorkflowState {
  const blockIdMap = new Map<string, string>()
  const newBlocks: WorkflowState['blocks'] = {}
  
  // First pass: create new IDs for all blocks
  Object.entries(workflowState.blocks).forEach(([oldId, block]) => {
    const newId = uuidv4()
    blockIdMap.set(oldId, newId)
    newBlocks[newId] = {
      ...block,
      id: newId,
    }
  })
  
  // Second pass: update edges with new block IDs
  const newEdges = workflowState.edges.map(edge => ({
    ...edge,
    id: uuidv4(), // Generate new edge ID
    source: blockIdMap.get(edge.source) || edge.source,
    target: blockIdMap.get(edge.target) || edge.target,
  }))
  
  // Third pass: update loops with new block IDs
  const newLoops: WorkflowState['loops'] = {}
  if (workflowState.loops) {
    Object.entries(workflowState.loops).forEach(([loopId, loop]) => {
      const newLoopId = uuidv4()
      newLoops[newLoopId] = {
        ...loop,
        id: newLoopId,
        nodes: loop.nodes.map(nodeId => blockIdMap.get(nodeId) || nodeId),
      }
    })
  }
  
  // Fourth pass: update parallels with new block IDs
  const newParallels: WorkflowState['parallels'] = {}
  if (workflowState.parallels) {
    Object.entries(workflowState.parallels).forEach(([parallelId, parallel]) => {
      const newParallelId = uuidv4()
      newParallels[newParallelId] = {
        ...parallel,
        id: newParallelId,
        nodes: parallel.nodes.map(nodeId => blockIdMap.get(nodeId) || nodeId),
      }
    })
  }
  
  // Fifth pass: update any block references in subblock values
  Object.entries(newBlocks).forEach(([blockId, block]) => {
    if (block.subBlocks) {
      Object.entries(block.subBlocks).forEach(([subBlockId, subBlock]) => {
        if (subBlock.value && typeof subBlock.value === 'string') {
          // Replace any block references in the value
          let updatedValue = subBlock.value
          blockIdMap.forEach((newId, oldId) => {
            // Replace references like <blockId.output> with new IDs
            const regex = new RegExp(`<${oldId}\\.`, 'g')
            updatedValue = updatedValue.replace(regex, `<${newId}.`)
          })
          block.subBlocks[subBlockId] = {
            ...subBlock,
            value: updatedValue,
          }
        }
      })
    }
  })
  
  return {
    blocks: newBlocks,
    edges: newEdges,
    loops: newLoops,
    parallels: newParallels,
  }
}

export function parseWorkflowJson(jsonContent: string, regenerateIdsFlag = true): {
  data: WorkflowState | null
  errors: string[]
} {
  const errors: string[] = []

  try {
    // Parse JSON content
    let data: any
    try {
      data = JSON.parse(jsonContent)
    } catch (parseError) {
      errors.push(`Invalid JSON: ${parseError instanceof Error ? parseError.message : 'Parse error'}`)
      return { data: null, errors }
    }

    // Validate top-level structure
    if (!data || typeof data !== 'object') {
      errors.push('Invalid JSON: Root must be an object')
      return { data: null, errors }
    }

    // Validate required fields
    if (!data.blocks || typeof data.blocks !== 'object') {
      errors.push('Missing or invalid field: blocks')
      return { data: null, errors }
    }

    if (!Array.isArray(data.edges)) {
      errors.push('Missing or invalid field: edges (must be an array)')
      return { data: null, errors }
    }

    // Validate blocks have required fields
    Object.entries(data.blocks).forEach(([blockId, block]: [string, any]) => {
      if (!block || typeof block !== 'object') {
        errors.push(`Invalid block ${blockId}: must be an object`)
        return
      }

      if (!block.id) {
        errors.push(`Block ${blockId} missing required field: id`)
      }
      if (!block.type) {
        errors.push(`Block ${blockId} missing required field: type`)
      }
      if (!block.position || typeof block.position.x !== 'number' || typeof block.position.y !== 'number') {
        errors.push(`Block ${blockId} missing or invalid position`)
      }
    })

    // Validate edges have required fields
    data.edges.forEach((edge: any, index: number) => {
      if (!edge || typeof edge !== 'object') {
        errors.push(`Invalid edge at index ${index}: must be an object`)
        return
      }

      if (!edge.id) {
        errors.push(`Edge at index ${index} missing required field: id`)
      }
      if (!edge.source) {
        errors.push(`Edge at index ${index} missing required field: source`)
      }
      if (!edge.target) {
        errors.push(`Edge at index ${index} missing required field: target`)
      }
    })

    // If there are errors, return null
    if (errors.length > 0) {
      return { data: null, errors }
    }

    // Construct the workflow state with defaults
    let workflowState: WorkflowState = {
      blocks: data.blocks || {},
      edges: data.edges || [],
      loops: data.loops || {},
      parallels: data.parallels || {},
    }
    
    // Regenerate IDs if requested (default: true)
    if (regenerateIdsFlag) {
      workflowState = regenerateIds(workflowState)
      logger.info('Regenerated IDs for imported workflow to avoid conflicts')
    }

    logger.info('Successfully parsed workflow JSON', {
      blocksCount: Object.keys(workflowState.blocks).length,
      edgesCount: workflowState.edges.length,
      loopsCount: Object.keys(workflowState.loops).length,
      parallelsCount: Object.keys(workflowState.parallels).length,
    })

    return { data: workflowState, errors: [] }
  } catch (error) {
    logger.error('Failed to parse workflow JSON:', error)
    errors.push(`Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return { data: null, errors }
  }
} 