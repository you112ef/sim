import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('AWSLambdaGetPromptsAPI')

// Constants for getPrompts operation
const system_prompt = `You are an expert in writing aws lambda functions. The user will provide an input which may contain the the existing lambda code, or they may not. If the initial code is provided, make the changes to the initial code to reflect what the user wants. If no code is provided, your job is to write the lambda function, choosing a runtime and handler.

Your output should be a valid JSON object, with the following structure:

[
"runtime": runtime string,
"handler": handler,
"timeout": timeout,
"memory": memory,
"files":
{
"file_path_1": "code string for first file",
"file_path_2": "code string for second file"
}
]`

const schema = {
  "name": "aws_lambda_function",
  "description": "Defines the structure for an AWS Lambda function configuration.",
  "strict": true,
  "schema": {
    "type": "object",
    "properties": {
      "runtime": {
        "type": "string",
        "description": "The runtime environment for the Lambda function."
      },
      "handler": {
        "type": "string",
        "description": "The function handler that Lambda calls to start execution."
      },
      "memory": {
        "type": "integer",
        "description": "The amount of memory allocated to the Lambda function in MB (128-10240).",
        "minimum": 128,
        "maximum": 10240
      },
      "timeout": {
        "type": "integer",
        "description": "The maximum execution time for the Lambda function in seconds (1-900).",
        "minimum": 1,
        "maximum": 900
      },
      "files": {
        "type": "object",
        "description": "A mapping of file paths to their respective code strings.",
        "additionalProperties": {
          "type": "string",
          "description": "The code string for a specific file."
        }
      }
    },
    "additionalProperties": false,
    "required": ["runtime", "handler", "files", "memory", "timeout"]
  }
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    logger.info(`[${requestId}] Processing AWS Lambda get prompts request`)

    // No validation needed since this endpoint doesn't require any parameters
    // Just return the hardcoded system prompt and schema

    logger.info(`[${requestId}] Returning system prompt and schema`)

    return createSuccessResponse({
      success: true,
      output: {
        systemPrompt: system_prompt,
        schema: schema,
      },
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Error in get prompts operation`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    return createErrorResponse(
      'Failed to get prompts and schema',
      500,
      'GET_PROMPTS_ERROR'
    )
  }
} 