import { useEffect, useState } from 'react'
import { Info } from 'lucide-react'
import { OutlookIcon } from '@/components/icons'
import {
  Badge,
  Button,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui'
import { Logger } from '@/lib/logs/console/logger'
import {
  ConfigField,
  ConfigSection,
  InstructionsSection,
  TestResultDisplay,
} from '../'

const logger = new Logger('OutlookConfig')

const FALLBACK_OUTLOOK_FOLDERS = [
  { id: 'inbox', name: 'Inbox' },
  { id: 'sentitems', name: 'Sent Items' },
  { id: 'drafts', name: 'Drafts' },
  { id: 'deleteditems', name: 'Deleted Items' },
  { id: 'junkemail', name: 'Junk Email' },
]

interface OutlookFolder {
  id: string
  name: string
  type?: string
  messagesTotal?: number
  messagesUnread?: number
}

const formatFolderName = (folder: OutlookFolder): string => {
  return folder.name
}

interface OutlookConfigProps {
  selectedFolders: string[]
  setSelectedFolders: (folders: string[]) => void
  isLoadingToken: boolean
  testResult: {
    success: boolean
    message?: string
    test?: any
  } | null
  copied: string | null
  copyToClipboard: (text: string, type: string) => void
  testWebhook: () => Promise<void>
}

export function OutlookConfig({
  selectedFolders,
  setSelectedFolders,
  isLoadingToken,
  testResult,
  copied,
  copyToClipboard,
  testWebhook,
}: OutlookConfigProps) {
  const [folders, setFolders] = useState<OutlookFolder[]>([])
  const [isLoadingFolders, setIsLoadingFolders] = useState(false)
  const [folderError, setFolderError] = useState<string | null>(null)

  // Fetch Outlook folders
  useEffect(() => {
    let mounted = true
    const fetchFolders = async () => {
      setIsLoadingFolders(true)
      setFolderError(null)

      try {
        const credentialsResponse = await fetch('/api/auth/oauth/credentials?provider=outlook')
        if (!credentialsResponse.ok) {
          throw new Error('Failed to get Outlook credentials')
        }

        const credentialsData = await credentialsResponse.json()
        if (!credentialsData.credentials || !credentialsData.credentials.length) {
          throw new Error('No Outlook credentials found')
        }

        const credentialId = credentialsData.credentials[0].id

        const response = await fetch(`/api/tools/outlook/folders?credentialId=${credentialId}`)
        if (!response.ok) {
          throw new Error('Failed to fetch Outlook folders')
        }

        const data = await response.json()
        if (data.folders && Array.isArray(data.folders)) {
          if (mounted) setFolders(data.folders)
        } else {
          throw new Error('Invalid folders data format')
        }
      } catch (error) {
        logger.error('Error fetching Outlook folders:', error)
        if (mounted) {
          setFolderError('Could not fetch Outlook folders. Using default folders instead.')
          setFolders(FALLBACK_OUTLOOK_FOLDERS)
        }
      } finally {
        if (mounted) setIsLoadingFolders(false)
      }
    }

    fetchFolders()
    return () => {
      mounted = false
    }
  }, [])

  const toggleFolder = (folderId: string) => {
    if (selectedFolders.includes(folderId)) {
      setSelectedFolders(selectedFolders.filter((id) => id !== folderId))
    } else {
      setSelectedFolders([...selectedFolders, folderId])
    }
  }

  return (
    <div className='space-y-6'>
      <ConfigSection>
        <div className='mb-3 flex items-center gap-2'>
          <h3 className='font-medium text-sm'>Email Folders to Monitor</h3>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='ghost'
                size='sm'
                className='h-6 w-6 p-1 text-gray-500'
                aria-label='Learn more about email folders'
              >
                <Info className='h-4 w-4' />
              </Button>
            </TooltipTrigger>
            <TooltipContent
              side='right'
              align='center'
              className='z-[100] max-w-[300px] p-3'
              role='tooltip'
            >
              <p className='text-sm'>Select which email folders to monitor for new emails.</p>
            </TooltipContent>
          </Tooltip>
        </div>

        {isLoadingFolders ? (
          <div className='flex flex-wrap gap-2 py-2'>
            {Array(5)
              .fill(0)
              .map((_, i) => (
                <Skeleton key={i} className='h-6 w-16 rounded-full' />
              ))}
          </div>
        ) : (
          <>
            {folderError && (
              <p className='text-amber-500 text-sm dark:text-amber-400'>{folderError}</p>
            )}

            <div className='mt-2 flex flex-wrap gap-2'>
              {folders.map((folder) => (
                <Badge
                  key={folder.id}
                  variant={selectedFolders.includes(folder.id) ? 'default' : 'outline'}
                  className='cursor-pointer'
                  onClick={() => toggleFolder(folder.id)}
                >
                  {formatFolderName(folder)}
                </Badge>
              ))}
            </div>
          </>
        )}
      </ConfigSection>

      <TestResultDisplay
        testResult={testResult}
        copied={copied}
        copyToClipboard={copyToClipboard}
        showCurlCommand={true}
      />

      <InstructionsSection
        title='How Outlook Webhooks Work'
        tip='Outlook webhooks use Microsoft Graph subscriptions to notify your workflow of new emails.'
      >
        <ul className='list-inside list-disc space-y-1'>
          <li>Webhooks are automatically created when you save this configuration.</li>
          <li>Microsoft Graph will send notifications for new emails in selected folders.</li>
          <li>Subscriptions automatically renew every 3 days for email folders.</li>
          <li>You must have appropriate Microsoft 365 permissions for the selected folders.</li>
        </ul>
      </InstructionsSection>
    </div>
  )
}
