import { create } from 'zustand'
import { useOfflineModeStore } from '@/stores/offline-mode/store'

type TextOpType = 'subblock' | 'variable'

interface PendingTextOperationBase {
  id: string
  workflowId: string
  timestamp: number
  retryCount: number
  nextRetryAt: number
  type: TextOpType
}

interface PendingSubblockOp extends PendingTextOperationBase {
  type: 'subblock'
  blockId: string
  subblockId: string
  value: unknown
}

interface PendingVariableOp extends PendingTextOperationBase {
  type: 'variable'
  variableId: string
  field: string
  value: unknown
}

export type PendingTextOperation = PendingSubblockOp | PendingVariableOp

// Timers per operation
const sendAttemptTimers = new Map<string, NodeJS.Timeout>()
const ackTimeoutTimers = new Map<string, NodeJS.Timeout>()

// Attempt sender and validator registered by socket layer
type AttemptSender = (op: PendingTextOperation) => boolean
type OperationValidator = (op: PendingTextOperation) => boolean
let attemptSender: AttemptSender | null = null
let operationValidator: OperationValidator | null = null

export function registerTextOutboxHandlers(sender: AttemptSender, validator?: OperationValidator) {
  attemptSender = sender
  operationValidator = validator || null
}

interface TextOutboxState {
  pending: Record<string, PendingTextOperation>
  addSubblock: (
    op: Omit<PendingSubblockOp, 'timestamp' | 'retryCount' | 'nextRetryAt' | 'type'>
  ) => void
  addVariable: (
    op: Omit<PendingVariableOp, 'timestamp' | 'retryCount' | 'nextRetryAt' | 'type'>
  ) => void
  confirm: (id: string) => void
  fail: (id: string, retryable?: boolean) => void
  clearWorkflow: (workflowId: string) => void
  clearBlock: (blockId: string) => void
  clearVariable: (variableId: string) => void
  getPendingForWorkflow: (workflowId: string) => PendingTextOperation[]
  getById: (id: string) => PendingTextOperation | undefined
  rescheduleWithoutPenalty: (id: string) => void
  scheduleAttempt: (id: string, delayMs?: number) => void
}

function computeNextRetryAt(_retryCount: number): number {
  // No extra backoff between attempts; rely on 5s ack timeout to pace retries
  return Date.now()
}

export const useTextOutboxStore = create<TextOutboxState>((set, get) => ({
  pending: {},

  addSubblock: (op) => {
    const id = op.id
    set((state) => ({
      pending: {
        ...state.pending,
        [id]: {
          ...op,
          timestamp: Date.now(),
          retryCount: 0,
          nextRetryAt: computeNextRetryAt(0),
          type: 'subblock',
        },
      },
    }))
    // Schedule immediate attempt
    get().scheduleAttempt(id, 0)
  },

  addVariable: (op) => {
    const id = op.id
    set((state) => ({
      pending: {
        ...state.pending,
        [id]: {
          ...op,
          timestamp: Date.now(),
          retryCount: 0,
          nextRetryAt: computeNextRetryAt(0),
          type: 'variable',
        },
      },
    }))
    // Schedule immediate attempt
    get().scheduleAttempt(id, 0)
  },

  confirm: (id) => {
    set((state) => {
      if (!state.pending[id]) return state
      const { [id]: _removed, ...rest } = state.pending
      return { pending: rest }
    })
    const ackTimer = ackTimeoutTimers.get(id)
    if (ackTimer) {
      clearTimeout(ackTimer)
      ackTimeoutTimers.delete(id)
    }
    const sendTimer = sendAttemptTimers.get(id)
    if (sendTimer) {
      clearTimeout(sendTimer)
      sendAttemptTimers.delete(id)
    }
  },

  fail: (id, retryable = true) => {
    set((state) => {
      const op = state.pending[id]
      if (!op) return state
      if (!retryable) {
        const { [id]: _removed, ...rest } = state.pending
        return { pending: rest }
      }
      const retryCount = op.retryCount + 1
      if (retryCount >= 2) {
        useOfflineModeStore.getState().triggerOfflineMode('text-outbox')
        const { [id]: _removed, ...rest } = state.pending
        return { pending: rest }
      }
      return {
        pending: {
          ...state.pending,
          [id]: {
            ...op,
            retryCount,
            nextRetryAt: computeNextRetryAt(retryCount),
          },
        },
      }
    })
    // Clear any outstanding ack timer and schedule next attempt
    const ackTimer = ackTimeoutTimers.get(id)
    if (ackTimer) {
      clearTimeout(ackTimer)
      ackTimeoutTimers.delete(id)
    }
    const op = get().pending[id]
    if (op) {
      const delay = Math.max(0, op.nextRetryAt - Date.now())
      get().scheduleAttempt(id, delay)
    }
  },

  clearWorkflow: (workflowId) => {
    const state = get()
    const toCancel = Object.entries(state.pending)
      .filter(([_, op]) => op.workflowId === workflowId)
      .map(([id]) => id)

    toCancel.forEach((id) => {
      const sendTimer = sendAttemptTimers.get(id)
      if (sendTimer) {
        clearTimeout(sendTimer)
        sendAttemptTimers.delete(id)
      }
      const ackTimer = ackTimeoutTimers.get(id)
      if (ackTimer) {
        clearTimeout(ackTimer)
        ackTimeoutTimers.delete(id)
      }
    })

    set((state) => {
      const next: Record<string, PendingTextOperation> = {}
      for (const [id, op] of Object.entries(state.pending)) {
        if (op.workflowId !== workflowId) next[id] = op
      }
      return { pending: next }
    })
  },

  clearBlock: (blockId) => {
    const state = get()
    const toCancel = Object.entries(state.pending)
      .filter(([_, op]) => op.type === 'subblock' && op.blockId === blockId)
      .map(([id]) => id)

    toCancel.forEach((id) => {
      const sendTimer = sendAttemptTimers.get(id)
      if (sendTimer) {
        clearTimeout(sendTimer)
        sendAttemptTimers.delete(id)
      }
      const ackTimer = ackTimeoutTimers.get(id)
      if (ackTimer) {
        clearTimeout(ackTimer)
        ackTimeoutTimers.delete(id)
      }
    })

    set((state) => {
      const next: Record<string, PendingTextOperation> = {}
      for (const [id, op] of Object.entries(state.pending)) {
        if (!(op.type === 'subblock' && op.blockId === blockId)) {
          next[id] = op
        }
      }
      return { pending: next }
    })
  },

  clearVariable: (variableId) => {
    const state = get()
    const toCancel = Object.entries(state.pending)
      .filter(([_, op]) => op.type === 'variable' && op.variableId === variableId)
      .map(([id]) => id)

    toCancel.forEach((id) => {
      const sendTimer = sendAttemptTimers.get(id)
      if (sendTimer) {
        clearTimeout(sendTimer)
        sendAttemptTimers.delete(id)
      }
      const ackTimer = ackTimeoutTimers.get(id)
      if (ackTimer) {
        clearTimeout(ackTimer)
        ackTimeoutTimers.delete(id)
      }
    })

    set((state) => {
      const next: Record<string, PendingTextOperation> = {}
      for (const [id, op] of Object.entries(state.pending)) {
        if (!(op.type === 'variable' && op.variableId === variableId)) {
          next[id] = op
        }
      }
      return { pending: next }
    })
  },

  getPendingForWorkflow: (workflowId) => {
    return Object.values(get().pending).filter((p) => p.workflowId === workflowId)
  },
  getById: (id) => get().pending[id],
  rescheduleWithoutPenalty: (id) => {
    set((state) => {
      const op = state.pending[id]
      if (!op) return state
      return {
        pending: {
          ...state.pending,
          [id]: { ...op, nextRetryAt: computeNextRetryAt(op.retryCount) },
        },
      }
    })
  },
  scheduleAttempt: (id, delayMs = 0) => {
    const existing = sendAttemptTimers.get(id)
    if (existing) clearTimeout(existing)
    const existingAck = ackTimeoutTimers.get(id)
    if (existingAck) {
      clearTimeout(existingAck)
      ackTimeoutTimers.delete(id)
    }
    const timeout = setTimeout(
      () => {
        const op = get().pending[id]
        if (!op) return

        if (operationValidator && !operationValidator(op)) {
          get().confirm(id)
          return
        }

        const sent = attemptSender ? attemptSender(op) : false
        if (sent) {
          const ackTimer = setTimeout(() => {
            get().fail(id, true)
          }, 7500)
          ackTimeoutTimers.set(id, ackTimer)
        } else {
          const waitTimer = setTimeout(() => {
            get().fail(id, true)
          }, 7500)
          ackTimeoutTimers.set(id, waitTimer)
        }
      },
      Math.max(0, delayMs)
    )
    sendAttemptTimers.set(id, timeout)
  },
}))
