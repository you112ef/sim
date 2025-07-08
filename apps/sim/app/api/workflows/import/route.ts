import crypto from 'crypto'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/db-helpers'
import { db } from '@/db'
import { workflow } from '@/db/schema'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowImportAPI')

// Schema for imported workflow
const ImportWorkflowSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional().default(''),
  color: z.string().optional().default('#3972F6'),
  workspaceId: z.string().optional(),
  folderId: z.string().nullable().optional(),
  state: z.object({
    blocks: z.record(z.any()),
    edges: z.array(z.any()),
    loops: z.record(z.any()).optional(),
    parallels: z.record(z.any()).optional(),
  }),
})

// POST /api/workflows/import - Create a workflow from imported JSON data
export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const session = await getSession()

  if (!session?.user?.id) {
    logger.warn(`[${requestId}] Unauthorized workflow import attempt`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { name, description, color, workspaceId, folderId, state } =
      ImportWorkflowSchema.parse(body)

    const workflowId = crypto.randomUUID()
    const now = new Date()

    logger.info(`[${requestId}] Importing workflow ${workflowId} for user ${session.user.id}`)
    logger.debug(
      `[${requestId}] Blocks: ${Object.keys(state.blocks || {}).length}, Edges: ${(state.edges || []).length}`
    )

    // Create workflow state object
    const workflowState: WorkflowState = {
      blocks: state.blocks || {},
      edges: state.edges || [],
      loops: state.loops || {},
      parallels: state.parallels || {},
      lastSaved: Date.now(),
      isDeployed: false,
      deploymentStatuses: {},
      hasActiveSchedule: false,
      hasActiveWebhook: false,
    }

    // Create the workflow and populate it in a transaction
    await db.transaction(async (tx) => {
      // Create the workflow with empty state first
      await tx.insert(workflow).values({
        id: workflowId,
        userId: session.user.id,
        workspaceId: workspaceId || null,
        folderId: folderId || null,
        name,
        description,
        state: {}, // Empty initial state
        color,
        lastSynced: now,
        createdAt: now,
        updatedAt: now,
        isDeployed: false,
        collaborators: [],
        runCount: 0,
        variables: {},
        isPublished: false,
        marketplaceData: null,
      })
    })

    // Now save the imported state to normalized tables
    const saveResult = await saveWorkflowToNormalizedTables(workflowId, workflowState)

    if (!saveResult.success) {
      // If saving to normalized tables fails, clean up the workflow
      await db.delete(workflow).where(eq(workflow.id, workflowId))
      logger.error(
        `[${requestId}] Failed to save imported state, cleaned up workflow: ${saveResult.error}`
      )
      return NextResponse.json(
        { error: `Failed to save workflow state: ${saveResult.error}` },
        { status: 500 }
      )
    }

    logger.info(`[${requestId}] Successfully imported workflow ${workflowId}`)

    return NextResponse.json({
      success: true,
      id: workflowId,
      message: 'Workflow imported successfully',
    })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid import data`, {
        errors: error.errors,
      })
      return NextResponse.json(
        { error: 'Invalid workflow data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error importing workflow`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
