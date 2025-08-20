/**
 * Online Search - Client-side tool using unified execute route
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

export class OnlineSearchClientTool extends BaseTool {
  static readonly id = 'search_online'

  metadata: ToolMetadata = {
    id: OnlineSearchClientTool.id,
    displayConfig: {
      states: {
        executing: { displayName: 'Searching online', icon: 'spinner' },
        success: { displayName: 'Searched online', icon: 'globe' },
        rejected: { displayName: 'Skipped online search', icon: 'circle-slash' },
        errored: { displayName: 'Failed to search online', icon: 'error' },
        aborted: { displayName: 'Aborted online search', icon: 'abort' },
      },
    },
    schema: {
      name: OnlineSearchClientTool.id,
      description: 'Search online for information',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          num: { type: 'number' },
          type: { type: 'string' },
          gl: { type: 'string' },
          hl: { type: 'string' },
        },
        required: ['query'],
      },
    },
    requiresInterrupt: false,
  }

  async execute(
    toolCall: CopilotToolCall,
    options?: ToolExecutionOptions
  ): Promise<ToolExecuteResult> {
    const logger = createLogger('OnlineSearchClientTool')
    const safeStringify = (o: any, m = 800) => {
      try {
        if (o === undefined) return 'undefined'
        if (o === null) return 'null'
        return JSON.stringify(o).substring(0, m)
      } catch {
        return '[unserializable]'
      }
    }

    try {
      options?.onStateChange?.('executing')
      const ext = toolCall as CopilotToolCall & { arguments?: any }
      if (ext.arguments && !toolCall.parameters && !toolCall.input) {
        toolCall.input = ext.arguments
        toolCall.parameters = ext.arguments
      }
      const provided = toolCall.parameters || toolCall.input || ext.arguments || {}

      const query = provided.query || provided.search || provided.q || ''
      const num = provided.num ?? provided.limit
      const type = provided.type
      const gl = provided.gl
      const hl = provided.hl

      if (!query || typeof query !== 'string' || !query.trim()) {
        options?.onStateChange?.('errored')
        return { success: false, error: 'query is required' }
      }

      const paramsToSend: any = { query: query.trim() }
      if (typeof num === 'number') paramsToSend.num = num
      if (typeof type === 'string') paramsToSend.type = type
      if (typeof gl === 'string') paramsToSend.gl = gl
      if (typeof hl === 'string') paramsToSend.hl = hl

      return await postToExecuteAndComplete(
        OnlineSearchClientTool.id,
        paramsToSend,
        { toolCallId: toolCall.id, toolId: toolCall.id },
        options
      )
    } catch (error: any) {
      options?.onStateChange?.('errored')
      return { success: false, error: error?.message || 'Unexpected error' }
    }
  }
}
