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
  code: z.record(z.string()).refine((val) => Object.keys(val).length > 0, 'At least one code file is required'),
  requirements: z.string().nullable().optional(),
  packageJson: z.string().nullable().optional(),
  timeout: z.number().min(1).max(900),
  memorySize: z.number().min(128).max(10240),
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

  // Add dependencies based on runtime
  if (params.runtime.startsWith('python') && params.requirements?.trim()) {
    zip.file('requirements.txt', params.requirements)
  } else if (params.runtime.startsWith('nodejs') && params.packageJson?.trim()) {
    zip.file('package.json', params.packageJson)
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
      codeValue: body.code
    })
    
    // Parse the code field if it's a JSON string
    if (typeof body.code === 'string') {
      try {
        body.code = JSON.parse(body.code)
        logger.info(`[${requestId}] Parsed code field:`, { parsedCode: body.code })
      } catch (parseError) {
        logger.error(`[${requestId}] Failed to parse code field as JSON`, { 
          error: parseError instanceof Error ? parseError.message : String(parseError),
          codeString: body.code 
        })
        return createErrorResponse('Invalid JSON in code field', 400, 'INVALID_CODE_JSON')
      }
    }
    
    const validationResult = DeployRequestSchema.safeParse(body)
    if (!validationResult.success) {
      logger.warn(`[${requestId}] Invalid request body`, { errors: validationResult.error.errors })
      return createErrorResponse('Invalid request parameters', 400, 'VALIDATION_ERROR')
    }

    const params = validationResult.data
    logger.info(`[${requestId}] Validation successful, params:`, { 
      functionName: params.functionName,
      runtime: params.runtime,
      codeKeys: Object.keys(params.code),
      hasRole: !!params.role
    })

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
