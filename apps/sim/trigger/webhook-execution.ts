import { task } from '@trigger.dev/sdk/v3'
import { eq, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { checkServerSideUsageLimits } from '@/lib/billing'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { decryptSecret } from '@/lib/utils'
import { fetchAndProcessAirtablePayloads, formatWebhookInput } from '@/lib/webhooks/utils'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'
import { updateWorkflowRunCounts } from '@/lib/workflows/utils'
import { db } from '@/db'
import { environment as environmentTable, userStats } from '@/db/schema'
import { Executor } from '@/executor'
import { Serializer } from '@/serializer'
import { mergeSubblockState } from '@/stores/workflows/server-utils'
import { getOAuthToken } from '@/app/api/auth/oauth/utils'
import type { CleanedOutlookMessage, OutlookMessage } from '@/tools/outlook/types'

const logger = createLogger('TriggerWebhookExecution')

async function fetchOutlookEmailContent(
  userId: string,
  resourceUrl: string,
  requestId: string
): Promise<{ email: CleanedOutlookMessage | null; error?: string }> {
  try {
    logger.info(`[${requestId}] DEBUG: Starting fetchOutlookEmailContent`, {
      userId,
      resourceUrl,
    })
    
    const accessToken = await getOAuthToken(userId, 'outlook')
    if (!accessToken) {
      logger.warn(`[${requestId}] No Outlook access token found for user ${userId}`)
      return { email: null, error: 'No Outlook access token found' }
    }

    logger.info(`[${requestId}] DEBUG: Access token retrieved, making Graph API call`, {
      resourceUrl,
      hasToken: !!accessToken,
      tokenLength: accessToken.length,
    })

    // Fix the resource URL to use lowercase 'users' and 'messages' as required by Microsoft Graph API
    const normalizedResourceUrl = resourceUrl
      .replace(/^Users\//, 'users/')
      .replace(/\/Messages\//, '/messages/')
    const apiUrl = `https://graph.microsoft.com/v1.0/${normalizedResourceUrl}`
    
    logger.info(`[${requestId}] DEBUG: Normalized resource URL`, {
      originalResourceUrl: resourceUrl,
      normalizedResourceUrl,
      apiUrl,
    })
    
    const response = await fetch(apiUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    logger.info(`[${requestId}] DEBUG: Graph API response received`, {
      apiUrl,
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
    })

    if (!response.ok) {
      const responseText = await response.text()
      logger.warn(`[${requestId}] Failed to fetch email content: ${response.status}`, {
        apiUrl,
        responseText: responseText.substring(0, 500), // Truncate for logging
      })
      return { 
        email: null, 
        error: `API call failed: ${response.status} ${response.statusText} - ${responseText.substring(0, 200)}` 
      }
    }

    const message: OutlookMessage = await response.json()
    
    logger.info(`[${requestId}] DEBUG: Successfully parsed email message`, {
      resourceUrl,
      subject: message.subject,
      hasBody: !!message.body,
      bodyContentType: message.body?.contentType,
      bodyLength: message.body?.content?.length,
      sender: message.sender?.emailAddress?.address,
      bodyPreview: message.bodyPreview?.substring(0, 100),
    })

    return {
      email: {
        id: message.id,
        subject: message.subject,
        bodyPreview: message.bodyPreview,
        body: {
          contentType: message.body?.contentType,
          content: message.body?.content,
        },
        sender: {
          name: message.sender?.emailAddress?.name,
          address: message.sender?.emailAddress?.address,
        },
        from: {
          name: message.from?.emailAddress?.name,
          address: message.from?.emailAddress?.address,
        },
        toRecipients:
          message.toRecipients?.map((recipient) => ({
            name: recipient.emailAddress?.name,
            address: recipient.emailAddress?.address,
          })) || [],
        ccRecipients:
          message.ccRecipients?.map((recipient) => ({
            name: recipient.emailAddress?.name,
            address: recipient.emailAddress?.address,
          })) || [],
        receivedDateTime: message.receivedDateTime,
        sentDateTime: message.sentDateTime,
        hasAttachments: message.hasAttachments,
        isRead: message.isRead,
        importance: message.importance,
      }
    }
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Outlook email content:`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      resourceUrl,
      userId,
    })
    return { 
      email: null, 
      error: `Exception: ${error instanceof Error ? error.message : String(error)}` 
    }
  }
}

export const webhookExecution = task({
  id: 'webhook-execution',
  retry: {
    maxAttempts: 1,
  },
  run: async (payload: {
    webhookId: string
    workflowId: string
    userId: string
    provider: string
    body: any
    headers: Record<string, string>
    path: string
    blockId?: string
  }) => {
    const executionId = uuidv4()
    const requestId = executionId.slice(0, 8)

    logger.info(`[${requestId}] Starting webhook execution via trigger.dev`, {
      webhookId: payload.webhookId,
      workflowId: payload.workflowId,
      provider: payload.provider,
      userId: payload.userId,
      executionId,
      bodyKeys: Object.keys(payload.body || {}),
      payloadProvider: payload.provider,
    })

    // Add console.log for debugging - this should show in your local logs
    console.log(`🔍 WEBHOOK DEBUG: Starting execution for provider: ${payload.provider}`)
    console.log(`🔍 WEBHOOK DEBUG: Request ID: ${requestId}`)

    // Add debug logging for Outlook specifically
    if (payload.provider === 'outlook') {
      console.log(`🟣 OUTLOOK DEBUG: Outlook webhook detected!`)
      console.log(`🟣 OUTLOOK DEBUG: Payload body:`, JSON.stringify(payload.body, null, 2))
      
      logger.info(`[${requestId}] DEBUG: Outlook webhook detected`, {
        provider: payload.provider,
        bodyValue: payload.body?.value,
        notificationCount: payload.body?.value?.length || 0,
      })
    }

    // Initialize logging session outside try block so it's available in catch
    const loggingSession = new LoggingSession(payload.workflowId, executionId, 'webhook', requestId)

    try {
      // Check usage limits first
      const usageCheck = await checkServerSideUsageLimits(payload.userId)
      if (usageCheck.isExceeded) {
        logger.warn(
          `[${requestId}] User ${payload.userId} has exceeded usage limits. Skipping webhook execution.`,
          {
            currentUsage: usageCheck.currentUsage,
            limit: usageCheck.limit,
            workflowId: payload.workflowId,
          }
        )
        throw new Error(
          usageCheck.message ||
            'Usage limit exceeded. Please upgrade your plan to continue using webhooks.'
        )
      }

      // Load workflow from normalized tables
      const workflowData = await loadWorkflowFromNormalizedTables(payload.workflowId)
      if (!workflowData) {
        throw new Error(`Workflow not found: ${payload.workflowId}`)
      }

      const { blocks, edges, loops, parallels } = workflowData

      // Get environment variables (matching workflow-execution pattern)
      const [userEnv] = await db
        .select()
        .from(environmentTable)
        .where(eq(environmentTable.userId, payload.userId))
        .limit(1)

      let decryptedEnvVars: Record<string, string> = {}
      if (userEnv) {
        const decryptionPromises = Object.entries((userEnv.variables as any) || {}).map(
          async ([key, encryptedValue]) => {
            try {
              const { decrypted } = await decryptSecret(encryptedValue as string)
              return [key, decrypted] as const
            } catch (error: any) {
              logger.error(`[${requestId}] Failed to decrypt environment variable "${key}":`, error)
              throw new Error(`Failed to decrypt environment variable "${key}": ${error.message}`)
            }
          }
        )

        const decryptedPairs = await Promise.all(decryptionPromises)
        decryptedEnvVars = Object.fromEntries(decryptedPairs)
      }

      // Start logging session
      await loggingSession.safeStart({
        userId: payload.userId,
        workspaceId: '', // TODO: Get from workflow if needed
        variables: decryptedEnvVars,
      })

      // Merge subblock states (matching workflow-execution pattern)
      const mergedStates = mergeSubblockState(blocks, {})

      // Process block states for execution
      const processedBlockStates = Object.entries(mergedStates).reduce(
        (acc, [blockId, blockState]) => {
          acc[blockId] = Object.entries(blockState.subBlocks).reduce(
            (subAcc, [key, subBlock]) => {
              subAcc[key] = subBlock.value
              return subAcc
            },
            {} as Record<string, any>
          )
          return acc
        },
        {} as Record<string, Record<string, any>>
      )

      // Handle workflow variables (for now, use empty object since we don't have workflow metadata)
      const workflowVariables = {}

      // Create serialized workflow
      const serializer = new Serializer()
      const serializedWorkflow = serializer.serializeWorkflow(
        mergedStates,
        edges,
        loops || {},
        parallels || {},
        true // Enable validation during execution
      )

      // Handle special Airtable case
      if (payload.provider === 'airtable') {
        logger.info(
          `[${requestId}] Processing Airtable webhook via fetchAndProcessAirtablePayloads`
        )

        const webhookData = {
          id: payload.webhookId,
          provider: payload.provider,
          providerConfig: {}, // Will be loaded within fetchAndProcessAirtablePayloads
        }

        // Create a mock workflow object for Airtable processing
        const mockWorkflow = {
          id: payload.workflowId,
          userId: payload.userId,
        }

        await fetchAndProcessAirtablePayloads(webhookData, mockWorkflow, requestId)

        await loggingSession.safeComplete({
          endedAt: new Date().toISOString(),
          totalDurationMs: 0,
          finalOutput: { message: 'Airtable webhook processed' },
          traceSpans: [],
        })

        return {
          success: true,
          workflowId: payload.workflowId,
          executionId,
          output: { message: 'Airtable webhook processed' },
          executedAt: new Date().toISOString(),
        }
      }

      // Handle special Outlook case (add after Airtable handling)
      if (payload.provider === 'outlook') {
        console.log(`🟣 OUTLOOK DEBUG: Entering Outlook special handling section!!!`)
        
        logger.info(`[${requestId}] DEBUG: Entering Outlook special handling section`)
        logger.info(`[${requestId}] Processing Outlook webhook with email content fetching`)

        const notifications = payload.body?.value || []
        console.log(`🟣 OUTLOOK DEBUG: Found ${notifications.length} notifications`)
        
        logger.info(`[${requestId}] DEBUG: Found ${notifications.length} notifications`, {
          notifications: notifications.map((n: any) => ({
            resource: n.resource,
            changeType: n.changeType,
            subscriptionId: n.subscriptionId,
          }))
        })
        
        // Fetch email content for each notification
        const emailsWithContent = await Promise.all(
          notifications.map(async (notification: any, index: number) => {
            logger.info(`[${requestId}] DEBUG: Processing notification ${index + 1}/${notifications.length}`, {
              resource: notification.resource,
              changeType: notification.changeType,
            })
            
            // Use the full resource URL directly (blog post approach)
            const resourceUrl = notification.resource
            const normalizedResourceUrl = resourceUrl 
              ? resourceUrl.replace(/^Users\//, 'users/').replace(/\/Messages\//, '/messages/')
              : resourceUrl
            
            logger.info(`[${requestId}] DEBUG: Processing resource URL`, {
              originalResourceUrl: resourceUrl,
              normalizedResourceUrl,
            })
            
            if (resourceUrl) {
              logger.info(`[${requestId}] DEBUG: Attempting to fetch email content for resource ${resourceUrl}`)
              
              const result = await fetchOutlookEmailContent(
                payload.userId,
                resourceUrl,
                requestId
              )
              
              logger.info(`[${requestId}] DEBUG: Email content fetch result`, {
                resourceUrl,
                success: !!result.email,
                error: result.error,
                subject: result.email?.subject,
                bodyPreview: result.email?.bodyPreview?.substring(0, 100),
              })
              
              return {
                notification,
                emailContent: result.email,
                error: result.error,
              }
            }
            
            logger.warn(`[${requestId}] DEBUG: No resource URL found for notification`, {
              notification,
            })
            
            return {
              notification,
              emailContent: null,
              error: undefined,
            }
          })
        )

        // Filter successful email fetches
        const validEmails = emailsWithContent
          .map(item => item.emailContent)
          .filter(Boolean)

        logger.info(`[${requestId}] DEBUG: Email fetch summary`, {
          totalNotifications: notifications.length,
          validEmails: validEmails.length,
          firstEmailSubject: validEmails[0]?.subject,
        })

                // Create debug info object with normalized API URLs
        const outlookDebugInfo = {
          apiUrls: emailsWithContent.map((item, index) => ({
            notificationIndex: index,
            resourceUrl: item.notification?.resource,
            originalApiUrl: item.notification?.resource ? `https://graph.microsoft.com/v1.0/${item.notification.resource}` : null,
            normalizedApiUrl: item.notification?.resource ? `https://graph.microsoft.com/v1.0/${item.notification.resource.replace(/^Users\//, 'users/').replace(/\/Messages\//, '/messages/')}` : null,
            emailFetched: !!item.emailContent,
            subject: item.emailContent?.subject,
            error: item.error,
          })),
          totalNotifications: notifications.length,
          successfulFetches: validEmails.length,
          requestId,
        }

        // Create input from email content
        const input = validEmails.length > 0 
          ? {
              input: `New email: ${validEmails[0]?.subject || 'No subject'} - ${validEmails[0]?.bodyPreview || validEmails[0]?.body?.content || 'No content'}`,
              outlook: {
                notifications: emailsWithContent.map(item => item.notification),
                emails: validEmails,
                raw: payload.body,
              },
              webhook: {
                data: {
                  provider: 'outlook',
                  path: payload.path,
                  payload: payload.body,
                  headers: payload.headers,
                  debug: outlookDebugInfo,
                },
              },
            }
          : {
              input: `New email received: ${notifications.length} notification(s)`,
              outlook: {
                notifications: emailsWithContent.map(item => item.notification),
                emails: [],
                raw: payload.body,
              },
              webhook: {
                data: {
                  provider: 'outlook',
                  path: payload.path,
                  payload: payload.body,
                  headers: payload.headers,
                  debug: outlookDebugInfo,
                },
              },
            }

        logger.info(`[${requestId}] DEBUG: Created Outlook input`, {
          inputText: typeof input.input === 'string' ? input.input : 'complex object',
          hasOutlookData: !!input.outlook,
          emailCount: input.outlook.emails.length,
          hasDebug: !!input.webhook?.data?.debug,
          debugApiUrlsCount: input.webhook?.data?.debug?.apiUrls?.length || 0,
        })

        // Create executor and execute
        const executor = new Executor(
          serializedWorkflow,
          processedBlockStates,
          decryptedEnvVars,
          input,
          workflowVariables
        )

        // Set up logging on the executor
        loggingSession.setupExecutor(executor)

        logger.info(`[${requestId}] Executing workflow for Outlook webhook with email content`)

        // Execute the workflow
        const result = await executor.execute(payload.workflowId, payload.blockId)

        // Check if we got a StreamingExecution result
        const executionResult =
          'stream' in result && 'execution' in result ? result.execution : result

        logger.info(`[${requestId}] Outlook webhook execution completed`, {
          success: executionResult.success,
          workflowId: payload.workflowId,
          emailCount: validEmails.length,
        })

        // Update workflow run counts on success
        if (executionResult.success) {
          await updateWorkflowRunCounts(payload.workflowId)

          // Track execution in user stats
          await db
            .update(userStats)
            .set({
              totalWebhookTriggers: sql`total_webhook_triggers + 1`,
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

        logger.info(`[${requestId}] DEBUG: Returning from Outlook special handling`, {
          success: executionResult.success,
          emailCount: validEmails.length,
        })

        // Collect debug information
        const debugInfo = {
                              apiUrls: emailsWithContent.map((item, index) => ({
                      notificationIndex: index,
                      resourceUrl: item.notification?.resource,
                      originalApiUrl: item.notification?.resource ? `https://graph.microsoft.com/v1.0/${item.notification.resource}` : null,
                      normalizedApiUrl: item.notification?.resource ? `https://graph.microsoft.com/v1.0/${item.notification.resource.replace(/^Users\//, 'users/').replace(/\/Messages\//, '/messages/')}` : null,
                      emailFetched: !!item.emailContent,
                      subject: item.emailContent?.subject,
                      error: item.error,
                    })),
          totalNotifications: notifications.length,
          successfulFetches: validEmails.length,
          requestId,
        }

        return {
          success: executionResult.success,
          workflowId: payload.workflowId,
          executionId,
          output: executionResult.output,
          executedAt: new Date().toISOString(),
          provider: payload.provider,
          emailCount: validEmails.length,
          debug: debugInfo,
        }
      }

      // Format input for standard webhooks
      const mockWebhook = {
        provider: payload.provider,
        blockId: payload.blockId,
      }
      const mockWorkflow = {
        id: payload.workflowId,
        userId: payload.userId,
      }
      const mockRequest = {
        headers: new Map(Object.entries(payload.headers)),
      } as any

      const input = formatWebhookInput(mockWebhook, mockWorkflow, payload.body, mockRequest)

      if (!input && payload.provider === 'whatsapp') {
        logger.info(`[${requestId}] No messages in WhatsApp payload, skipping execution`)
        await loggingSession.safeComplete({
          endedAt: new Date().toISOString(),
          totalDurationMs: 0,
          finalOutput: { message: 'No messages in WhatsApp payload' },
          traceSpans: [],
        })
        return {
          success: true,
          workflowId: payload.workflowId,
          executionId,
          output: { message: 'No messages in WhatsApp payload' },
          executedAt: new Date().toISOString(),
          debug: {
            provider: 'whatsapp',
            requestId,
            reason: 'No messages in payload',
          },
        }
      }

      // Create executor and execute
      const executor = new Executor(
        serializedWorkflow,
        processedBlockStates,
        decryptedEnvVars,
        input || {},
        workflowVariables
      )

      // Set up logging on the executor
      loggingSession.setupExecutor(executor)

      logger.info(`[${requestId}] Executing workflow for ${payload.provider} webhook`)

      // Execute the workflow
      const result = await executor.execute(payload.workflowId, payload.blockId)

      // Check if we got a StreamingExecution result
      const executionResult =
        'stream' in result && 'execution' in result ? result.execution : result

      logger.info(`[${requestId}] Webhook execution completed`, {
        success: executionResult.success,
        workflowId: payload.workflowId,
        provider: payload.provider,
      })

      // Update workflow run counts on success
      if (executionResult.success) {
        await updateWorkflowRunCounts(payload.workflowId)

        // Track execution in user stats
        await db
          .update(userStats)
          .set({
            totalWebhookTriggers: sql`total_webhook_triggers + 1`,
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
        provider: payload.provider,
      }
    } catch (error: any) {
      logger.error(`[${requestId}] Webhook execution failed`, {
        error: error.message,
        stack: error.stack,
        workflowId: payload.workflowId,
        provider: payload.provider,
      })

      // Complete logging session with error (matching workflow-execution pattern)
      try {
        await loggingSession.safeCompleteWithError({
          endedAt: new Date().toISOString(),
          totalDurationMs: 0,
          error: {
            message: error.message || 'Webhook execution failed',
            stackTrace: error.stack,
          },
        })
      } catch (loggingError) {
        logger.error(`[${requestId}] Failed to complete logging session`, loggingError)
      }

      throw error // Let Trigger.dev handle retries
    }
  },
})
