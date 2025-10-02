import type React from 'react'
import { useEffect, useState } from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import { Label, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { FieldDiffStatus } from '@/lib/workflows/diff/types'
import {
  ChannelSelectorInput,
  CheckboxList,
  Code,
  ComboBox,
  ConditionInput,
  CredentialSelector,
  DocumentSelector,
  Dropdown,
  EvalInput,
  FileSelectorInput,
  FileUpload,
  FolderSelectorInput,
  InputFormat,
  InputMapping,
  KnowledgeBaseSelector,
  LongInput,
  McpDynamicArgs,
  McpServerSelector,
  McpToolSelector,
  ProjectSelectorInput,
  ResponseFormat,
  ScheduleConfig,
  ShortInput,
  SliderInput,
  Switch,
  Table,
  TimeInput,
  ToolInput,
  TriggerConfig,
  WaitStatus,
  WebhookConfig,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/components'
import type { SubBlockConfig } from '@/blocks/types'
import { DocumentTagEntry } from './components/document-tag-entry/document-tag-entry'
import { E2BSwitch } from './components/e2b-switch'
import { KnowledgeTagFilters } from './components/knowledge-tag-filters/knowledge-tag-filters'

interface SubBlockProps {
  blockId: string
  config: SubBlockConfig
  isConnecting: boolean
  isPreview?: boolean
  subBlockValues?: Record<string, any>
  disabled?: boolean
  fieldDiffStatus?: FieldDiffStatus
  allowExpandInPreview?: boolean
  isWide?: boolean
}

export function SubBlock({
  blockId,
  config,
  isConnecting,
  isPreview = false,
  subBlockValues,
  disabled = false,
  fieldDiffStatus,
  allowExpandInPreview,
  isWide = false,
}: SubBlockProps) {
  const [isValidJson, setIsValidJson] = useState(true)

  // Debug field diff status
  useEffect(() => {
    if (fieldDiffStatus) {
      console.log(`[SubBlock ${config.id}] fieldDiffStatus:`, fieldDiffStatus)
    }
  }, [fieldDiffStatus, config.id])

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation()
  }

  const handleValidationChange = (isValid: boolean) => {
    setIsValidJson(isValid)
  }

  const isFieldRequired = () => {
    return config.required === true
  }

  // Get preview value for this specific sub-block
  const getPreviewValue = () => {
    if (!isPreview || !subBlockValues) return undefined
    return subBlockValues[config.id]?.value ?? null
  }

  const renderInput = () => {
    const previewValue = getPreviewValue()
    // Disable input if explicitly disabled or in preview mode
    const isDisabled = disabled || isPreview

    switch (config.type) {
      case 'short-input':
        return (
          <ShortInput
            blockId={blockId}
            subBlockId={config.id}
            placeholder={config.placeholder}
            password={config.password}
            isConnecting={isConnecting}
            config={config}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
          />
        )
      case 'long-input':
        return (
          <LongInput
            blockId={blockId}
            subBlockId={config.id}
            placeholder={config.placeholder}
            isConnecting={isConnecting}
            rows={config.rows}
            config={config}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
          />
        )
      case 'dropdown':
        return (
          <div onMouseDown={handleMouseDown}>
            <Dropdown
              blockId={blockId}
              subBlockId={config.id}
              options={config.options as { label: string; id: string }[]}
              defaultValue={typeof config.value === 'function' ? config.value({}) : config.value}
              placeholder={config.placeholder}
              isPreview={isPreview}
              previewValue={previewValue}
              disabled={isDisabled}
              config={config}
            />
          </div>
        )
      case 'combobox':
        return (
          <div onMouseDown={handleMouseDown}>
            <ComboBox
              blockId={blockId}
              subBlockId={config.id}
              options={config.options as { label: string; id: string }[]}
              defaultValue={typeof config.value === 'function' ? config.value({}) : config.value}
              placeholder={config.placeholder}
              isPreview={isPreview}
              previewValue={previewValue}
              disabled={isDisabled}
              isConnecting={isConnecting}
              config={config}
              isWide={isWide}
            />
          </div>
        )
      case 'slider':
        return (
          <SliderInput
            blockId={blockId}
            subBlockId={config.id}
            min={config.min}
            max={config.max}
            defaultValue={(config.min || 0) + ((config.max || 100) - (config.min || 0)) / 2}
            step={config.step}
            integer={config.integer}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
          />
        )
      case 'table':
        return (
          <Table
            blockId={blockId}
            subBlockId={config.id}
            columns={config.columns ?? []}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
          />
        )
      case 'code':
        return (
          <Code
            blockId={blockId}
            subBlockId={config.id}
            isConnecting={isConnecting}
            placeholder={config.placeholder}
            language={config.language}
            generationType={config.generationType}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
            onValidationChange={handleValidationChange}
            wandConfig={
              config.wandConfig || {
                enabled: false,
                prompt: '',
                placeholder: '',
              }
            }
          />
        )
      case 'switch':
        if (config.id === 'remoteExecution') {
          return (
            <E2BSwitch
              blockId={blockId}
              subBlockId={config.id}
              title={config.title ?? ''}
              isPreview={isPreview}
              previewValue={previewValue}
              disabled={isDisabled}
            />
          )
        }
        return (
          <Switch
            blockId={blockId}
            subBlockId={config.id}
            title={config.title ?? ''}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
          />
        )
      case 'tool-input':
        return (
          <ToolInput
            blockId={blockId}
            subBlockId={config.id}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={allowExpandInPreview ? false : isDisabled}
            allowExpandInPreview={allowExpandInPreview}
          />
        )
      case 'checkbox-list':
        return (
          <CheckboxList
            blockId={blockId}
            subBlockId={config.id}
            title={config.title ?? ''}
            options={config.options as { label: string; id: string }[]}
            layout={config.layout}
            isPreview={isPreview}
            subBlockValues={subBlockValues}
            disabled={isDisabled}
          />
        )
      case 'condition-input':
        return (
          <ConditionInput
            blockId={blockId}
            subBlockId={config.id}
            isConnecting={isConnecting}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
          />
        )
      case 'eval-input':
        return (
          <EvalInput
            blockId={blockId}
            subBlockId={config.id}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
          />
        )
      case 'time-input':
        return (
          <TimeInput
            blockId={blockId}
            subBlockId={config.id}
            placeholder={config.placeholder}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
          />
        )
      case 'file-upload':
        return (
          <FileUpload
            blockId={blockId}
            subBlockId={config.id}
            acceptedTypes={config.acceptedTypes || '*'}
            multiple={config.multiple === true}
            maxSize={config.maxSize}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
          />
        )
      case 'webhook-config': {
        // For webhook config, we need to construct the value from multiple subblock values
        const webhookValue =
          isPreview && subBlockValues
            ? {
                webhookProvider: subBlockValues.webhookProvider?.value,
                webhookPath: subBlockValues.webhookPath?.value,
                providerConfig: subBlockValues.providerConfig?.value,
              }
            : previewValue

        return (
          <WebhookConfig
            blockId={blockId}
            subBlockId={config.id}
            isConnecting={isConnecting}
            isPreview={isPreview}
            value={webhookValue}
            disabled={isDisabled}
          />
        )
      }
      case 'trigger-config': {
        // For trigger config, we need to construct the value from multiple subblock values
        const triggerValue =
          isPreview && subBlockValues
            ? {
                triggerId: subBlockValues.triggerId?.value,
                triggerPath: subBlockValues.triggerPath?.value,
                triggerConfig: subBlockValues.triggerConfig?.value,
              }
            : previewValue
        return (
          <TriggerConfig
            blockId={blockId}
            isConnecting={isConnecting}
            isPreview={isPreview}
            value={triggerValue}
            disabled={isDisabled}
            availableTriggers={config.availableTriggers}
          />
        )
      }
      case 'schedule-config':
        return (
          <ScheduleConfig
            blockId={blockId}
            subBlockId={config.id}
            isConnecting={isConnecting}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
          />
        )
      case 'wait-status':
        return <WaitStatus blockId={blockId} isPreview={isPreview} disabled={isDisabled} />
      case 'oauth-input':
        return (
          <CredentialSelector
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue}
          />
        )
      case 'file-selector':
        return (
          <FileSelectorInput
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue}
            previewContextValues={subBlockValues}
          />
        )
      case 'project-selector':
        return (
          <ProjectSelectorInput
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue}
          />
        )
      case 'folder-selector':
        return (
          <FolderSelectorInput
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue}
          />
        )
      case 'knowledge-base-selector':
        return (
          <KnowledgeBaseSelector
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue}
          />
        )
      case 'knowledge-tag-filters':
        return (
          <KnowledgeTagFilters
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue}
            isConnecting={isConnecting}
          />
        )

      case 'document-tag-entry':
        return (
          <DocumentTagEntry
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue}
            isConnecting={isConnecting}
          />
        )
      case 'document-selector':
        return (
          <DocumentSelector
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue}
          />
        )
      case 'input-format': {
        return (
          <InputFormat
            blockId={blockId}
            subBlockId={config.id}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
            isConnecting={isConnecting}
            config={config}
            showValue={true}
          />
        )
      }
      case 'input-mapping': {
        return (
          <InputMapping
            blockId={blockId}
            subBlockId={config.id}
            isPreview={isPreview}
            previewValue={previewValue}
            disabled={isDisabled}
          />
        )
      }
      case 'response-format':
        return (
          <ResponseFormat
            blockId={blockId}
            subBlockId={config.id}
            isPreview={isPreview}
            previewValue={previewValue}
            isConnecting={isConnecting}
            config={config}
            disabled={isDisabled}
          />
        )
      case 'channel-selector':
        return (
          <ChannelSelectorInput
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue}
          />
        )
      case 'mcp-server-selector':
        return (
          <McpServerSelector
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue}
          />
        )
      case 'mcp-tool-selector':
        return (
          <McpToolSelector
            blockId={blockId}
            subBlock={config}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue}
          />
        )
      case 'mcp-dynamic-args':
        return (
          <McpDynamicArgs
            blockId={blockId}
            subBlockId={config.id}
            disabled={isDisabled}
            isPreview={isPreview}
            previewValue={previewValue}
          />
        )
      default:
        return <div>Unknown input type: {config.type}</div>
    }
  }

  const required = isFieldRequired()

  return (
    <div
      className={cn(
        'space-y-[6px] pt-[2px]',
        // Field-level diff highlighting - make it more prominent for testing
        fieldDiffStatus === 'changed' &&
          '-m-1 rounded-lg border border-orange-200 bg-orange-100 p-3 ring-2 ring-orange-500 dark:border-orange-800 dark:bg-orange-900/40'
      )}
      onMouseDown={handleMouseDown}
    >
      {config.type !== 'switch' && (
        <Label className='flex items-center gap-1'>
          {config.title}
          {required && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className='cursor-help text-red-500'>*</span>
              </TooltipTrigger>
              <TooltipContent side='top'>
                <p>This field is required</p>
              </TooltipContent>
            </Tooltip>
          )}
          {config.id === 'responseFormat' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertTriangle
                  className={cn(
                    'h-4 w-4 cursor-pointer text-destructive',
                    !isValidJson ? 'opacity-100' : 'opacity-0'
                  )}
                />
              </TooltipTrigger>
              <TooltipContent side='top'>
                <p>Invalid JSON</p>
              </TooltipContent>
            </Tooltip>
          )}
          {config.description && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className='h-4 w-4 cursor-pointer text-muted-foreground' />
              </TooltipTrigger>
              <TooltipContent side='top' className='max-w-[400px] select-text whitespace-pre-wrap'>
                {config.description.split('\n').map((line, idx) => (
                  <p
                    key={idx}
                    className={idx === 0 ? 'mb-1 text-sm' : 'text-muted-foreground text-xs'}
                  >
                    {line}
                  </p>
                ))}
              </TooltipContent>
            </Tooltip>
          )}
        </Label>
      )}
      {renderInput()}
    </div>
  )
}
