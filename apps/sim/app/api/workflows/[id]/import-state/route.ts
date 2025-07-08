import crypto from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/db-helpers'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowImportAPI')

// Schema for imported workflow state
const ImportStateSchema = z.object({
  blocks: z.record(z.any()),
  edges: z.array(z.any()),
  loops: z.record(z.any()).optional(),
  parallels: z.record(z.any()).optional(),
})

// POST /api/workflows/[id]/import-state - Save imported workflow state
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id: workflowId } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    logger.warn(`[${requestId}] Unauthorized workflow state import attempt for ${workflowId}`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { blocks, edges, loops, parallels } = ImportStateSchema.parse(body)

    logger.info(`[${requestId}] Importing workflow state for ${workflowId}`)
    logger.debug(
      `[${requestId}] Blocks: ${Object.keys(blocks || {}).length}, Edges: ${(edges || []).length}`
    )

    // Create workflow state object
    const workflowState: WorkflowState = {
      blocks: blocks || {},
      edges: edges || [],
      loops: loops || {},
      parallels: parallels || {},
      lastSaved: Date.now(),
      isDeployed: false,
      deploymentStatuses: {},
      hasActiveSchedule: false,
      hasActiveWebhook: false,
    }

    // Save to normalized tables
    const saveResult = await saveWorkflowToNormalizedTables(workflowId, workflowState)

    if (!saveResult.success) {
      logger.error(`[${requestId}] Failed to save imported state: ${saveResult.error}`)
      return NextResponse.json(
        { error: `Failed to save workflow state: ${saveResult.error}` },
        { status: 500 }
      )
    }

    logger.info(`[${requestId}] Successfully imported workflow state for ${workflowId}`)

    return NextResponse.json({
      success: true,
      message: 'Workflow state imported successfully',
    })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid import state data for ${workflowId}`, {
        errors: error.errors,
      })
      return NextResponse.json(
        { error: 'Invalid workflow state data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error importing workflow state for ${workflowId}`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
