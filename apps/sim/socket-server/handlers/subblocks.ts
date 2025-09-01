import { and, eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { workflow, workflowBlocks } from '@/db/schema'
import type { HandlerDependencies } from '@/socket-server/handlers/workflow'
import type { AuthenticatedSocket } from '@/socket-server/middleware/auth'
import type { RoomManager } from '@/socket-server/rooms/manager'

const logger = createLogger('SubblocksHandlers')

export function setupSubblocksHandlers(
  socket: AuthenticatedSocket,
  deps: HandlerDependencies | RoomManager
) {
  const roomManager =
    deps instanceof Object && 'roomManager' in deps ? deps.roomManager : (deps as RoomManager)
  const pendingTimers = new Map<string, NodeJS.Timeout>()
  const pendingBuffers = new Map<
    string,
    {
      workflowId: string
      blockId: string
      subblockId: string
      value: unknown
      timestamp: number
      userId: string
    }
  >()
  const lastApplied = new Map<string, number>()

  const makeKey = (workflowId: string, blockId: string, subblockId: string) =>
    `${workflowId}:${blockId}:${subblockId}`
  socket.on('subblock-update', async (data) => {
    const workflowId = roomManager.getWorkflowIdForSocket(socket.id)
    const session = roomManager.getUserSession(socket.id)

    if (!workflowId || !session) {
      logger.debug(`Ignoring subblock update: socket not connected to any workflow room`, {
        socketId: socket.id,
        hasWorkflowId: !!workflowId,
        hasSession: !!session,
      })
      return
    }

    const { blockId, subblockId, value, timestamp, operationId } = data
    const room = roomManager.getWorkflowRoom(workflowId)

    if (!room) {
      logger.debug(`Ignoring subblock update: workflow room not found`, {
        socketId: socket.id,
        workflowId,
        blockId,
        subblockId,
      })
      return
    }

    try {
      const userPresence = room.users.get(socket.id)
      if (userPresence) {
        userPresence.lastActivity = Date.now()
      }

      const key = makeKey(workflowId, blockId, subblockId)
      pendingBuffers.set(key, {
        workflowId,
        blockId,
        subblockId,
        value,
        timestamp: Number(timestamp) || Date.now(),
        userId: session.userId,
      })

      const scheduleFlush = () => {
        const buffer = pendingBuffers.get(key)
        if (!buffer) return
        pendingBuffers.delete(key)
        pendingTimers.delete(key)

        const lastTs = lastApplied.get(key) || 0
        if (buffer.timestamp < lastTs) {
          return
        }

        ;(async () => {
          try {
            const workflowExists = await db
              .select({ id: workflow.id })
              .from(workflow)
              .where(eq(workflow.id, buffer.workflowId))
              .limit(1)

            if (workflowExists.length === 0) {
              roomManager.cleanupUserFromRoom(socket.id, buffer.workflowId)
              return
            }

            let updateSuccessful = false
            await db.transaction(async (tx) => {
              const [block] = await tx
                .select({ subBlocks: workflowBlocks.subBlocks })
                .from(workflowBlocks)
                .where(
                  and(
                    eq(workflowBlocks.id, buffer.blockId),
                    eq(workflowBlocks.workflowId, buffer.workflowId)
                  )
                )
                .limit(1)

              if (!block) {
                return
              }

              const subBlocks = (block.subBlocks as any) || {}

              if (!subBlocks[buffer.subblockId]) {
                subBlocks[buffer.subblockId] = {
                  id: buffer.subblockId,
                  type: 'unknown',
                  value: buffer.value,
                }
              } else {
                subBlocks[buffer.subblockId] = {
                  ...subBlocks[buffer.subblockId],
                  value: buffer.value,
                }
              }

              await tx
                .update(workflowBlocks)
                .set({
                  subBlocks: subBlocks,
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(workflowBlocks.id, buffer.blockId),
                    eq(workflowBlocks.workflowId, buffer.workflowId)
                  )
                )

              updateSuccessful = true
            })

            if (updateSuccessful) {
              lastApplied.set(key, buffer.timestamp)
              socket.to(buffer.workflowId).emit('subblock-update', {
                blockId: buffer.blockId,
                subblockId: buffer.subblockId,
                value: buffer.value,
                timestamp: buffer.timestamp,
                senderId: socket.id,
                userId: buffer.userId,
              })
              logger.debug(
                `Subblock update in workflow ${buffer.workflowId}: ${buffer.blockId}.${buffer.subblockId}`
              )
            }
          } catch (error) {
            logger.error('Error handling subblock update:', error)
          }
        })()
      }

      const existing = pendingTimers.get(key)
      if (existing) clearTimeout(existing)
      const timer = setTimeout(scheduleFlush, 25)
      pendingTimers.set(key, timer)
    } catch (error) {
      logger.error('Error handling subblock update:', error)

      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      if (operationId) {
        socket.emit('operation-failed', {
          operationId,
          error: errorMessage,
          retryable: true,
        })
      }
      socket.emit('operation-error', {
        type: 'SUBBLOCK_UPDATE_FAILED',
        message: `Failed to update subblock ${blockId}.${subblockId}: ${errorMessage}`,
        operation: 'subblock-update',
        target: 'subblock',
      })
    }
  })
}
