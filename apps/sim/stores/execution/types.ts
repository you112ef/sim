import type { Executor } from '@/executor'
import type { ExecutionContext } from '@/executor/types'

export interface ExecutionState {
  activeBlockIds: Set<string>
  isExecuting: boolean
  isDebugging: boolean
  pendingBlocks: string[]
  executionId: string | null
  workflowId: string | null
  executor: Executor | null
  debugContext: ExecutionContext | null
  autoPanDisabled: boolean
}

export interface ExecutionActions {
  setActiveBlocks: (blockIds: Set<string>) => void
  setIsExecuting: (isExecuting: boolean) => void
  setIsDebugging: (isDebugging: boolean) => void
  setExecutionIdentifiers: (ids: { executionId?: string | null; workflowId?: string | null }) => void
  setPendingBlocks: (blockIds: string[]) => void
  setExecutor: (executor: Executor | null) => void
  setDebugContext: (context: ExecutionContext | null) => void
  setAutoPanDisabled: (disabled: boolean) => void
  reset: () => void
}

export const initialState: ExecutionState = {
  activeBlockIds: new Set(),
  isExecuting: false,
  isDebugging: false,
  pendingBlocks: [],
  executionId: null,
  workflowId: null,
  executor: null,
  debugContext: null,
  autoPanDisabled: false,
}

// Types for panning functionality
export type PanToBlockCallback = (blockId: string) => void
export type SetPanToBlockCallback = (callback: PanToBlockCallback | null) => void
