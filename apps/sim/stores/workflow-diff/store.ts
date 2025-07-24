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
    diffAnalysis?: {
      deleted_blocks: string[]
      edited_blocks: string[]
      new_blocks: string[]
    }
  }
}

interface WorkflowDiffActions {
  // Set the proposed changes from copilot
  setProposedChanges: (proposedWorkflow: WorkflowState, source?: 'copilot' | 'manual') => Promise<void>
  
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

    setProposedChanges: async (proposedWorkflow: WorkflowState, source = 'copilot') => {
      logger.info('Setting proposed changes', { source, blockCount: Object.keys(proposedWorkflow.blocks).length })
      
      // Get current workflow YAML and analyze diff if possible
      let diffAnalysis: any = null
      try {
        // Get current workflow YAML
        const { activeWorkflowId } = useWorkflowRegistry.getState()
        if (activeWorkflowId) {
          const currentWorkflowResponse = await fetch('/api/tools/get-user-workflow', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              workflowId: activeWorkflowId,
              includeMetadata: false,
            }),
          })
          
          if (currentWorkflowResponse.ok) {
            const currentWorkflowResult = await currentWorkflowResponse.json()
            if (currentWorkflowResult.success && currentWorkflowResult.output?.yaml) {
              // Convert proposed workflow to YAML for comparison
              const { generateWorkflowYaml } = await import('@/lib/workflows/yaml-generator')
              const proposedYaml = generateWorkflowYaml(proposedWorkflow)
              
              // Call diff API
              const diffResponse = await fetch('/api/workflows/diff', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  original_yaml: currentWorkflowResult.output.yaml,
                  agent_yaml: proposedYaml,
                }),
              })
              
              if (diffResponse.ok) {
                const diffData = await diffResponse.json()
                if (diffData.success) {
                  diffAnalysis = diffData.data
                  logger.info('Generated diff analysis', diffAnalysis)
                }
              }
            }
          }
        }
      } catch (error) {
        logger.error('Failed to generate diff analysis:', error)
      }
      
      // Add is_diff field to blocks based on diff analysis
      const enhancedWorkflow = { ...proposedWorkflow }
      if (diffAnalysis) {
        Object.keys(enhancedWorkflow.blocks).forEach(blockId => {
          const block = enhancedWorkflow.blocks[blockId]
          if (diffAnalysis.new_blocks.includes(blockId)) {
            block.is_diff = 'new'
          } else if (diffAnalysis.edited_blocks.includes(blockId)) {
            block.is_diff = 'edited'
          } else {
            block.is_diff = 'unchanged'
          }
        })
      }
      
      set({
        diffWorkflow: enhancedWorkflow,
        diffMetadata: {
          source,
          timestamp: Date.now(),
          diffAnalysis,
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
      
      // Return the actual workflow state using the main store's method
      // This eliminates code duplication and automatically stays in sync with WorkflowState changes
      return useWorkflowStore.getState().getWorkflowState()
    },
  }))
) 