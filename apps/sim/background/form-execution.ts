import { db } from '@sim/db'
import { userStats, workflow as workflowTable } from '@sim/db/schema'
import { task } from '@trigger.dev/sdk'
import { eq, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { checkServerSideUsageLimits } from '@/lib/billing'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { IdempotencyService, webhookIdempotency } from '@/lib/idempotency'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import type { FormSubmissionPayload } from '@/lib/types/form'
import { decryptSecret } from '@/lib/utils'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'
import { updateWorkflowRunCounts } from '@/lib/workflows/utils'
import { Executor } from '@/executor'
import { Serializer } from '@/serializer'
import { mergeSubblockState } from '@/stores/workflows/server-utils'

const logger = createLogger('TriggerFormExecution')

export type { FormSubmissionPayload }

/**
 * Helper function to process block states for execution
 */
function processBlockStatesForExecution(mergedStates: any): Record<string, Record<string, any>> {
  return Object.fromEntries(
    Object.entries(mergedStates).map(([blockId, blockState]: [string, any]) => [
      blockId,
      Object.fromEntries(
        Object.entries(blockState.subBlocks).map(([key, subBlock]: [string, any]) => [
          key,
          subBlock.value,
        ])
      ),
    ])
  )
}

export async function executeFormSubmissionJob(payload: FormSubmissionPayload) {
  const executionId = uuidv4()
  const requestId = executionId.slice(0, 8)

  logger.info(`[${requestId}] Starting form submission execution`, {
    formId: payload.formId,
    workflowId: payload.workflowId,
    userId: payload.userId,
    executionId,
  })

  const idempotencyKey = IdempotencyService.createWebhookIdempotencyKey(
    payload.formId,
    payload.headers
  )

  const runOperation = async () => {
    return await executeFormSubmissionJobInternal(payload, executionId, requestId)
  }

  return await webhookIdempotency.executeWithIdempotency('form', idempotencyKey, runOperation)
}

async function executeFormSubmissionJobInternal(
  payload: FormSubmissionPayload,
  executionId: string,
  requestId: string
) {
  const loggingSession = new LoggingSession(payload.workflowId, executionId, 'form', requestId)

  try {
    const usageCheck = await checkServerSideUsageLimits(payload.userId)
    if (usageCheck.isExceeded) {
      logger.warn(
        `[${requestId}] User ${payload.userId} has exceeded usage limits. Skipping form execution.`,
        {
          currentUsage: usageCheck.currentUsage,
          limit: usageCheck.limit,
          workflowId: payload.workflowId,
        }
      )
      throw new Error(
        usageCheck.message ||
          'Usage limit exceeded. Please upgrade your plan to continue using forms.'
      )
    }

    const workflowData = await loadWorkflowFromNormalizedTables(payload.workflowId)
    if (!workflowData) {
      throw new Error(`Workflow not found: ${payload.workflowId}`)
    }

    const { blocks, edges, loops, parallels } = workflowData

    const wfRows = await db
      .select({ workspaceId: workflowTable.workspaceId })
      .from(workflowTable)
      .where(eq(workflowTable.id, payload.workflowId))
      .limit(1)
    const workspaceId = wfRows[0]?.workspaceId || undefined

    const { personalEncrypted, workspaceEncrypted } = await getPersonalAndWorkspaceEnv(
      payload.userId,
      workspaceId
    )
    const mergedEncrypted = { ...personalEncrypted, ...workspaceEncrypted }
    const decryptedPairs = await Promise.all(
      Object.entries(mergedEncrypted).map(async ([key, encrypted]) => {
        const { decrypted } = await decryptSecret(encrypted)
        return [key, decrypted] as const
      })
    )
    const decryptedEnvVars: Record<string, string> = Object.fromEntries(decryptedPairs)

    // Start logging session
    await loggingSession.safeStart({
      userId: payload.userId,
      workspaceId: workspaceId || '',
      variables: decryptedEnvVars,
    })

    // Merge subblock states (matching workflow-execution pattern)
    const mergedStates = mergeSubblockState(blocks, {})

    // Process block states for execution
    const processedBlockStates = processBlockStatesForExecution(mergedStates)

    // Create serialized workflow
    const serializer = new Serializer()
    const serializedWorkflow = serializer.serializeWorkflow(
      mergedStates,
      edges,
      loops || {},
      parallels || {},
      true // Enable validation during execution
    )

    // Format form input - normalize field names to lowercase for case-insensitive access
    const input: Record<string, any> = {}
    Object.entries(payload.formData).forEach(([key, value]) => {
      input[key.toLowerCase()] = value
    })

    // Create executor and execute
    const executor = new Executor({
      workflow: serializedWorkflow,
      currentBlockStates: processedBlockStates,
      envVarValues: decryptedEnvVars,
      workflowInput: input,
      contextExtensions: {
        executionId,
        workspaceId: workspaceId || '',
      },
    })

    // Set up logging on the executor
    loggingSession.setupExecutor(executor)

    logger.info(`[${requestId}] Executing workflow for form submission`)

    // Execute the workflow
    const result = await executor.execute(payload.workflowId, payload.blockId)

    // Check if we got a StreamingExecution result
    const executionResult = 'stream' in result && 'execution' in result ? result.execution : result

    logger.info(`[${requestId}] Form submission execution completed`, {
      success: executionResult.success,
      workflowId: payload.workflowId,
    })

    // Update workflow run counts on success
    if (executionResult.success) {
      await updateWorkflowRunCounts(payload.workflowId)

      // Track execution in user stats - we'll need to add a new column for form triggers
      // For now, we can track it as a manual execution since forms are user-initiated
      await db
        .update(userStats)
        .set({
          totalManualExecutions: sql`total_manual_executions + 1`,
          lastActive: sql`now()`,
        })
        .where(eq(userStats.userId, payload.userId))
    }

    // Build trace spans and complete logging session
    const { traceSpans, totalDuration } = buildTraceSpans(executionResult)

    await loggingSession.safeComplete({
      endedAt: new Date().toISOString(),
      totalDurationMs: totalDuration || 0,
      finalOutput: executionResult.output || {},
      traceSpans: traceSpans as any,
    })

    return {
      success: executionResult.success,
      workflowId: payload.workflowId,
      executionId,
      output: executionResult.output,
      executedAt: new Date().toISOString(),
      formId: payload.formId,
    }
  } catch (error: any) {
    logger.error(`[${requestId}] Form submission execution failed`, {
      error: error.message,
      stack: error.stack,
      workflowId: payload.workflowId,
      formId: payload.formId,
    })

    // Complete logging session with error
    try {
      await loggingSession.safeCompleteWithError({
        endedAt: new Date().toISOString(),
        totalDurationMs: 0,
        error: {
          message: error.message || 'Form submission execution failed',
          stackTrace: error.stack,
        },
      })
    } catch (loggingError) {
      logger.error(`[${requestId}] Failed to complete logging session`, loggingError)
    }

    throw error
  }
}

export const formSubmission = task({
  id: 'form-submission',
  retry: {
    maxAttempts: 1,
  },
  run: async (payload: FormSubmissionPayload) => executeFormSubmissionJob(payload),
})
