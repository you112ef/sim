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
    const isSetEnv = methodId === 'set_environment_variables'
    if (isSetEnv) {
      logger.info('[SEV] postToExecuteAndComplete:start', {
        methodId,
        paramsKeys: Object.keys(params || {}),
        toolIdentifiers,
        stack: new Error().stack,
      })
    }

    options?.onStateChange?.('executing')

    const response = await fetch('/api/copilot/tools/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ methodId, params }),
    })

    if (isSetEnv) {
      logger.info('[SEV] postToExecuteAndComplete:execute-response', {
        methodId,
        status: response.status,
      })
    }

    logger.info('Execute route response received', { status: response.status })

    const result = await response.json().catch(() => ({}))

    if (!response.ok || !result?.success) {
      const errorMessage = result?.error || 'Failed to execute server method'
      if (isSetEnv) {
        logger.info('[SEV] postToExecuteAndComplete:complete-start (error path)', {
          methodId,
          toolId: toolIdentifiers.toolId ?? toolIdentifiers.toolCallId ?? null,
          errorMessage,
        })
      }
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
        if (isSetEnv) {
          logger.info('[SEV] postToExecuteAndComplete:complete-finished (error path)', {
            methodId,
          })
        }
      } catch (e) {
        if (isSetEnv) {
          logger.info('[SEV] postToExecuteAndComplete:complete-failed (error path)', {
            methodId,
            error: e instanceof Error ? e.message : String(e),
          })
        }
      }
      options?.onStateChange?.('errored')
      return {
        success: false,
        error: errorMessage,
      }
    }

    options?.onStateChange?.('success')

    if (isSetEnv) {
      logger.info('[SEV] postToExecuteAndComplete:complete-start (success path)', {
        methodId,
        toolId: toolIdentifiers.toolId ?? toolIdentifiers.toolCallId ?? null,
      })
    }

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
      if (isSetEnv) {
        logger.info('[SEV] postToExecuteAndComplete:complete-finished (success path)', {
          methodId,
        })
      }
    } catch (e) {
      if (isSetEnv) {
        logger.info('[SEV] postToExecuteAndComplete:complete-failed (success path)', {
          methodId,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }

    return { success: true, data: result.data }
  } catch (error: any) {
    if (methodId === 'set_environment_variables') {
      logger.info('[SEV] postToExecuteAndComplete:catch', {
        methodId,
        error: error?.message || 'Unknown',
      })
    }
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
      if (methodId === 'set_environment_variables') {
        logger.info('[SEV] postToExecuteAndComplete:complete-finished (catch path)', {
          methodId,
        })
      }
    } catch (e) {
      if (methodId === 'set_environment_variables') {
        logger.info('[SEV] postToExecuteAndComplete:complete-failed (catch path)', {
          methodId,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }
    return {
      success: false,
      error: error?.message || 'Unexpected error while calling execute route',
    }
  }
}
