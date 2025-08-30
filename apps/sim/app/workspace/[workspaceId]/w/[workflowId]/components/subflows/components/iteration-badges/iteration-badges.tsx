import { useCallback, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { highlight, languages } from 'prismjs'
import Editor from 'react-simple-code-editor'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { checkTagTrigger, TagDropdown } from '@/components/ui/tag-dropdown'
import { cn } from '@/lib/utils'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import 'prismjs/components/prism-javascript'
import 'prismjs/themes/prism.css'

type IterationType = 'loop' | 'parallel' | 'while'
type LoopType = 'for' | 'forEach'
type ParallelType = 'count' | 'collection'
type WhileType = 'while' | 'doWhile'

interface IterationNodeData {
  width?: number
  height?: number
  parentId?: string
  state?: string
  type?: string
  extent?: 'parent'
  loopType?: LoopType
  parallelType?: ParallelType
  whileType?: WhileType
  // Common
  count?: number
  collection?: string | any[] | Record<string, any>
  condition?: string
  isPreview?: boolean
  executionState?: {
    currentIteration?: number
    currentExecution?: number
    isExecuting: boolean
    startTime: number | null
    endTime: number | null
  }
}

interface IterationBadgesProps {
  nodeId: string
  data: IterationNodeData
  iterationType: IterationType
}

const CONFIG = {
  loop: {
    typeLabels: { for: 'For Loop', forEach: 'For Each' },
    typeKey: 'loopType' as const,
    storeKey: 'loops' as const,
    maxIterations: 100,
    configKeys: {
      iterations: 'iterations' as const,
      items: 'forEachItems' as const,
    },
  },
  parallel: {
    typeLabels: { count: 'Parallel Count', collection: 'Parallel Each' },
    typeKey: 'parallelType' as const,
    storeKey: 'parallels' as const,
    maxIterations: 20,
    configKeys: {
      iterations: 'count' as const,
      items: 'distribution' as const,
    },
  },
  while: {
    typeLabels: { while: 'While Loop', doWhile: 'Do While' },
    typeKey: 'whileType' as const,
    storeKey: 'whiles' as const,
    maxIterations: 100,
  },
} as const

export function IterationBadges({ nodeId, data, iterationType }: IterationBadgesProps) {
  const config = CONFIG[iterationType]
  const isPreview = data?.isPreview || false

  // Get configuration from the workflow store
  const store = useWorkflowStore()
  const nodeConfig = store[config.storeKey][nodeId]

  // Determine current type and values
  const currentType = (data?.[config.typeKey] ||
    (iterationType === 'loop' ? 'for' : iterationType === 'parallel' ? 'count' : 'while')) as any

  const configIterations =
    iterationType === 'loop'
      ? ((nodeConfig as any)?.[CONFIG.loop.configKeys.iterations] ?? data?.count ?? 5)
      : iterationType === 'parallel'
        ? ((nodeConfig as any)?.[CONFIG.parallel.configKeys.iterations] ?? data?.count ?? 5)
        : ((nodeConfig as any)?.iterations ?? data?.count ?? 5)

  const configCollection =
    iterationType === 'loop'
      ? ((nodeConfig as any)?.[CONFIG.loop.configKeys.items] ?? data?.collection ?? '')
      : iterationType === 'parallel'
        ? ((nodeConfig as any)?.[CONFIG.parallel.configKeys.items] ?? data?.collection ?? '')
        : ''

  const iterations = configIterations
  const collectionString =
    typeof configCollection === 'string' ? configCollection : JSON.stringify(configCollection) || ''

  // State management
  const [tempInputValue, setTempInputValue] = useState<string | null>(null)
  const isWhile = iterationType === 'while'
  const [whileValue, setWhileValue] = useState<string>(data?.condition || '')
  const inputValue = tempInputValue ?? iterations.toString()
  const editorValue = isWhile ? whileValue : collectionString
  const [typePopoverOpen, setTypePopoverOpen] = useState(false)
  const [configPopoverOpen, setConfigPopoverOpen] = useState(false)
  const [showTagDropdown, setShowTagDropdown] = useState(false)
  const [cursorPosition, setCursorPosition] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const editorContainerRef = useRef<HTMLDivElement>(null)

  // Get collaborative functions
  const {
    collaborativeUpdateLoopType,
    collaborativeUpdateParallelType,
    collaborativeUpdateWhileType,
    collaborativeUpdateIterationCount,
    collaborativeUpdateIterationCollection,
  } = useCollaborativeWorkflow()

  // Handle type change
  const handleTypeChange = useCallback(
    (newType: any) => {
      if (isPreview) return
      if (iterationType === 'loop') {
        collaborativeUpdateLoopType(nodeId, newType)
      } else if (iterationType === 'parallel') {
        collaborativeUpdateParallelType(nodeId, newType)
      } else {
        collaborativeUpdateWhileType(nodeId, newType)
      }
      setTypePopoverOpen(false)
    },
    [
      nodeId,
      iterationType,
      collaborativeUpdateLoopType,
      collaborativeUpdateParallelType,
      collaborativeUpdateWhileType,
      isPreview,
    ]
  )

  // Handle iterations input change
  const handleIterationsChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (isPreview) return
      const sanitizedValue = e.target.value.replace(/[^0-9]/g, '')
      const numValue = Number.parseInt(sanitizedValue)

      if (!Number.isNaN(numValue)) {
        setTempInputValue(Math.min(config.maxIterations, numValue).toString())
      } else {
        setTempInputValue(sanitizedValue)
      }
    },
    [isPreview, config.maxIterations]
  )

  // Handle iterations save
  const handleIterationsSave = useCallback(() => {
    if (isPreview) return
    const value = Number.parseInt(inputValue)

    if (!Number.isNaN(value)) {
      const newValue = Math.min(config.maxIterations, Math.max(1, value))
      if (iterationType === 'loop' || iterationType === 'parallel') {
        collaborativeUpdateIterationCount(nodeId, iterationType, newValue)
      }
    }
    setTempInputValue(null)
    setConfigPopoverOpen(false)
  }, [
    inputValue,
    nodeId,
    iterationType,
    collaborativeUpdateIterationCount,
    isPreview,
    config.maxIterations,
  ])

  // Handle editor change
  const handleEditorChange = useCallback(
    (value: string) => {
      if (isPreview) return
      if (iterationType === 'loop' || iterationType === 'parallel') {
        collaborativeUpdateIterationCollection(nodeId, iterationType, value)
      } else if (isWhile) {
        setWhileValue(value)
      }

      const textarea = editorContainerRef.current?.querySelector('textarea')
      if (textarea) {
        textareaRef.current = textarea
        const cursorPos = textarea.selectionStart || 0
        setCursorPosition(cursorPos)

        const triggerCheck = checkTagTrigger(value, cursorPos)
        setShowTagDropdown(triggerCheck.show)
      }
    },
    [nodeId, iterationType, collaborativeUpdateIterationCollection, isPreview, isWhile]
  )

  // Handle tag selection
  const handleTagSelect = useCallback(
    (newValue: string) => {
      if (isPreview) return
      if (iterationType === 'loop' || iterationType === 'parallel') {
        collaborativeUpdateIterationCollection(nodeId, iterationType, newValue)
      } else if (isWhile) {
        setWhileValue(newValue)
      }
      setShowTagDropdown(false)

      setTimeout(() => {
        const textarea = textareaRef.current
        if (textarea) {
          textarea.focus()
        }
      }, 0)
    },
    [nodeId, iterationType, collaborativeUpdateIterationCollection, isPreview, isWhile]
  )

  // Determine if we're in count mode or collection mode
  const isCountMode =
    (iterationType === 'loop' && currentType === 'for') ||
    (iterationType === 'parallel' && currentType === 'count')

  // Get type options
  const typeOptions = Object.entries(config.typeLabels)

  return (
    <div className='-top-9 absolute right-0 left-0 z-10 flex justify-between'>
      {/* Type Badge */}
      <Popover
        open={!isPreview && typePopoverOpen}
        onOpenChange={isPreview ? undefined : setTypePopoverOpen}
      >
        <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
          <Badge
            variant='outline'
            className={cn(
              'border-border bg-background/80 py-0.5 pr-1.5 pl-2.5 font-medium text-foreground text-sm backdrop-blur-sm',
              !isPreview && 'cursor-pointer transition-colors duration-150 hover:bg-accent/50',
              'flex items-center gap-1'
            )}
            style={{ pointerEvents: isPreview ? 'none' : 'auto' }}
          >
            {config.typeLabels[currentType as keyof typeof config.typeLabels]}
            {!isPreview && <ChevronDown className='h-3 w-3 text-muted-foreground' />}
          </Badge>
        </PopoverTrigger>
        {!isPreview && (
          <PopoverContent className='w-48 p-3' align='center' onClick={(e) => e.stopPropagation()}>
            <div className='space-y-2'>
              <div className='font-medium text-muted-foreground text-xs'>
                {iterationType === 'loop'
                  ? 'Loop Type'
                  : iterationType === 'parallel'
                    ? 'Parallel Type'
                    : 'While Type'}
              </div>
              <div className='space-y-1'>
                {typeOptions.map(([typeValue, typeLabel]) => (
                  <div
                    key={typeValue}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5',
                      currentType === typeValue ? 'bg-accent' : 'hover:bg-accent/50'
                    )}
                    onClick={() => handleTypeChange(typeValue)}
                  >
                    <span className='text-sm'>{typeLabel}</span>
                  </div>
                ))}
              </div>
            </div>
          </PopoverContent>
        )}
      </Popover>

      {/* Configuration Badge */}
      <Popover
        open={!isPreview && configPopoverOpen}
        onOpenChange={isPreview ? undefined : setConfigPopoverOpen}
      >
        <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
          <Badge
            variant='outline'
            className={cn(
              'border-border bg-background/80 py-0.5 pr-1.5 pl-2.5 font-medium text-foreground text-sm backdrop-blur-sm',
              !isPreview && 'cursor-pointer transition-colors duration-150 hover:bg-accent/50',
              'flex items-center gap-1'
            )}
            style={{ pointerEvents: isPreview ? 'none' : 'auto' }}
          >
            {isWhile ? 'Condition' : isCountMode ? `Iterations: ${iterations}` : 'Items'}
            {!isPreview && <ChevronDown className='h-3 w-3 text-muted-foreground' />}
          </Badge>
        </PopoverTrigger>
        {!isPreview && (
          <PopoverContent
            className={cn('p-3', isWhile || !isCountMode ? 'w-72' : 'w-48')}
            align='center'
            onClick={(e) => e.stopPropagation()}
          >
            <div className='space-y-2'>
              <div className='font-medium text-muted-foreground text-xs'>
                {isWhile
                  ? 'While Condition'
                  : isCountMode
                    ? `${iterationType === 'loop' ? 'Loop' : 'Parallel'} Iterations`
                    : `${iterationType === 'loop' ? 'Collection' : 'Parallel'} Items`}
              </div>

              {isWhile ? (
                // Code editor for while condition
                <div ref={editorContainerRef} className='relative'>
                  <div className='relative min-h-[80px] rounded-md border border-input bg-background px-3 pt-2 pb-3 font-mono text-sm'>
                    {editorValue === '' && (
                      <div className='pointer-events-none absolute top-[8.5px] left-3 select-none text-muted-foreground/50'>
                        condition === true
                      </div>
                    )}
                    <Editor
                      value={editorValue}
                      onValueChange={handleEditorChange}
                      highlight={(code) => highlight(code, languages.javascript, 'javascript')}
                      padding={0}
                      style={{
                        fontFamily: 'monospace',
                        lineHeight: '21px',
                      }}
                      className='w-full focus:outline-none'
                      textareaClassName='focus:outline-none focus:ring-0 bg-transparent resize-none w-full overflow-hidden whitespace-pre-wrap'
                    />
                  </div>
                  <div className='mt-2 text-[10px] text-muted-foreground'>
                    Enter a boolean expression.
                  </div>
                  {showTagDropdown && (
                    <TagDropdown
                      visible={showTagDropdown}
                      onSelect={handleTagSelect}
                      blockId={nodeId}
                      activeSourceBlockId={null}
                      inputValue={editorValue}
                      cursorPosition={cursorPosition}
                      onClose={() => setShowTagDropdown(false)}
                    />
                  )}
                </div>
              ) : isCountMode ? (
                // Number input for count-based mode
                <div className='flex items-center gap-2'>
                  <Input
                    type='text'
                    value={inputValue}
                    onChange={handleIterationsChange}
                    onBlur={handleIterationsSave}
                    onKeyDown={(e) => e.key === 'Enter' && handleIterationsSave()}
                    className='h-8 text-sm'
                    autoFocus
                  />
                </div>
              ) : (
                // Code editor for collection-based mode
                <div ref={editorContainerRef} className='relative'>
                  <div className='relative min-h-[80px] rounded-md border border-input bg-background px-3 pt-2 pb-3 font-mono text-sm'>
                    {editorValue === '' && (
                      <div className='pointer-events-none absolute top-[8.5px] left-3 select-none text-muted-foreground/50'>
                        ['item1', 'item2', 'item3']
                      </div>
                    )}
                    <Editor
                      value={editorValue}
                      onValueChange={handleEditorChange}
                      highlight={(code) => highlight(code, languages.javascript, 'javascript')}
                      padding={0}
                      style={{
                        fontFamily: 'monospace',
                        lineHeight: '21px',
                      }}
                      className='w-full focus:outline-none'
                      textareaClassName='focus:outline-none focus:ring-0 bg-transparent resize-none w-full overflow-hidden whitespace-pre-wrap'
                    />
                  </div>
                  <div className='mt-2 text-[10px] text-muted-foreground'>
                    Array or object to iterate over. Type "{'<'}" to reference other blocks.
                  </div>
                  {showTagDropdown && (
                    <TagDropdown
                      visible={showTagDropdown}
                      onSelect={handleTagSelect}
                      blockId={nodeId}
                      activeSourceBlockId={null}
                      inputValue={editorValue}
                      cursorPosition={cursorPosition}
                      onClose={() => setShowTagDropdown(false)}
                    />
                  )}
                </div>
              )}

              {isCountMode && (
                <div className='text-[10px] text-muted-foreground'>
                  Enter a number between 1 and {config.maxIterations}
                </div>
              )}
            </div>
          </PopoverContent>
        )}
      </Popover>
    </div>
  )
}
