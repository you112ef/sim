import { create } from 'zustand'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('OfflineMode')

interface OfflineModeState {
  isOffline: boolean
  triggerOfflineMode: (source: 'operation-queue' | 'text-outbox') => void
  clearOfflineMode: () => void
}

export const useOfflineModeStore = create<OfflineModeState>((set, get) => ({
  isOffline: false,

  triggerOfflineMode: (source) => {
    const state = get()
    if (state.isOffline) return

    logger.error(`Offline mode triggered by ${source}`)
    set({ isOffline: true })
  },

  clearOfflineMode: () => {
    set({ isOffline: false })
  },
}))
