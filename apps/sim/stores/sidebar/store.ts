import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Sidebar state interface
 */
interface SidebarState {
  workspaceDropdownOpen: boolean
  sidebarWidth: number
  setWorkspaceDropdownOpen: (isOpen: boolean) => void
  setSidebarWidth: (width: number) => void
}

/**
 * Sidebar width constraints
 */
const DEFAULT_SIDEBAR_WIDTH = 232
const MIN_SIDEBAR_WIDTH = 232
const MAX_SIDEBAR_WIDTH = 400

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      workspaceDropdownOpen: false,
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      setWorkspaceDropdownOpen: (isOpen) => set({ workspaceDropdownOpen: isOpen }),
      setSidebarWidth: (width) => {
        const clampedWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, width))
        set({ sidebarWidth: clampedWidth })
        // Update CSS variable for immediate visual feedback
        if (typeof window !== 'undefined') {
          document.documentElement.style.setProperty('--sidebar-width', `${clampedWidth}px`)
        }
      },
    }),
    {
      name: 'sidebar-state',
      onRehydrateStorage: () => (state) => {
        // Sync CSS variable with persisted state after rehydration
        if (state && typeof window !== 'undefined') {
          document.documentElement.style.setProperty('--sidebar-width', `${state.sidebarWidth}px`)
        }
      },
    }
  )
)
