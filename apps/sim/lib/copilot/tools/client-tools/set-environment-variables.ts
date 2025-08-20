/**
 * Set Environment Variables - Client-side tool using unified execute route (requires interrupt)
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

export class SetEnvironmentVariablesClientTool extends BaseTool {
  static readonly id = 'set_environment_variables'

  metadata: ToolMetadata = {
    id: SetEnvironmentVariablesClientTool.id,
    displayConfig: {
      states: {
        pending: { displayName: 'Set environment variables?', icon: 'edit' },
        executing: { displayName: 'Setting environment variables', icon: 'spinner' },
        success: { displayName: 'Set environment variables', icon: 'wrench' },
        rejected: { displayName: 'Skipped setting environment variables', icon: 'circle-slash' },
        errored: { displayName: 'Failed to set environment variables', icon: 'error' },
        background: { displayName: 'Setting moved to background', icon: 'wrench' },
        aborted: { displayName: 'Aborted setting environment variables', icon: 'abort' },
      },
    },
    schema: {
      name: SetEnvironmentVariablesClientTool.id,
      description: 'Set environment variables for the active workflow',
      parameters: {
        type: 'object',
        properties: {
          variables: { type: 'object' },
          workflowId: { type: 'string' },
        },
        required: ['variables'],
      },
    },
    requiresInterrupt: true,
  }

  async execute(
    toolCall: CopilotToolCall,
    options?: ToolExecutionOptions
  ): Promise<ToolExecuteResult> {
    const logger = createLogger('SetEnvironmentVariablesClientTool')

    try {
      options?.onStateChange?.('executing')
      const ext = toolCall as CopilotToolCall & { arguments?: any }
      if (ext.arguments && !toolCall.parameters && !toolCall.input) {
        toolCall.input = ext.arguments
        toolCall.parameters = ext.arguments
      }
      const provided = toolCall.parameters || toolCall.input || ext.arguments || {}

      const variables = provided.variables || {}
      const workflowId = provided.workflowId

      if (!variables || typeof variables !== 'object' || Object.keys(variables).length === 0) {
        options?.onStateChange?.('errored')
        return { success: false, error: 'variables is required' }
      }

      const params = { variables, ...(workflowId ? { workflowId } : {}) }

      const result = await postToExecuteAndComplete(
        SetEnvironmentVariablesClientTool.id,
        params,
        { toolId: toolCall.id },
        options
      )

      return result
    } catch (error: any) {
      options?.onStateChange?.('errored')
      return { success: false, error: error?.message || 'Unexpected error' }
    }
  }
}
