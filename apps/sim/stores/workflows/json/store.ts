import { devtools } from 'zustand/middleware'
import { create } from 'zustand'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowRegistry } from '../registry/store'
import { getWorkflowWithValues } from '@/stores/workflows'
import { WorkflowState } from '../workflow/types'

const logger = createLogger('WorkflowJsonStore')

interface WorkflowJsonStore {
  json: string
  lastGenerated?: number

  generateJson: () => void
  getJson: () => Promise<string>
  refreshJson: () => void
}

export const useWorkflowJsonStore = create<WorkflowJsonStore>()(
  devtools(
    (set, get) => ({
      json: '',
      lastGenerated: undefined,

      generateJson: () => {
        // Get the active workflow ID from registry
        const { activeWorkflowId } = useWorkflowRegistry.getState()

        if (!activeWorkflowId) {
          logger.warn('No active workflow to generate JSON for')
          return
        }

        try {
          // Get the workflow state with merged subblock values
          const workflow = getWorkflowWithValues(activeWorkflowId)
          
          if (!workflow || !workflow.state) {
            logger.warn('No workflow state found for ID:', activeWorkflowId)
            return
          }

          const workflowState = workflow.state

          // Clean the state to only include necessary fields
          const cleanState: WorkflowState = {
            blocks: workflowState.blocks || {},
            edges: workflowState.edges || [],
            loops: workflowState.loops || {},
            parallels: workflowState.parallels || {},
          }

          // Convert to formatted JSON
          const jsonString = JSON.stringify(cleanState, null, 2)

          set({
            json: jsonString,
            lastGenerated: Date.now(),
          })

          logger.info('Workflow JSON generated successfully', {
            blocksCount: Object.keys(cleanState.blocks).length,
            edgesCount: cleanState.edges.length,
            jsonLength: jsonString.length,
          })
        } catch (error) {
          logger.error('Failed to generate JSON:', error)
        }
      },

      getJson: async () => {
        const currentTime = Date.now()
        const { json, lastGenerated } = get()

        // Auto-refresh if data is stale (older than 1 second) or never generated
        if (!lastGenerated || currentTime - lastGenerated > 1000) {
          get().generateJson()
          return get().json
        }

        return json
      },

      refreshJson: () => {
        get().generateJson()
      },
    }),
    {
      name: 'workflow-json-store',
    }
  )
) 