import { StartIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const ManualTriggerBlock: BlockConfig = {
  type: 'manual_trigger',
  name: 'Manual Trigger',
  description: 'Run workflow manually from the editor',
  longDescription: 'Manual trigger to start the workflow during test runs.',
  category: 'triggers',
  bgColor: '#2FB3FF',
  icon: StartIcon,
  subBlocks: [],
  tools: {
    access: [],
  },
  inputs: {},
  outputs: {},
  triggers: {
    enabled: true,
    available: ['manual'],
  },
}
