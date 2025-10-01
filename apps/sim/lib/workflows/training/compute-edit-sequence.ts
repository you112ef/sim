import type { CopilotWorkflowState } from '@/lib/workflows/json-sanitizer'

export interface EditOperation {
  operation_type: 'add' | 'edit' | 'delete'
  block_id: string
  params?: {
    type?: string
    name?: string
    triggerMode?: boolean
    advancedMode?: boolean
    inputs?: Record<string, any>
    connections?: Record<string, any>
    nestedNodes?: Record<string, any>
  }
}

export interface WorkflowDiff {
  operations: EditOperation[]
  summary: {
    blocksAdded: number
    blocksModified: number
    blocksDeleted: number
    edgesChanged: number
    subflowsChanged: number
  }
}

/**
 * Extract all edges from blocks with embedded connections
 */
function extractAllEdgesFromBlocks(blocks: Record<string, any>): Array<{
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}> {
  const edges: Array<{
    source: string
    target: string
    sourceHandle?: string | null
    targetHandle?: string | null
  }> = []

  Object.entries(blocks).forEach(([blockId, block]) => {
    if (block.connections) {
      Object.entries(block.connections).forEach(([sourceHandle, targets]) => {
        const targetArray = Array.isArray(targets) ? targets : [targets]
        targetArray.forEach((target: string) => {
          edges.push({
            source: blockId,
            target,
            sourceHandle,
            targetHandle: 'target',
          })
        })
      })
    }
  })

  return edges
}

/**
 * Compute the edit sequence (operations) needed to transform startState into endState
 * This analyzes the differences and generates operations that can recreate the changes
 * Works with sanitized CopilotWorkflowState (no positions, only semantic data)
 */
export function computeEditSequence(
  startState: CopilotWorkflowState,
  endState: CopilotWorkflowState
): WorkflowDiff {
  const operations: EditOperation[] = []

  const startBlocks = startState.blocks || {}
  const endBlocks = endState.blocks || {}

  // Extract edges from connections for tracking
  const startEdges = extractAllEdgesFromBlocks(startBlocks)
  const endEdges = extractAllEdgesFromBlocks(endBlocks)

  // Track statistics
  let blocksAdded = 0
  let blocksModified = 0
  let blocksDeleted = 0
  let edgesChanged = 0
  let subflowsChanged = 0

  // 1. Find deleted blocks (exist in start but not in end)
  for (const blockId in startBlocks) {
    if (!(blockId in endBlocks)) {
      operations.push({
        operation_type: 'delete',
        block_id: blockId,
      })
      blocksDeleted++
    }
  }

  // 2. Find added blocks (exist in end but not in start)
  for (const blockId in endBlocks) {
    if (!(blockId in startBlocks)) {
      const block = endBlocks[blockId]
      const addParams: EditOperation['params'] = {
        type: block.type,
        name: block.name,
        ...(block?.triggerMode !== undefined && { triggerMode: Boolean(block.triggerMode) }),
        ...(block?.advancedMode !== undefined && { advancedMode: Boolean(block.advancedMode) }),
      }

      // Add inputs if present
      const inputs = extractInputValues(block)
      if (Object.keys(inputs).length > 0) {
        addParams.inputs = inputs
      }

      // Add connections if present
      const connections = extractConnections(blockId, endEdges)
      if (connections && Object.keys(connections).length > 0) {
        addParams.connections = connections
      }

      // Add nested nodes if present (for loops/parallels)
      if (block.nestedNodes && Object.keys(block.nestedNodes).length > 0) {
        addParams.nestedNodes = block.nestedNodes
        subflowsChanged++
      }

      operations.push({
        operation_type: 'add',
        block_id: blockId,
        params: addParams,
      })
      blocksAdded++
    }
  }

  // 3. Find modified blocks (exist in both but have changes)
  for (const blockId in endBlocks) {
    if (blockId in startBlocks) {
      const startBlock = startBlocks[blockId]
      const endBlock = endBlocks[blockId]
      const changes = computeBlockChanges(startBlock, endBlock, blockId, startEdges, endEdges)

      if (changes) {
        operations.push({
          operation_type: 'edit',
          block_id: blockId,
          params: changes,
        })
        blocksModified++
        if (changes.connections) {
          edgesChanged++
        }
        if (changes.nestedNodes) {
          subflowsChanged++
        }
      }
    }
  }

  return {
    operations,
    summary: {
      blocksAdded,
      blocksModified,
      blocksDeleted,
      edgesChanged,
      subflowsChanged,
    },
  }
}

/**
 * Extract input values from a block
 * Works with sanitized format where inputs is Record<string, value>
 */
function extractInputValues(block: any): Record<string, any> {
  // New sanitized format uses 'inputs' field
  if (block.inputs) {
    return { ...block.inputs }
  }

  // Fallback for any legacy data
  if (block.subBlocks) {
    return { ...block.subBlocks }
  }

  return {}
}

/**
 * Extract connections for a specific block from edges
 */
function extractConnections(
  blockId: string,
  edges: Array<{
    source: string
    target: string
    sourceHandle?: string | null
    targetHandle?: string | null
  }>
): Record<string, any> {
  const connections: Record<string, any> = {}

  // Find all edges where this block is the source
  const outgoingEdges = edges.filter((edge) => edge.source === blockId)

  for (const edge of outgoingEdges) {
    const handle = edge.sourceHandle || 'default'

    // Group by source handle
    if (!connections[handle]) {
      connections[handle] = []
    }

    // Add target block to this handle's connections
    if (edge.targetHandle && edge.targetHandle !== 'target') {
      connections[handle].push({
        block: edge.target,
        handle: edge.targetHandle,
      })
    } else {
      connections[handle].push(edge.target)
    }
  }

  // Simplify single-element arrays to just the element
  for (const handle in connections) {
    if (Array.isArray(connections[handle]) && connections[handle].length === 1) {
      connections[handle] = connections[handle][0]
    }
  }

  return connections
}

/**
 * Compute what changed in a block between two states
 */
function computeBlockChanges(
  startBlock: any,
  endBlock: any,
  blockId: string,
  startEdges: Array<{
    source: string
    target: string
    sourceHandle?: string | null
    targetHandle?: string | null
  }>,
  endEdges: Array<{
    source: string
    target: string
    sourceHandle?: string | null
    targetHandle?: string | null
  }>
): Record<string, any> | null {
  const changes: Record<string, any> = {}
  let hasChanges = false

  // Check type change
  if (startBlock.type !== endBlock.type) {
    changes.type = endBlock.type
    hasChanges = true
  }

  // Check name change
  if (startBlock.name !== endBlock.name) {
    changes.name = endBlock.name
    hasChanges = true
  }

  // Check trigger mode change (covers entering/exiting trigger mode)
  const startTrigger = Boolean(startBlock?.triggerMode)
  const endTrigger = Boolean(endBlock?.triggerMode)
  if (startTrigger !== endTrigger) {
    changes.triggerMode = endTrigger
    hasChanges = true
  }

  // Check advanced mode change
  const startAdvanced = Boolean(startBlock?.advancedMode)
  const endAdvanced = Boolean(endBlock?.advancedMode)
  if (startAdvanced !== endAdvanced) {
    changes.advancedMode = endAdvanced
    hasChanges = true
  }

  // Check input value changes
  const startInputs = extractInputValues(startBlock)
  const endInputs = extractInputValues(endBlock)

  if (JSON.stringify(startInputs) !== JSON.stringify(endInputs)) {
    changes.inputs = endInputs
    hasChanges = true
  }

  // Check connection changes
  const startConnections = extractConnections(blockId, startEdges)
  const endConnections = extractConnections(blockId, endEdges)

  if (JSON.stringify(startConnections) !== JSON.stringify(endConnections)) {
    changes.connections = endConnections
    hasChanges = true
  }

  // Check nested nodes changes (for loops/parallels)
  const startNestedNodes = startBlock.nestedNodes || {}
  const endNestedNodes = endBlock.nestedNodes || {}

  if (JSON.stringify(startNestedNodes) !== JSON.stringify(endNestedNodes)) {
    changes.nestedNodes = endNestedNodes
    hasChanges = true
  }

  return hasChanges ? changes : null
}

/**
 * Format edit operations into a human-readable description
 */
export function formatEditSequence(operations: EditOperation[]): string[] {
  return operations.map((op) => {
    switch (op.operation_type) {
      case 'add':
        return `Add block "${op.params?.name || op.block_id}" (${op.params?.type || 'unknown'})`
      case 'delete':
        return `Delete block "${op.block_id}"`
      case 'edit': {
        const changes: string[] = []
        if (op.params?.type) changes.push(`type to ${op.params.type}`)
        if (op.params?.name) changes.push(`name to "${op.params.name}"`)
        if (op.params?.triggerMode !== undefined)
          changes.push(`trigger mode to ${op.params.triggerMode}`)
        if (op.params?.advancedMode !== undefined)
          changes.push(`advanced mode to ${op.params.advancedMode}`)
        if (op.params?.inputs) {
          const inputKeys = Object.keys(op.params.inputs)
          if (inputKeys.length > 0) {
            changes.push(`inputs (${inputKeys.join(', ')})`)
          }
        }
        if (op.params?.connections) changes.push('connections')
        if (op.params?.nestedNodes) {
          const nestedCount = Object.keys(op.params.nestedNodes).length
          changes.push(`nested nodes (${nestedCount} blocks)`)
        }
        return `Edit block "${op.block_id}": ${changes.join(', ')}`
      }
      default:
        return `Unknown operation: ${op.operation_type}`
    }
  })
}
