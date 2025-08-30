import { getBlock } from '@/blocks'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

/**
 * Decide whether incoming edges should be blocked for a target block.
 * - Block if the block is a pure trigger category (webhook, etc.)
 * - Block if the block is currently in triggerMode
 * - Block if the block is the starter block
 */
export function shouldBlockIncomingEdgesForTarget(blockType: string, triggerMode: boolean | undefined): boolean {
	// Starter blocks should never have incoming edges
	if (blockType === 'starter') return true

	// Runtime toggle
	if (triggerMode === true) return true

	// Pure trigger categories
	try {
		const config = getBlock(blockType)
		if (config?.category === 'triggers') return true
	} catch {}

	return false
}

/**
 * Return a copy of state with edges to trigger-like targets removed.
 */
export function filterEdgesForTriggers(state: WorkflowState): WorkflowState {
	const blocks = state.blocks || {}
	const edges = state.edges || []

	const filteredEdges = edges.filter((edge) => {
		const target = blocks[edge.target]
		if (!target) return false // Drop dangling edges defensively
		return !shouldBlockIncomingEdgesForTarget(target.type, target.triggerMode)
	})

	return {
		...state,
		edges: filteredEdges,
	}
} 