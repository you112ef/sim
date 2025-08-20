/**
 * Get Workflow Console - Client-side tool using unified execute route
 */

import { BaseTool } from '@/lib/copilot/tools/base-tool'
import type {
  CopilotToolCall,
  ToolExecuteResult,
  ToolExecutionOptions,
  ToolMetadata,
} from '@/lib/copilot/tools/types'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

export class GetWorkflowConsoleClientTool extends BaseTool {
  static readonly id = 'get_workflow_console'

  metadata: ToolMetadata = {
    id: GetWorkflowConsoleClientTool.id,
    displayConfig: {
      states: {
        executing: { displayName: 'Reading workflow console', icon: 'spinner' },
        success: { displayName: 'Read workflow console', icon: 'squareTerminal' },
        rejected: { displayName: 'Skipped reading console', icon: 'circle-slash' },
        errored: { displayName: 'Failed to read console', icon: 'error' },
        aborted: { displayName: 'Aborted reading console', icon: 'abort' },
      },
    },
    schema: {
      name: GetWorkflowConsoleClientTool.id,
      description: 'Get workflow console output and recent executions',
      parameters: {
        type: 'object',
        properties: {
          workflowId: { type: 'string' },
          limit: { type: 'number' },
          includeDetails: { type: 'boolean' },
        },
        required: ['workflowId'],
      },
    },
    requiresInterrupt: false,
  }

  async execute(
    toolCall: CopilotToolCall,
    options?: ToolExecutionOptions
  ): Promise<ToolExecuteResult> {
    const logger = createLogger('GetWorkflowConsoleClientTool')
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

      let workflowId = provided.workflowId || provided.workflow_id || ''
      const limit = provided.limit
      const includeDetails = provided.includeDetails ?? provided.include_details

      if (!workflowId) {
        const { activeWorkflowId } = useWorkflowRegistry.getState()
        if (activeWorkflowId) workflowId = activeWorkflowId
      }

      if (!workflowId) {
        options?.onStateChange?.('errored')
        return { success: false, error: 'workflowId is required' }
      }

      const paramsToSend: any = { workflowId }
      if (typeof limit === 'number') paramsToSend.limit = limit
      if (typeof includeDetails === 'boolean') paramsToSend.includeDetails = includeDetails

      const response = await fetch('/api/copilot/tools/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ methodId: GetWorkflowConsoleClientTool.id, params: paramsToSend }),
      })

      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result?.success) {
        const errorMessage = result?.error || 'Failed to get console'
        try {
          await fetch('/api/copilot/tools/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              toolId: toolCall.id,
              methodId: GetWorkflowConsoleClientTool.id,
              success: false,
              error: errorMessage,
            }),
          })
        } catch {}
        options?.onStateChange?.('errored')
        return { success: false, error: errorMessage }
      }

      options?.onStateChange?.('success')
      try {
        await fetch('/api/copilot/tools/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            toolId: toolCall.id,
            methodId: GetWorkflowConsoleClientTool.id,
            success: true,
            data: result.data,
          }),
        })
      } catch {}

      return { success: true, data: result.data }
    } catch (error: any) {
      options?.onStateChange?.('errored')
      try {
        await fetch('/api/copilot/tools/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            toolId: toolCall.id,
            methodId: GetWorkflowConsoleClientTool.id,
            success: false,
            error: error?.message || 'Unexpected error',
          }),
        })
      } catch {}
      return { success: false, error: error?.message || 'Unexpected error' }
    }
  }
}
