import { create } from 'zustand'
import { createLogger } from '@/lib/logs/console/logger'
import { useOfflineModeStore } from '@/stores/offline-mode/store'

const logger = createLogger('OperationQueue')

export interface QueuedOperation {
  id: string
  operation: {
    operation: string
    target: string
    payload: any
  }
  workflowId: string
  timestamp: number
  retryCount: number
  status: 'pending' | 'processing' | 'confirmed' | 'failed'
  userId: string
  immediate?: boolean // Flag for immediate processing (skips debouncing)
}

interface OperationQueueState {
  operations: QueuedOperation[]
  isProcessing: boolean
  pendingBlockCreates: Record<string, true>

  addToQueue: (operation: Omit<QueuedOperation, 'timestamp' | 'retryCount' | 'status'>) => void
  confirmOperation: (operationId: string) => void
  failOperation: (operationId: string, retryable?: boolean) => void
  handleOperationTimeout: (operationId: string) => void
  processNextOperation: () => void
  cancelOperationsForBlock: (blockId: string) => void
  cancelOperationsForVariable: (variableId: string) => void
  cancelOperationsForWorkflow: (workflowId: string) => void
  clearAllTimers: () => void
}

const retryTimeouts = new Map<string, NodeJS.Timeout>()
const operationTimeouts = new Map<string, NodeJS.Timeout>()

// Debounce removed for all operations

let emitWorkflowOperation:
  | ((operation: string, target: string, payload: any, operationId?: string) => void)
  | null = null
let emitSubblockUpdate:
  | ((blockId: string, subblockId: string, value: any, operationId?: string) => void)
  | null = null
let emitVariableUpdate:
  | ((variableId: string, field: string, value: any, operationId?: string) => void)
  | null = null

export function registerEmitFunctions(
  workflowEmit: (operation: string, target: string, payload: any, operationId?: string) => void,
  subblockEmit: (blockId: string, subblockId: string, value: any, operationId?: string) => void,
  variableEmit: (variableId: string, field: string, value: any, operationId?: string) => void,
  workflowId: string | null
) {
  emitWorkflowOperation = workflowEmit
  emitSubblockUpdate = subblockEmit
  emitVariableUpdate = variableEmit
  currentRegisteredWorkflowId = workflowId
}

let currentRegisteredWorkflowId: string | null = null

export const useOperationQueueStore = create<OperationQueueState>((set, get) => ({
  operations: [],
  isProcessing: false,
  pendingBlockCreates: {},

  addToQueue: (operation) => {
    // Handle non-subblock/variable operations only
    const state = get()

    // Check for duplicate operation ID
    const existingOp = state.operations.find((op) => op.id === operation.id)
    if (existingOp) {
      logger.debug('Skipping duplicate operation ID', {
        operationId: operation.id,
        existingStatus: existingOp.status,
      })
      return
    }

    // Enhanced duplicate content check - especially important for block operations
    const duplicateContent = state.operations.find(
      (op) =>
        op.operation.operation === operation.operation.operation &&
        op.operation.target === operation.operation.target &&
        op.workflowId === operation.workflowId &&
        // For block operations, check the block ID specifically
        ((operation.operation.target === 'block' &&
          op.operation.payload?.id === operation.operation.payload?.id) ||
          // For other operations, fall back to full payload comparison
          (operation.operation.target !== 'block' &&
            JSON.stringify(op.operation.payload) === JSON.stringify(operation.operation.payload)))
    )

    if (duplicateContent) {
      logger.debug('Skipping duplicate operation content', {
        operationId: operation.id,
        existingOperationId: duplicateContent.id,
        operation: operation.operation.operation,
        target: operation.operation.target,
        existingStatus: duplicateContent.status,
        payload:
          operation.operation.target === 'block'
            ? { id: operation.operation.payload?.id }
            : operation.operation.payload,
      })
      return
    }

    const queuedOp: QueuedOperation = {
      ...operation,
      timestamp: Date.now(),
      retryCount: 0,
      status: 'pending',
    }

    logger.debug('Adding operation to queue', {
      operationId: queuedOp.id,
      operation: queuedOp.operation,
    })

    set((state) => {
      const next: OperationQueueState = {
        ...state,
        operations: [...state.operations, queuedOp],
      }
      if (
        queuedOp.operation.target === 'block' &&
        queuedOp.operation.operation === 'add' &&
        queuedOp.operation.payload?.id
      ) {
        next.pendingBlockCreates = {
          ...state.pendingBlockCreates,
          [queuedOp.operation.payload.id]: true,
        }
      }
      return next
    })

    // Start processing if not already processing
    get().processNextOperation()
  },

  confirmOperation: (operationId) => {
    const state = get()
    const operation = state.operations.find((op) => op.id === operationId)
    const newOperations = state.operations.filter((op) => op.id !== operationId)

    const retryTimeout = retryTimeouts.get(operationId)
    if (retryTimeout) {
      clearTimeout(retryTimeout)
      retryTimeouts.delete(operationId)
    }

    const operationTimeout = operationTimeouts.get(operationId)
    if (operationTimeout) {
      clearTimeout(operationTimeout)
      operationTimeouts.delete(operationId)
    }

    // No debounce cleanup needed

    logger.debug('Removing operation from queue', {
      operationId,
      remainingOps: newOperations.length,
    })

    set((s) => {
      let nextPending = s.pendingBlockCreates
      if (
        operation?.operation.target === 'block' &&
        operation.operation.operation === 'add' &&
        operation.operation.payload?.id
      ) {
        const { [operation.operation.payload.id]: _removed, ...rest } = s.pendingBlockCreates
        nextPending = rest
      }
      return { operations: newOperations, isProcessing: false, pendingBlockCreates: nextPending }
    })

    // Process next operation in queue
    get().processNextOperation()
  },

  failOperation: (operationId: string, retryable = true) => {
    const state = get()
    const operation = state.operations.find((op) => op.id === operationId)
    if (!operation) {
      logger.warn('Attempted to fail operation that does not exist in queue', { operationId })
      return
    }

    const operationTimeout = operationTimeouts.get(operationId)
    if (operationTimeout) {
      clearTimeout(operationTimeout)
      operationTimeouts.delete(operationId)
    }

    // No debounce cleanup needed

    if (!retryable) {
      logger.debug('Operation marked as non-retryable, removing from queue', { operationId })

      set((state) => {
        let nextPending = state.pendingBlockCreates
        if (
          operation.operation.target === 'block' &&
          operation.operation.operation === 'add' &&
          operation.operation.payload?.id
        ) {
          const { [operation.operation.payload.id]: _removed, ...rest } = state.pendingBlockCreates
          nextPending = rest
        }
        return {
          operations: state.operations.filter((op) => op.id !== operationId),
          isProcessing: false,
          pendingBlockCreates: nextPending,
        }
      })

      get().processNextOperation()
      return
    }

    if (operation.retryCount < 3) {
      const newRetryCount = operation.retryCount + 1
      const delay = 2 ** newRetryCount * 1000 // 2s, 4s, 8s

      logger.warn(`Operation failed, retrying in ${delay}ms (attempt ${newRetryCount}/3)`, {
        operationId,
        retryCount: newRetryCount,
      })

      // Update retry count and mark as pending for retry
      set((state) => ({
        operations: state.operations.map((op) =>
          op.id === operationId
            ? { ...op, retryCount: newRetryCount, status: 'pending' as const }
            : op
        ),
        isProcessing: false, // Allow processing to continue
      }))

      // Schedule retry
      const timeout = setTimeout(() => {
        retryTimeouts.delete(operationId)
        get().processNextOperation()
      }, delay)

      retryTimeouts.set(operationId, timeout)
    } else {
      logger.error('Operation failed after max retries, triggering offline mode', { operationId })
      get().clearAllTimers()
      set((state) => ({
        operations: state.operations.filter((op) => op.id !== operationId),
        isProcessing: false,
      }))
      useOfflineModeStore.getState().triggerOfflineMode('operation-queue')
    }
  },

  handleOperationTimeout: (operationId: string) => {
    const state = get()
    const operation = state.operations.find((op) => op.id === operationId)
    if (!operation) {
      logger.debug('Ignoring timeout for operation not in queue', { operationId })
      return
    }

    logger.warn('Operation timeout detected - treating as failure to trigger retries', {
      operationId,
    })

    get().failOperation(operationId)
  },

  processNextOperation: () => {
    const state = get()

    // Don't process if already processing
    if (state.isProcessing) {
      return
    }

    const nextOperation = currentRegisteredWorkflowId
      ? state.operations.find(
          (op) => op.status === 'pending' && op.workflowId === currentRegisteredWorkflowId
        )
      : state.operations.find((op) => op.status === 'pending')
    if (!nextOperation) {
      return
    }

    if (currentRegisteredWorkflowId && nextOperation.workflowId !== currentRegisteredWorkflowId) {
      return
    }

    // Mark as processing
    set((state) => ({
      operations: state.operations.map((op) =>
        op.id === nextOperation.id ? { ...op, status: 'processing' as const } : op
      ),
      isProcessing: true,
    }))

    logger.debug('Processing operation sequentially', {
      operationId: nextOperation.id,
      operation: nextOperation.operation,
      retryCount: nextOperation.retryCount,
    })

    // Emit the operation
    const { operation: op, target, payload } = nextOperation.operation
    if (emitWorkflowOperation) {
      emitWorkflowOperation(op, target, payload, nextOperation.id)
    }

    // Create operation timeout
    const timeoutId = setTimeout(() => {
      logger.warn('Operation timeout - no server response after 5 seconds', {
        operationId: nextOperation.id,
      })
      operationTimeouts.delete(nextOperation.id)
      get().handleOperationTimeout(nextOperation.id)
    }, 5000)

    operationTimeouts.set(nextOperation.id, timeoutId)
  },

  cancelOperationsForBlock: (blockId: string) => {
    logger.debug('Canceling all operations for block', { blockId })

    // Find and cancel operation timeouts for operations related to this block
    const state = get()
    const operationsToCancel = state.operations.filter(
      (op) =>
        (op.operation.target === 'block' && op.operation.payload?.id === blockId) ||
        (op.operation.target === 'subblock' && op.operation.payload?.blockId === blockId)
    )

    // Cancel timeouts for these operations
    operationsToCancel.forEach((op) => {
      const operationTimeout = operationTimeouts.get(op.id)
      if (operationTimeout) {
        clearTimeout(operationTimeout)
        operationTimeouts.delete(op.id)
      }

      const retryTimeout = retryTimeouts.get(op.id)
      if (retryTimeout) {
        clearTimeout(retryTimeout)
        retryTimeouts.delete(op.id)
      }
    })

    // Remove all operations for this block (both pending and processing)
    const newOperations = state.operations.filter(
      (op) =>
        !(
          (op.operation.target === 'block' && op.operation.payload?.id === blockId) ||
          (op.operation.target === 'subblock' && op.operation.payload?.blockId === blockId)
        )
    )

    set((s) => {
      const { [blockId]: _removed, ...rest } = s.pendingBlockCreates
      return {
        operations: newOperations,
        isProcessing: false,
        pendingBlockCreates: rest,
      }
    })

    logger.debug('Cancelled operations for block', {
      blockId,
      cancelledOperations: operationsToCancel.length,
    })

    // Process next operation if there are any remaining
    get().processNextOperation()
  },

  cancelOperationsForVariable: (variableId: string) => {
    logger.debug('Canceling all operations for variable', { variableId })

    // Find and cancel operation timeouts for operations related to this variable
    const state = get()
    const operationsToCancel = state.operations.filter(
      (op) =>
        (op.operation.target === 'variable' && op.operation.payload?.variableId === variableId) ||
        (op.operation.target === 'variable' &&
          op.operation.payload?.sourceVariableId === variableId)
    )

    // Cancel timeouts for these operations
    operationsToCancel.forEach((op) => {
      const operationTimeout = operationTimeouts.get(op.id)
      if (operationTimeout) {
        clearTimeout(operationTimeout)
        operationTimeouts.delete(op.id)
      }

      const retryTimeout = retryTimeouts.get(op.id)
      if (retryTimeout) {
        clearTimeout(retryTimeout)
        retryTimeouts.delete(op.id)
      }
    })

    // Remove all operations for this variable (both pending and processing)
    const newOperations = state.operations.filter(
      (op) =>
        !(
          (op.operation.target === 'variable' && op.operation.payload?.variableId === variableId) ||
          (op.operation.target === 'variable' &&
            op.operation.payload?.sourceVariableId === variableId)
        )
    )

    set({
      operations: newOperations,
      isProcessing: false, // Reset processing state in case we removed the current operation
    })

    logger.debug('Cancelled operations for variable', {
      variableId,
      cancelledOperations: operationsToCancel.length,
    })

    // Process next operation if there are any remaining
    get().processNextOperation()
  },

  cancelOperationsForWorkflow: (workflowId: string) => {
    const state = get()
    retryTimeouts.forEach((timeout, opId) => {
      const op = state.operations.find((o) => o.id === opId)
      if (op && op.workflowId === workflowId) {
        clearTimeout(timeout)
        retryTimeouts.delete(opId)
      }
    })
    operationTimeouts.forEach((timeout, opId) => {
      const op = state.operations.find((o) => o.id === opId)
      if (op && op.workflowId === workflowId) {
        clearTimeout(timeout)
        operationTimeouts.delete(opId)
      }
    })
    set((s) => {
      // Remove pending block creates for blocks whose add operation belongs to this workflow
      const remainingOps = s.operations.filter((op) => op.workflowId !== workflowId)
      const blocksStillPending = new Set<string>()
      remainingOps.forEach((op) => {
        if (
          op.operation.target === 'block' &&
          op.operation.operation === 'add' &&
          op.operation.payload?.id
        ) {
          blocksStillPending.add(op.operation.payload.id)
        }
      })
      const nextPending: Record<string, true> = {}
      Object.keys(s.pendingBlockCreates).forEach((bid) => {
        if (blocksStillPending.has(bid)) nextPending[bid] = true
      })
      return {
        operations: remainingOps,
        isProcessing: false,
        pendingBlockCreates: nextPending,
      }
    })
  },

  clearAllTimers: () => {
    retryTimeouts.forEach((timeout) => clearTimeout(timeout))
    retryTimeouts.clear()
    operationTimeouts.forEach((timeout) => clearTimeout(timeout))
    operationTimeouts.clear()
  },
}))

export function useOperationQueue() {
  const store = useOperationQueueStore()
  const { isOffline, clearOfflineMode } = useOfflineModeStore()

  return {
    queue: store.operations,
    isProcessing: store.isProcessing,
    hasOperationError: isOffline,
    addToQueue: store.addToQueue,
    confirmOperation: store.confirmOperation,
    failOperation: store.failOperation,
    processNextOperation: store.processNextOperation,
    cancelOperationsForBlock: store.cancelOperationsForBlock,
    cancelOperationsForVariable: store.cancelOperationsForVariable,
    clearError: clearOfflineMode,
  }
}
