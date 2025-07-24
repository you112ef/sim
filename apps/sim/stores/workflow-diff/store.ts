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
  acceptChanges: () => Promise<void>
  
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
        // Automatically show diff for copilot changes, let user toggle for manual changes
        isShowingDiff: source === 'copilot',
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

    acceptChanges: async () => {
      const { diffWorkflow } = get()
      
      if (!diffWorkflow) {
        logger.warn('Cannot accept changes - no proposed changes available')
        return
      }
      
      logger.info('Accepting proposed changes')
      
      const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
      
      if (!activeWorkflowId) {
        logger.error('No active workflow ID for accepting changes')
        return
      }

      try {
        // Convert diff workflow to YAML using the same approach as other components
        const { generateWorkflowYaml } = await import('@/lib/workflows/yaml-generator')
        
        // Extract subblock values from diff workflow
        const subBlockValues: Record<string, Record<string, any>> = {}
        Object.values(diffWorkflow.blocks).forEach((block: any) => {
          if (block.subBlocks) {
            const blockValues: Record<string, any> = {}
            Object.entries(block.subBlocks).forEach(([subBlockId, subBlock]: [string, any]) => {
              if (subBlock.value !== undefined && subBlock.value !== null) {
                blockValues[subBlockId] = subBlock.value
              }
            })
            if (Object.keys(blockValues).length > 0) {
              subBlockValues[block.id] = blockValues
            }
          }
        })
        
        // Generate YAML from diff workflow
        const yamlContent = generateWorkflowYaml(diffWorkflow, subBlockValues)
        
        // Use the same consolidated YAML endpoint as the YAML editor
        const response = await fetch(`/api/workflows/${activeWorkflowId}/yaml`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            yamlContent,
            description: 'Applied copilot changes',
            source: 'copilot',
            applyAutoLayout: true,
            createCheckpoint: false,
          }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          logger.error('Failed to apply diff changes:', errorData)
          throw new Error(errorData.message || `Failed to apply changes: ${response.statusText}`)
        }

        const result = await response.json()
        
        if (!result.success) {
          logger.error('Failed to apply diff changes:', result)
          throw new Error(result.message || 'Failed to apply workflow changes')
        }

        logger.info('Successfully applied diff changes via YAML endpoint', {
          blocksCount: result.data?.blocksCount,
          edgesCount: result.data?.edgesCount,
        })
        
        // Clear the diff after successful acceptance
        get().clearDiff()
        
      } catch (error) {
        logger.error('Error accepting diff changes:', error)
        // Don't clear diff on error so user can try again
        throw error
      }
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