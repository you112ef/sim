import { create } from 'zustand'
import type { ExecutionContext } from '@/executor/types'

interface BlockSnapshot {
  output: any
  executed: boolean
  executionTime?: number
}

interface DebugSnapshotState {
  blockSnapshots: Map<string, BlockSnapshot>
  envVarValues?: Record<string, string>
  workflowVariables?: Record<string, any>
}

interface DebugSnapshotActions {
  captureFromContext: (ctx: ExecutionContext) => void
  clear: () => void
}

export const useDebugSnapshotStore = create<DebugSnapshotState & DebugSnapshotActions>()((set) => ({
  blockSnapshots: new Map<string, BlockSnapshot>(),
  envVarValues: undefined,
  workflowVariables: undefined,

  captureFromContext: (ctx: ExecutionContext) => {
    const next = new Map<string, BlockSnapshot>()
    try {
      ctx.blockStates.forEach((state, key) => {
        next.set(String(key), {
          output: state?.output ?? {},
          executed: !!state?.executed,
          executionTime: state?.executionTime,
        })
      })
    } catch {}

    set({
      blockSnapshots: next,
      envVarValues: ctx.environmentVariables || undefined,
      workflowVariables: ctx.workflowVariables || undefined,
    })
  },

  clear: () => set({ blockSnapshots: new Map(), envVarValues: undefined, workflowVariables: undefined }),
})) 