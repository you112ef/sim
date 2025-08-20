import { BaseTool } from '@/lib/copilot/tools/base-tool'
import { postToExecuteAndComplete } from '@/lib/copilot/tools/client-tools/client-utils'
import type {
  CopilotToolCall,
  ToolExecuteResult,
  ToolExecutionOptions,
  ToolMetadata,
} from '@/lib/copilot/tools/types'
import { createLogger } from '@/lib/logs/console/logger'

export class GDriveRequestAccessTool extends BaseTool {
  static readonly id = 'gdrive_request_access'

  metadata: ToolMetadata = {
    id: GDriveRequestAccessTool.id,
    displayConfig: {
      states: {
        pending: {
          displayName: 'Select Google Drive files',
          icon: 'googleDrive',
        },
        executing: {
          displayName: 'Requesting Google Drive access',
          icon: 'spinner',
        },
        accepted: {
          displayName: 'Requesting Google Drive access',
          icon: 'spinner',
        },
        success: {
          displayName: 'Selected Google Drive files',
          icon: 'googleDrive',
        },
        rejected: {
          displayName: 'Skipped Google Drive access request',
          icon: 'circle-slash',
        },
        errored: {
          displayName: 'Failed to request Google Drive access',
          icon: 'error',
        },
      },
    },
    schema: {
      name: GDriveRequestAccessTool.id,
      description: 'Prompt the user to grant Google Drive file access via the picker',
      parameters: {
        type: 'object',
        properties: {
          // Accepts arbitrary context but no required params
        },
        required: [],
      },
    },
    requiresInterrupt: true,
  }

  async execute(
    toolCall: CopilotToolCall,
    options?: ToolExecutionOptions
  ): Promise<ToolExecuteResult> {
    const logger = createLogger('GDriveRequestAccessTool')

    try {
      options?.onStateChange?.('executing')

      // Execute server-side request access (no params)
      return await postToExecuteAndComplete(
        GDriveRequestAccessTool.id,
        {},
        { toolCallId: toolCall.id, toolId: toolCall.id },
        options
      )
    } catch (error: any) {
      logger.error('Client tool error', { toolCallId: toolCall.id, message: error?.message })
      options?.onStateChange?.('errored')
      return { success: false, error: error?.message || 'Unexpected error' }
    }
  }
}
