import { StartIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const ChatTriggerBlock: BlockConfig = {
  type: 'chat_trigger',
  name: 'Chat Trigger',
  description: 'Start workflow from a chat deployment',
  longDescription: 'Chat trigger to run the workflow via deployed chat interfaces.',
  category: 'triggers',
  bgColor: '#8B5CF6',
  icon: StartIcon,
  subBlocks: [],
  tools: {
    access: [],
  },
  inputs: {},
  outputs: {
    input: { type: 'string', description: 'User message' },
    conversationId: { type: 'string', description: 'Conversation ID' },
    files: { type: 'array', description: 'Uploaded files' },
  },
  triggers: {
    enabled: true,
    available: ['chat'],
  },
}
