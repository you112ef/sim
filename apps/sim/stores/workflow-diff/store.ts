import type { Edge } from 'reactflow'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console-logger'
import { useWorkflowStore } from '../workflows/workflow/store'
import { useSubBlockStore } from '../workflows/subblock/store'
import { useWorkflowRegistry } from '../workflows/registry/store'
import type { WorkflowState, BlockState } from '../workflows/workflow/types'
import { generateLoopBlocks, generateParallelBlocks } from '../workflows/workflow/utils'

const logger = createLogger('WorkflowDiffStore')

interface WorkflowDiffState {
  isShowingDiff: boolean
  diffWorkflow: WorkflowState | null
  diffAnalysis: any | null
  diffMetadata?: {
    source: string
    timestamp: number
  } | null
}

interface WorkflowDiffActions {
  setProposedChanges: (proposedWorkflow: WorkflowState, diffAnalysis?: any) => Promise<void>
  clearDiff: () => void
  getCurrentWorkflowForCanvas: () => WorkflowState
  toggleDiffView: () => void
  acceptChanges: () => Promise<void>
  rejectChanges: () => void
}

/**
 * Validate workflow blocks and edges (mirrors YAML import approach)
 * Reports issues without making destructive changes
 */
function validateWorkflowStructure(blocks: Record<string, BlockState>, edges: Edge[]): {
  errors: string[]
  warnings: string[]
} {
  const errors: string[] = []
  const warnings: string[] = []
  const blockIds = new Set(Object.keys(blocks))

  // Validate block references in edges
  edges.forEach((edge) => {
    if (!blockIds.has(edge.source)) {
      errors.push(`Edge ${edge.id} references non-existent source block '${edge.source}'`)
    }
    if (!blockIds.has(edge.target)) {
      errors.push(`Edge ${edge.id} references non-existent target block '${edge.target}'`)
    }
  })

  // Validate parent-child relationships
  Object.entries(blocks).forEach(([blockId, block]) => {
    const parentId = block.data?.parentId
    if (parentId && !blockIds.has(parentId)) {
      errors.push(`Block '${blockId}' references non-existent parent block '${parentId}'`)
    }
  })

  return { errors, warnings }
}

/**
 * Create ID mapping from proposed IDs to new UUIDs (mirrors YAML import approach)
 */
function createIdMapping(proposedBlocks: Record<string, BlockState>): Map<string, string> {
  const idMapping = new Map<string, string>()
  
  Object.keys(proposedBlocks).forEach(oldId => {
    const newId = crypto.randomUUID()
    idMapping.set(oldId, newId)
  })
  
  logger.info('Created ID mapping for diff workflow', {
    mappingCount: idMapping.size,
    mappings: Array.from(idMapping.entries())
  })
  
  return idMapping
}

/**
 * Update block references in values with new mapped IDs (mirrors YAML import approach)
 */
function updateBlockReferences(
  value: any,
  blockIdMapping: Map<string, string>
): any {
  if (typeof value === 'string' && value.includes('<') && value.includes('>')) {
    let processedValue = value
    const blockMatches = value.match(/<([^>]+)>/g)

    if (blockMatches) {
      for (const match of blockMatches) {
        const path = match.slice(1, -1)
        const [blockRef] = path.split('.')

        // Skip system references (start, loop, parallel, variable)
        if (['start', 'loop', 'parallel', 'variable'].includes(blockRef.toLowerCase())) {
          continue
        }

        // Check if this references an old block ID that needs mapping
        const newMappedId = blockIdMapping.get(blockRef)
        if (newMappedId) {
          logger.debug(`Updating block reference: ${blockRef} -> ${newMappedId}`)
          processedValue = processedValue.replace(
            new RegExp(`<${blockRef}\\.`, 'g'),
            `<${newMappedId}.`
          )
          processedValue = processedValue.replace(
            new RegExp(`<${blockRef}>`, 'g'),
            `<${newMappedId}>`
          )
        }
      }
    }

    return processedValue
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return value.map((item) => updateBlockReferences(item, blockIdMapping))
  }

  // Handle objects
  if (value !== null && typeof value === 'object') {
    const result = { ...value }
    for (const key in result) {
      result[key] = updateBlockReferences(result[key], blockIdMapping)
    }
    return result
  }

  return value
}

export const useWorkflowDiffStore = create<WorkflowDiffState & WorkflowDiffActions>()(
  devtools(
    (set, get) => ({
      isShowingDiff: false,
      diffWorkflow: null,
      diffAnalysis: null,
      diffMetadata: null,

      setProposedChanges: async (proposedWorkflow: WorkflowState, diffAnalysis?: any) => {
        logger.info('Setting proposed changes for diff mode with ID mapping')
        
        // Log the incoming workflow structure for debugging
        const incomingLoopBlocks = Object.entries(proposedWorkflow.blocks)
          .filter(([_, block]) => block.type === 'loop')
          .map(([id, block]) => ({ id, type: block.type, data: block.data }))
        
        logger.info('Incoming loop blocks:', incomingLoopBlocks)
        
        // Create ID mapping from proposed IDs to new UUIDs (like YAML import)
        const blockIdMapping = createIdMapping(proposedWorkflow.blocks)
        
        // Create new blocks with mapped IDs and updated references
        const mappedBlocks: Record<string, BlockState> = {}
        
        Object.entries(proposedWorkflow.blocks).forEach(([oldId, block]) => {
          const newId = blockIdMapping.get(oldId)!
          
          // Create new block with mapped ID
          const mappedBlock: BlockState = {
            ...block,
            id: newId,
            // Update parent references if they exist
            data: block.data ? {
              ...block.data,
              parentId: block.data.parentId ? blockIdMapping.get(block.data.parentId) : undefined
            } : undefined
          }
          
          // Special handling for loop and parallel blocks (like YAML import)
          if (block.type === 'loop' || block.type === 'parallel') {
            // For loop/parallel blocks, ensure proper data structure
            mappedBlock.data = {
              ...mappedBlock.data,
              width: mappedBlock.data?.width || 500,
              height: mappedBlock.data?.height || 300,
              type: block.type === 'loop' ? 'loopNode' : 'parallelNode',
              // Preserve loop-specific properties
              loopType: mappedBlock.data?.loopType || 'for',
              count: mappedBlock.data?.count || 5,
              collection: mappedBlock.data?.collection || '',
              // Preserve parallel-specific properties  
              parallelType: mappedBlock.data?.parallelType || 'collection',
            }
            
            // For container blocks, subBlocks should be empty (they don't use them)
            mappedBlock.subBlocks = {}
            mappedBlock.outputs = {}
            
            logger.debug(`Mapped ${block.type} block with special data structure:`, {
              oldId,
              newId,
              data: mappedBlock.data
            })
          } else {
            // Update block references in subblock values for regular blocks
            if (mappedBlock.subBlocks) {
              Object.entries(mappedBlock.subBlocks).forEach(([subBlockId, subBlock]) => {
                if (subBlock.value !== null && subBlock.value !== undefined) {
                  subBlock.value = updateBlockReferences(subBlock.value, blockIdMapping)
                }
              })
            }
          }
          
          mappedBlocks[newId] = mappedBlock
        })
        
        // Create new edges with mapped IDs
        const mappedEdges: Edge[] = proposedWorkflow.edges.map(edge => ({
          ...edge,
          id: crypto.randomUUID(), // Generate new edge ID
          source: blockIdMapping.get(edge.source) || edge.source,
          target: blockIdMapping.get(edge.target) || edge.target
        }))
        
        // Create the enhanced workflow with mapped IDs
        const enhancedWorkflow = {
          ...proposedWorkflow,
          blocks: mappedBlocks,
          edges: mappedEdges
        }
        
        // Add is_diff field to blocks based on diff analysis
        if (diffAnalysis && diffAnalysis.new_blocks && diffAnalysis.edited_blocks) {
          Object.keys(enhancedWorkflow.blocks).forEach(blockId => {
            const block = enhancedWorkflow.blocks[blockId]
            // Find original ID to check diff analysis
            const originalId = Array.from(blockIdMapping.entries()).find(([_, newId]) => newId === blockId)?.[0]
            
            if (originalId) {
              if (diffAnalysis.new_blocks.includes(originalId)) {
                block.is_diff = 'new'
              } else if (diffAnalysis.edited_blocks.includes(originalId)) {
                block.is_diff = 'edited'
              } else {
                block.is_diff = 'unchanged'
              }
            } else {
              block.is_diff = 'unchanged'
            }
          })
        } else {
          // If no diff analysis provided, mark all blocks as unchanged
          Object.keys(enhancedWorkflow.blocks).forEach(blockId => {
            const block = enhancedWorkflow.blocks[blockId]
            block.is_diff = 'unchanged'
          })
        }
        
        // Generate loops and parallels from mapped blocks
        const generatedLoops = generateLoopBlocks(enhancedWorkflow.blocks)
        const generatedParallels = generateParallelBlocks(enhancedWorkflow.blocks)
        
        // Update loops and parallels with mapped IDs
        enhancedWorkflow.loops = generatedLoops
        enhancedWorkflow.parallels = generatedParallels
        
        // Log final loop blocks for debugging
        const finalLoopBlocks = Object.entries(enhancedWorkflow.blocks)
          .filter(([_, block]) => block.type === 'loop')
          .map(([id, block]) => ({ id, type: block.type, data: block.data }))
        
        logger.info('Final processed loop blocks:', finalLoopBlocks)
        logger.info('Generated loops from blocks:', generatedLoops)
        
        // Validate the workflow structure (like YAML import does)
        const { errors, warnings } = validateWorkflowStructure(
          enhancedWorkflow.blocks, 
          enhancedWorkflow.edges
        )
        
        // Log validation results without making destructive changes
        if (errors.length > 0) {
          logger.warn('Validation errors in proposed workflow changes:', errors)
          // Log detailed block and edge information for debugging
          logger.warn('Problematic workflow structure:', {
            blockIds: Object.keys(enhancedWorkflow.blocks),
            edges: enhancedWorkflow.edges.map(e => ({ id: e.id, source: e.source, target: e.target })),
            blocksWithParents: Object.entries(enhancedWorkflow.blocks)
              .filter(([_, block]) => block.data?.parentId)
              .map(([id, block]) => ({ id, parentId: block.data?.parentId }))
          })
        }
        if (warnings.length > 0) {
          logger.warn('Validation warnings in proposed workflow changes:', warnings)
        }
        
        // Apply autolayout to ensure blocks are well-positioned for diff review
        try {
          logger.info('Applying autolayout to diff workflow for better visualization')
          
          // Import autolayout service
          const { autoLayoutWorkflow } = await import('@/lib/autolayout/service')
          
          // Apply autolayout with the same settings used in other parts of the codebase
          const layoutedBlocks = await autoLayoutWorkflow(
            enhancedWorkflow.blocks,
            enhancedWorkflow.edges,
            {
              strategy: 'smart',
              direction: 'auto',
              spacing: {
                horizontal: 500,
                vertical: 400,
                layer: 700,
              },
              alignment: 'center',
              padding: {
                x: 250,
                y: 250,
              },
            }
          )
          
          // Update the workflow with the layouted blocks
          enhancedWorkflow.blocks = layoutedBlocks
          
          logger.info('Successfully applied autolayout to diff workflow', {
            blocksCount: Object.keys(layoutedBlocks).length,
          })
          
        } catch (layoutError) {
          // Log the error but don't fail the diff - use original positions
          logger.warn('Autolayout failed for diff workflow, using original positions:', layoutError)
        }
        
        logger.info('Generated loops and parallels for diff workflow with ID mapping', {
          loopsCount: Object.keys(generatedLoops).length,
          parallelsCount: Object.keys(generatedParallels).length,
          blocksCount: Object.keys(enhancedWorkflow.blocks).length,
          edgesCount: enhancedWorkflow.edges.length,
          validationErrors: errors.length,
          validationWarnings: warnings.length,
          idMappingsCount: blockIdMapping.size
        })
        
        set({
          diffWorkflow: enhancedWorkflow,
          diffAnalysis,
          isShowingDiff: true,
          diffMetadata: {
            source: 'copilot',
            timestamp: Date.now(),
          },
        })
      },

      clearDiff: () => {
        logger.info('Clearing diff mode')
        set({
          isShowingDiff: false,
          diffWorkflow: null,
          diffAnalysis: null,
          diffMetadata: null,
        })
      },

      toggleDiffView: () => {
        const { isShowingDiff } = get()
        logger.info('Toggling diff view', { currentState: isShowingDiff })
        set({ isShowingDiff: !isShowingDiff })
      },

      acceptChanges: async () => {
        const { diffWorkflow } = get()
        if (!diffWorkflow) {
          logger.warn('No diff workflow to accept')
          return
        }

        logger.info('Accepting proposed changes')
        
        try {
          // Apply the diff workflow to the main workflow store
          const workflowStore = useWorkflowStore.getState()
          
          // Get the current active workflow ID for subblock store updates
          const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
          
          if (!activeWorkflowId) {
            logger.error('No active workflow ID found when accepting diff')
            throw new Error('No active workflow found')
          }
          
          // Directly replace the workflow state instead of using addBlock
          // This preserves all the block data including subBlocks with their values
          const newState = {
            blocks: { ...diffWorkflow.blocks },
            edges: [...diffWorkflow.edges],
            loops: { ...diffWorkflow.loops },
            parallels: { ...diffWorkflow.parallels },
          }
          
          // Remove is_diff properties from blocks as they're no longer needed
          Object.values(newState.blocks).forEach((block) => {
            delete block.is_diff
          })
          
          // Update the main workflow store state
          useWorkflowStore.setState((state) => ({
            ...state,
            ...newState,
          }))
          
          // Update the subblock store with the values from the diff workflow blocks
          if (activeWorkflowId) {
            const subblockValues: Record<string, Record<string, any>> = {}
            
            Object.entries(diffWorkflow.blocks).forEach(([blockId, block]) => {
              subblockValues[blockId] = {}
              Object.entries(block.subBlocks || {}).forEach(([subblockId, subblock]) => {
                subblockValues[blockId][subblockId] = subblock.value
              })
            })
            
            useSubBlockStore.setState((state) => ({
              workflowValues: {
                ...state.workflowValues,
                [activeWorkflowId]: subblockValues,
              },
            }))
            
            logger.info('Updated subblock store with diff values', {
              blocksWithSubblocks: Object.keys(subblockValues).length,
              totalSubblocks: Object.values(subblockValues).reduce((sum, blockSubblocks) => 
                sum + Object.keys(blockSubblocks).length, 0
              )
            })
          }
          
          // Trigger save and history
          workflowStore.updateLastSaved()
          
          logger.info('Successfully applied diff workflow to main store', {
            blocksCount: Object.keys(newState.blocks).length,
            edgesCount: newState.edges.length,
            loopsCount: Object.keys(newState.loops).length,
            parallelsCount: Object.keys(newState.parallels).length,
          })
          
          // IMPORTANT: Persist to database
          // This was the missing piece that caused accepted diffs not to be saved
          try {
            logger.info('Persisting accepted diff changes to database')
            
            // Get the complete workflow state for database persistence
            const completeWorkflowState = {
              blocks: newState.blocks,
              edges: newState.edges,
              loops: newState.loops,
              parallels: newState.parallels,
              lastSaved: Date.now(),
              isDeployed: diffWorkflow.isDeployed || false,
              deployedAt: diffWorkflow.deployedAt,
              deploymentStatuses: diffWorkflow.deploymentStatuses || {},
              hasActiveWebhook: diffWorkflow.hasActiveWebhook || false,
            }
            
            const response = await fetch(`/api/workflows/${activeWorkflowId}/state`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(completeWorkflowState),
            })

            if (!response.ok) {
              const errorData = await response.json()
              logger.error('Failed to persist accepted diff to database:', errorData)
              throw new Error(errorData.error || `Failed to save: ${response.statusText}`)
            }

            const result = await response.json()
            logger.info('Successfully persisted accepted diff to database', {
              blocksCount: result.blocksCount,
              edgesCount: result.edgesCount,
            })
            
          } catch (persistError) {
            logger.error('Failed to persist accepted diff to database:', persistError)
            // Don't throw here - the store is already updated, so the UI is correct
            // The user can try manual save or the socket will eventually sync
            logger.warn('Diff was applied to local stores but not persisted to database')
          }
          
          // Clear the diff
          get().clearDiff()
          
        } catch (error) {
          logger.error('Failed to accept changes:', error)
          throw error
        }
      },

      rejectChanges: () => {
        logger.info('Rejecting proposed changes')
        get().clearDiff()
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
    }),
    { name: 'workflow-diff-store' }
  )
) 