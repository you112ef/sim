import { Loader2, MinusCircle, Search, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

export class GetOperationsExamplesClientTool extends BaseClientTool {
  static readonly id = 'get_operations_examples'

  constructor(toolCallId: string) {
    super(toolCallId, GetOperationsExamplesClientTool.id, GetOperationsExamplesClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Fetching operations examples', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Fetching operations examples', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Fetching operations examples', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Fetched operations examples', icon: Search },
      [ClientToolCallState.error]: { text: 'Failed to fetch operations examples', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted getting operations examples', icon: MinusCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped getting operations examples', icon: MinusCircle },
    },
    interrupt: undefined,
  }

  async execute(): Promise<void> {
    return
  }
}
