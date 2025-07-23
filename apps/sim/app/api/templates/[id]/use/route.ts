import { eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { templates, workflow } from '@/db/schema'

const logger = createLogger('TemplateUseAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/templates/[id]/use - Use a template (increment views and create workflow)
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized use attempt for template: ${id}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get workspace ID from request body
    const body = await request.json()
    const { workspaceId } = body

    if (!workspaceId) {
      logger.warn(`[${requestId}] Missing workspaceId in request body`)
      return NextResponse.json({ error: 'Workspace ID is required' }, { status: 400 })
    }

    logger.debug(
      `[${requestId}] Using template: ${id}, user: ${session.user.id}, workspace: ${workspaceId}`
    )

    // Get the template with its data
    const template = await db
      .select({
        id: templates.id,
        name: templates.name,
        description: templates.description,
        state: templates.state,
        color: templates.color,
      })
      .from(templates)
      .where(eq(templates.id, id))
      .limit(1)

    if (template.length === 0) {
      logger.warn(`[${requestId}] Template not found: ${id}`)
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    const templateData = template[0]

    // Create a new workflow ID
    const newWorkflowId = uuidv4()

    // Use a transaction to ensure consistency
    const result = await db.transaction(async (tx) => {
      // Increment the template views
      await tx
        .update(templates)
        .set({
          views: sql`${templates.views} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(templates.id, id))

      const now = new Date()

      // Create a new workflow from the template
      const newWorkflow = await tx
        .insert(workflow)
        .values({
          id: newWorkflowId,
          workspaceId: workspaceId,
          name: `${templateData.name} (copy)`,
          description: templateData.description,
          state: templateData.state,
          color: templateData.color,
          userId: session.user.id,
          createdAt: now,
          updatedAt: now,
          lastSynced: now,
        })
        .returning({ id: workflow.id })

      // Use same robust pattern as workflow deployment with ID remapping
      const templateState = templateData.state as any
      logger.debug(
        `[${requestId}] Remapping template state with ${Object.keys(templateState.blocks || {}).length} blocks`
      )

      // Create ID mapping from template IDs to new workflow IDs
      const workflowIdMap = new Map<string, string>()

      // Remap block IDs for new workflow
      const workflowBlocksMap: Record<string, any> = {}
      Object.values(templateState.blocks || {}).forEach((block: any) => {
        const newBlockId = uuidv4()
        workflowIdMap.set(block.id, newBlockId)

        workflowBlocksMap[newBlockId] = {
          ...block,
          id: newBlockId,
          // Preserve subBlocks which contain system prompts for agents
          subBlocks: block.subBlocks || {},
          data: block.data || {},
          outputs: block.outputs || {},
        }
      })

      // Remap edges with new block references
      const workflowEdges = (templateState.edges || []).map((edge: any) => ({
        ...edge,
        id: uuidv4(),
        source: workflowIdMap.get(edge.source) || edge.source,
        target: workflowIdMap.get(edge.target) || edge.target,
      }))

      // Remap loops with new node references
      const workflowLoops: Record<string, any> = {}
      Object.entries(templateState.loops || {}).forEach(
        ([_templateLoopId, loopConfig]: [string, any]) => {
          const newLoopId = uuidv4()
          workflowLoops[newLoopId] = {
            ...loopConfig,
            id: newLoopId,
            nodes: (loopConfig.nodes || []).map(
              (nodeId: string) => workflowIdMap.get(nodeId) || nodeId
            ),
          }
        }
      )

      // Remap parallels with new node references
      const workflowParallels: Record<string, any> = {}
      Object.entries(templateState.parallels || {}).forEach(
        ([_templateParallelId, parallelConfig]: [string, any]) => {
          const newParallelId = uuidv4()
          workflowParallels[newParallelId] = {
            ...parallelConfig,
            id: newParallelId,
            nodes: (parallelConfig.nodes || []).map(
              (nodeId: string) => workflowIdMap.get(nodeId) || nodeId
            ),
          }
        }
      )

      const finalWorkflowState = {
        blocks: workflowBlocksMap,
        edges: workflowEdges,
        loops: workflowLoops,
        parallels: workflowParallels,
        lastSaved: Date.now(),
      }

      // Update the workflow with complete remapped state
      await tx
        .update(workflow)
        .set({ state: finalWorkflowState })
        .where(eq(workflow.id, newWorkflowId))

      // Also save to normalized tables using the existing helper
      const { saveWorkflowToNormalizedTables } = await import('@/lib/workflows/db-helpers')
      const saveResult = await saveWorkflowToNormalizedTables(
        newWorkflowId,
        finalWorkflowState as any
      )

      if (!saveResult.success) {
        logger.error(`[${requestId}] Failed to save to normalized tables: ${saveResult.error}`)
        throw new Error(`Failed to save workflow to normalized tables: ${saveResult.error}`)
      }

      logger.debug(
        `[${requestId}] Successfully saved workflow to normalized tables with ${Object.keys(workflowBlocksMap).length} blocks`
      )

      return newWorkflow[0]
    })

    logger.info(
      `[${requestId}] Successfully used template: ${id}, created workflow: ${newWorkflowId}, database returned: ${result.id}`
    )

    // Verify the workflow was actually created
    const verifyWorkflow = await db
      .select({ id: workflow.id })
      .from(workflow)
      .where(eq(workflow.id, newWorkflowId))
      .limit(1)

    if (verifyWorkflow.length === 0) {
      logger.error(`[${requestId}] Workflow was not created properly: ${newWorkflowId}`)
      return NextResponse.json({ error: 'Failed to create workflow' }, { status: 500 })
    }

    return NextResponse.json(
      {
        message: 'Template used successfully',
        workflowId: newWorkflowId,
        workspaceId: workspaceId,
      },
      { status: 201 }
    )
  } catch (error: any) {
    logger.error(`[${requestId}] Error using template: ${id}`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
