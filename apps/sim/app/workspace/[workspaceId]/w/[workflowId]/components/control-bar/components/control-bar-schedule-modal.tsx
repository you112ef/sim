'use client'

import { useEffect, useState } from 'react'
import { Clock, Trash2, X } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { UnsavedChangesDialog } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/components/webhook/components'

const logger = createLogger('ControlBarScheduleModal')

// Parse cron expression back to configuration object
function parseCronToConfig(cronExpression: string, timezone: string) {
  if (!cronExpression) {
    return { scheduleType: 'daily', timezone }
  }

  const parts = cronExpression.trim().split(/\s+/)
  if (parts.length !== 5) {
    return { scheduleType: 'custom', cronExpression, timezone }
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  // Every X minutes: */X * * * *
  if (
    minute.startsWith('*/') &&
    hour === '*' &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    const interval = minute.substring(2)
    return {
      scheduleType: 'minutes',
      minutesInterval: interval,
      timezone,
    }
  }

  // Hourly at specific minute: X * * * *
  if (
    !minute.includes('*') &&
    !minute.includes('/') &&
    hour === '*' &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    return {
      scheduleType: 'hourly',
      hourlyMinute: minute,
      timezone,
    }
  }

  // Daily at specific time: M H * * *
  if (
    !minute.includes('*') &&
    !hour.includes('*') &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    const h = Number.parseInt(hour)
    const m = Number.parseInt(minute)
    const time = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
    return {
      scheduleType: 'daily',
      dailyTime: time,
      timezone,
    }
  }

  // Weekly: M H * * D
  if (
    !minute.includes('*') &&
    !hour.includes('*') &&
    dayOfMonth === '*' &&
    month === '*' &&
    !dayOfWeek.includes('*')
  ) {
    const h = Number.parseInt(hour)
    const m = Number.parseInt(minute)
    const time = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`

    const dayMap: Record<string, string> = {
      '1': 'MON',
      '2': 'TUE',
      '3': 'WED',
      '4': 'THU',
      '5': 'FRI',
      '6': 'SAT',
      '0': 'SUN',
      '7': 'SUN',
    }

    return {
      scheduleType: 'weekly',
      weeklyDay: dayMap[dayOfWeek] || 'MON',
      weeklyDayTime: time,
      timezone,
    }
  }

  // Monthly: M H D * *
  if (
    !minute.includes('*') &&
    !hour.includes('*') &&
    !dayOfMonth.includes('*') &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    const h = Number.parseInt(hour)
    const m = Number.parseInt(minute)
    const time = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`

    return {
      scheduleType: 'monthly',
      monthlyDay: dayOfMonth,
      monthlyTime: time,
      timezone,
    }
  }

  // Fallback to custom cron
  return {
    scheduleType: 'custom',
    cronExpression,
    timezone,
  }
}

interface ControlBarScheduleModalProps {
  isOpen: boolean
  onClose: () => void
  workflowId: string
  onSave: (scheduleData: any) => Promise<boolean>
  onDelete?: () => Promise<boolean>
  scheduleId?: string | null
  existingSchedule?: any
}

export function ControlBarScheduleModal({
  isOpen,
  onClose,
  workflowId,
  onSave,
  onDelete,
  scheduleId,
  existingSchedule,
}: ControlBarScheduleModalProps) {
  // Pure local state - no SubBlock hooks
  const [scheduleType, setScheduleType] = useState('daily')
  const [minutesInterval, setMinutesInterval] = useState('')
  const [hourlyMinute, setHourlyMinute] = useState('')
  const [dailyTime, setDailyTime] = useState('')
  const [weeklyDay, setWeeklyDay] = useState('MON')
  const [weeklyDayTime, setWeeklyDayTime] = useState('')
  const [monthlyDay, setMonthlyDay] = useState('')
  const [monthlyTime, setMonthlyTime] = useState('')
  const [cronExpression, setCronExpression] = useState('')
  const [timezone, setTimezone] = useState('UTC')

  // UI states
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [showUnsavedChangesConfirm, setShowUnsavedChangesConfirm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [initialValues, setInitialValues] = useState<Record<string, any>>({})

  // Standalone Time input component (based on the original TimeInput)
  const TimeInput = ({
    value,
    onChange,
    placeholder,
    className,
  }: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    className?: string
  }) => {
    const [isOpen, setIsOpen] = useState(false)
    const [hour, setHour] = useState('12')
    const [minute, setMinute] = useState('00')
    const [ampm, setAmpm] = useState<'AM' | 'PM'>('AM')

    // Convert 24h time string to display format (12h with AM/PM)
    const formatDisplayTime = (time: string) => {
      if (!time) return ''
      const [hours, minutes] = time.split(':')
      const hour = Number.parseInt(hours, 10)
      const ampm = hour >= 12 ? 'PM' : 'AM'
      const displayHour = hour % 12 || 12
      return `${displayHour}:${minutes} ${ampm}`
    }

    // Convert display time to 24h format for storage
    const formatStorageTime = (hour: number, minute: number, ampm: string) => {
      const hours24 = ampm === 'PM' ? (hour === 12 ? 12 : hour + 12) : hour === 12 ? 0 : hour
      return `${hours24.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
    }

    // Update the time when any component changes
    const updateTime = (newHour?: string, newMinute?: string, newAmpm?: 'AM' | 'PM') => {
      const h = Number.parseInt(newHour ?? hour) || 12
      const m = Number.parseInt(newMinute ?? minute) || 0
      const p = newAmpm ?? ampm
      onChange(formatStorageTime(h, m, p))
    }

    // Initialize from existing value
    useEffect(() => {
      if (value) {
        const [hours, minutes] = value.split(':')
        const hour24 = Number.parseInt(hours, 10)
        const _minute = Number.parseInt(minutes, 10)
        const isAM = hour24 < 12
        setHour((hour24 % 12 || 12).toString())
        setMinute(minutes)
        setAmpm(isAM ? 'AM' : 'PM')
      }
    }, [value])

    const handleBlur = () => {
      updateTime()
      setIsOpen(false)
    }

    return (
      <Popover
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open)
          if (!open) {
            handleBlur()
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant='outline'
            className={cn(
              'w-full justify-start text-left font-normal',
              !value && 'text-muted-foreground',
              className
            )}
          >
            <Clock className='mr-1 h-4 w-4' />
            {value ? formatDisplayTime(value) : <span>{placeholder || 'Select time'}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className='w-auto p-4'>
          <div className='flex items-center space-x-2'>
            <Input
              className='w-[4rem]'
              value={hour}
              onChange={(e) => {
                const val = e.target.value.replace(/[^0-9]/g, '')
                if (val === '') {
                  setHour('')
                  return
                }
                const numVal = Number.parseInt(val)
                if (!Number.isNaN(numVal)) {
                  const newHour = Math.min(12, Math.max(1, numVal)).toString()
                  setHour(newHour)
                  updateTime(newHour)
                }
              }}
              onBlur={() => {
                const numVal = Number.parseInt(hour) || 12
                setHour(numVal.toString())
                updateTime(numVal.toString())
              }}
              type='text'
            />
            <span>:</span>
            <Input
              className='w-[4rem]'
              value={minute}
              onChange={(e) => {
                const val = e.target.value.replace(/[^0-9]/g, '')
                if (val === '') {
                  setMinute('')
                  return
                }
                const numVal = Number.parseInt(val)
                if (!Number.isNaN(numVal)) {
                  const newMinute = Math.min(59, Math.max(0, numVal)).toString().padStart(2, '0')
                  setMinute(newMinute)
                  updateTime(undefined, newMinute)
                }
              }}
              onBlur={() => {
                const numVal = Number.parseInt(minute) || 0
                setMinute(numVal.toString().padStart(2, '0'))
                updateTime(undefined, numVal.toString())
              }}
              type='text'
            />
            <Button
              variant='outline'
              className='w-[4rem]'
              onClick={() => {
                const newAmpm = ampm === 'AM' ? 'PM' : 'AM'
                setAmpm(newAmpm)
                updateTime(undefined, undefined, newAmpm)
              }}
            >
              {ampm}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    )
  }

  // Initialize from existing schedule data
  useEffect(() => {
    if (isOpen && existingSchedule) {
      // For standalone schedules (control bar), we need to extract config from database schedule
      // For block-based schedules, we read from workflowState.blocks
      let config: any = {}

      if (existingSchedule.workflowState?.blocks) {
        // Block-based schedule (backwards compatibility)
        const scheduleBlock = Object.values(existingSchedule.workflowState.blocks).find(
          (block: any) => block.type === 'schedule' || block.type === 'starter'
        ) as any

        if (scheduleBlock?.subBlocks) {
          config = scheduleBlock.subBlocks
        }
      } else {
        // Standalone schedule (control bar) - parse from cron expression
        config = parseCronToConfig(
          existingSchedule.cronExpression,
          existingSchedule.timezone || 'UTC'
        )
      }

      setScheduleType(config.scheduleType || 'daily')
      setMinutesInterval(config.minutesInterval || '')
      setHourlyMinute(config.hourlyMinute || '')
      setDailyTime(config.dailyTime || '')
      setWeeklyDay(config.weeklyDay || 'MON')
      setWeeklyDayTime(config.weeklyDayTime || '')
      setMonthlyDay(config.monthlyDay || '')
      setMonthlyTime(config.monthlyTime || '')
      setCronExpression(config.cronExpression || '')
      setTimezone(config.timezone || existingSchedule.timezone || 'UTC')

      // Set initial values for change tracking immediately after setting state
      if (isOpen) {
        const currentValues = {
          scheduleType: config.scheduleType || 'daily',
          minutesInterval: config.minutesInterval || '',
          hourlyMinute: config.hourlyMinute || '',
          dailyTime: config.dailyTime || '',
          weeklyDay: config.weeklyDay || 'MON',
          weeklyDayTime: config.weeklyDayTime || '',
          monthlyDay: config.monthlyDay || '',
          monthlyTime: config.monthlyTime || '',
          timezone: config.timezone || existingSchedule?.timezone || 'UTC',
          cronExpression: config.cronExpression || '',
        }
        setInitialValues(currentValues)
        setHasChanges(false)
        setErrorMessage(null)
      }
    } else if (isOpen) {
      // For new schedules (no existing schedule), set default initial values
      const defaultValues = {
        scheduleType: 'daily',
        minutesInterval: '',
        hourlyMinute: '',
        dailyTime: '',
        weeklyDay: 'MON',
        weeklyDayTime: '',
        monthlyDay: '',
        monthlyTime: '',
        timezone: 'UTC',
        cronExpression: '',
      }
      setInitialValues(defaultValues)
      setHasChanges(false)
      setErrorMessage(null)
    }
  }, [isOpen, existingSchedule])

  // Track changes
  useEffect(() => {
    if (!isOpen) return

    const currentValues = {
      scheduleType,
      minutesInterval,
      hourlyMinute,
      dailyTime,
      weeklyDay,
      weeklyDayTime,
      monthlyDay,
      monthlyTime,
      timezone,
      cronExpression,
    }

    const valuesChanged = JSON.stringify(initialValues) !== JSON.stringify(currentValues)

    // For new schedules, consider them changed if any value is set based on schedule type
    if (!scheduleId) {
      let hasRequiredFields = false

      switch (currentValues.scheduleType) {
        case 'minutes':
          hasRequiredFields = !!currentValues.minutesInterval
          break
        case 'hourly':
          hasRequiredFields = currentValues.hourlyMinute !== ''
          break
        case 'daily':
          hasRequiredFields = !!currentValues.dailyTime
          break
        case 'weekly':
          hasRequiredFields = !!currentValues.weeklyDay && !!currentValues.weeklyDayTime
          break
        case 'monthly':
          hasRequiredFields = !!currentValues.monthlyDay && !!currentValues.monthlyTime
          break
        case 'custom':
          hasRequiredFields = !!currentValues.cronExpression
          break
      }

      setHasChanges(valuesChanged || hasRequiredFields)
    } else {
      setHasChanges(valuesChanged)
    }
  }, [
    isOpen,
    scheduleId,
    scheduleType,
    minutesInterval,
    hourlyMinute,
    dailyTime,
    weeklyDay,
    weeklyDayTime,
    monthlyDay,
    monthlyTime,
    timezone,
    cronExpression,
    initialValues,
  ])

  // Handle modal close
  const handleClose = () => {
    if (hasChanges) {
      setShowUnsavedChangesConfirm(true)
    } else {
      onClose()
    }
  }

  // Handle confirming close despite unsaved changes
  const handleConfirmClose = () => {
    // Revert form values to initial values
    if (hasChanges) {
      setScheduleType(initialValues.scheduleType || 'daily')
      setMinutesInterval(initialValues.minutesInterval || '')
      setHourlyMinute(initialValues.hourlyMinute || '')
      setDailyTime(initialValues.dailyTime || '')
      setWeeklyDay(initialValues.weeklyDay || 'MON')
      setWeeklyDayTime(initialValues.weeklyDayTime || '')
      setMonthlyDay(initialValues.monthlyDay || '')
      setMonthlyTime(initialValues.monthlyTime || '')
      setTimezone(initialValues.timezone || 'UTC')
      setCronExpression(initialValues.cronExpression || '')
    }

    setShowUnsavedChangesConfirm(false)
    onClose()
  }

  // Handle canceling the close
  const handleCancelClose = () => {
    setShowUnsavedChangesConfirm(false)
  }

  // Handle saving the schedule
  const handleSave = async () => {
    setErrorMessage(null)
    setIsSaving(true)

    try {
      // Validate inputs based on schedule type
      if (scheduleType === 'minutes' && !minutesInterval) {
        setErrorMessage('Please enter minutes interval')
        setIsSaving(false)
        return
      }

      if (scheduleType === 'hourly' && hourlyMinute === '') {
        setErrorMessage('Please enter minute of the hour')
        setIsSaving(false)
        return
      }

      if (scheduleType === 'daily' && !dailyTime) {
        setErrorMessage('Please enter time of day')
        setIsSaving(false)
        return
      }

      if (scheduleType === 'weekly' && !weeklyDayTime) {
        setErrorMessage('Please enter time of day')
        setIsSaving(false)
        return
      }

      if (scheduleType === 'monthly' && (!monthlyDay || !monthlyTime)) {
        setErrorMessage('Please enter day of month and time')
        setIsSaving(false)
        return
      }

      if (scheduleType === 'custom' && !cronExpression) {
        setErrorMessage('Please enter a cron expression')
        setIsSaving(false)
        return
      }

      // Prepare schedule data
      const scheduleData = {
        scheduleType,
        minutesInterval,
        hourlyMinute,
        dailyTime,
        weeklyDay,
        weeklyDayTime,
        monthlyDay,
        monthlyTime,
        timezone,
        cronExpression,
      }

      const success = await onSave(scheduleData)

      if (success) {
        const updatedValues = {
          scheduleType,
          minutesInterval,
          hourlyMinute,
          dailyTime,
          weeklyDay,
          weeklyDayTime,
          monthlyDay,
          monthlyTime,
          timezone,
          cronExpression,
        }
        logger.debug('Schedule saved successfully, updating initial values', updatedValues)
        setInitialValues(updatedValues)
        setHasChanges(false)
        onClose()
      }
    } catch (error) {
      logger.error('Error saving schedule:', { error })
      setErrorMessage('Failed to save schedule')
    } finally {
      setIsSaving(false)
    }
  }

  // Handle deleting the schedule
  const handleDelete = async () => {
    if (!onDelete) return

    setIsDeleting(true)
    try {
      const success = await onDelete()

      if (success) {
        setShowDeleteConfirm(false)
        onClose()
      }
    } catch (error) {
      logger.error('Error deleting schedule:', { error })
      setErrorMessage('Failed to delete schedule')
    } finally {
      setIsDeleting(false)
    }
  }

  // Open delete confirmation dialog
  const openDeleteConfirm = () => {
    setShowDeleteConfirm(true)
  }

  return (
    <>
      <DialogContent className='flex flex-col gap-0 p-0 sm:max-w-[600px]' hideCloseButton>
        <DialogHeader className='border-b px-6 py-4'>
          <div className='flex items-center justify-between'>
            <DialogTitle className='font-medium text-lg'>Schedule Configuration</DialogTitle>
            <Button variant='ghost' size='icon' className='h-8 w-8 p-0' onClick={handleClose}>
              <X className='h-4 w-4' />
              <span className='sr-only'>Close</span>
            </Button>
          </div>
        </DialogHeader>

        <div className='overflow-y-auto px-6 pt-4 pb-6'>
          {errorMessage && (
            <Alert variant='destructive' className='mb-4'>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          <div className='space-y-6'>
            {/* Frequency selector */}
            <div className='space-y-1'>
              <label htmlFor='scheduleType' className='font-medium text-sm'>
                Frequency
              </label>
              <Select value={scheduleType} onValueChange={setScheduleType}>
                <SelectTrigger className='h-10'>
                  <SelectValue placeholder='Select frequency' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='minutes'>Every X Minutes</SelectItem>
                  <SelectItem value='hourly'>Hourly</SelectItem>
                  <SelectItem value='daily'>Daily</SelectItem>
                  <SelectItem value='weekly'>Weekly</SelectItem>
                  <SelectItem value='monthly'>Monthly</SelectItem>
                  <SelectItem value='custom'>Custom Cron</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Minutes schedule options */}
            {scheduleType === 'minutes' && (
              <div className='space-y-1'>
                <label htmlFor='minutesInterval' className='font-medium text-sm'>
                  Run Every (minutes)
                </label>
                <Input
                  id='minutesInterval'
                  value={minutesInterval}
                  onChange={(e) => setMinutesInterval(e.target.value)}
                  placeholder='15'
                  type='number'
                  min='1'
                  className='h-10'
                />
              </div>
            )}

            {/* Hourly schedule options */}
            {scheduleType === 'hourly' && (
              <div className='space-y-1'>
                <label htmlFor='hourlyMinute' className='font-medium text-sm'>
                  Minute of the Hour
                </label>
                <Input
                  id='hourlyMinute'
                  value={hourlyMinute}
                  onChange={(e) => setHourlyMinute(e.target.value)}
                  placeholder='0'
                  type='number'
                  min='0'
                  max='59'
                  className='h-10'
                />
                <p className='text-muted-foreground text-xs'>
                  Specify which minute of each hour the workflow should run (0-59)
                </p>
              </div>
            )}

            {/* Daily schedule options */}
            {(scheduleType === 'daily' || !scheduleType) && (
              <div className='space-y-1'>
                <label htmlFor='dailyTime' className='font-medium text-sm'>
                  Time of Day
                </label>
                <TimeInput
                  value={dailyTime}
                  onChange={setDailyTime}
                  placeholder='Select time'
                  className='h-10'
                />
              </div>
            )}

            {/* Weekly schedule options */}
            {scheduleType === 'weekly' && (
              <div className='space-y-4'>
                <div className='space-y-1'>
                  <label htmlFor='weeklyDay' className='font-medium text-sm'>
                    Day of Week
                  </label>
                  <Select value={weeklyDay} onValueChange={setWeeklyDay}>
                    <SelectTrigger className='h-10'>
                      <SelectValue placeholder='Select day' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='MON'>Monday</SelectItem>
                      <SelectItem value='TUE'>Tuesday</SelectItem>
                      <SelectItem value='WED'>Wednesday</SelectItem>
                      <SelectItem value='THU'>Thursday</SelectItem>
                      <SelectItem value='FRI'>Friday</SelectItem>
                      <SelectItem value='SAT'>Saturday</SelectItem>
                      <SelectItem value='SUN'>Sunday</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className='space-y-1'>
                  <label htmlFor='weeklyDayTime' className='font-medium text-sm'>
                    Time of Day
                  </label>
                  <TimeInput
                    value={weeklyDayTime}
                    onChange={setWeeklyDayTime}
                    placeholder='Select time'
                    className='h-10'
                  />
                </div>
              </div>
            )}

            {/* Monthly schedule options */}
            {scheduleType === 'monthly' && (
              <div className='space-y-4'>
                <div className='space-y-1'>
                  <label htmlFor='monthlyDay' className='font-medium text-sm'>
                    Day of Month
                  </label>
                  <Input
                    id='monthlyDay'
                    value={monthlyDay}
                    onChange={(e) => setMonthlyDay(e.target.value)}
                    placeholder='1'
                    type='number'
                    min='1'
                    max='31'
                    className='h-10'
                  />
                  <p className='text-muted-foreground text-xs'>
                    Specify which day of the month the workflow should run (1-31)
                  </p>
                </div>

                <div className='space-y-1'>
                  <label htmlFor='monthlyTime' className='font-medium text-sm'>
                    Time of Day
                  </label>
                  <TimeInput
                    value={monthlyTime}
                    onChange={setMonthlyTime}
                    placeholder='Select time'
                    className='h-10'
                  />
                </div>
              </div>
            )}

            {/* Custom cron options */}
            {scheduleType === 'custom' && (
              <div className='space-y-1'>
                <label htmlFor='cronExpression' className='font-medium text-sm'>
                  Cron Expression
                </label>
                <Input
                  id='cronExpression'
                  value={cronExpression}
                  onChange={(e) => setCronExpression(e.target.value)}
                  placeholder='*/15 * * * *'
                  className='h-10'
                />
                <p className='mt-1 text-muted-foreground text-xs'>
                  Use standard cron format (e.g., "*/15 * * * *" for every 15 minutes)
                </p>
              </div>
            )}

            {/* Timezone configuration - only show for time-specific schedules */}
            {scheduleType !== 'minutes' && scheduleType !== 'hourly' && (
              <div className='space-y-1'>
                <label htmlFor='timezone' className='font-medium text-sm'>
                  Timezone
                </label>
                <Select value={timezone} onValueChange={setTimezone}>
                  <SelectTrigger className='h-10'>
                    <SelectValue placeholder='Select timezone' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='UTC'>UTC</SelectItem>
                    <SelectItem value='America/New_York'>US Eastern (UTC-4)</SelectItem>
                    <SelectItem value='America/Chicago'>US Central (UTC-5)</SelectItem>
                    <SelectItem value='America/Denver'>US Mountain (UTC-6)</SelectItem>
                    <SelectItem value='America/Los_Angeles'>US Pacific (UTC-7)</SelectItem>
                    <SelectItem value='Europe/London'>London (UTC+1)</SelectItem>
                    <SelectItem value='Europe/Paris'>Paris (UTC+2)</SelectItem>
                    <SelectItem value='Asia/Singapore'>Singapore (UTC+8)</SelectItem>
                    <SelectItem value='Asia/Tokyo'>Tokyo (UTC+9)</SelectItem>
                    <SelectItem value='Australia/Sydney'>Sydney (UTC+10)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className='w-full px-6 pt-0 pb-6'>
          <div className='flex w-full justify-between'>
            <div>
              {scheduleId && onDelete && (
                <Button
                  type='button'
                  variant='destructive'
                  onClick={openDeleteConfirm}
                  disabled={isDeleting || isSaving}
                  size='default'
                  className='h-10'
                >
                  <Trash2 className='mr-2 h-4 w-4' />
                  {isDeleting ? 'Deleting...' : 'Delete Schedule'}
                </Button>
              )}
            </div>
            <div className='flex gap-2'>
              <Button variant='outline' onClick={handleClose} size='default' className='h-10'>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={!hasChanges || isSaving}
                className={cn('h-10', hasChanges ? 'bg-primary hover:bg-primary/90' : '')}
                size='default'
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>

      <UnsavedChangesDialog
        open={showUnsavedChangesConfirm}
        setOpen={setShowUnsavedChangesConfirm}
        onCancel={handleCancelClose}
        onConfirm={handleConfirmClose}
      />

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Schedule</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this schedule? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            >
              {isDeleting ? 'Deleting...' : 'Delete Schedule'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
