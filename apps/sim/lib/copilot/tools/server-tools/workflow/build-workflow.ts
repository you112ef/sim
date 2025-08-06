import { createLogger } from '@/lib/logs/console/logger'
import { BaseCopilotTool } from '../base'

interface BuildWorkflowParams {
  workflowState: any
  description?: string
}

interface BuildWorkflowResult {
  description?: string
  success: boolean
  message: string
  workflowState?: any
  data?: {
    blocksCount: number
    edgesCount: number
  }
}

class BuildWorkflowTool extends BaseCopilotTool<BuildWorkflowParams, BuildWorkflowResult> {
  readonly id = 'build_workflow'
  readonly displayName = 'Building workflow'

  protected async executeImpl(params: BuildWorkflowParams): Promise<BuildWorkflowResult> {
    return buildWorkflow(params)
  }
}

// Export the tool instance
export const buildWorkflowTool = new BuildWorkflowTool()

// Implementation function that builds workflow from workflow state
async function buildWorkflow(params: BuildWorkflowParams): Promise<BuildWorkflowResult> {
  const logger = createLogger('BuildWorkflow')
  const { workflowState, description } = params

  logger.info('Building workflow for copilot', {
    blocksCount: Object.keys(workflowState?.blocks || {}).length,
    edgesCount: workflowState?.edges?.length || 0,
    description,
  })

  try {
    if (!workflowState || !workflowState.blocks) {
      return {
        success: false,
        message: 'Invalid workflow state: missing blocks',
        description,
      }
    }

    // Create a basic workflow state structure for preview
    const previewWorkflowState = {
      blocks: {} as Record<string, any>,
      edges: [] as any[],
      loops: {} as Record<string, any>,
      parallels: {} as Record<string, any>,
      lastSaved: Date.now(),
      isDeployed: false,
    }

    // Process blocks with preview IDs
    const blockIdMapping = new Map<string, string>()

    Object.keys(workflowState.blocks).forEach((blockId) => {
      const previewId = `preview-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
      blockIdMapping.set(blockId, previewId)
    })

    // Add blocks to preview workflow state
    for (const [originalId, block] of Object.entries(workflowState.blocks)) {
      const previewBlockId = blockIdMapping.get(originalId)!
      const typedBlock = block as any

      previewWorkflowState.blocks[previewBlockId] = {
        ...typedBlock,
        id: previewBlockId,
        position: typedBlock.position || { x: 0, y: 0 },
        enabled: true,
      }
    }

    // Process edges with updated block IDs
    previewWorkflowState.edges = (workflowState.edges || []).map((edge: any) => ({
      ...edge,
      id: `edge-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      source: blockIdMapping.get(edge.source) || edge.source,
      target: blockIdMapping.get(edge.target) || edge.target,
    }))

    // Copy loops and parallels if they exist
    if (workflowState.loops) {
      previewWorkflowState.loops = { ...workflowState.loops }
    }
    if (workflowState.parallels) {
      previewWorkflowState.parallels = { ...workflowState.parallels }
    }

    const blocksCount = Object.keys(previewWorkflowState.blocks).length
    const edgesCount = previewWorkflowState.edges.length

    logger.info('Workflow built successfully', { blocksCount, edgesCount })

    return {
      success: true,
      message: `Successfully built workflow with ${blocksCount} blocks and ${edgesCount} connections`,
      description: description || 'Built workflow',
      workflowState: previewWorkflowState,
      data: {
        blocksCount,
        edgesCount,
      },
    }
  } catch (error) {
    logger.error('Failed to build workflow:', error)
    return {
      success: false,
      message: `Workflow build failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      description,
    }
  }
}
