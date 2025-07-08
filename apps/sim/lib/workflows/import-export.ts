import { createLogger } from '@/lib/logs/console-logger'
import { getBlock } from '@/blocks'
import { getWorkflowWithValues } from '@/stores/workflows'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('WorkflowImportExport')

export interface ExportedWorkflow {
  version: string
  metadata: {
    name: string
    description?: string
    color: string
    exportedAt: string
    exportedBy?: string
  }
  state: {
    blocks: Record<string, any>
    edges: any[]
    loops: Record<string, any>
    parallels: Record<string, any>
  }
}

/**
 * Export the current active workflow as JSON
 */
export function exportWorkflowAsJSON(): ExportedWorkflow | null {
  const { activeWorkflowId } = useWorkflowRegistry.getState()

  if (!activeWorkflowId) {
    logger.warn('No active workflow to export')
    return null
  }

  const workflowWithValues = getWorkflowWithValues(activeWorkflowId)

  if (!workflowWithValues) {
    logger.warn(`Could not get workflow data for export: ${activeWorkflowId}`)
    return null
  }

  const exportData: ExportedWorkflow = {
    version: '1.0',
    metadata: {
      name: workflowWithValues.name,
      description: workflowWithValues.description,
      color: workflowWithValues.color,
      exportedAt: new Date().toISOString(),
    },
    state: {
      blocks: workflowWithValues.state.blocks,
      edges: workflowWithValues.state.edges,
      loops: workflowWithValues.state.loops,
      parallels: workflowWithValues.state.parallels,
    },
  }

  logger.info(`Exported workflow: ${workflowWithValues.name}`)
  return exportData
}

/**
 * Download workflow JSON as a file
 */
export function downloadWorkflowJSON(workflowData: ExportedWorkflow) {
  const jsonString = JSON.stringify(workflowData, null, 2)
  const blob = new Blob([jsonString], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = `${workflowData.metadata.name.replace(/[^a-zA-Z0-9]/g, '_')}_workflow.json`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)

  logger.info(`Downloaded workflow JSON: ${workflowData.metadata.name}`)
}

/**
 * Validate imported workflow JSON structure
 */
export function validateWorkflowJSON(data: any): { valid: boolean; error?: string } {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Invalid JSON format' }
  }

  if (!data.version) {
    return { valid: false, error: 'Missing version field' }
  }

  if (!data.metadata || !data.metadata.name) {
    return { valid: false, error: 'Missing metadata or workflow name' }
  }

  if (!data.state) {
    return { valid: false, error: 'Missing workflow state' }
  }

  if (!data.state.blocks || typeof data.state.blocks !== 'object') {
    return { valid: false, error: 'Invalid or missing blocks in workflow state' }
  }

  if (!Array.isArray(data.state.edges)) {
    return { valid: false, error: 'Invalid or missing edges in workflow state' }
  }

  return { valid: true }
}

/**
 * Traverse workflow from start block and copy elements systematically
 */
async function traverseAndCopyWorkflow(importedState: any): Promise<{
  blocks: Record<string, any>
  edges: any[]
  loops: Record<string, any>
  parallels: Record<string, any>
  idMapping: Record<string, string>
}> {
  const idMapping: Record<string, string> = {}
  const newBlocks: Record<string, any> = {}
  const newEdges: any[] = []
  const visited = new Set<string>()
  const edgeQueue: any[] = []

  // Validate all blocks exist in current registry and filter out unsupported blocks
  const validBlocks: Record<string, any> = {}

  for (const [blockId, block] of Object.entries(importedState.blocks || {})) {
    const blockData = block as any

    // Allow starter, loop, and parallel blocks (special cases)
    if (
      blockData.type === 'starter' ||
      blockData.type === 'loop' ||
      blockData.type === 'parallel'
    ) {
      validBlocks[blockId] = blockData
      continue
    }

    // Check if block type exists in current registry
    const blockConfig = getBlock(blockData.type)
    if (blockConfig) {
      validBlocks[blockId] = blockData
    } else {
      logger.warn(`Skipping unsupported block type: ${blockData.type} (ID: ${blockId})`)
    }
  }

  // Update importedState to only include valid blocks
  importedState.blocks = validBlocks

  // Find the start block in validated data
  const startBlockEntry = Object.entries(validBlocks).find(
    ([_, block]) => (block as any).type === 'starter'
  )

  if (!startBlockEntry) {
    throw new Error('No start block found in imported workflow')
  }

  const [originalStartId, startBlock] = startBlockEntry as [string, any]

  // Generate ID for start block (this will replace the default one)
  const newStartId = crypto.randomUUID()
  idMapping[originalStartId] = newStartId

  // Copy start block with new ID
  newBlocks[newStartId] = {
    ...startBlock,
    id: newStartId,
  }

  // Queue for traversal (breadth-first)
  const blockQueue: string[] = [originalStartId]
  visited.add(originalStartId)

  // Traverse from start block following edges
  while (blockQueue.length > 0) {
    const currentOriginalId = blockQueue.shift()!

    // Find all edges from this block that point to blocks that exist in our imported data
    const outgoingEdges = (importedState.edges || []).filter(
      (edge: any) => edge.source === currentOriginalId && importedState.blocks[edge.target]
    )

    for (const edge of outgoingEdges) {
      const targetOriginalId = edge.target

      // Copy target block if not already copied and it exists in imported data
      if (!visited.has(targetOriginalId) && importedState.blocks[targetOriginalId]) {
        const targetBlock = importedState.blocks[targetOriginalId]
        const newTargetId = crypto.randomUUID()
        idMapping[targetOriginalId] = newTargetId

        newBlocks[newTargetId] = {
          ...targetBlock,
          id: newTargetId,
        }

        visited.add(targetOriginalId)
        blockQueue.push(targetOriginalId)
      }

      // Only queue edge if both source and target blocks exist in our data
      if (importedState.blocks[edge.source] && importedState.blocks[edge.target]) {
        edgeQueue.push(edge)
      }
    }
  }

  // Process all valid edges with new IDs
  for (const edge of edgeQueue) {
    // Double-check that both blocks exist in our mapping
    if (idMapping[edge.source] && idMapping[edge.target]) {
      newEdges.push({
        ...edge,
        id: crypto.randomUUID(),
        source: idMapping[edge.source],
        target: idMapping[edge.target],
      })
    }
  }

  // Handle any remaining blocks that weren't reached by traversal
  for (const [blockId, block] of Object.entries(importedState.blocks || {})) {
    if (!idMapping[blockId]) {
      const newId = crypto.randomUUID()
      idMapping[blockId] = newId
      newBlocks[newId] = {
        ...(block as any),
        id: newId,
      }
    }
  }

  // Handle any remaining edges (only if both blocks exist in imported data)
  for (const edge of importedState.edges || []) {
    const sourceExists = importedState.blocks[edge.source]
    const targetExists = importedState.blocks[edge.target]
    const alreadyProcessed = newEdges.find(
      (e) => e.source === idMapping[edge.source] && e.target === idMapping[edge.target]
    )

    if (sourceExists && targetExists && !alreadyProcessed) {
      newEdges.push({
        ...edge,
        id: crypto.randomUUID(),
        source: idMapping[edge.source],
        target: idMapping[edge.target],
      })
    }
  }

  // Copy loops with updated block references
  const newLoops: Record<string, any> = {}
  Object.entries(importedState.loops || {}).forEach(([oldId, loop]: [string, any]) => {
    const newId = crypto.randomUUID()
    newLoops[newId] = {
      ...loop,
      id: newId,
      nodes: (loop.nodes || []).map((nodeId: string) => idMapping[nodeId] || nodeId),
    }
  })

  // Copy parallels with updated block references
  const newParallels: Record<string, any> = {}
  Object.entries(importedState.parallels || {}).forEach(([oldId, parallel]: [string, any]) => {
    const newId = crypto.randomUUID()
    newParallels[newId] = {
      ...parallel,
      id: newId,
      nodes: (parallel.nodes || []).map((nodeId: string) => idMapping[nodeId] || nodeId),
    }
  })

  return {
    blocks: newBlocks,
    edges: newEdges,
    loops: newLoops,
    parallels: newParallels,
    idMapping,
  }
}

/**
 * Create a workflow from imported JSON data
 */
export async function createWorkflowFromJSON(
  jsonData: ExportedWorkflow,
  options: {
    workspaceId?: string
    folderId?: string
    namePrefix?: string
  } = {}
): Promise<string> {
  // Validate the JSON data
  const validation = validateWorkflowJSON(jsonData)
  if (!validation.valid) {
    throw new Error(`Invalid workflow JSON: ${validation.error}`)
  }

  // Traverse and copy workflow elements systematically
  const { blocks, edges, loops, parallels, idMapping } = await traverseAndCopyWorkflow(
    jsonData.state
  )
  logger.debug('Traversed and copied imported workflow', {
    originalBlocks: Object.keys(jsonData.state.blocks || {}).length,
    newBlocks: Object.keys(blocks || {}).length,
    originalEdges: (jsonData.state.edges || []).length,
    newEdges: (edges || []).length,
    mappedIds: Object.keys(idMapping).length,
  })

  // Prepare the workflow name
  const baseName = jsonData.metadata.name
  const workflowName = options.namePrefix
    ? `${options.namePrefix} ${baseName}`
    : `${baseName} (Imported)`

  // Create the workflow using the new import API that handles the traversal properly
  const response = await fetch('/api/workflows/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: workflowName,
      description: jsonData.metadata.description || 'Imported workflow',
      color: jsonData.metadata.color || '#3972F6',
      workspaceId: options.workspaceId,
      folderId: options.folderId,
      state: {
        blocks,
        edges,
        loops,
        parallels,
      },
    }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(`Failed to import workflow: ${errorData.error || response.statusText}`)
  }

  const importResult = await response.json()
  const workflowId = importResult.id

  // Update the workflow color after creation
  const { updateWorkflow } = useWorkflowRegistry.getState()
  await updateWorkflow(workflowId, {
    color: jsonData.metadata.color,
  })

  logger.info(`Created workflow from JSON: ${workflowName} (ID: ${workflowId})`)
  return workflowId
}

/**
 * Parse JSON string and validate workflow structure
 */
export function parseWorkflowJSON(jsonString: string): ExportedWorkflow {
  try {
    const jsonData = JSON.parse(jsonString)

    const validation = validateWorkflowJSON(jsonData)
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid workflow JSON')
    }

    return jsonData
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Invalid JSON format')
    }
    throw error
  }
}
