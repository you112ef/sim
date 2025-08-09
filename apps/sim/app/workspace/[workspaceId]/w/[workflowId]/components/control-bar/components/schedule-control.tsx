'use client'

import { useCallback, useEffect, useState } from 'react'
import { Calendar } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button, Dialog, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui'
import { createLogger } from '@/lib/logs/console/logger'
import { parseCronToHumanReadable } from '@/lib/schedules/utils'
import { cn, formatDateTime } from '@/lib/utils'
import type { WorkspaceUserPermissions } from '@/hooks/use-user-permissions'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { ControlBarScheduleModal } from './control-bar-schedule-modal'

const logger = createLogger('ScheduleControl')

interface ScheduleControlProps {
  userPermissions: WorkspaceUserPermissions
}

export function ScheduleControl({ userPermissions }: ScheduleControlProps) {
  const [error, setError] = useState<string | null>(null)
  const [scheduleId, setScheduleId] = useState<string | null>(null)
  const [nextRunAt, setNextRunAt] = useState<string | null>(null)
  const [lastRanAt, setLastRanAt] = useState<string | null>(null)
  const [cronExpression, setCronExpression] = useState<string | null>(null)
  const [timezone, setTimezone] = useState<string>('UTC')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [refreshCounter, setRefreshCounter] = useState(0)
  const [existingScheduleData, setExistingScheduleData] = useState<any>(null)

  const params = useParams()
  const workflowId = params.workflowId as string
  const { activeWorkflowId } = useWorkflowRegistry()

  // Function to check if schedule exists in the database
  const checkSchedule = useCallback(async () => {
    if (!workflowId) return

    setIsLoading(true)
    try {
      // Check for workflow-level schedules (not block-specific)
      const url = new URL('/api/schedules', window.location.origin)
      url.searchParams.set('workflowId', workflowId)
      // No blockId parameter means we're looking for workflow-level schedules

      const response = await fetch(url.toString(), {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
        },
      })

      if (response.ok) {
        const data = await response.json()
        logger.debug('Schedule check response:', data)

        if (data.schedule) {
          setScheduleId(data.schedule.id)
          setNextRunAt(data.schedule.nextRunAt)
          setLastRanAt(data.schedule.lastRanAt)
          setCronExpression(data.schedule.cronExpression)
          setTimezone(data.schedule.timezone || 'UTC')

          // Store the full schedule data for the modal
          setExistingScheduleData(data.schedule)
        } else {
          setScheduleId(null)
          setNextRunAt(null)
          setLastRanAt(null)
          setCronExpression(null)
          setExistingScheduleData(null)
        }
      }
    } catch (error) {
      logger.error('Error checking schedule:', { error })
      setError('Failed to check schedule status')
    } finally {
      setIsLoading(false)
    }
  }, [workflowId])

  // Check for schedule on mount and when dependencies change
  useEffect(() => {
    if (workflowId && activeWorkflowId) {
      checkSchedule()
    }
  }, [workflowId, activeWorkflowId, refreshCounter, checkSchedule])

  // Format the schedule information for display
  const getScheduleInfo = () => {
    if (!scheduleId || !nextRunAt) return null

    let scheduleTiming = 'Unknown schedule'

    if (cronExpression) {
      scheduleTiming = parseCronToHumanReadable(cronExpression)
    }

    return {
      timing: scheduleTiming,
      nextRun: formatDateTime(new Date(nextRunAt), timezone),
      lastRun: lastRanAt ? formatDateTime(new Date(lastRanAt), timezone) : null,
    }
  }

  const handleOpenModal = () => {
    if (!userPermissions.canEdit) return
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    // The refresh will be handled by the save operation if needed
  }

  const handleSaveSchedule = async (scheduleData: any): Promise<boolean> => {
    if (!userPermissions.canEdit) return false

    setIsSaving(true)
    setError(null)

    try {
      if (!activeWorkflowId) {
        setError('No active workflow found')
        return false
      }

      // Create a schedule configuration that will be stored in the database
      // We don't need to modify the workflow state - schedules are stored separately
      const requestBody = {
        workflowId,
        scheduleConfig: scheduleData, // Direct schedule configuration
        mode: 'standalone', // Indicate this is a standalone schedule, not block-based
      }

      const response = await fetch('/api/schedules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      const responseText = await response.text()
      let responseData
      try {
        responseData = JSON.parse(responseText)
      } catch (e) {
        logger.error('Failed to parse response JSON', e, responseText)
        responseData = {}
      }

      if (!response.ok) {
        setError(responseData.error || 'Failed to save schedule')
        return false
      }

      logger.debug('Schedule save response:', responseData)

      // Update local state with the response
      setScheduleId(responseData.scheduleId || responseData.id)

      if (responseData.cronExpression) {
        setCronExpression(responseData.cronExpression)
      }

      if (responseData.nextRunAt) {
        setNextRunAt(
          typeof responseData.nextRunAt === 'string'
            ? responseData.nextRunAt
            : responseData.nextRunAt.toISOString?.() || responseData.nextRunAt
        )
      }

      if (responseData.timezone) {
        setTimezone(responseData.timezone)
      }

      // Update the refresh counter to trigger useEffect refresh
      setRefreshCounter((prev) => prev + 1)

      return true
    } catch (error) {
      logger.error('Error saving schedule:', { error })
      setError('Failed to save schedule')
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteSchedule = async (): Promise<boolean> => {
    if (!userPermissions.canEdit || !scheduleId) return false

    setIsDeleting(true)
    try {
      const response = await fetch(`/api/schedules/${scheduleId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        setError(data.error || 'Failed to delete schedule')
        return false
      }

      // Clear schedule state
      setScheduleId(null)
      setNextRunAt(null)
      setLastRanAt(null)
      setCronExpression(null)

      // Update the refresh counter to trigger useEffect refresh
      setRefreshCounter((prev) => prev + 1)

      return true
    } catch (error) {
      logger.error('Error deleting schedule:', { error })
      setError('Failed to delete schedule')
      return false
    } finally {
      setIsDeleting(false)
    }
  }

  // Check if the schedule is active
  const isScheduleActive = !!scheduleId && !!nextRunAt
  const scheduleInfo = getScheduleInfo()

  const canEdit = userPermissions.canEdit
  const isDisabled = !canEdit || isLoading || isSaving || isDeleting

  const getTooltipContent = () => {
    if (!canEdit) {
      return 'Admin permission required to configure schedules'
    }

    if (isScheduleActive && scheduleInfo) {
      return (
        <div className='text-center'>
          <p className='font-medium'>{scheduleInfo.timing}</p>
          <p className='text-xs'>Next: {scheduleInfo.nextRun}</p>
          {scheduleInfo.lastRun && <p className='text-xs'>Last: {scheduleInfo.lastRun}</p>}
        </div>
      )
    }

    return 'Configure workflow schedule'
  }

  const getButtonClass = () => {
    return cn(
      'h-12 w-12 rounded-[11px] border-[hsl(var(--card-border))] bg-[hsl(var(--card-background))] text-[hsl(var(--card-text))] shadow-xs',
      'hover:border-[#701FFC] hover:bg-[#701FFC] hover:text-white',
      'transition-all duration-200',
      isScheduleActive && 'text-[#802FFF]',
      isDisabled &&
        'cursor-not-allowed opacity-50 hover:border-[hsl(var(--card-border))] hover:bg-[hsl(var(--card-background))] hover:text-[hsl(var(--card-text))] hover:shadow-xs'
    )
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant='outline'
            onClick={handleOpenModal}
            disabled={isDisabled}
            className={getButtonClass()}
          >
            <Calendar className='h-5 w-5' />
            <span className='sr-only'>
              {isScheduleActive ? 'Edit Schedule' : 'Configure Schedule'}
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{getTooltipContent()}</TooltipContent>
      </Tooltip>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <ControlBarScheduleModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          workflowId={workflowId}
          onSave={handleSaveSchedule}
          onDelete={scheduleId ? handleDeleteSchedule : undefined}
          scheduleId={scheduleId}
          existingSchedule={existingScheduleData}
        />
      </Dialog>
    </>
  )
}
