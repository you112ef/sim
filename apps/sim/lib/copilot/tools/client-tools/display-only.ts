import { BaseTool } from '@/lib/copilot/tools/base-tool'
import type { CopilotToolCall, ToolExecuteResult, ToolExecutionOptions, ToolMetadata } from '@/lib/copilot/tools/types'

function makeDisplayOnlyTool(
  id: string,
  states: Record<string, { displayName: string; icon: string }>,
  description: string
) {
  return class DisplayOnlyTool extends BaseTool {
    static readonly id = id
    metadata: ToolMetadata = {
      id,
      displayConfig: { states },
      schema: { name: id, description },
      requiresInterrupt: false,
    }
    async execute(toolCall: CopilotToolCall, options?: ToolExecutionOptions): Promise<ToolExecuteResult> {
      options?.onStateChange?.('success')
      return { success: true, data: toolCall.parameters || toolCall.input || {} }
    }
  }
}

export const GetYamlStructureTool = makeDisplayOnlyTool(
  'get_yaml_structure',
  {
    executing: { displayName: 'Analyzing workflow structure', icon: 'spinner' },
    success: { displayName: 'Analyzed workflow structure', icon: 'tree' },
    rejected: { displayName: 'Skipped workflow structure analysis', icon: 'circle-slash' },
    errored: { displayName: 'Failed to analyze workflow structure', icon: 'error' },
    aborted: { displayName: 'Workflow structure analysis aborted', icon: 'x' },
  },
  'Get workflow YAML structure'
)

export const GetBuildWorkflowExamplesTool = makeDisplayOnlyTool(
  'get_build_workflow_examples',
  {
    executing: { displayName: 'Discovering workflow patterns', icon: 'spinner' },
    success: { displayName: 'Discovered workflow patterns', icon: 'gitbranch' },
    rejected: { displayName: 'Skipped discovering patterns', icon: 'circle-slash' },
    errored: { displayName: 'Failed to discover patterns', icon: 'error' },
    aborted: { displayName: 'Discovering patterns aborted', icon: 'x' },
  },
  'Get workflow examples'
)

export const GetEditWorkflowExamplesTool = makeDisplayOnlyTool(
  'get_edit_workflow_examples',
  {
    executing: { displayName: 'Optimizing edit approach', icon: 'spinner' },
    success: { displayName: 'Optimized edit approach', icon: 'gitbranch' },
    rejected: { displayName: 'Skipped optimizing edit approach', icon: 'circle-slash' },
    errored: { displayName: 'Failed to optimize edit approach', icon: 'error' },
    aborted: { displayName: 'Edit approach optimization aborted', icon: 'x' },
  },
  'Get workflow examples'
)

export const GetBlockBestPracticesTool = makeDisplayOnlyTool(
  'get_block_best_practices',
  {
    executing: { displayName: 'Reviewing recommendations', icon: 'spinner' },
    success: { displayName: 'Reviewed recommendations', icon: 'network' },
    rejected: { displayName: 'Skipped recommendations review', icon: 'circle-slash' },
    errored: { displayName: 'Failed to review recommendations', icon: 'error' },
    aborted: { displayName: 'Recommendations review aborted', icon: 'x' },
  },
  'Get best practices and usage guidelines for workflow blocks and tools'
) 