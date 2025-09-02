import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { workflow } from '@/db/schema'
import type { HandlerDependencies } from '@/socket-server/handlers/workflow'
import type { AuthenticatedSocket } from '@/socket-server/middleware/auth'
import type { RoomManager } from '@/socket-server/rooms/manager'

const logger = createLogger('VariablesHandlers')

export function setupVariablesHandlers(
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
      variableId: string
      field: string
      value: unknown
      timestamp: number
      userId: string
      operationIds: Set<string>
    }
  >()
  const lastApplied = new Map<string, number>()

  const makeKey = (workflowId: string, variableId: string, field: string) =>
    `${workflowId}:${variableId}:${field}`

  // Cleanup function for workflow-related entries
  const cleanupWorkflow = (workflowId: string) => {
    const keysToDelete: string[] = []
    for (const [key, buffer] of pendingBuffers.entries()) {
      if (buffer.workflowId === workflowId) {
        keysToDelete.push(key)
        const timer = pendingTimers.get(key)
        if (timer) clearTimeout(timer)
      }
    }
    keysToDelete.forEach((key) => {
      pendingBuffers.delete(key)
      pendingTimers.delete(key)
      lastApplied.delete(key)
    })
  }

  // Listen for cleanup events
  socket.on('disconnect', () => {
    // Clear all pending operations for this socket's workflows
    const workflowId = roomManager.getWorkflowIdForSocket(socket.id)
    if (workflowId) {
      cleanupWorkflow(workflowId)
    }
  })

  socket.on('leave-workflow', () => {
    const workflowId = roomManager.getWorkflowIdForSocket(socket.id)
    if (workflowId) {
      cleanupWorkflow(workflowId)
    }
  })

  socket.on('variable-update', async (data) => {
    const workflowId = roomManager.getWorkflowIdForSocket(socket.id)
    const session = roomManager.getUserSession(socket.id)

    if (!workflowId || !session) {
      logger.debug(`Ignoring variable update: socket not connected to any workflow room`, {
        socketId: socket.id,
        hasWorkflowId: !!workflowId,
        hasSession: !!session,
      })
      return
    }

    const { variableId, field, value, timestamp, operationId } = data
    const room = roomManager.getWorkflowRoom(workflowId)

    if (!room) {
      logger.debug(`Ignoring variable update: workflow room not found`, {
        socketId: socket.id,
        workflowId,
        variableId,
        field,
      })
      return
    }

    try {
      const userPresence = room.users.get(socket.id)
      if (userPresence) {
        userPresence.lastActivity = Date.now()
      }

      const key = makeKey(workflowId, variableId, field)
      const existingBuffer = pendingBuffers.get(key)
      if (existingBuffer) {
        existingBuffer.value = value
        existingBuffer.timestamp = Number(timestamp) || Date.now()
        if (operationId) existingBuffer.operationIds.add(operationId)
      } else {
        pendingBuffers.set(key, {
          workflowId,
          variableId,
          field,
          value,
          timestamp: Number(timestamp) || Date.now(),
          userId: session.userId,
          operationIds: new Set(operationId ? [operationId] : []),
        })
      }

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
              for (const id of buffer.operationIds) {
                socket.emit('operation-failed', {
                  operationId: id,
                  error: 'Workflow no longer exists',
                  retryable: false,
                })
              }
              roomManager.cleanupUserFromRoom(socket.id, buffer.workflowId)
              return
            }

            let updateSuccessful = false
            await db.transaction(async (tx) => {
              const [workflowRecord] = await tx
                .select({ variables: workflow.variables })
                .from(workflow)
                .where(eq(workflow.id, buffer.workflowId))
                .limit(1)

              if (!workflowRecord) {
                for (const id of buffer.operationIds) {
                  socket.emit('operation-failed', {
                    operationId: id,
                    error: 'Workflow no longer exists',
                    retryable: false,
                  })
                }
                return
              }

              const variables = (workflowRecord.variables as any) || {}
              if (!variables[buffer.variableId]) {
                for (const id of buffer.operationIds) {
                  socket.emit('operation-failed', {
                    operationId: id,
                    error: 'Variable no longer exists',
                    retryable: false,
                  })
                }
                return
              }

              variables[buffer.variableId] = {
                ...variables[buffer.variableId],
                [buffer.field]: buffer.value,
              }

              await tx
                .update(workflow)
                .set({
                  variables: variables,
                  updatedAt: new Date(),
                })
                .where(eq(workflow.id, buffer.workflowId))

              updateSuccessful = true
            })

            if (updateSuccessful) {
              lastApplied.set(key, buffer.timestamp)
              socket.to(buffer.workflowId).emit('variable-update', {
                variableId: buffer.variableId,
                field: buffer.field,
                value: buffer.value,
                timestamp: buffer.timestamp,
                senderId: socket.id,
                userId: buffer.userId,
              })
              for (const id of buffer.operationIds) {
                socket.emit('operation-confirmed', {
                  operationId: id,
                  serverTimestamp: Date.now(),
                })
              }
              logger.debug(
                `Variable update in workflow ${buffer.workflowId}: ${buffer.variableId}.${buffer.field}`
              )
            }
          } catch (error) {
            logger.error('Error handling variable update:', error)
            const errMsg = error instanceof Error ? error.message : 'Unknown error'
            const buf = pendingBuffers.get(key)
            if (buf) {
              for (const id of buf.operationIds) {
                socket.emit('operation-failed', {
                  operationId: id,
                  error: errMsg,
                  retryable: true,
                })
              }
            }
          }
        })()
      }

      const existing = pendingTimers.get(key)
      if (existing) clearTimeout(existing)
      const timer = setTimeout(scheduleFlush, 25)
      pendingTimers.set(key, timer)
    } catch (error) {
      logger.error('Error handling variable update:', error)

      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      if (operationId) {
        socket.emit('operation-failed', {
          operationId,
          error: errorMessage,
          retryable: true,
        })
      }

      socket.emit('operation-error', {
        type: 'VARIABLE_UPDATE_FAILED',
        message: `Failed to update variable ${variableId}.${field}: ${errorMessage}`,
        operation: 'variable-update',
        target: 'variable',
      })
    }
  })
}
