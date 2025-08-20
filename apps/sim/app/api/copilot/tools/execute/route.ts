import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { authenticateCopilotRequestSessionOnly } from '@/lib/copilot/auth'

// Import server-side tool implementations from lib
import { searchDocsTool } from '@/lib/copilot/tools/server-tools/docs/search-docs'
import { getBlocksAndToolsTool } from '@/lib/copilot/tools/server-tools/blocks/get-blocks-and-tools'
import { getBlocksMetadataTool } from '@/lib/copilot/tools/server-tools/blocks/get-blocks-metadata'
import { getEnvironmentVariablesTool } from '@/lib/copilot/tools/server-tools/user/get-environment-variables'
import { getOAuthCredentialsTool } from '@/lib/copilot/tools/server-tools/user/get-oauth-credentials'
import { listGDriveFilesTool } from '@/lib/copilot/tools/server-tools/gdrive/list-gdrive-files'
import { readGDriveFileTool } from '@/lib/copilot/tools/server-tools/gdrive/read-gdrive-file'
import { gdriveRequestAccessServerTool } from '@/lib/copilot/tools/server-tools/other/gdrive-request-access'
import { makeApiRequestTool } from '@/lib/copilot/tools/server-tools/other/make-api-request'
import { onlineSearchTool } from '@/lib/copilot/tools/server-tools/other/online-search'
import { getWorkflowConsoleTool } from '@/lib/copilot/tools/server-tools/workflow/get-workflow-console'
import { buildWorkflowTool } from '@/lib/copilot/tools/server-tools/workflow/build-workflow'
import { editWorkflowTool } from '@/lib/copilot/tools/server-tools/workflow/edit-workflow'

const logger = createLogger('CopilotToolsExecuteAPI')

const Schema = z.object({
	methodId: z.string().min(1),
	params: z.record(z.any()).optional().default({}),
})

const HANDLERS: Record<string, (params: any) => Promise<any>> = {
	search_documentation: (p) => searchDocsTool.execute(p),
	get_blocks_and_tools: (p) => getBlocksAndToolsTool.execute(p),
	get_blocks_metadata: (p) => getBlocksMetadataTool.execute(p),
	get_environment_variables: (p) => getEnvironmentVariablesTool.execute(p),
	get_oauth_credentials: (p) => getOAuthCredentialsTool.execute(p),
	list_gdrive_files: (p) => listGDriveFilesTool.execute(p),
	read_gdrive_file: (p) => readGDriveFileTool.execute(p),
	gdrive_request_access: (p) => gdriveRequestAccessServerTool.execute(p),
	make_api_request: (p) => makeApiRequestTool.execute(p),
	search_online: (p) => onlineSearchTool.execute(p),
	get_workflow_console: (p) => getWorkflowConsoleTool.execute(p),
	build_workflow: (p) => buildWorkflowTool.execute(p),
	edit_workflow: (p) => editWorkflowTool.execute(p),
}

export async function POST(req: NextRequest) {
	const requestId = crypto.randomUUID()
	const start = Date.now()
	try {
		// Require session
		const sessionAuth = await authenticateCopilotRequestSessionOnly()
		if (!sessionAuth.isAuthenticated) {
			return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
		}

		const body = await req.json()
		const { methodId, params } = Schema.parse(body)

		const handler = HANDLERS[methodId]
		if (!handler) {
			logger.warn(`[${requestId}] Unknown methodId`, { methodId })
			return NextResponse.json(
				{ success: false, error: `Unknown method: ${methodId}` },
				{ status: 400 }
			)
		}

		logger.info(`[${requestId}] Executing tool`, {
			methodId,
			paramsKeys: Object.keys(params || {}),
		})

		const result = await handler(params)
		const duration = Date.now() - start
		logger.info(`[${requestId}] Tool executed`, { methodId, success: result?.success, duration })

		return NextResponse.json(result, { status: result?.success ? 200 : 400 })
	} catch (e) {
		logger.error('Execute failed', { error: e instanceof Error ? e.message : 'Unknown error' })
		if (e instanceof z.ZodError) {
			return NextResponse.json(
				{ success: false, error: e.errors.map((er) => er.message).join(', ') },
				{ status: 400 }
			)
		}
		return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
	}
} 