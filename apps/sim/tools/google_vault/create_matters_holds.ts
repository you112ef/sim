import type { GoogleVaultCreateMattersHoldsParams } from '@/tools/google_vault/types'
import type { ToolConfig } from '@/tools/types'

// matters.holds.create
// POST https://vault.googleapis.com/v1/matters/{matterId}/holds
export const createMattersHoldsTool: ToolConfig<GoogleVaultCreateMattersHoldsParams> = {
  id: 'create_matters_holds',
  name: 'Vault Create Hold (by Matter)',
  description: 'Create a hold in a matter',
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
    url: (params) => `https://vault.googleapis.com/v1/matters/${params.matterId}/holds`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    // Only path param required per provided spec; body intentionally empty
    body: () => ({}),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to create hold')
    }
    return { success: true, output: data }
  },
}
