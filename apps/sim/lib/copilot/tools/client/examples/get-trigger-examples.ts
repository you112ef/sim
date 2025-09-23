import { Blocks, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'


export class GetTriggerExamplesClientTool extends BaseClientTool {
  static readonly id = 'get_trigger_examples'

  constructor(toolCallId: string) {
    super(toolCallId, GetTriggerExamplesClientTool.id, GetTriggerExamplesClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Getting trigger examples', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Getting trigger examples', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Getting trigger examples', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Got trigger examples', icon: Blocks },
      [ClientToolCallState.error]: { text: 'Failed to get trigger examples', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted getting trigger examples', icon: MinusCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped getting trigger examples', icon: MinusCircle },
    },
    interrupt: undefined,
  }

  async execute(): Promise<void> {
    return
  }
}
