'use client'

import { useState } from 'react'
import { Eye, Maximize2, Minimize2, Save, CheckCircle, X, AlertCircle, XCircle, ChevronDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { WorkflowPreview } from '@/app/workspace/[workspaceId]/w/components/workflow-preview/workflow-preview'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('CopilotSandboxModal')

interface CopilotSandboxModalProps {
  isOpen: boolean
  onClose: () => void
  proposedWorkflowState: WorkflowState | null
  yamlContent: string
  description?: string
  onApplyToCurrentWorkflow: () => Promise<void>
  onSaveAsNewWorkflow: (name: string) => Promise<void>
  onReject?: () => Promise<void>
  isProcessing?: boolean
}

export function CopilotSandboxModal({
  isOpen,
  onClose,
  proposedWorkflowState,
  yamlContent,
  description,
  onApplyToCurrentWorkflow,
  onSaveAsNewWorkflow,
  onReject,
  isProcessing = false,
}: CopilotSandboxModalProps) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [saveAsNewMode, setSaveAsNewMode] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [isRejecting, setIsRejecting] = useState(false)

  const { workflows, activeWorkflowId } = useWorkflowRegistry()
  const currentWorkflow = activeWorkflowId ? workflows[activeWorkflowId] : null

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen)
  }

  const handleApplyToCurrentWorkflow = async () => {
    try {
      setIsApplying(true)
      await onApplyToCurrentWorkflow()
      onClose()
    } catch (error) {
      logger.error('Failed to apply workflow changes:', error)
    } finally {
      setIsApplying(false)
    }
  }

  const handleSaveAsNewWorkflow = async () => {
    try {
      setIsSaving(true)
      // Generate auto name based on description or use default
      const autoName = description 
        ? `${description.slice(0, 50)}${description.length > 50 ? '...' : ''}`
        : 'Copilot Generated Workflow'
      await onSaveAsNewWorkflow(autoName)
      onClose()
    } catch (error) {
      logger.error('Failed to save as new workflow:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleReject = async () => {
    if (!onReject) {
      handleClose()
      return
    }

    try {
      setIsRejecting(true)
      await onReject()
      onClose()
    } catch (error) {
      logger.error('Failed to reject workflow:', error)
    } finally {
      setIsRejecting(false)
    }
  }

  const handleClose = () => {
    setSaveAsNewMode(false)
    onClose()
  }

  if (!proposedWorkflowState) {
    return null
  }

  const blockCount = Object.keys(proposedWorkflowState.blocks || {}).length
  const edgeCount = proposedWorkflowState.edges?.length || 0

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent
        className={cn(
          'flex flex-col gap-0 p-0',
          isFullscreen
            ? 'h-[100vh] max-h-[100vh] w-[100vw] max-w-[100vw] rounded-none'
            : 'h-[90vh] max-h-[90vh] w-[95vw] max-w-[95vw] overflow-hidden'
        )}
        hideCloseButton={true}
      >
        {/* Header */}
        <DialogHeader className='flex flex-row items-center justify-between border-b bg-background p-4'>
          <div className='flex items-center gap-3'>
            <div className='flex h-8 w-8 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900'>
              <Eye className='h-4 w-4 text-purple-600 dark:text-purple-400' />
            </div>
            <div>
              <DialogTitle className='font-semibold text-foreground text-lg'>
                Workflow Preview - Copilot Proposal
              </DialogTitle>
              <div className='mt-1 flex items-center gap-2'>
                {description && (
                  <span className='text-muted-foreground text-sm'>{description}</span>
                )}
                <Badge variant='secondary' className='text-xs'>
                  {blockCount} blocks, {edgeCount} connections
                </Badge>
                <Badge variant='outline' className='text-xs'>
                  Sandbox
                </Badge>
              </div>
            </div>
          </div>

          <div className='flex items-center gap-2'>
            <Button variant='ghost' size='sm' onClick={toggleFullscreen} className='h-8 w-8 p-0'>
              {isFullscreen ? <Minimize2 className='h-4 w-4' /> : <Maximize2 className='h-4 w-4' />}
            </Button>
            <Button variant='ghost' size='sm' onClick={handleClose} className='h-8 w-8 p-0'>
              <X className='h-4 w-4' />
            </Button>
          </div>
        </DialogHeader>

        {/* Preview Container */}
        <div className='min-h-0 flex-1 bg-gray-50 dark:bg-gray-900'>
          <WorkflowPreview
            workflowState={proposedWorkflowState}
            showSubBlocks={true}
            height='100%'
            width='100%'
            isPannable={true}
          />
        </div>



        {/* Action Buttons */}
        <div className='border-t bg-background px-6 py-4'>
          <div className='flex items-center justify-between'>
            <div className='text-muted-foreground text-sm'>
              💡 This is a preview of the workflow the copilot wants to create. Choose how to proceed.
            </div>
            
            <div className='flex items-center gap-3'>
              <Button
                variant='outline'
                onClick={handleReject}
                disabled={isProcessing || isSaving || isApplying || isRejecting}
                className='text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950'
              >
                {isRejecting ? (
                  <>
                    <div className='mr-2 h-3 w-3 animate-spin rounded-full border-2 border-red-300 border-t-red-600' />
                    Rejecting...
                  </>
                ) : (
                  <>
                    <XCircle className='mr-2 h-4 w-4' />
                    Reject
                  </>
                )}
              </Button>
              {/* Split Accept Button - GitHub Style */}
              <div className='flex items-stretch'>
                {/* Main Button - toggles between Accept and Save as New */}
                <Button
                  onClick={saveAsNewMode ? handleSaveAsNewWorkflow : handleApplyToCurrentWorkflow}
                  disabled={isProcessing || isSaving || isApplying || isRejecting}
                  className={saveAsNewMode 
                    ? 'bg-gray-600 hover:bg-gray-700 rounded-r-none border-r border-gray-500' 
                    : 'bg-purple-600 hover:bg-purple-700 rounded-r-none border-r border-purple-500'
                  }
                >
                  {(saveAsNewMode ? isSaving : isApplying) ? (
                    <>
                      <div className='mr-2 h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-white' />
                      {saveAsNewMode ? 'Saving...' : 'Applying...'}
                    </>
                  ) : (
                    <>
                      {saveAsNewMode ? <Save className='mr-2 h-4 w-4' /> : <CheckCircle className='mr-2 h-4 w-4' />}
                      {saveAsNewMode ? 'Save as New Workflow' : 'Accept'}
                    </>
                  )}
                </Button>
                
                {/* Dropdown Arrow Button */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant='default'
                      size='sm'
                      disabled={isProcessing || isSaving || isApplying || isRejecting}
                      className={saveAsNewMode 
                        ? 'bg-gray-600 hover:bg-gray-700 rounded-l-none border-l-0 px-2 h-10' 
                        : 'bg-purple-600 hover:bg-purple-700 rounded-l-none border-l-0 px-2 h-10'
                      }
                    >
                      <ChevronDown className='h-4 w-4' />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end' className='w-56'>
                    <DropdownMenuItem
                      onClick={() => setSaveAsNewMode(!saveAsNewMode)}
                      className='cursor-pointer'
                    >
                      {saveAsNewMode ? (
                        <>
                          <CheckCircle className='mr-2 h-4 w-4' />
                          Accept (Apply to Current)
                        </>
                      ) : (
                        <>
                          <Save className='mr-2 h-4 w-4' />
                          Save as New Workflow
                        </>
                      )}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>

          {/* Warning for current workflow changes */}
          {currentWorkflow && !saveAsNewMode && (
            <div className='mt-3 flex items-start gap-2 rounded-md bg-amber-50 p-3 dark:bg-amber-900/20'>
              <AlertCircle className='mt-0.5 h-4 w-4 text-amber-600 dark:text-amber-400' />
              <div className='text-sm'>
                <p className='font-medium text-amber-800 dark:text-amber-200'>
                  This will replace your current workflow: "{currentWorkflow.name}"
                </p>
                <p className='text-amber-700 dark:text-amber-300'>
                  A checkpoint will be created automatically so you can revert if needed.
                </p>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
} 