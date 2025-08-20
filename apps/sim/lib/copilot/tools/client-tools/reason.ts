import { BaseTool } from '@/lib/copilot/tools/base-tool'
import type { CopilotToolCall, ToolExecuteResult, ToolExecutionOptions, ToolMetadata } from '@/lib/copilot/tools/types'

export class ReasonClientTool extends BaseTool {
  static readonly id = 'reason'

  metadata: ToolMetadata = {
    id: ReasonClientTool.id,
    displayConfig: {
      states: {
        executing: { displayName: 'Designing an approach', icon: 'spinner' },
        success: { displayName: 'Designed an approach', icon: 'brain' },
        rejected: { displayName: 'Skipped reasoning', icon: 'circle-slash' },
        errored: { displayName: 'Failed to design an approach', icon: 'error' },
        aborted: { displayName: 'Reasoning aborted', icon: 'x' },
      },
    },
    schema: { name: ReasonClientTool.id, description: 'Reason through a complex problem' },
    requiresInterrupt: false,
  }

  async execute(toolCall: CopilotToolCall, options?: ToolExecutionOptions): Promise<ToolExecuteResult> {
    options?.onStateChange?.('success')
    return { success: true, data: toolCall.parameters || toolCall.input || {} }
  }
} 