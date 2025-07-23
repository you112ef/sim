'use client'

import { useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Eye, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopilotSandboxModal } from './copilot-sandbox-modal/copilot-sandbox-modal'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useCopilotStore } from '@/stores/copilot/store'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('ReviewButton')

// Backward compatibility exports (deprecated)
export function setLatestPreview() {}
export function clearLatestPreview() {}
export function getLatestUnseenPreview() { return null }

export function ReviewButton() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const { activeWorkflowId, createWorkflow } = useWorkflowRegistry()
  const { currentChat, sendImplicitFeedback, clearPreviewYaml } = useCopilotStore()
  const [showModal, setShowModal] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [previewWorkflowState, setPreviewWorkflowState] = useState<any>(null)

  // Check if current chat has preview YAML
  const hasPreview = currentChat?.previewYaml !== null && currentChat?.previewYaml !== undefined

  // Only show if there's a preview YAML in the current chat
  if (!hasPreview) {
    return null
  }

  const handleShowPreview = async () => {
    if (!currentChat?.previewYaml) return
    
    try {
      // Validate YAML content before sending
      const yamlContent = currentChat.previewYaml.trim()
      if (!yamlContent) {
        throw new Error('Preview YAML content is empty')
      }

      logger.info('Generating preview with YAML content (first 200 chars):', yamlContent.substring(0, 200))
      
      // Generate workflow state from YAML for the modal
      const response = await fetch('/api/workflows/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          yamlContent,
          applyAutoLayout: true,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.error('Preview API response not ok:', { status: response.status, statusText: response.statusText, errorText })
        throw new Error(`Failed to generate preview: ${response.status} ${response.statusText}`)
      }

      const result = await response.json()
      
      if (!result.success) {
        logger.error('Preview API returned error:', result)
        throw new Error(result.message || 'Failed to generate preview')
      }

      // Set the generated workflow state and open modal
      setPreviewWorkflowState(result.workflowState)
      setShowModal(true)
    } catch (error) {
      logger.error('Failed to generate preview for modal:', {
        error: error instanceof Error ? error.message : String(error),
        yamlLength: currentChat?.previewYaml?.length,
        yamlPreview: currentChat?.previewYaml?.substring(0, 100)
      })
      // TODO: Show user-friendly error message
    }
  }

  const handleApply = async () => {
    if (!currentChat?.previewYaml) return
    
    try {
      setIsProcessing(true)

      logger.info('Applying preview to current workflow (store-first)', {
        workflowId: activeWorkflowId,
        yamlLength: currentChat.previewYaml.length,
      })

      // STEP 1: Parse YAML and update local store immediately
      try {
        // Import the necessary modules
        const { parseWorkflowYaml, convertYamlToWorkflow } = await import('@/stores/workflows/yaml/importer')
        const { useWorkflowStore } = await import('@/stores/workflows/workflow/store')
        const { useSubBlockStore } = await import('@/stores/workflows/subblock/store')
        const { getBlock } = await import('@/blocks')
        const { generateLoopBlocks, generateParallelBlocks } = await import('@/stores/workflows/workflow/utils')

        // Parse YAML content
        const { data: yamlWorkflow, errors: parseErrors } = parseWorkflowYaml(currentChat.previewYaml)

        if (!yamlWorkflow || parseErrors.length > 0) {
          throw new Error(`Failed to parse YAML: ${parseErrors.join(', ')}`)
        }

        // Convert YAML to workflow format  
        const { blocks, edges, errors: convertErrors } = convertYamlToWorkflow(yamlWorkflow)

        if (convertErrors.length > 0) {
          throw new Error(`Failed to convert YAML: ${convertErrors.join(', ')}`)
        }

        // Convert ImportedBlocks to workflow store format
        const workflowBlocks: Record<string, any> = {}
        const workflowEdges: any[] = []

        // Process blocks
        for (const block of blocks) {
          const blockConfig = getBlock(block.type)
          if (blockConfig) {
            const subBlocks: Record<string, any> = {}

            // Set up subBlocks from block configuration
            blockConfig.subBlocks.forEach((subBlock) => {
              const yamlValue = block.inputs[subBlock.id]
              subBlocks[subBlock.id] = {
                id: subBlock.id,
                type: subBlock.type,
                value: yamlValue !== undefined ? yamlValue : null,
              }
            })

            // Also ensure we have subBlocks for any YAML inputs not in block config
            Object.keys(block.inputs).forEach((inputKey) => {
              if (!subBlocks[inputKey]) {
                subBlocks[inputKey] = {
                  id: inputKey,
                  type: 'short-input',
                  value: block.inputs[inputKey],
                }
              }
            })

            const outputs = blockConfig.outputs || {}

            workflowBlocks[block.id] = {
              id: block.id,
              type: block.type,
              name: block.name,
              position: block.position || { x: 0, y: 0 },
              subBlocks,
              outputs,
              enabled: true,
              horizontalHandles: true,
              isWide: false,
              height: 0,
              data: block.data || {},
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
        const { applyAutoLayoutToBlocks } = await import('../utils/auto-layout')
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
        Object.values(layoutedBlocks).forEach((block: any) => {
          if (block.subBlocks) {
            const blockValues: Record<string, any> = {}
            Object.entries(block.subBlocks).forEach(([subBlockId, subBlock]: [string, any]) => {
              if (subBlock.value !== undefined && subBlock.value !== null) {
                blockValues[subBlockId] = subBlock.value
              }
            })
            if (Object.keys(blockValues).length > 0) {
              subblockValues[block.id] = blockValues
            }
          }
        })

        // Update subblock store
        if (Object.keys(subblockValues).length > 0) {
          useSubBlockStore.setState((state) => ({
            workflowValues: {
              ...state.workflowValues,
              [activeWorkflowId!]: subblockValues,
            },
          }))
        }

        logger.info('Successfully updated local stores with preview content')

      } catch (parseError) {
        logger.error('Failed to parse and apply preview locally:', parseError)
        throw parseError
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
              yamlContent: currentChat.previewYaml,
              description: 'Applied copilot proposal',
              source: 'copilot',
              applyAutoLayout: true,
              createCheckpoint: true,
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

          logger.info('Successfully saved preview to database')
        } catch (dbError) {
          logger.error('Failed to save preview to database (store already updated):', dbError)
          // Don't throw - the store is already updated, so the UI is correct
          // The socket will eventually sync when the database is available
        }
      }

      // Save to database without blocking UI
      saveToDatabase()

      // STEP 3: Clear preview YAML after successful store update (user has accepted)
      console.log('Clearing preview YAML after successful apply')
      await clearPreviewYaml()
      console.log('Preview YAML cleared, closing modal')
      setShowModal(false)
      setPreviewWorkflowState(null)
      
      // Continue the copilot conversation with acceptance message
      await sendImplicitFeedback(
        'The user has accepted and applied the workflow changes. Please provide an acknowledgement.',
        'applied'
      )
    } catch (error) {
      logger.error('Failed to apply preview:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleSaveAsNew = async (name: string) => {
    if (!currentChat?.previewYaml) {
      logger.error('No YAML content to save')
      return
    }

    try {
      setIsProcessing(true)

      logger.info('Creating new workflow from preview', {
        name,
        yamlLength: currentChat.previewYaml.length,
      })

      // First create a new workflow
      const newWorkflowId = await createWorkflow({
        name,
        description: 'Created from copilot proposal',
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
          yamlContent: currentChat.previewYaml,
          description: 'Created from copilot proposal',
          source: 'copilot',
          applyAutoLayout: true,
          createCheckpoint: false,
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

      logger.info('Successfully created new workflow from preview')
      await clearPreviewYaml()
      setShowModal(false)
      setPreviewWorkflowState(null)
      
      // Continue the copilot conversation with save as new message  
      await sendImplicitFeedback(
        `The user has saved the workflow changes as a new workflow named "${name}". Please continue.`,
        'applied'
      )
    } catch (error) {
      logger.error('Failed to save preview as new workflow:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleReject = async () => {
    if (!currentChat?.previewYaml) return
    
    try {
      setIsProcessing(true)
      await clearPreviewYaml()
      setShowModal(false)
      setPreviewWorkflowState(null)
      
      // Continue the copilot conversation with rejection message
      await sendImplicitFeedback(
        'The user has rejected the workflow changes. Please continue.',
        'rejected'
      )
    } catch (error) {
      logger.error('Failed to reject preview:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleClose = () => {
    setShowModal(false)
    setPreviewWorkflowState(null)
  }

  // Create preview data for the sandbox modal
  const previewData = currentChat?.previewYaml && previewWorkflowState ? {
    workflowState: previewWorkflowState,
    yamlContent: currentChat.previewYaml,
    description: 'Copilot generated workflow preview'
  } : null

  return (
    <>
      {/* Simple button at bottom center */}
      <div className='fixed bottom-20 left-1/2 z-30 -translate-x-1/2'>
        <div className='rounded-lg border bg-background/95 p-3 shadow-lg backdrop-blur-sm'>
          <div className='flex items-center gap-3'>
            <div className='flex items-center gap-2'>
              <div className='flex h-8 w-8 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900'>
                <Eye className='h-4 w-4 text-purple-600 dark:text-purple-400' />
              </div>
              <span className='font-medium text-sm'>Copilot has proposed changes</span>
            </div>
            <Button
              variant='default'
              size='sm'
              onClick={handleShowPreview}
              className='h-8 bg-purple-600 px-3 hover:bg-purple-700'
            >
              <FileText className='mr-1 h-3 w-3' />
              Review Changes
            </Button>
          </div>
        </div>
      </div>

      {/* Sandbox Modal */}
      {showModal && previewData && (
        <CopilotSandboxModal
          isOpen={showModal}
          onClose={handleClose}
          proposedWorkflowState={previewData.workflowState}
          yamlContent={previewData.yamlContent}
          description={previewData.description}
          onApplyToCurrentWorkflow={handleApply}
          onSaveAsNewWorkflow={handleSaveAsNew}
          onReject={handleReject}
          isProcessing={isProcessing}
        />
      )}
    </>
  )
} 