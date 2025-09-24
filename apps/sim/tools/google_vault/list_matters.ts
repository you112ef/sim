import type { ToolConfig } from '@/tools/types'

export interface GoogleVaultListMattersParams {
  accessToken: string
  pageSize?: number
  pageToken?: string
  matterId?: string // Optional get for a specific matter
}

export const listMattersTool: ToolConfig<GoogleVaultListMattersParams> = {
  id: 'list_matters',
  name: 'Vault List Matters',
  description: 'List matters, or get a specific matter if matterId is provided',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'google-vault',
    additionalScopes: ['https://www.googleapis.com/auth/ediscovery'],
  },

  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    pageSize: { type: 'number', required: false, visibility: 'user-only' },
    pageToken: { type: 'string', required: false, visibility: 'hidden' },
    matterId: { type: 'string', required: true, visibility: 'user-or-llm' },
  },

  request: {
    url: (params) => {
      if (params.matterId) {
        return `https://vault.googleapis.com/v1/matters/${params.matterId}`
      }
      const url = new URL('https://vault.googleapis.com/v1/matters')
      // Coerce numeric-like strings and only set when a finite number
      const raw = (params as any).pageSize
      const pageSize = typeof raw === 'string' ? Number(raw.trim()) : raw
      if (Number.isFinite(pageSize)) url.searchParams.set('pageSize', String(pageSize))
      if (params.pageToken) url.searchParams.set('pageToken', params.pageToken)
      // Default BASIC view implicitly by omitting 'view' and 'state' params
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.accessToken}` }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to list matters')
    }
    return { success: true, output: data }
  },
}
