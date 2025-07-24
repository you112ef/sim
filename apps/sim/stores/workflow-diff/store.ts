import type { Edge } from 'reactflow'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console-logger'
import { useWorkflowStore } from '../workflows/workflow/store'
import { useSubBlockStore } from '../workflows/subblock/store'
import { useWorkflowRegistry } from '../workflows/registry/store'
import type { WorkflowState, BlockState } from '../workflows/workflow/types'

const logger = createLogger('WorkflowDiffStore')

interface WorkflowDiffState {
  // The proposed workflow state to show on canvas
  diffWorkflow: WorkflowState | null
  // Whether we're currently showing the diff view
  isShowingDiff: boolean
  // Metadata about the diff
  diffMetadata?: {
    source: 'copilot' | 'manual'
    timestamp: number
  }
}

interface WorkflowDiffActions {
  // Set the proposed changes from copilot
  setProposedChanges: (proposedWorkflow: WorkflowState, source?: 'copilot' | 'manual') => void
  
  // Toggle between showing actual vs proposed workflow
  toggleDiffView: () => void
  
  // Accept the proposed changes (merge into main workflow store)
  acceptChanges: () => void
  
  // Reject the proposed changes (clear diff store)
  rejectChanges: () => void
  
  // Clear all diff state
  clearDiff: () => void
  
  // Get the current workflow state to show on canvas (either actual or proposed)
  getCurrentWorkflowForCanvas: () => WorkflowState
}

type WorkflowDiffStore = WorkflowDiffState & WorkflowDiffActions

const initialState: WorkflowDiffState = {
  diffWorkflow: null,
  isShowingDiff: false,
}

export const useWorkflowDiffStore = create<WorkflowDiffStore>()(
  devtools((set, get) => ({
    ...initialState,

    setProposedChanges: (proposedWorkflow: WorkflowState, source = 'copilot') => {
      logger.info('Setting proposed changes', { source, blockCount: Object.keys(proposedWorkflow.blocks).length })
      
      set({
        diffWorkflow: proposedWorkflow,
        diffMetadata: {
          source,
          timestamp: Date.now(),
        },
        // Don't automatically show diff - let user toggle
        isShowingDiff: false,
      })
    },

    toggleDiffView: () => {
      const { isShowingDiff, diffWorkflow } = get()
      
      if (!diffWorkflow) {
        logger.warn('Cannot toggle diff view - no proposed changes available')
        return
      }
      
      logger.info('Toggling diff view', { newState: !isShowingDiff })
      set({ isShowingDiff: !isShowingDiff })
    },

    acceptChanges: () => {
      const { diffWorkflow } = get()
      
      if (!diffWorkflow) {
        logger.warn('Cannot accept changes - no proposed changes available')
        return
      }
      
      logger.info('Accepting proposed changes')
      
      // Get the main workflow store and apply the changes
      const workflowStore = useWorkflowStore.getState()
      
      // Update the main workflow store with the proposed changes
      // Set the entire new state instead of clearing and re-adding to preserve all properties
      useWorkflowStore.setState({
        blocks: diffWorkflow.blocks,
        edges: diffWorkflow.edges,
        loops: diffWorkflow.loops || {},
        parallels: diffWorkflow.parallels || {},
        lastSaved: Date.now(),
        // Preserve existing deployment status and other metadata
        isDeployed: workflowStore.isDeployed,
        deployedAt: workflowStore.deployedAt,
        deploymentStatuses: workflowStore.deploymentStatuses,
        needsRedeployment: workflowStore.needsRedeployment,
        hasActiveWebhook: workflowStore.hasActiveWebhook,
      })
      
      // Extract and update subblock values from the diff workflow
      const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
      
      if (activeWorkflowId) {
        const subblockValues: Record<string, Record<string, any>> = {}
        Object.entries(diffWorkflow.blocks).forEach(([blockId, block]) => {
          subblockValues[blockId] = {}
          Object.entries(block.subBlocks || {}).forEach(([subBlockId, subBlock]) => {
            if (subBlock.value !== undefined && subBlock.value !== null) {
              subblockValues[blockId][subBlockId] = subBlock.value
            }
          })
        })

        // Update subblock store with the new values
        useSubBlockStore.setState((state) => ({
          workflowValues: {
            ...state.workflowValues,
            [activeWorkflowId]: subblockValues,
          },
        }))
      }
      
      // Clear the diff after accepting
      get().clearDiff()
    },

    rejectChanges: () => {
      logger.info('Rejecting proposed changes')
      get().clearDiff()
    },

    clearDiff: () => {
      logger.info('Clearing diff state')
      set({
        diffWorkflow: null,
        isShowingDiff: false,
        diffMetadata: undefined,
      })
    },

    getCurrentWorkflowForCanvas: () => {
      const { isShowingDiff, diffWorkflow } = get()
      
      if (isShowingDiff && diffWorkflow) {
        logger.debug('Returning diff workflow for canvas')
        return diffWorkflow
      }
      
      // Return the actual workflow state
      const workflowStore = useWorkflowStore.getState()
      return {
        blocks: workflowStore.blocks,
        edges: workflowStore.edges,
        loops: workflowStore.loops,
        parallels: workflowStore.parallels,
        lastSaved: workflowStore.lastSaved,
        isDeployed: workflowStore.isDeployed,
        deployedAt: workflowStore.deployedAt,
        deploymentStatuses: workflowStore.deploymentStatuses,
        needsRedeployment: workflowStore.needsRedeployment,
        hasActiveWebhook: workflowStore.hasActiveWebhook,
      }
    },
  }))
) 