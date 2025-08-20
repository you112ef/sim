import { BaseTool } from '@/lib/copilot/tools/base-tool'
import type {
  CopilotToolCall,
  ToolExecuteResult,
  ToolExecutionOptions,
  ToolMetadata,
} from '@/lib/copilot/tools/types'

export class PlanClientTool extends BaseTool {
  static readonly id = 'plan'

  metadata: ToolMetadata = {
    id: PlanClientTool.id,
    displayConfig: {
      states: {
        executing: { displayName: 'Crafting an approach', icon: 'spinner' },
        success: { displayName: 'Crafted a plan', icon: 'listTodo' },
        rejected: { displayName: 'Skipped crafting a plan', icon: 'circle-slash' },
        errored: { displayName: 'Failed to craft a plan', icon: 'error' },
        aborted: { displayName: 'Crafting a plan aborted', icon: 'x' },
      },
    },
    schema: { name: PlanClientTool.id, description: 'Plan the approach to solve a problem' },
    requiresInterrupt: false,
  }

  async execute(
    toolCall: CopilotToolCall,
    options?: ToolExecutionOptions
  ): Promise<ToolExecuteResult> {
    options?.onStateChange?.('success')
    return { success: true, data: toolCall.parameters || toolCall.input || {} }
  }
}
