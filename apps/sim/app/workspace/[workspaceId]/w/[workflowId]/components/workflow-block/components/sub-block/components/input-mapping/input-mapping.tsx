import { useEffect, useMemo, useRef, useState } from 'react'
import { formatDisplayText } from '@/components/ui/formatted-text'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { checkTagTrigger, TagDropdown } from '@/components/ui/tag-dropdown'
import { cn } from '@/lib/utils'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface InputMappingProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: any
  disabled?: boolean
}

// Simple mapping UI: for each field in child Input Trigger's inputFormat, render an input with TagDropdown support
export function InputMapping({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
}: InputMappingProps) {
  const [mapping, setMapping] = useSubBlockValue(blockId, subBlockId)
  const [selectedWorkflowId] = useSubBlockValue(blockId, 'workflowId')

  const { workflows } = useWorkflowRegistry.getState()

  // Fetch child workflow state via registry API endpoint, using cached metadata when possible
  // Here we rely on live store; the serializer/executor will resolve at runtime too.
  // We only need the inputFormat from an Input Trigger in the selected child workflow state.
  const [childInputFields, setChildInputFields] = useState<Array<{ name: string; type?: string }>>(
    []
  )

  useEffect(() => {
    let isMounted = true
    const controller = new AbortController()
    async function fetchChildSchema() {
      try {
        if (!selectedWorkflowId) {
          if (isMounted) setChildInputFields([])
          return
        }
        const res = await fetch(`/api/workflows/${selectedWorkflowId}`, {
          signal: controller.signal,
        })
        if (!res.ok) {
          if (isMounted) setChildInputFields([])
          return
        }
        const { data } = await res.json()
        const blocks = data?.state?.blocks || {}
        const triggerEntry = Object.entries(blocks).find(
          ([, b]: any) => b?.type === 'input_trigger'
        )
        if (!triggerEntry) {
          if (isMounted) setChildInputFields([])
          return
        }
        const triggerBlock = triggerEntry[1] as any
        const inputFormat = triggerBlock?.subBlocks?.inputFormat?.value
        if (Array.isArray(inputFormat)) {
          const fields = inputFormat
            .filter((f: any) => f && typeof f.name === 'string' && f.name.trim() !== '')
            .map((f: any) => ({ name: f.name as string, type: f.type as string | undefined }))
          if (isMounted) setChildInputFields(fields)
        } else {
          if (isMounted) setChildInputFields([])
        }
      } catch {
        if (isMounted) setChildInputFields([])
      }
    }
    fetchChildSchema()
    return () => {
      isMounted = false
      controller.abort()
    }
  }, [selectedWorkflowId])

  const valueObj: Record<string, any> = useMemo(() => {
    if (isPreview && previewValue && typeof previewValue === 'object') return previewValue
    if (mapping && typeof mapping === 'object') return mapping as Record<string, any>
    try {
      if (typeof mapping === 'string') return JSON.parse(mapping)
    } catch {}
    return {}
  }, [mapping, isPreview, previewValue])

  const update = (field: string, value: string) => {
    if (disabled) return
    const updated = { ...valueObj, [field]: value }
    setMapping(updated)
  }

  if (!selectedWorkflowId) {
    return (
      <div className='rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground'>
        Select a workflow first.
      </div>
    )
  }

  if (!childInputFields || childInputFields.length === 0) {
    return (
      <div className='rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground'>
        The selected workflow must have an Input Trigger with a defined input format to show fields.
      </div>
    )
  }

  return (
    <div className='space-y-3'>
      {childInputFields.map((field) => {
        return (
          <InputMappingField
            key={field.name}
            fieldName={field.name}
            fieldType={field.type}
            value={valueObj[field.name] || ''}
            onChange={(value) => update(field.name, value)}
            blockId={blockId}
            subBlockId={subBlockId}
            disabled={isPreview || disabled}
          />
        )
      })}
    </div>
  )
}

// Individual field component with TagDropdown support
function InputMappingField({
  fieldName,
  fieldType,
  value,
  onChange,
  blockId,
  subBlockId,
  disabled,
}: {
  fieldName: string
  fieldType?: string
  value: string
  onChange: (value: string) => void
  blockId: string
  subBlockId: string
  disabled: boolean
}) {
  const [showTags, setShowTags] = useState(false)
  const [cursorPosition, setCursorPosition] = useState(0)
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) {
      e.preventDefault()
      return
    }

    const newValue = e.target.value
    const newCursorPosition = e.target.selectionStart ?? 0

    onChange(newValue)
    setCursorPosition(newCursorPosition)

    // Check for tag trigger
    const tagTrigger = checkTagTrigger(newValue, newCursorPosition)
    setShowTags(tagTrigger.show)
  }

  // Sync scroll position between input and overlay
  const handleScroll = (e: React.UIEvent<HTMLInputElement>) => {
    if (overlayRef.current) {
      overlayRef.current.scrollLeft = e.currentTarget.scrollLeft
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setShowTags(false)
    }
  }

  const handleTagSelect = (newValue: string) => {
    onChange(newValue)
    // Don't emit tag selection here - onChange already updates the parent which handles the state update
    // emitTagSelection was overwriting the entire inputMapping object with just a string value
  }

  // Drag and Drop handlers
  const handleDragOver = (e: React.DragEvent<HTMLInputElement>) => {
    e.preventDefault()
  }

  const handleDrop = (e: React.DragEvent<HTMLInputElement>) => {
    e.preventDefault()

    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'))
      if (data.type !== 'connectionBlock') return

      // Get current cursor position or append to end
      const dropPosition = inputRef.current?.selectionStart ?? value.length ?? 0

      // Insert '<' at drop position to trigger the dropdown
      const newValue = `${value.slice(0, dropPosition)}<${value.slice(dropPosition)}`

      // Focus the input first
      inputRef.current?.focus()

      // Update all state in a single batch
      Promise.resolve().then(() => {
        onChange(newValue)
        setCursorPosition(dropPosition + 1)
        setShowTags(true)

        // Pass the source block ID from the dropped connection
        if (data.connectionData?.sourceBlockId) {
          setActiveSourceBlockId(data.connectionData.sourceBlockId)
        }

        // Set cursor position after state updates
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.selectionStart = dropPosition + 1
            inputRef.current.selectionEnd = dropPosition + 1
          }
        }, 0)
      })
    } catch (error) {
      console.error('Failed to parse drop data:', error)
    }
  }

  return (
    <div className='space-y-1.5'>
      <Label className='text-sm'>{fieldName}</Label>
      <div className='group relative w-full'>
        <Input
          ref={inputRef}
          className={cn(
            'allow-scroll w-full overflow-auto text-transparent caret-foreground placeholder:text-muted-foreground/50'
          )}
          type='text'
          value={value}
          onChange={handleChange}
          onFocus={() => {
            setShowTags(false)
          }}
          onBlur={() => {
            setShowTags(false)
          }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          autoComplete='off'
          style={{ overflowX: 'auto' }}
          disabled={disabled}
        />
        <div
          ref={overlayRef}
          className='pointer-events-none absolute inset-0 flex items-center overflow-x-auto bg-transparent px-3 text-sm'
          style={{ overflowX: 'auto' }}
        >
          <div
            className='w-full whitespace-pre'
            style={{ scrollbarWidth: 'none', minWidth: 'fit-content' }}
          >
            {formatDisplayText(value, true)}
          </div>
        </div>

        <TagDropdown
          visible={showTags}
          onSelect={handleTagSelect}
          blockId={blockId}
          activeSourceBlockId={activeSourceBlockId}
          inputValue={value}
          cursorPosition={cursorPosition}
          onClose={() => {
            setShowTags(false)
            setActiveSourceBlockId(null)
          }}
        />
      </div>
    </div>
  )
}
