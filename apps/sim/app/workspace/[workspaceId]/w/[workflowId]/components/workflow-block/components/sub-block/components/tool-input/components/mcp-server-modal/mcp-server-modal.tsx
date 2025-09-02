import { useEffect, useState } from 'react'
import { ServerIcon } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('MCPServerModal')

export interface MCPServer {
  id?: string
  name: string
  url: string
  headers?: Record<string, string>
  enabled: boolean
}

interface MCPServerModalProps {
  open: boolean
  onClose: () => void
  onSave: (server: MCPServer) => void
  onDelete?: () => void
  server?: MCPServer
  mode: 'create' | 'edit'
}

export function MCPServerModal({
  open,
  onClose,
  onSave,
  onDelete,
  server,
  mode,
}: MCPServerModalProps) {
  const [formData, setFormData] = useState<MCPServer>({
    name: '',
    url: '',
    headers: {},
    enabled: true,
  })
  const [headersText, setHeadersText] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  useEffect(() => {
    if (server) {
      setFormData(server)
      setHeadersText(
        Object.entries(server.headers || {})
          .map(([key, value]) => `${key}: ${value}`)
          .join('\n')
      )
    } else {
      setFormData({
        name: '',
        url: '',
        headers: {},
        enabled: true,
      })
      setHeadersText('')
    }
    setErrors({})
  }, [server, open])

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!formData.name.trim()) {
      newErrors.name = 'Server name is required'
    }

    if (!formData.url?.trim()) {
      newErrors.url = 'Server URL is required'
    } else if (!formData.url.startsWith('http://') && !formData.url.startsWith('https://')) {
      newErrors.url = 'URL must start with http:// or https://'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSave = () => {
    if (!validateForm()) {
      return
    }

    const headers: Record<string, string> = {}
    if (headersText.trim()) {
      headersText
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .forEach((line) => {
          const [key, ...valueParts] = line.split(':')
          if (key && valueParts.length > 0) {
            headers[key.trim()] = valueParts.join(':').trim()
          }
        })
    }

    const serverData: MCPServer = {
      ...formData,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
    }

    logger.info(`${mode === 'create' ? 'Creating' : 'Updating'} MCP server:`, serverData.name)
    onSave(serverData)
    onClose()
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className='max-w-2xl'>
          <DialogHeader>
            <DialogTitle className='flex items-center gap-2'>
              <ServerIcon className='h-5 w-5' />
              {mode === 'create' ? 'Add MCP Server' : 'Edit MCP Server'}
            </DialogTitle>
            <DialogDescription>
              {mode === 'create'
                ? 'Configure a new MCP server to add its tools to your agent.'
                : 'Update the configuration for this MCP server.'}
            </DialogDescription>
          </DialogHeader>

          <div className='space-y-6'>
            {/* Server Name */}
            <div className='space-y-2'>
              <Label htmlFor='name'>Server Name *</Label>
              <Input
                id='name'
                placeholder='github-mcp'
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className={errors.name ? 'border-red-500' : ''}
              />
              {errors.name && <p className='text-red-500 text-sm'>{errors.name}</p>}
              <p className='text-muted-foreground text-xs'>
                A unique identifier for this MCP server
              </p>
            </div>

            {/* Server URL */}
            <div className='space-y-2'>
              <Label htmlFor='url'>Server URL *</Label>
              <Input
                id='url'
                placeholder='https://mcp.firecrawl.dev/your-api-key/sse'
                value={formData.url || ''}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                className={errors.url ? 'border-red-500' : ''}
              />
              {errors.url && <p className='text-red-500 text-sm'>{errors.url}</p>}
              <p className='text-muted-foreground text-xs'>
                SSE endpoint URL for the MCP server (include API key in path for Firecrawl)
              </p>
            </div>

            {/* Headers */}
            <div className='space-y-2'>
              <Label htmlFor='headers'>Headers (Optional)</Label>
              <Textarea
                id='headers'
                placeholder='Authorization: Bearer your-token-here
X-API-Key: your-api-key'
                value={headersText}
                onChange={(e) => setHeadersText(e.target.value)}
                rows={3}
              />
              <p className='text-muted-foreground text-xs'>
                One per line in Header-Name: value format
              </p>
            </div>
          </div>

          <DialogFooter>
            {mode === 'edit' && onDelete && (
              <Button
                variant='destructive'
                onClick={() => setShowDeleteConfirm(true)}
                className='mr-auto'
              >
                Delete Server
              </Button>
            )}
            <Button variant='outline' onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              {mode === 'create' ? 'Add Server' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure you want to delete this MCP server?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The server and all its associated tools will be
              permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onDelete?.()
                setShowDeleteConfirm(false)
              }}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            >
              Delete Server
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
