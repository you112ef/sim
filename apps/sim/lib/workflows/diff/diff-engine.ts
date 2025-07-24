import { createLogger } from '@/lib/logs/console-logger'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { convertYamlToWorkflowState, applyAutoLayoutToBlocks } from '@/lib/workflows/yaml-converter'

const logger = createLogger('WorkflowDiffEngine')

export interface DiffMetadata {
  source: string
  timestamp: number
}

export interface DiffAnalysis {
  new_blocks: string[]
  edited_blocks: string[]
  deleted_blocks: string[]
}

export interface WorkflowDiff {
  proposedState: WorkflowState
  diffAnalysis?: DiffAnalysis
  metadata: DiffMetadata
}

export interface DiffResult {
  success: boolean
  diff?: WorkflowDiff
  errors?: string[]
}

/**
 * Clean diff engine that handles workflow diff operations
 * without polluting core workflow stores
 */
export class WorkflowDiffEngine {
  private currentDiff: WorkflowDiff | null = null

  /**
   * Create a diff from YAML content
   */
  async createDiffFromYaml(
    yamlContent: string,
    diffAnalysis?: DiffAnalysis
  ): Promise<DiffResult> {
    try {
      logger.info('Creating diff from YAML content')

      // Convert YAML to workflow state with new IDs
      const conversionResult = await convertYamlToWorkflowState(yamlContent, {
        generateNewIds: true
      })

      if (!conversionResult.success || !conversionResult.workflowState) {
        return {
          success: false,
          errors: conversionResult.errors
        }
      }

      const proposedState = conversionResult.workflowState

      // Apply auto layout for better visualization
      const layoutResult = await applyAutoLayoutToBlocks(
        proposedState.blocks,
        proposedState.edges
      )

      if (layoutResult.success && layoutResult.layoutedBlocks) {
        proposedState.blocks = layoutResult.layoutedBlocks
      }

      // Add diff markers to blocks if analysis is provided
      let mappedDiffAnalysis = diffAnalysis
      if (diffAnalysis) {
        logger.info('Applying diff markers with analysis:', {
          new_blocks: diffAnalysis.new_blocks,
          edited_blocks: diffAnalysis.edited_blocks,
          deleted_blocks: diffAnalysis.deleted_blocks
        })
        this.applyDiffMarkers(proposedState, diffAnalysis, conversionResult.idMapping!)
        // Create a mapped version of the diff analysis with new IDs
        mappedDiffAnalysis = this.createMappedDiffAnalysis(diffAnalysis, conversionResult.idMapping!)
      }

      // Debug: Log blocks with parent relationships
      const blocksWithParents = Object.values(proposedState.blocks).filter((block: any) => block.parentNode)
      logger.info(`Found ${blocksWithParents.length} blocks with parent relationships`)
      blocksWithParents.forEach((block: any) => {
        logger.info(`Block ${block.id} has parentNode: ${block.parentNode}`)
      })

      // Debug: Log loop and parallel blocks
      const containerBlocks = Object.values(proposedState.blocks).filter(
        block => block.type === 'loop' || block.type === 'parallel'
      )
      logger.info(`Found ${containerBlocks.length} container blocks (loops/parallels):`, 
        containerBlocks.map(b => ({ id: b.id, type: b.type, name: b.name }))
      )

      // Create the diff object
      this.currentDiff = {
        proposedState,
        diffAnalysis: mappedDiffAnalysis,
        metadata: {
          source: 'copilot',
          timestamp: Date.now()
        }
      }

      logger.info('Diff created successfully', {
        blocksCount: Object.keys(proposedState.blocks).length,
        edgesCount: proposedState.edges.length
      })

      return {
        success: true,
        diff: this.currentDiff
      }
    } catch (error) {
      logger.error('Failed to create diff:', error)
      return {
        success: false,
        errors: [error instanceof Error ? error.message : 'Failed to create diff']
      }
    }
  }

  /**
   * Create a mapped version of diff analysis with new IDs
   */
  private createMappedDiffAnalysis(
    analysis: DiffAnalysis,
    idMapping: Map<string, string>
  ): DiffAnalysis {
    return {
      new_blocks: analysis.new_blocks.map(oldId => idMapping.get(oldId) || oldId),
      edited_blocks: analysis.edited_blocks.map(oldId => idMapping.get(oldId) || oldId),
      deleted_blocks: analysis.deleted_blocks // Deleted blocks won't have new IDs
    }
  }

  /**
   * Apply diff markers to blocks based on analysis
   */
  private applyDiffMarkers(
    state: WorkflowState,
    analysis: DiffAnalysis,
    idMapping: Map<string, string>
  ): void {
    // Create reverse mapping from new IDs to original IDs
    const reverseMapping = new Map<string, string>()
    idMapping.forEach((newId, originalId) => {
      reverseMapping.set(newId, originalId)
    })

    Object.entries(state.blocks).forEach(([blockId, block]) => {
      // Find original ID to check diff analysis
      const originalId = reverseMapping.get(blockId)
      
      if (originalId) {
        if (analysis.new_blocks.includes(originalId)) {
          (block as any).is_diff = 'new'
          logger.info(`Block ${blockId} (original: ${originalId}) marked as new`)
        } else if (analysis.edited_blocks.includes(originalId)) {
          (block as any).is_diff = 'edited'
          logger.info(`Block ${blockId} (original: ${originalId}) marked as edited`)
        } else {
          (block as any).is_diff = 'unchanged'
        }
      } else {
        (block as any).is_diff = 'unchanged'
        logger.warn(`Block ${blockId} has no original ID mapping`)
      }
    })
  }

  /**
   * Get the current diff
   */
  getCurrentDiff(): WorkflowDiff | null {
    return this.currentDiff
  }

  /**
   * Clear the current diff
   */
  clearDiff(): void {
    this.currentDiff = null
    logger.info('Diff cleared')
  }

  /**
   * Check if a diff is active
   */
  hasDiff(): boolean {
    return this.currentDiff !== null
  }

  /**
   * Get the workflow state for display (either diff or provided state)
   */
  getDisplayState(currentState: WorkflowState): WorkflowState {
    if (this.currentDiff) {
      return this.currentDiff.proposedState
    }
    return currentState
  }

  /**
   * Accept the diff and return the clean state
   */
  acceptDiff(): WorkflowState | null {
    if (!this.currentDiff) {
      logger.warn('No diff to accept')
      return null
    }

    const cleanState = { ...this.currentDiff.proposedState }
    
    // Remove diff markers
    Object.values(cleanState.blocks).forEach(block => {
      delete (block as any).is_diff
    })

    logger.info('Diff accepted', {
      blocksCount: Object.keys(cleanState.blocks).length,
      edgesCount: cleanState.edges.length
    })

    this.clearDiff()
    return cleanState
  }

  /**
   * Analyze differences between two workflow states
   */
  static async analyzeDiff(
    originalYaml: string,
    proposedYaml: string
  ): Promise<DiffAnalysis | null> {
    try {
      const response = await fetch('/api/workflows/diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          original_yaml: originalYaml,
          agent_yaml: proposedYaml
        })
      })

      if (response.ok) {
        const result = await response.json()
        if (result.success && result.data) {
          return result.data
        }
      }
    } catch (error) {
      logger.error('Failed to analyze diff:', error)
    }
    
    return null
  }
} 