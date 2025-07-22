'use client'

import { useState } from 'react'
import { Eye, Maximize2, Minimize2, Save, CheckCircle, X, AlertCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  isProcessing = false,
}: CopilotSandboxModalProps) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showSaveAsNew, setShowSaveAsNew] = useState(false)
  const [newWorkflowName, setNewWorkflowName] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isApplying, setIsApplying] = useState(false)

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
    if (!newWorkflowName.trim()) {
      return
    }

    try {
      setIsSaving(true)
      await onSaveAsNewWorkflow(newWorkflowName.trim())
      onClose()
    } catch (error) {
      logger.error('Failed to save as new workflow:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleClose = () => {
    setShowSaveAsNew(false)
    setNewWorkflowName('')
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
            : 'h-[90vh] max-h-[90vh] overflow-hidden sm:max-w-[1200px]'
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

        {/* Save As New Workflow Form */}
        {showSaveAsNew && (
          <div className='border-t bg-background p-4'>
            <div className='space-y-3'>
              <Label htmlFor='workflow-name' className='text-sm font-medium'>
                New Workflow Name
              </Label>
              <Input
                id='workflow-name'
                placeholder='Enter workflow name...'
                value={newWorkflowName}
                onChange={(e) => setNewWorkflowName(e.target.value)}
                className='w-full'
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newWorkflowName.trim()) {
                    handleSaveAsNewWorkflow()
                  }
                  if (e.key === 'Escape') {
                    setShowSaveAsNew(false)
                  }
                }}
              />
              <div className='flex justify-end gap-2'>
                <Button 
                  variant='outline' 
                  size='sm' 
                  onClick={() => setShowSaveAsNew(false)}
                  disabled={isSaving}
                >
                  Cancel
                </Button>
                <Button 
                  size='sm' 
                  onClick={handleSaveAsNewWorkflow}
                  disabled={!newWorkflowName.trim() || isSaving}
                >
                  {isSaving ? (
                    <>
                      <div className='mr-2 h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-white' />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className='mr-2 h-3 w-3' />
                      Save Workflow
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className='border-t bg-background px-6 py-4'>
          <div className='flex items-center justify-between'>
            <div className='text-muted-foreground text-sm'>
              💡 This is a preview of the workflow the copilot wants to create. Choose how to proceed.
            </div>
            
            <div className='flex items-center gap-3'>
              <Button
                variant='outline'
                onClick={() => setShowSaveAsNew(true)}
                disabled={isProcessing || showSaveAsNew || isSaving || isApplying}
              >
                <Save className='mr-2 h-4 w-4' />
                Save as New Workflow
              </Button>

              <Button
                onClick={handleApplyToCurrentWorkflow}
                disabled={isProcessing || showSaveAsNew || isSaving || isApplying}
                className='bg-purple-600 hover:bg-purple-700'
              >
                {isApplying ? (
                  <>
                    <div className='mr-2 h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-white' />
                    Applying...
                  </>
                ) : (
                  <>
                    <CheckCircle className='mr-2 h-4 w-4' />
                    Apply to Current Workflow
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Warning for current workflow changes */}
          {currentWorkflow && !showSaveAsNew && (
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