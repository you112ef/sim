import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
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
import { createBlockTypeDimensionsMapping } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils'

const logger = createLogger('YamlAutoLayoutAPI')

// Sim Agent API configuration
const SIM_AGENT_API_URL = process.env.SIM_AGENT_API_URL || 'http://localhost:8000'
const SIM_AGENT_API_KEY = process.env.SIM_AGENT_API_KEY

const AutoLayoutRequestSchema = z.object({
  workflowState: z.object({
    blocks: z.record(z.any()),
    edges: z.array(z.any()),
    loops: z.record(z.any()).optional().default({}),
    parallels: z.record(z.any()).optional().default({}),
  }),
  options: z
    .object({

      direction: z.enum(['horizontal', 'vertical', 'auto']).optional(),
      spacing: z
        .object({
          horizontal: z.number().optional(),
          vertical: z.number().optional(),
          layer: z.number().optional(),
        })
        .optional(),
      alignment: z.enum(['start', 'center', 'end']).optional(),
      padding: z
        .object({
          x: z.number().optional(),
          y: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
})

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const body = await request.json()
    const { workflowState, options } = AutoLayoutRequestSchema.parse(body)

    logger.info(`[${requestId}] Applying auto layout`, {
      blockCount: Object.keys(workflowState.blocks).length,
      edgeCount: workflowState.edges.length,
      hasApiKey: !!SIM_AGENT_API_KEY,
      simAgentUrl: SIM_AGENT_API_URL,
    })

    // Gather block registry and utilities
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

    // Log sample block data for debugging
    const sampleBlockId = Object.keys(workflowState.blocks)[0]
    if (sampleBlockId) {
      logger.info(`[${requestId}] Sample block data:`, {
        blockId: sampleBlockId,
        blockType: workflowState.blocks[sampleBlockId].type,
        hasPosition: !!workflowState.blocks[sampleBlockId].position,
        position: workflowState.blocks[sampleBlockId].position,
      })
    }

    logger.info(`[${requestId}] Calling sim-agent autolayout with options:`, {
      direction: options?.direction || 'auto (default)',
      spacing: options?.spacing,
      alignment: options?.alignment || 'center (default)',
    })

    // Generate block dimensions mapping for autolayout
    const blockDimensions = createBlockTypeDimensionsMapping()

    // Log the complete request being sent to autolayout
    logger.info(`[${requestId}] Sending YAML autolayout request to sim-agent`, {
      blockCount: Object.keys(workflowState.blocks).length,
      edgeCount: workflowState.edges.length,
      blockDimensionsCount: Object.keys(blockDimensions).length,
      sampleBlockDimensions: Object.fromEntries(
        Object.entries(blockDimensions).slice(0, 5) // Log first 5 block dimensions as sample
      ),
      requestOptions: {
        direction: 'auto',
        spacing: { horizontal: 500, vertical: 400, layer: 700 },
        alignment: 'center',
        padding: { x: 250, y: 250 },
        ...options // Show any overrides
      }
    })

    // Log full block dimensions mapping
    logger.info(`[${requestId}] Complete block dimensions mapping for YAML autolayout`, {
      blockDimensions,
    })

    // Call sim-agent API
    const response = await fetch(`${SIM_AGENT_API_URL}/api/yaml/autolayout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(SIM_AGENT_API_KEY && { 'x-api-key': SIM_AGENT_API_KEY }),
      },
      body: JSON.stringify({
        workflowState: {
          blocks: workflowState.blocks,
          edges: workflowState.edges,
          loops: workflowState.loops || {},
          parallels: workflowState.parallels || {},
        },
        options: {
          direction: 'auto',
          spacing: {
            horizontal: 500,
            vertical: 400,
            layer: 700,
          },
          alignment: 'center',
          padding: {
            x: 250,
            y: 250,
          },
          ...options, // Allow override of defaults
        },
        blockRegistry,
        blockDimensions,
        utilities: {
          generateLoopBlocks: generateLoopBlocks.toString(),
          generateParallelBlocks: generateParallelBlocks.toString(),
          resolveOutputType: resolveOutputType.toString(),
          convertLoopBlockToLoop: convertLoopBlockToLoop.toString(),
          convertParallelBlockToParallel: convertParallelBlockToParallel.toString(),
          findChildNodes: findChildNodes.toString(),
          findAllDescendantNodes: findAllDescendantNodes.toString(),
        },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()

      // Try to parse the error as JSON for better error messages
      let errorMessage = `Sim agent API error: ${response.statusText}`

      // Check if it's a 404 error
      if (response.status === 404) {
        errorMessage =
          'Auto-layout endpoint not found on sim agent. Please ensure the /api/yaml/autolayout endpoint is implemented in the sim agent service.'
      } else {
        try {
          const errorJson = JSON.parse(errorText)
          if (errorJson.errors && Array.isArray(errorJson.errors)) {
            errorMessage = errorJson.errors.join(', ')
          } else if (errorJson.error) {
            errorMessage = errorJson.error
          }
        } catch (e) {
          // If not JSON, use the raw text
          errorMessage = errorText || errorMessage
        }
      }

      logger.error(`[${requestId}] Sim agent API error:`, {
        status: response.status,
        error: errorText,
        parsedError: errorMessage,
      })

      return NextResponse.json(
        { success: false, errors: [errorMessage] },
        { status: response.status }
      )
    }

    const result = await response.json()

    // Log the complete autolayout response for analysis
    logger.info(`[${requestId}] Complete YAML autolayout response:`, {
      fullResult: result
    })

    logger.info(`[${requestId}] Sim agent response summary:`, {
      success: result.success,
      hasBlocks: !!result.blocks,
      blockCount: result.blocks ? Object.keys(result.blocks).length : 0,
      responseKeys: Object.keys(result),
    })

    // Log details about returned blocks if available
    if (result.blocks) {
      const containerBlocks = Object.entries(result.blocks).filter(([_, block]: [string, any]) => 
        block.type === 'loop' || block.type === 'parallel'
      )
      
      logger.info(`[${requestId}] YAML autolayout block analysis:`, {
        totalBlocks: Object.keys(result.blocks).length,
        containerCount: containerBlocks.length,
        containerDetails: containerBlocks.map(([id, block]: [string, any]) => ({
          id,
          type: block.type,
          position: block.position,
          dimensions: {
            width: block.data?.width || 'not set',
            height: block.data?.height || 'not set'
          },
          dataKeys: block.data ? Object.keys(block.data) : []
        })),
        sampleRegularBlocks: Object.entries(result.blocks)
          .filter(([_, block]: [string, any]) => block.type !== 'loop' && block.type !== 'parallel')
          .slice(0, 3)
          .map(([id, block]: [string, any]) => ({
            id,
            type: block.type,
            position: block.position,
            parentId: block.data?.parentId || 'no parent'
          }))
      })
    }

    // Transform the response to match the expected format
    const transformedResponse = {
      success: result.success,
      workflowState: {
        blocks: result.blocks || {},
        edges: workflowState.edges || [],
        loops: workflowState.loops || {},
        parallels: workflowState.parallels || {},
      },
      errors: result.errors,
    }

    logger.info(`[${requestId}] Transformed response:`, {
      success: transformedResponse.success,
      blockCount: Object.keys(transformedResponse.workflowState.blocks).length,
      hasWorkflowState: true,
    })

    return NextResponse.json(transformedResponse)
  } catch (error) {
    logger.error(`[${requestId}] Auto layout failed:`, error)

    return NextResponse.json(
      {
        success: false,
        errors: [error instanceof Error ? error.message : 'Unknown auto layout error'],
      },
      { status: 500 }
    )
  }
}
