/**
 * Get OAuth Credentials - Client-side tool using unified execute route
 */

import { BaseTool } from '@/lib/copilot/tools/base-tool'
import type {
  CopilotToolCall,
  ToolExecuteResult,
  ToolExecutionOptions,
  ToolMetadata,
} from '@/lib/copilot/tools/types'
import { createLogger } from '@/lib/logs/console/logger'
import { postToExecuteAndComplete } from '@/lib/copilot/tools/client-tools/client-utils'

export class GetOAuthCredentialsClientTool extends BaseTool {
  static readonly id = 'get_oauth_credentials'

  metadata: ToolMetadata = {
    id: GetOAuthCredentialsClientTool.id,
    displayConfig: {
      states: {
        executing: { displayName: 'Retrieving login IDs', icon: 'spinner' },
        success: { displayName: 'Retrieved login IDs', icon: 'key' },
        rejected: { displayName: 'Skipped retrieving login IDs', icon: 'circle-slash' },
        errored: { displayName: 'Failed to retrieve login IDs', icon: 'error' },
        aborted: { displayName: 'Retrieving login IDs aborted', icon: 'abort' },
      },
    },
    schema: {
      name: GetOAuthCredentialsClientTool.id,
      description: 'Get OAuth credentials for the current user',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'Optional explicit userId override' },
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
    const logger = createLogger('GetOAuthCredentialsClientTool')

    try {
      options?.onStateChange?.('executing')

      const provided = (toolCall.parameters || toolCall.input || {}) as Record<string, any>
      const userId: string | undefined = provided.userId

      const result = await postToExecuteAndComplete(
        GetOAuthCredentialsClientTool.id,
        { ...(userId ? { userId } : {}) },
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
      return { success: false, error: error.message || 'Failed to retrieve login IDs' }
    }
  }
}
