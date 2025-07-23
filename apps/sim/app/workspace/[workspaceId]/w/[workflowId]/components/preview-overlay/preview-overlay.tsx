'use client'

import { useEffect, useState } from 'react'
import { Eye, GitBranch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { usePreviewStore } from '@/stores/copilot/preview-store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface PreviewOverlayProps {
  onShowPreview: (previewId: string) => void
}

export function PreviewOverlay({ onShowPreview }: PreviewOverlayProps) {
  const { activeWorkflowId } = useWorkflowRegistry()
  const { getLatestPendingPreview, previews } = usePreviewStore()

  // Get latest preview, reacting to store changes
  const latestPreview = activeWorkflowId ? getLatestPendingPreview(activeWorkflowId) : null

  if (!latestPreview) {
    return null
  }

  return (
    <div className='fixed bottom-6 left-1/2 z-50 -translate-x-1/2 transform'>
      <Card className='border border-orange-200 bg-orange-50 p-3 shadow-lg dark:border-orange-800 dark:bg-orange-950'>
        <div className='flex items-center gap-3'>
          <div className='flex h-8 w-8 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900'>
            <GitBranch className='h-4 w-4 text-orange-600 dark:text-orange-400' />
          </div>
          <div className='flex-1'>
            <div className='font-medium text-orange-900 text-sm dark:text-orange-100'>
              Workflow Changes Ready
            </div>
            <div className='text-orange-700 text-xs dark:text-orange-300'>
              {latestPreview.description || 'New workflow preview available'}
            </div>
          </div>
          <Button
            size='sm'
            variant='outline'
            onClick={() => onShowPreview(latestPreview.id)}
            className='border-orange-200 bg-white text-orange-700 hover:bg-orange-100 dark:border-orange-700 dark:bg-orange-900 dark:text-orange-200 dark:hover:bg-orange-800'
          >
            <Eye className='mr-1 h-3 w-3' />
            Review Changes
          </Button>
        </div>
      </Card>
    </div>
  )
} 