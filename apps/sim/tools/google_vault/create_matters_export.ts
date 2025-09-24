import type { GoogleVaultCreateMattersExportParams } from '@/tools/google_vault/types'
import type { ToolConfig } from '@/tools/types'

// matters.exports.create
// POST https://vault.googleapis.com/v1/matters/{matterId}/exports
export const createMattersExportTool: ToolConfig<GoogleVaultCreateMattersExportParams> = {
  id: 'create_matters_export',
  name: 'Vault Create Export (by Matter)',
  description: 'Create an export in a matter',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'google-vault',
    additionalScopes: ['https://www.googleapis.com/auth/ediscovery'],
  },

  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    matterId: { type: 'string', required: true, visibility: 'user-or-llm' },
  },

  request: {
    url: (params) => `https://vault.googleapis.com/v1/matters/${params.matterId}/exports`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    // Only path param required per your spec; body intentionally empty here
    body: () => ({}),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to create export')
    }
    return { success: true, output: data }
  },
}
