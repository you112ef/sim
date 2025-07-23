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

      logger.info('Applying preview to current workflow (store-first)', {
        previewId: pendingPreview?.id,
        yamlLength: pendingPreview?.yamlContent.length,
      })

      // STEP 1: Parse YAML and update local store immediately
      try {
        // Import the YAML parser
        const { parseWorkflowYaml, convertYamlToWorkflow } = await import('@/stores/workflows/yaml/importer')
        const { useWorkflowStore } = await import('@/stores/workflows/workflow/store')
        const { useSubBlockStore } = await import('@/stores/workflows/subblock/store')

        // Parse YAML content
        const { data: yamlWorkflow, errors: parseErrors } = parseWorkflowYaml(pendingPreview.yamlContent)

        if (!yamlWorkflow || parseErrors.length > 0) {
          throw new Error(`Failed to parse YAML: ${parseErrors.join(', ')}`)
        }

        // Convert YAML to workflow format  
        const { blocks, edges, errors: convertErrors } = convertYamlToWorkflow(yamlWorkflow)

        if (convertErrors.length > 0) {
          throw new Error(`Failed to convert YAML: ${convertErrors.join(', ')}`)
        }

        // Convert ImportedBlocks to workflow store format
        const { getBlock } = await import('@/blocks')
        const { generateLoopBlocks, generateParallelBlocks } = await import('@/stores/workflows/workflow/utils')
        
        const workflowBlocks: Record<string, any> = {}
        const workflowEdges: any[] = []
        const blockIdMapping = new Map<string, string>()
        
        // Process blocks - convert from array to record format
        for (const block of blocks) {
          const blockId = block.id
          blockIdMapping.set(block.id, blockId)
          
          const blockConfig = getBlock(block.type)
          
          if (!blockConfig && (block.type === 'loop' || block.type === 'parallel')) {
            // Handle loop/parallel blocks
            workflowBlocks[blockId] = {
              id: blockId,
              type: block.type,
              name: block.name,
              position: block.position,
              subBlocks: {},
              outputs: {},
              enabled: true,
              horizontalHandles: true,
              isWide: false,
              height: 0,
              data: (block as any).data || {},
            }
          } else if (blockConfig) {
            // Handle regular blocks with proper subBlocks setup
            const subBlocks: Record<string, any> = {}
            
            // Set up subBlocks from block configuration
            blockConfig.subBlocks.forEach((subBlock) => {
              subBlocks[subBlock.id] = {
                id: subBlock.id,
                type: subBlock.type,
                value: (block as any).inputs?.[subBlock.id] || null,
              }
            })
            
            workflowBlocks[blockId] = {
              id: blockId,
              type: block.type,
              name: block.name,
              position: block.position,
              subBlocks,
              outputs: (block as any).outputs || {},
              enabled: true,
              horizontalHandles: true,
              isWide: false,
              height: 0,
              data: (block as any).data || {},
            }
          }
        }
        
        // Process edges
        for (const edge of edges) {
          workflowEdges.push({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            sourceHandle: edge.sourceHandle,
            targetHandle: edge.targetHandle,
            type: edge.type || 'default',
          })
        }

        // Generate loops and parallels
        const loops = generateLoopBlocks(workflowBlocks)
        const parallels = generateParallelBlocks(workflowBlocks)

        // Apply auto layout using the shared utility
        const { applyAutoLayoutToBlocks } = await import('../../utils/auto-layout')
        const layoutResult = await applyAutoLayoutToBlocks(workflowBlocks, workflowEdges)
        
        const layoutedBlocks = layoutResult.success ? layoutResult.layoutedBlocks! : workflowBlocks
        
        if (layoutResult.success) {
          logger.info('Successfully applied auto layout to preview blocks')
        } else {
          logger.warn('Auto layout failed, using original positions:', layoutResult.error)
        }

        // Update workflow store immediately
        const workflowStore = useWorkflowStore.getState()
        const newWorkflowState = {
          blocks: layoutedBlocks,
          edges: workflowEdges,
          loops,
          parallels,
          lastSaved: Date.now(),
          isDeployed: workflowStore.isDeployed,
          deployedAt: workflowStore.deployedAt,
          deploymentStatuses: workflowStore.deploymentStatuses,
          hasActiveWebhook: workflowStore.hasActiveWebhook,
        }

        useWorkflowStore.setState(newWorkflowState)

        // Extract and update subblock values
        const subblockValues: Record<string, Record<string, any>> = {}
        Object.entries(layoutedBlocks).forEach(([blockId, block]) => {
          subblockValues[blockId] = {}
          Object.entries(block.subBlocks || {}).forEach(([subblockId, subblock]) => {
            subblockValues[blockId][subblockId] = (subblock as any).value
          })
        })

        // Update subblock store
        useSubBlockStore.setState((state) => ({
          workflowValues: {
            ...state.workflowValues,
            [activeWorkflowId]: subblockValues,
          },
        }))

        logger.info('Successfully updated local stores with preview changes')

      } catch (storeError) {
        logger.error('Failed to update local stores:', storeError)
        throw new Error(`Store update failed: ${storeError instanceof Error ? storeError.message : 'Unknown error'}`)
      }

      // STEP 2: Save to database (in background, don't await to keep UI responsive)
      const saveToDatabase = async () => {
        try {
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

          logger.info('Successfully saved preview to database:', { 
            previewId: pendingPreview?.id,
            blocksCount: result.data?.blocksCount,
            edgesCount: result.data?.edgesCount,
          })
        } catch (dbError) {
          logger.error('Failed to save preview to database (store already updated):', dbError)
          // Don't throw - the store is already updated, so the UI is correct
          // The socket will eventually sync when the database is available
        }
      }

      // Save to database without blocking UI
      saveToDatabase()

      // STEP 3: Only dismiss preview after successful store update (user has accepted)
      if (pendingPreview) {
        logger.info('Accepting preview:', { previewId: pendingPreview.id })
        previewStore.acceptPreview(pendingPreview.id)
        logger.info('Preview accepted, closing modal')
      }
      setShowModal(false)

      logger.info('Successfully applied preview to current workflow (store-first):', { 
        previewId: pendingPreview?.id,
      })

    } catch (error) {
      logger.error('Failed to apply preview:', error)
      throw error
    } finally {
      setIsProcessing(false)
    }
  }, [activeWorkflowId, pendingPreview, previewStore])

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
                  <span className='font-medium text-sm'>Copilot has proposed changes</span>
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