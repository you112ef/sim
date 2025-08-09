import crypto from 'crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import {
  type BlockState,
  calculateNextRunTime,
  generateCronExpression,
  getScheduleTimeValues,
  getSubBlockValue,
  validateCronExpression,
} from '@/lib/schedules/utils'
import { db } from '@/db'
import { workflow, workflowSchedule } from '@/db/schema'

const logger = createLogger('ScheduledAPI')

export const dynamic = 'force-dynamic'

const ScheduleRequestSchema = z.object({
  workflowId: z.string(),
  blockId: z.string().optional(),
  state: z
    .object({
      blocks: z.record(z.any()),
      edges: z.array(z.any()),
      loops: z.record(z.any()),
    })
    .optional(),
  scheduleConfig: z
    .object({
      scheduleType: z.string(),
      minutesInterval: z.string().optional(),
      hourlyMinute: z.string().optional(),
      dailyTime: z.string().optional(),
      weeklyDay: z.string().optional(),
      weeklyDayTime: z.string().optional(),
      monthlyDay: z.string().optional(),
      monthlyTime: z.string().optional(),
      cronExpression: z.string().optional(),
      timezone: z.string().optional(),
    })
    .optional(),
  mode: z.enum(['block', 'standalone']).optional(),
})

// Track recent requests to reduce redundant logging
const recentRequests = new Map<string, number>()
const LOGGING_THROTTLE_MS = 5000 // 5 seconds between logging for the same workflow

function hasValidScheduleConfig(
  scheduleType: string | undefined,
  scheduleValues: ReturnType<typeof getScheduleTimeValues>,
  starterBlock: BlockState
): boolean {
  switch (scheduleType) {
    case 'minutes':
      return !!scheduleValues.minutesInterval
    case 'hourly':
      return scheduleValues.hourlyMinute !== undefined
    case 'daily':
      return !!scheduleValues.dailyTime[0] || !!scheduleValues.dailyTime[1]
    case 'weekly':
      return (
        !!scheduleValues.weeklyDay &&
        (!!scheduleValues.weeklyTime[0] || !!scheduleValues.weeklyTime[1])
      )
    case 'monthly':
      return (
        !!scheduleValues.monthlyDay &&
        (!!scheduleValues.monthlyTime[0] || !!scheduleValues.monthlyTime[1])
      )
    case 'custom':
      return !!getSubBlockValue(starterBlock, 'cronExpression')
    default:
      return false
  }
}

/**
 * Get schedule information for a workflow
 */
export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const url = new URL(req.url)
  const workflowId = url.searchParams.get('workflowId')
  const blockId = url.searchParams.get('blockId')

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized schedule query attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!workflowId) {
      return NextResponse.json({ error: 'Missing workflowId parameter' }, { status: 400 })
    }

    // Check if user has permission to view this workflow
    const [workflowRecord] = await db
      .select({ userId: workflow.userId, workspaceId: workflow.workspaceId })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!workflowRecord) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    // Check authorization - either the user owns the workflow or has workspace permissions
    let isAuthorized = workflowRecord.userId === session.user.id

    // If not authorized by ownership and the workflow belongs to a workspace, check workspace permissions
    if (!isAuthorized && workflowRecord.workspaceId) {
      const userPermission = await getUserEntityPermissions(
        session.user.id,
        'workspace',
        workflowRecord.workspaceId
      )
      isAuthorized = userPermission !== null
    }

    if (!isAuthorized) {
      return NextResponse.json({ error: 'Not authorized to view this workflow' }, { status: 403 })
    }

    const now = Date.now()
    const lastLog = recentRequests.get(workflowId) || 0
    const shouldLog = now - lastLog > LOGGING_THROTTLE_MS

    if (shouldLog) {
      logger.info(`[${requestId}] Getting schedule for workflow ${workflowId}`)
      recentRequests.set(workflowId, now)
    }

    // Build query conditions
    const conditions = [eq(workflowSchedule.workflowId, workflowId)]
    if (blockId) {
      conditions.push(eq(workflowSchedule.blockId, blockId))
    } else {
      // If no blockId provided, look for workflow-level schedules (null blockId)
      conditions.push(isNull(workflowSchedule.blockId))
    }

    const schedule = await db
      .select()
      .from(workflowSchedule)
      .where(conditions.length > 1 ? and(...conditions) : conditions[0])
      .limit(1)

    const headers = new Headers()
    headers.set('Cache-Control', 'max-age=30') // Cache for 30 seconds

    if (schedule.length === 0) {
      return NextResponse.json({ schedule: null }, { headers })
    }

    const scheduleData = schedule[0]
    const isDisabled = scheduleData.status === 'disabled'
    const hasFailures = scheduleData.failedCount > 0

    return NextResponse.json(
      {
        schedule: scheduleData,
        isDisabled,
        hasFailures,
        canBeReactivated: isDisabled,
      },
      { headers }
    )
  } catch (error) {
    logger.error(`[${requestId}] Error retrieving workflow schedule`, error)
    return NextResponse.json({ error: 'Failed to retrieve workflow schedule' }, { status: 500 })
  }
}

/**
 * Create or update a schedule for a workflow
 */
export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized schedule update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { workflowId, blockId, state, scheduleConfig, mode } = ScheduleRequestSchema.parse(body)

    logger.info(
      `[${requestId}] Processing schedule update for workflow ${workflowId}, mode: ${mode}`
    )

    // Check if user has permission to modify this workflow
    const [workflowRecord] = await db
      .select({ userId: workflow.userId, workspaceId: workflow.workspaceId })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!workflowRecord) {
      logger.warn(`[${requestId}] Workflow not found: ${workflowId}`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    // Check authorization - either the user owns the workflow or has write/admin workspace permissions
    let isAuthorized = workflowRecord.userId === session.user.id

    // If not authorized by ownership and the workflow belongs to a workspace, check workspace permissions
    if (!isAuthorized && workflowRecord.workspaceId) {
      const userPermission = await getUserEntityPermissions(
        session.user.id,
        'workspace',
        workflowRecord.workspaceId
      )
      isAuthorized = userPermission === 'write' || userPermission === 'admin'
    }

    if (!isAuthorized) {
      logger.warn(
        `[${requestId}] User not authorized to modify schedule for workflow: ${workflowId}`
      )
      return NextResponse.json({ error: 'Not authorized to modify this workflow' }, { status: 403 })
    }

    // Find the target block - handle both block-based and standalone modes
    let targetBlock: BlockState | undefined

    if (mode === 'standalone' && scheduleConfig) {
      // For standalone mode, create a synthetic block from scheduleConfig
      targetBlock = {
        id: 'standalone-schedule',
        type: 'schedule',
        subBlocks: {
          scheduleType: { value: scheduleConfig.scheduleType },
          minutesInterval: { value: scheduleConfig.minutesInterval },
          hourlyMinute: { value: scheduleConfig.hourlyMinute },
          dailyTime: { value: scheduleConfig.dailyTime },
          weeklyDay: { value: scheduleConfig.weeklyDay },
          weeklyDayTime: { value: scheduleConfig.weeklyDayTime },
          monthlyDay: { value: scheduleConfig.monthlyDay },
          monthlyTime: { value: scheduleConfig.monthlyTime },
          cronExpression: { value: scheduleConfig.cronExpression },
          timezone: { value: scheduleConfig.timezone || 'UTC' },
        },
        position: { x: 0, y: 0 },
        width: 0,
        height: 0,
      } as BlockState
    } else if (state) {
      // Original block-based mode
      if (blockId) {
        // If blockId is provided, find that specific block
        targetBlock = Object.values(state.blocks).find((block: any) => block.id === blockId) as
          | BlockState
          | undefined
      } else {
        // Fallback: find either starter block or schedule trigger block
        targetBlock = Object.values(state.blocks).find(
          (block: any) => block.type === 'starter' || block.type === 'schedule'
        ) as BlockState | undefined
      }
    }

    if (!targetBlock) {
      logger.warn(`[${requestId}] No starter or schedule block found in workflow ${workflowId}`)
      return NextResponse.json(
        { error: 'No starter or schedule block found in workflow' },
        { status: 400 }
      )
    }

    const startWorkflow = getSubBlockValue(targetBlock, 'startWorkflow')
    const scheduleType = getSubBlockValue(targetBlock, 'scheduleType')

    const scheduleValues = getScheduleTimeValues(targetBlock)

    const hasScheduleConfig = hasValidScheduleConfig(scheduleType, scheduleValues, targetBlock)

    // For schedule trigger blocks, we always have valid configuration
    // For starter blocks, check if schedule is selected and has valid config
    const isScheduleBlock = targetBlock.type === 'schedule'
    const hasValidConfig = isScheduleBlock || (startWorkflow === 'schedule' && hasScheduleConfig)

    // Debug logging to understand why validation fails
    logger.info(`[${requestId}] Schedule validation debug:`, {
      workflowId,
      blockId,
      blockType: targetBlock.type,
      isScheduleBlock,
      startWorkflow,
      scheduleType,
      hasScheduleConfig,
      hasValidConfig,
      scheduleValues: {
        minutesInterval: scheduleValues.minutesInterval,
        dailyTime: scheduleValues.dailyTime,
        cronExpression: scheduleValues.cronExpression,
      },
    })

    if (!hasValidConfig) {
      logger.info(
        `[${requestId}] Removing schedule for workflow ${workflowId} - no valid configuration found`
      )
      // Build delete conditions
      const deleteConditions = [eq(workflowSchedule.workflowId, workflowId)]
      if (mode === 'standalone') {
        deleteConditions.push(isNull(workflowSchedule.blockId))
      } else if (blockId) {
        deleteConditions.push(eq(workflowSchedule.blockId, blockId))
      }

      await db
        .delete(workflowSchedule)
        .where(deleteConditions.length > 1 ? and(...deleteConditions) : deleteConditions[0])

      return NextResponse.json({ message: 'Schedule removed' })
    }

    if (isScheduleBlock) {
      logger.info(`[${requestId}] Processing schedule trigger block for workflow ${workflowId}`)
    } else if (startWorkflow !== 'schedule') {
      logger.info(
        `[${requestId}] Setting workflow to scheduled mode based on schedule configuration`
      )
    }

    logger.debug(`[${requestId}] Schedule type for workflow ${workflowId}: ${scheduleType}`)

    let cronExpression: string | null = null
    let nextRunAt: Date | undefined
    const timezone = getSubBlockValue(targetBlock, 'timezone') || 'UTC'

    try {
      const defaultScheduleType = scheduleType || 'daily'
      const scheduleStartAt = getSubBlockValue(targetBlock, 'scheduleStartAt')
      const scheduleTime = getSubBlockValue(targetBlock, 'scheduleTime')

      logger.debug(`[${requestId}] Schedule configuration:`, {
        type: defaultScheduleType,
        timezone,
        startDate: scheduleStartAt || 'not specified',
        time: scheduleTime || 'not specified',
      })

      cronExpression = generateCronExpression(defaultScheduleType, scheduleValues)

      // Additional validation for custom cron expressions
      if (defaultScheduleType === 'custom' && cronExpression) {
        const validation = validateCronExpression(cronExpression)
        if (!validation.isValid) {
          logger.error(`[${requestId}] Invalid cron expression: ${validation.error}`)
          return NextResponse.json(
            { error: `Invalid cron expression: ${validation.error}` },
            { status: 400 }
          )
        }
      }

      nextRunAt = calculateNextRunTime(defaultScheduleType, scheduleValues)

      logger.debug(
        `[${requestId}] Generated cron: ${cronExpression}, next run at: ${nextRunAt.toISOString()}`
      )
    } catch (error) {
      logger.error(`[${requestId}] Error generating schedule: ${error}`)
      return NextResponse.json({ error: 'Failed to generate schedule' }, { status: 400 })
    }

    const finalBlockId = mode === 'standalone' ? null : blockId

    const values = {
      id: crypto.randomUUID(),
      workflowId,
      blockId: finalBlockId,
      cronExpression,
      triggerType: 'schedule',
      createdAt: new Date(),
      updatedAt: new Date(),
      nextRunAt,
      timezone,
      status: 'active', // Ensure new schedules are active
      failedCount: 0, // Reset failure count for new schedules
    }

    const setValues = {
      blockId: finalBlockId,
      cronExpression,
      updatedAt: new Date(),
      nextRunAt,
      timezone,
      status: 'active', // Reactivate if previously disabled
      failedCount: 0, // Reset failure count on reconfiguration
    }

    if (finalBlockId) {
      // Block-specific schedule - use composite key
      await db
        .insert(workflowSchedule)
        .values(values)
        .onConflictDoUpdate({
          target: [workflowSchedule.workflowId, workflowSchedule.blockId],
          set: setValues,
        })
    } else {
      // Workflow-level schedule - first delete any existing null blockId schedules, then insert
      await db
        .delete(workflowSchedule)
        .where(and(eq(workflowSchedule.workflowId, workflowId), isNull(workflowSchedule.blockId)))

      await db.insert(workflowSchedule).values(values)
    }

    logger.info(`[${requestId}] Schedule updated for workflow ${workflowId}`, {
      nextRunAt: nextRunAt?.toISOString(),
      cronExpression,
    })

    return NextResponse.json({
      message: 'Schedule updated',
      nextRunAt,
      cronExpression,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error updating workflow schedule`, error)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: 'Failed to update workflow schedule' }, { status: 500 })
  }
}
