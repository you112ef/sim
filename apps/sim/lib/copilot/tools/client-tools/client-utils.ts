import type {
  CopilotToolCall,
  ToolExecuteResult,
  ToolExecutionOptions,
} from '@/lib/copilot/tools/types'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('CopilotClientUtils')

export function safeStringify(obj: any, maxLength = 1000): string {
  try {
    if (obj === undefined) return 'undefined'
    if (obj === null) return 'null'
    const str = JSON.stringify(obj)
    return str ? str.substring(0, maxLength) : 'empty'
  } catch (e) {
    return `[stringify error: ${e}]`
  }
}

export function normalizeToolCallArguments(toolCall: CopilotToolCall): CopilotToolCall {
  const extended = toolCall as CopilotToolCall & { arguments?: any }
  if (extended.arguments && !toolCall.parameters && !toolCall.input) {
    toolCall.input = extended.arguments
    toolCall.parameters = extended.arguments
  }
  return toolCall
}

export function getProvidedParams(toolCall: CopilotToolCall): any {
  const extended = toolCall as CopilotToolCall & { arguments?: any }
  return toolCall.parameters || toolCall.input || extended.arguments || {}
}

export async function postToExecuteAndComplete(
  methodId: string,
  params: Record<string, any>,
  toolIdentifiers: { toolCallId?: string | null; toolId?: string | null },
  options?: ToolExecutionOptions
): Promise<ToolExecuteResult> {
  try {
    options?.onStateChange?.('executing')

    const response = await fetch('/api/copilot/tools/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ methodId, params }),
    })

    logger.info('Execute route response received', { status: response.status })

    const result = await response.json().catch(() => ({}))

    if (!response.ok || !result?.success) {
      const errorMessage = result?.error || 'Failed to execute server method'
      try {
        await fetch('/api/copilot/tools/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            toolId: toolIdentifiers.toolId ?? toolIdentifiers.toolCallId ?? null,
            methodId,
            success: false,
            error: errorMessage,
          }),
        })
      } catch {}
      options?.onStateChange?.('errored')
      return {
        success: false,
        error: errorMessage,
      }
    }

    options?.onStateChange?.('success')

    try {
      await fetch('/api/copilot/tools/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          toolId: toolIdentifiers.toolId ?? toolIdentifiers.toolCallId ?? null,
          methodId,
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
          toolId: toolIdentifiers.toolId ?? toolIdentifiers.toolCallId ?? null,
          methodId,
          success: false,
          error: error?.message || 'Unexpected error while calling execute route',
        }),
      })
    } catch {}
    return {
      success: false,
      error: error?.message || 'Unexpected error while calling execute route',
    }
  }
}
