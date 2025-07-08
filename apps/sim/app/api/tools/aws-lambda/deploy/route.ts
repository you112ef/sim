import {
  CreateFunctionCommand,
  GetFunctionCommand,
  LambdaClient,
  type Runtime,
  UpdateFunctionCodeCommand,
} from '@aws-sdk/client-lambda'
import JSZip from 'jszip'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console-logger'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('AWSLambdaDeployAPI')

// Validation schema for the request body
const DeployRequestSchema = z.object({
  accessKeyId: z.string().min(1, 'AWS Access Key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS Secret Access Key is required'),
  region: z.string().min(1, 'AWS Region is required'),
  functionName: z.string().min(1, 'Function name is required'),
  handler: z.string().optional(),
  runtime: z.string().min(1, 'Runtime is required'),
  code: z
    .record(z.string())
    .refine((val) => Object.keys(val).length > 0, 'At least one code file is required'),

  timeout: z.coerce.number().min(1).max(900).optional().default(3),
  memorySize: z.coerce.number().min(128).max(10240).optional().default(128),
  environmentVariables: z.record(z.string()).default({}),
  tags: z.record(z.string()).default({}),
  role: z.string().min(1, 'Role ARN is required'),
})

type DeployRequest = z.infer<typeof DeployRequestSchema>

interface LambdaFunctionDetails {
  functionArn: string
  functionName: string
  runtime: string
  region: string
  status: string
  lastModified: string
  codeSize: number
  description: string
  timeout: number
  memorySize: number
  environment: Record<string, string>
  tags: Record<string, string>
}

/**
 * Get the appropriate file extension for the given runtime
 */
function getFileExtension(runtime: string): string {
  if (runtime.startsWith('nodejs')) return 'js'
  if (runtime.startsWith('python')) return 'py'
  if (runtime.startsWith('java')) return 'java'
  if (runtime.startsWith('dotnet')) return 'cs'
  if (runtime.startsWith('go')) return 'go'
  if (runtime.startsWith('ruby')) return 'rb'
  return 'js' // default
}

/**
 * Create a ZIP file with the Lambda code and dependencies
 */
async function createLambdaPackage(params: DeployRequest): Promise<Buffer> {
  const zip = new JSZip()

  // Add all code files from the JSON object
  for (const [filePath, codeContent] of Object.entries(params.code)) {
    zip.file(filePath, codeContent)
  }

  return await zip.generateAsync({ type: 'nodebuffer' })
}

/**
 * Check if a Lambda function already exists
 */
async function checkFunctionExists(
  lambdaClient: LambdaClient,
  functionName: string
): Promise<boolean> {
  try {
    await lambdaClient.send(new GetFunctionCommand({ FunctionName: functionName }))
    return true
  } catch (error: any) {
    if (error.name === 'ResourceNotFoundException') {
      return false
    }
    throw error
  }
}

/**
 * Create a new Lambda function
 */
async function createLambdaFunction(
  lambdaClient: LambdaClient,
  params: DeployRequest,
  zipBuffer: Buffer
): Promise<any> {
  const createParams = {
    FunctionName: params.functionName,
    Runtime: params.runtime as Runtime,
    Role: params.role,
    Handler: params.handler,
    Code: {
      ZipFile: zipBuffer,
    },
    Timeout: params.timeout,
    MemorySize: params.memorySize,
    Environment: {
      Variables: params.environmentVariables,
    },
    Tags: params.tags,
  }

  return await lambdaClient.send(new CreateFunctionCommand(createParams))
}

/**
 * Update an existing Lambda function's code
 */
async function updateLambdaFunction(
  lambdaClient: LambdaClient,
  functionName: string,
  zipBuffer: Buffer
): Promise<any> {
  const updateParams = {
    FunctionName: functionName,
    ZipFile: zipBuffer,
  }

  return await lambdaClient.send(new UpdateFunctionCodeCommand(updateParams))
}

/**
 * Get detailed information about a Lambda function
 */
async function getFunctionDetails(
  lambdaClient: LambdaClient,
  functionName: string,
  region: string
): Promise<LambdaFunctionDetails> {
  const functionDetails = await lambdaClient.send(
    new GetFunctionCommand({ FunctionName: functionName })
  )

  return {
    functionArn: functionDetails.Configuration?.FunctionArn || '',
    functionName: functionDetails.Configuration?.FunctionName || '',
    runtime: functionDetails.Configuration?.Runtime || '',
    region,
    status: functionDetails.Configuration?.State || '',
    lastModified: functionDetails.Configuration?.LastModified || '',
    codeSize: functionDetails.Configuration?.CodeSize || 0,
    description: functionDetails.Configuration?.Description || '',
    timeout: functionDetails.Configuration?.Timeout || 0,
    memorySize: functionDetails.Configuration?.MemorySize || 0,
    environment: functionDetails.Configuration?.Environment?.Variables || {},
    tags: functionDetails.Tags || {},
  }
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    logger.info(`[${requestId}] Processing AWS Lambda deployment request`)

    // Parse and validate request body
    let body: any
    try {
      body = await request.json()
    } catch (parseError) {
      logger.error(`[${requestId}] Failed to parse request body`, {
        error: parseError instanceof Error ? parseError.message : String(parseError),
      })
      return createErrorResponse('Invalid JSON in request body', 400, 'INVALID_JSON')
    }

    logger.info(`[${requestId}] Request body received:`, {
      body,
      codeType: typeof body.code,
      codeValue: body.code,
    })

    // Parse the code field if it's a JSON string
    if (typeof body.code === 'string') {
      try {
        body.code = JSON.parse(body.code)
        logger.info(`[${requestId}] Parsed code field:`, { parsedCode: body.code })
      } catch (parseError) {
        logger.error(`[${requestId}] Failed to parse code field as JSON`, {
          error: parseError instanceof Error ? parseError.message : String(parseError),
          codeString: body.code,
        })
        return createErrorResponse('Invalid JSON in code field', 400, 'INVALID_CODE_JSON')
      }
    }

    // Runtime field should be a string, no JSON parsing needed
    if (typeof body.runtime !== 'string') {
      logger.error(`[${requestId}] Runtime field must be a string`, {
        runtimeType: typeof body.runtime,
        runtimeValue: body.runtime,
      })
      return createErrorResponse('Runtime field must be a string', 400, 'INVALID_RUNTIME_TYPE')
    }

    // Parse the timeout field if it's a JSON string
    if (typeof body.timeout === 'string') {
      try {
        body.timeout = JSON.parse(body.timeout)
        logger.info(`[${requestId}] Parsed timeout field:`, { parsedTimeout: body.timeout })
      } catch (parseError) {
        logger.error(`[${requestId}] Failed to parse timeout field as JSON`, {
          error: parseError instanceof Error ? parseError.message : String(parseError),
          timeoutString: body.timeout,
        })
        return createErrorResponse('Invalid JSON in timeout field', 400, 'INVALID_TIMEOUT_JSON')
      }
    }

    // Parse the memorySize field if it's a JSON string
    if (typeof body.memorySize === 'string') {
      try {
        body.memorySize = JSON.parse(body.memorySize)
        logger.info(`[${requestId}] Parsed memorySize field:`, {
          parsedMemorySize: body.memorySize,
        })
      } catch (parseError) {
        logger.error(`[${requestId}] Failed to parse memorySize field as JSON`, {
          error: parseError instanceof Error ? parseError.message : String(parseError),
          memorySizeString: body.memorySize,
        })
        return createErrorResponse(
          'Invalid JSON in memorySize field',
          400,
          'INVALID_MEMORYSIZE_JSON'
        )
      }
    }

    const validationResult = DeployRequestSchema.safeParse(body)
    if (!validationResult.success) {
      logger.warn(`[${requestId}] Invalid request body`, { errors: validationResult.error.errors })
      return createErrorResponse('Invalid request parameters', 400, 'VALIDATION_ERROR')
    }

    const params = validationResult.data

    // Log the deployment payload (excluding sensitive credentials)
    logger.info(`[${requestId}] AWS Lambda deployment payload received`, {
      functionName: params.functionName,
      region: params.region,
      runtime: params.runtime,
      handler: params.handler,
      timeout: params.timeout,
      memorySize: params.memorySize,
      accessKeyId: params.accessKeyId ? `${params.accessKeyId.substring(0, 4)}...` : undefined,
      hasSecretAccessKey: !!params.secretAccessKey,
      hasRole: !!params.role,
      role: params.role ? `${params.role.substring(0, 20)}...` : undefined,
      codeFiles: Object.keys(params.code),
      codeFilesCount: Object.keys(params.code).length,
      environmentVariables: params.environmentVariables,
      environmentVariablesCount: Object.keys(params.environmentVariables || {}).length,
      tags: params.tags,
      tagsCount: Object.keys(params.tags || {}).length,
    })

    logger.info(`[${requestId}] Deploying Lambda function: ${params.functionName}`)

    // Create Lambda client
    const lambdaClient = new LambdaClient({
      region: params.region,
      credentials: {
        accessKeyId: params.accessKeyId,
        secretAccessKey: params.secretAccessKey,
      },
    })

    // Create ZIP file with the Lambda code and dependencies
    const zipBuffer = await createLambdaPackage(params)

    // Check if function already exists
    const functionExists = await checkFunctionExists(lambdaClient, params.functionName)

    if (functionExists) {
      logger.info(`[${requestId}] Function ${params.functionName} already exists, updating code`)
      await updateLambdaFunction(lambdaClient, params.functionName, zipBuffer)
    } else {
      logger.info(
        `[${requestId}] Function ${params.functionName} does not exist, creating new function`
      )
      await createLambdaFunction(lambdaClient, params, zipBuffer)
    }

    // Get function details for response
    const functionDetails = await getFunctionDetails(
      lambdaClient,
      params.functionName,
      params.region
    )

    logger.info(`[${requestId}] Lambda function deployment completed successfully`, {
      functionName: params.functionName,
      functionArn: functionDetails.functionArn,
    })

    return createSuccessResponse({
      success: true,
      output: functionDetails,
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Error deploying Lambda function`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    // Handle specific AWS errors
    let errorMessage = 'Failed to deploy Lambda function'
    let statusCode = 500

    if (error.name === 'AccessDeniedException') {
      errorMessage = 'Access denied. Please check your AWS credentials and permissions.'
      statusCode = 403
    } else if (error.name === 'InvalidParameterValueException') {
      errorMessage = `Invalid parameter: ${error.message}`
      statusCode = 400
    } else if (error.name === 'ResourceConflictException') {
      errorMessage = 'Resource conflict. The function may be in use or being updated.'
      statusCode = 409
    } else if (error.name === 'ServiceException') {
      errorMessage = 'AWS Lambda service error. Please try again later.'
      statusCode = 503
    } else if (error instanceof Error) {
      errorMessage = error.message
    }

    return createErrorResponse(errorMessage, statusCode, 'DEPLOYMENT_ERROR')
  }
}
