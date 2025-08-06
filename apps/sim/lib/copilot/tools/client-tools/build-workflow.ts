import { BaseTool } from '@/lib/copilot/tools/base-tool'
import type { CopilotToolCall, ToolExecuteResult, ToolExecutionOptions } from '@/lib/copilot/tools/types'
import { useCopilotStore } from '@/stores/copilot/store'

interface BuildWorkflowParams {
  yamlContent: string
  data?: {
    yamlContent?: string
  }
}

export class BuildWorkflowTool extends BaseTool {
  static readonly id = 'build_workflow'

  metadata = {
    id: 'build_workflow',
    displayConfig: {
      states: {
        executing: { displayName: 'Building workflow', icon: 'spinner' },
        ready_for_review: { displayName: 'Workflow changes ready for review', icon: 'network' },
        success: { displayName: 'Built workflow', icon: 'network' },
        rejected: { displayName: 'Workflow changes not applied', icon: 'skip' },
        errored: { displayName: 'Failed to build workflow', icon: 'error' },
        accepted: { displayName: 'Built workflow', icon: 'network' },
      },
    },
    schema: {
      name: 'build_workflow',
      description: 'Build a new workflow',
    },
    stateMessages: {
      accepted: 'The user accepted your workflow changes',
      rejected: 'The user rejected your workflow changes',
    },
    requiresInterrupt: false,
    allowBackgroundExecution: false,
  }

  /**
   * Execute the tool - just create the diff from YAML content
   * This doesn't require user confirmation like run_workflow
   */
  async execute(
    toolCall: CopilotToolCall,
    options?: ToolExecutionOptions
  ): Promise<ToolExecuteResult> {
    try {
      // Parse parameters from either toolCall.parameters or toolCall.input
      const rawParams = toolCall.parameters || toolCall.input || {}
      const params = rawParams as BuildWorkflowParams

      // Extract YAML content from various possible locations
      const yamlContent = 
        params.yamlContent || 
        params.data?.yamlContent ||
        toolCall.input?.yamlContent ||
        toolCall.input?.data?.yamlContent

      if (!yamlContent) {
        options?.onStateChange?.('errored')
        return {
          success: false,
          error: 'No YAML content provided',
        }
      }

      // Get the copilot store to check if diff already set up
      const copilotStore = useCopilotStore.getState()
      
      // Check if preview YAML is already set (which means setToolCallState already handled it)
      const previewAlreadySet = copilotStore.currentChat?.previewYaml === yamlContent
      
      if (!previewAlreadySet) {
        // Only update if not already set by setToolCallState
        copilotStore.setPreviewYaml(yamlContent)
        await copilotStore.updateDiffStore(yamlContent, 'build_workflow')
      }

      // Notify success
      await this.notify(
        toolCall.id,
        'success',
        'Workflow diff created successfully'
      )

      options?.onStateChange?.('success')

      return {
        success: true,
        data: {
          yamlContent,
          message: 'Workflow diff created and ready for review',
        },
      }
    } catch (error: any) {
      // Notify error
      await this.notify(toolCall.id, 'errored', `Workflow diff creation failed: ${error.message}`)

      options?.onStateChange?.('errored')

      return {
        success: false,
        error: error.message || 'Failed to create workflow diff',
      }
    }
  }
} 