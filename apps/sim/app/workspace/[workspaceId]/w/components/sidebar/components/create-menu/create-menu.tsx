'use client'

import { useState } from 'react'
import { logger } from '@sentry/nextjs'
import { File, Folder, Plus, Upload } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useFolderStore } from '@/stores/folders/store'
import { parseWorkflowJSON, createWorkflowFromJSON } from '@/lib/workflows/import-export'

interface CreateMenuProps {
  onCreateWorkflow: (folderId?: string) => void
  isCollapsed?: boolean
  isCreatingWorkflow?: boolean
}

export function CreateMenu({
  onCreateWorkflow,
  isCollapsed,
  isCreatingWorkflow = false,
}: CreateMenuProps) {
  const [showFolderDialog, setShowFolderDialog] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [isHoverOpen, setIsHoverOpen] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [importJson, setImportJson] = useState('')
  const [isImporting, setIsImporting] = useState(false)

  const params = useParams()
  const workspaceId = params.workspaceId as string
  const router = useRouter()
  const { createFolder } = useFolderStore()

  const handleCreateWorkflow = () => {
    setIsHoverOpen(false)
    onCreateWorkflow()
  }

  const handleCreateFolder = () => {
    setIsHoverOpen(false)
    setShowFolderDialog(true)
  }

  const handleFolderSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!folderName.trim() || !workspaceId) return

    setIsCreating(true)
    try {
      await createFolder({
        name: folderName.trim(),
        workspaceId: workspaceId,
      })
      setFolderName('')
      setShowFolderDialog(false)
    } catch (error) {
      logger.error('Failed to create folder:', { error })
    } finally {
      setIsCreating(false)
    }
  }

  const handleCancel = () => {
    setFolderName('')
    setShowFolderDialog(false)
  }

  const handleImportWorkflow = () => {
    setIsHoverOpen(false)
    setShowImportDialog(true)
  }

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!importJson.trim()) return

    setIsImporting(true)
    try {
      const workflowData = parseWorkflowJSON(importJson.trim())

      const workflowId = await createWorkflowFromJSON(workflowData, {
        workspaceId,
        namePrefix: 'Imported'
      })
      
      // Navigate to the new workflow
      router.push(`/workspace/${workspaceId}/w/${workflowId}`)
      
      logger.info(`Successfully imported workflow: ${workflowData.metadata.name}`)
      setImportJson('')
      setShowImportDialog(false)
    } catch (error) {
      logger.error('Failed to import workflow:', { error })
    } finally {
      setIsImporting(false)
    }
  }

  const handleImportCancel = () => {
    setImportJson('')
    setShowImportDialog(false)
  }

  return (
    <>
      <Popover open={isHoverOpen}>
        <PopoverTrigger asChild>
          <Button
            variant='ghost'
            size='icon'
            className='h-6 w-6 shrink-0 p-0 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
            title='Create'
            onClick={handleCreateWorkflow}
            onMouseEnter={() => setIsHoverOpen(true)}
            onMouseLeave={() => setIsHoverOpen(false)}
            disabled={isCreatingWorkflow}
          >
            <Plus
              className={cn(
                'stroke-[2px]',
                isCollapsed ? 'h-[18px] w-[18px]' : 'h-[16px] w-[16px]'
              )}
            />
            <span className='sr-only'>Create</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align={isCollapsed ? 'center' : 'end'}
          side={isCollapsed ? 'right' : undefined}
          sideOffset={0}
          className={cn(
            'fade-in-0 zoom-in-95 data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
            'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
            'z-50 animate-in overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
            'data-[state=closed]:animate-out',
            'w-40'
          )}
          onMouseEnter={() => setIsHoverOpen(true)}
          onMouseLeave={() => setIsHoverOpen(false)}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <button
            className={cn(
              'flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors',
              isCreatingWorkflow
                ? 'cursor-not-allowed opacity-50'
                : 'hover:bg-accent hover:text-accent-foreground'
            )}
            onClick={handleCreateWorkflow}
            disabled={isCreatingWorkflow}
          >
            <File className='h-4 w-4' />
            {isCreatingWorkflow ? 'Creating...' : 'New Workflow'}
          </button>
          <button
            className='flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground'
            onClick={handleCreateFolder}
          >
            <Folder className='h-4 w-4' />
            New Folder
          </button>
          <button
            className={cn(
              'flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors',
              isImporting
                ? 'cursor-not-allowed opacity-50'
                : 'hover:bg-accent hover:text-accent-foreground'
            )}
            onClick={handleImportWorkflow}
            disabled={isImporting}
          >
            <Upload className='h-4 w-4' />
            {isImporting ? 'Importing...' : 'Import from JSON'}
          </button>
        </PopoverContent>
      </Popover>

      {/* Import workflow dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className='sm:max-w-[600px]'>
          <DialogHeader>
            <DialogTitle>Import Workflow from JSON</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleImportSubmit} className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='workflow-json'>Workflow JSON</Label>
              <Textarea
                id='workflow-json'
                value={importJson}
                onChange={(e) => setImportJson(e.target.value)}
                placeholder='Paste your workflow JSON here...'
                className='min-h-[300px] font-mono text-sm'
                autoFocus
                required
              />
              <p className='text-muted-foreground text-sm'>
                Paste the exported workflow JSON data to import it as a new workflow.
              </p>
            </div>
            <div className='flex justify-end space-x-2'>
              <Button type='button' variant='outline' onClick={handleImportCancel}>
                Cancel
              </Button>
              <Button type='submit' disabled={!importJson.trim() || isImporting}>
                {isImporting ? 'Importing...' : 'Import Workflow'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Folder creation dialog */}
      <Dialog open={showFolderDialog} onOpenChange={setShowFolderDialog}>
        <DialogContent className='sm:max-w-[425px]'>
          <DialogHeader>
            <DialogTitle>Create New Folder</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleFolderSubmit} className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='folder-name'>Folder Name</Label>
              <Input
                id='folder-name'
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                placeholder='Enter folder name...'
                autoFocus
                required
              />
            </div>
            <div className='flex justify-end space-x-2'>
              <Button type='button' variant='outline' onClick={handleCancel}>
                Cancel
              </Button>
              <Button type='submit' disabled={!folderName.trim() || isCreating}>
                {isCreating ? 'Creating...' : 'Create Folder'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
