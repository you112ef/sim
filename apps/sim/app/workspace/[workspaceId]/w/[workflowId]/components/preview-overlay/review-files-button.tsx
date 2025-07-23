'use client'

import { useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Eye, FileText, CheckCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { usePreviewStore } from '@/stores/copilot/preview-store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useCopilotStore } from '@/stores/copilot/store'
import { CopilotSandboxModal } from '../copilot-sandbox-modal/copilot-sandbox-modal'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('ReviewFilesButton')

export function ReviewFilesButton() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const { activeWorkflowId, createWorkflow } = useWorkflowRegistry()
  const previewStore = usePreviewStore()
  const { currentChat } = useCopilotStore()
  const [showModal, setShowModal] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)

  // Get the latest pending preview for the current workflow and chat session
  // Using the store object directly to ensure reactivity
  const pendingPreview = activeWorkflowId ? previewStore.getLatestPendingPreview(activeWorkflowId, currentChat?.id) : null

  // Debug logging
  logger.info('ReviewFilesButton render:', {
    activeWorkflowId,
    currentChatId: currentChat?.id,
    hasPendingPreview: !!pendingPreview,
    previewId: pendingPreview?.id,
    previewStatus: pendingPreview?.status,
    totalPreviews: Object.keys(previewStore.previews).length,
    allPreviewIds: Object.keys(previewStore.previews),
  })

  const handleApplyToCurrentWorkflow = useCallback(async () => {
    if (!activeWorkflowId || !pendingPreview?.yamlContent) {
      throw new Error('No active workflow or YAML content')
    }

    try {
      setIsProcessing(true)

      logger.info('Applying preview to current workflow', {
        workflowId: activeWorkflowId,
        previewId: pendingPreview?.id,
        yamlLength: pendingPreview?.yamlContent.length,
      })

      // Use the existing YAML endpoint to apply the changes
      const response = await fetch(`/api/workflows/${activeWorkflowId}/yaml`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          yamlContent: pendingPreview?.yamlContent,
          description: pendingPreview?.description || 'Applied copilot proposal',
          source: 'copilot',
          applyAutoLayout: true,
          createCheckpoint: true, // Always create checkpoints for copilot changes
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || `Failed to apply workflow: ${response.statusText}`)
      }

      const result = await response.json()
      
      if (!result.success) {
        throw new Error(result.message || 'Failed to apply workflow changes')
      }

      if (pendingPreview) {
        logger.info('Accepting preview:', { previewId: pendingPreview.id })
        previewStore.acceptPreview(pendingPreview.id)
        logger.info('Preview accepted, closing modal')
      }
      setShowModal(false)
      
      logger.info('Successfully applied preview to current workflow:', { 
        previewId: pendingPreview?.id,
        blocksCount: result.data?.blocksCount,
        edgesCount: result.data?.edgesCount,
      })

    } catch (error) {
      logger.error('Failed to apply preview:', error)
      throw error
    } finally {
      setIsProcessing(false)
    }
  }, [activeWorkflowId, pendingPreview, acceptPreview])

  const handleSaveAsNewWorkflow = useCallback(async (name: string) => {
    if (!pendingPreview?.yamlContent) {
      throw new Error('No YAML content to save')
    }

    try {
      setIsProcessing(true)

      logger.info('Creating new workflow from preview', {
        name,
        previewId: pendingPreview.id,
        yamlLength: pendingPreview.yamlContent.length,
      })

      // First create a new workflow
      const newWorkflowId = await createWorkflow({
        name,
        description: pendingPreview.description,
        workspaceId,
      })

      if (!newWorkflowId) {
        throw new Error('Failed to create new workflow')
      }

      // Then apply the YAML content to the new workflow
      const response = await fetch(`/api/workflows/${newWorkflowId}/yaml`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          yamlContent: pendingPreview.yamlContent,
          description: pendingPreview.description || 'Created from copilot proposal',
          source: 'copilot',
          applyAutoLayout: true,
          createCheckpoint: false, // No need for checkpoint on new workflow
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || `Failed to save workflow: ${response.statusText}`)
      }

      const result = await response.json()
      
      if (!result.success) {
        throw new Error(result.message || 'Failed to save workflow')
      }

      logger.info('Accepting preview after save as new:', { previewId: pendingPreview.id })
      previewStore.acceptPreview(pendingPreview.id)
      setShowModal(false)
      
      logger.info('Successfully created new workflow from preview:', { 
        newWorkflowId,
        name,
        previewId: pendingPreview.id,
        blocksCount: result.data?.blocksCount,
        edgesCount: result.data?.edgesCount,
      })

    } catch (error) {
      logger.error('Failed to save preview as new workflow:', error)
      throw error
    } finally {
      setIsProcessing(false)
    }
  }, [pendingPreview, createWorkflow, workspaceId, previewStore])

  // Early return after all hooks are defined
  if (!pendingPreview) {
    return null
  }

  const handleShowPreview = () => {
    logger.info('Opening preview modal for pending preview:', {
      previewId: pendingPreview.id,
      workflowId: pendingPreview.workflowId,
    })
    setShowModal(true)
  }

  const handleReject = () => {
    if (pendingPreview) {
      logger.info('Rejecting preview:', { previewId: pendingPreview.id })
      previewStore.rejectPreview(pendingPreview.id)
      logger.info('Preview rejected, closing modal')
    }
    setShowModal(false)
    logger.info('Rejected preview:', { previewId: pendingPreview?.id })
  }

  const blockCount = Object.keys(pendingPreview.workflowState?.blocks || {}).length
  const edgeCount = pendingPreview.workflowState?.edges?.length || 0

  return (
    <>
      {/* Review Files Button */}
      <div className='fixed bottom-6 left-1/2 z-30 -translate-x-1/2'>
        <div className='rounded-lg border bg-background/95 p-3 shadow-lg backdrop-blur-sm'>
          <div className='flex items-center gap-3'>
            <div className='flex items-center gap-2'>
              <div className='flex h-8 w-8 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900'>
                <Eye className='h-4 w-4 text-purple-600 dark:text-purple-400' />
              </div>
              <div className='flex flex-col gap-1'>
                <div className='flex items-center gap-2'>
                  <span className='font-medium text-sm'></span>
                  <Badge variant='secondary' className='text-xs'>
                    {blockCount} blocks, {edgeCount} connections
                  </Badge>
                </div>
                {pendingPreview.description && (
                  <span className='text-muted-foreground text-xs'>{pendingPreview.description}</span>
                )}
              </div>
            </div>

            <div className='flex items-center gap-2'>
              <Button
                variant='outline'
                size='sm'
                onClick={handleReject}
                className='h-8 px-3'
              >
                <X className='mr-1 h-3 w-3' />
                Reject
              </Button>
              <Button
                variant='default'
                size='sm'
                onClick={handleShowPreview}
                className='h-8 bg-purple-600 px-3 hover:bg-purple-700'
              >
                <FileText className='mr-1 h-3 w-3' />
                Review Files
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Sandbox Modal */}
      {showModal && (
        <CopilotSandboxModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          proposedWorkflowState={pendingPreview.workflowState}
          yamlContent={pendingPreview.yamlContent}
          description={pendingPreview.description}
          onApplyToCurrentWorkflow={handleApplyToCurrentWorkflow}
          onSaveAsNewWorkflow={handleSaveAsNewWorkflow}
          isProcessing={isProcessing}
        />
      )}
    </>
  )
} 