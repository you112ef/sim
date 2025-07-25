import { useMemo } from 'react'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import type { WorkflowState, BlockState, Loop, Parallel } from '@/stores/workflows/workflow/types'
import type { DeploymentStatus } from '@/stores/workflows/registry/types'
import type { Edge } from 'reactflow'

/**
 * Interface for the current workflow abstraction
 */
export interface CurrentWorkflow {
  // Current workflow state properties
  blocks: Record<string, BlockState>
  edges: Edge[]
  loops: Record<string, Loop>
  parallels: Record<string, Parallel>
  lastSaved?: number
  isDeployed?: boolean
  deployedAt?: Date
  deploymentStatuses?: Record<string, DeploymentStatus>
  needsRedeployment?: boolean
  hasActiveWebhook?: boolean
  
  // Mode information
  isDiffMode: boolean
  isNormalMode: boolean
  
  // Full workflow state (for cases that need the complete object)
  workflowState: WorkflowState
  
  // Helper methods
  getBlockById: (blockId: string) => BlockState | undefined
  getBlockCount: () => number
  getEdgeCount: () => number
  hasBlocks: () => boolean
  hasEdges: () => boolean
}

/**
 * Clean abstraction for accessing the current workflow state.
 * Automatically handles diff vs normal mode without exposing the complexity to consumers.
 */
export function useCurrentWorkflow(): CurrentWorkflow {
  // Get normal workflow state
  const normalWorkflow = useWorkflowStore((state) => state.getWorkflowState())
  
  // Get diff state
  const { isShowingDiff, diffWorkflow } = useWorkflowDiffStore()
  
  // Debug: Log when diff state changes
  console.log('[useCurrentWorkflow] State update:', {
    isShowingDiff,
    hasDiffWorkflow: !!diffWorkflow,
    diffWorkflowBlockCount: diffWorkflow ? Object.keys(diffWorkflow.blocks).length : 0,
    timestamp: Date.now()
  })

  // Create the abstracted interface
  const currentWorkflow = useMemo((): CurrentWorkflow => {
    // Determine which workflow to use
    const activeWorkflow = isShowingDiff && diffWorkflow ? diffWorkflow : normalWorkflow
    
    // Debug: Log which workflow is being used and sample block diff status
    const sampleBlockId = Object.keys(activeWorkflow.blocks)[0]
    const sampleBlock = sampleBlockId ? activeWorkflow.blocks[sampleBlockId] : null
    const sampleDiffStatus = sampleBlock ? (sampleBlock as any).is_diff : undefined
    
    console.log('[useCurrentWorkflow] Using workflow:', {
      type: isShowingDiff && diffWorkflow ? 'diff' : 'normal',
      blockCount: Object.keys(activeWorkflow.blocks).length,
      sampleBlockId,
      sampleDiffStatus,
      timestamp: Date.now()
    })
    
    return {
      // Current workflow state
      blocks: activeWorkflow.blocks,
      edges: activeWorkflow.edges,
      loops: activeWorkflow.loops || {},
      parallels: activeWorkflow.parallels || {},
      lastSaved: activeWorkflow.lastSaved,
      isDeployed: activeWorkflow.isDeployed,
      deployedAt: activeWorkflow.deployedAt,
      deploymentStatuses: activeWorkflow.deploymentStatuses,
      needsRedeployment: activeWorkflow.needsRedeployment,
      hasActiveWebhook: activeWorkflow.hasActiveWebhook,
      
      // Mode information
      isDiffMode: isShowingDiff && !!diffWorkflow,
      isNormalMode: !isShowingDiff || !diffWorkflow,
      
      // Full workflow state (for cases that need the complete object)
      workflowState: activeWorkflow,
      
      // Helper methods
      getBlockById: (blockId: string) => activeWorkflow.blocks[blockId],
      getBlockCount: () => Object.keys(activeWorkflow.blocks).length,
      getEdgeCount: () => activeWorkflow.edges.length,
      hasBlocks: () => Object.keys(activeWorkflow.blocks).length > 0,
      hasEdges: () => activeWorkflow.edges.length > 0,
    }
  }, [normalWorkflow, isShowingDiff, diffWorkflow])
  
  return currentWorkflow
} 