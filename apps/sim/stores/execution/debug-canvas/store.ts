import { create } from 'zustand'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

interface DebugCanvasState {
	isActive: boolean
	workflowState: WorkflowState | null
}

interface DebugCanvasActions {
	activate: (workflowState: WorkflowState) => void
	deactivate: () => void
	setWorkflowState: (workflowState: WorkflowState | null) => void
	clear: () => void
}

export const useDebugCanvasStore = create<DebugCanvasState & DebugCanvasActions>()((set) => ({
	isActive: false,
	workflowState: null,

	activate: (workflowState) => set({ isActive: true, workflowState }),
	deactivate: () => set({ isActive: false, workflowState: null }),
	setWorkflowState: (workflowState) => set({ workflowState }),
	clear: () => set({ isActive: false, workflowState: null }),
})) 