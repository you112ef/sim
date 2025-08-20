/**
 * Get Environment Variables - Client-side tool using unified execute route
 */

import { BaseTool } from '@/lib/copilot/tools/base-tool'
import { postToExecuteAndComplete } from '@/lib/copilot/tools/client-tools/client-utils'
import type {
  CopilotToolCall,
  ToolExecuteResult,
  ToolExecutionOptions,
  ToolMetadata,
} from '@/lib/copilot/tools/types'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

export class GetEnvironmentVariablesClientTool extends BaseTool {
  static readonly id = 'get_environment_variables'

  metadata: ToolMetadata = {
    id: GetEnvironmentVariablesClientTool.id,
    displayConfig: {
      states: {
        executing: { displayName: 'Getting environment variables', icon: 'spinner' },
        success: { displayName: 'Found environment variables', icon: 'wrench' },
        rejected: { displayName: 'Skipped viewing environment variables', icon: 'circle-slash' },
        errored: { displayName: 'Failed to get environment variables', icon: 'error' },
        aborted: { displayName: 'Environment variables viewing aborted', icon: 'abort' },
      },
    },
    schema: {
      name: GetEnvironmentVariablesClientTool.id,
      description: 'Get environment variables for the active workflow/user',
      parameters: {
        type: 'object',
        properties: {
          workflowId: { type: 'string', description: 'Optional workflow ID' },
        },
        required: [],
      },
    },
    requiresInterrupt: false,
  }

  async execute(
    toolCall: CopilotToolCall,
    options?: ToolExecutionOptions
  ): Promise<ToolExecuteResult> {
    const logger = createLogger('GetEnvironmentVariablesClientTool')

    try {
      options?.onStateChange?.('executing')

      // Prefer provided param if any; else use active workflowId
      const provided = (toolCall.parameters || toolCall.input || {}) as Record<string, any>
      let workflowId: string | undefined = provided.workflowId
      if (!workflowId) {
        const { activeWorkflowId } = useWorkflowRegistry.getState()
        workflowId = activeWorkflowId || undefined
      }

      const params = { ...(workflowId ? { workflowId } : {}) }

      const result = await postToExecuteAndComplete(
        GetEnvironmentVariablesClientTool.id,
        params,
        { toolId: toolCall.id },
        options
      )

      return result
    } catch (error: any) {
      logger.error('Error in client tool execution:', {
        toolCallId: toolCall.id,
        error: error,
        message: error instanceof Error ? error.message : String(error),
      })
      options?.onStateChange?.('errored')
      return { success: false, error: error.message || 'Failed to get environment variables' }
    }
  }
}
