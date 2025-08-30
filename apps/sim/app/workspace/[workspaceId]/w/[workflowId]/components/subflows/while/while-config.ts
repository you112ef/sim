import { RefreshCwIcon } from 'lucide-react'

export const WhileTool = {
  id: 'while',
  type: 'while',
  name: 'While',
  description: 'While Loop',
  icon: RefreshCwIcon,
  bgColor: '#CC5500',
  data: {
    label: 'While',
    whileType: 'while' as 'while' | 'doWhile',
    condition: '',
    width: 500,
    height: 300,
    extent: 'parent',
    executionState: {
      currentIteration: 0,
      isExecuting: false,
      startTime: null,
      endTime: null,
    },
  },
  style: {
    width: 500,
    height: 300,
  },
  isResizable: true,
}
