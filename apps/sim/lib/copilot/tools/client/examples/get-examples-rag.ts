import { Blocks, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'


export class GetExamplesRagClientTool extends BaseClientTool {
  static readonly id = 'get_examples_rag'

  constructor(toolCallId: string) {
    super(toolCallId, GetExamplesRagClientTool.id, GetExamplesRagClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Getting examples', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Getting examples', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Getting examples', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Got examples', icon: Blocks },
      [ClientToolCallState.error]: { text: 'Failed to get examples', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted getting examples', icon: MinusCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped getting examples', icon: MinusCircle },
    },
    interrupt: undefined,
  }

  async execute(): Promise<void> {
    return
  }
}
