import {
  CreateFunctionCommand,
  GetFunctionCommand,
  LambdaClient,
  type Runtime,
  UpdateFunctionCodeCommand,
} from '@aws-sdk/client-lambda'
import JSZip from 'jszip'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('AWSLambdaDeployAPI')

// Validation schema for the request body
const DeployRequestSchema = z.object({
  accessKeyId: z.string().min(1, 'AWS Access Key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS Secret Access Key is required'),
  region: z.string().min(1, 'AWS Region is required'),
  functionName: z.string().min(1, 'Function name is required'),
  handler: z.string().optional(),
  runtime: z.string().min(1, 'Runtime is required'),
  code: z.string().min(1, 'Function code is required'),
  requirements: z.string().nullable().optional(),
  packageJson: z.string().nullable().optional(),
  timeout: z.number().min(1).max(900),
  memorySize: z.number().min(128).max(10240),
  environmentVariables: z.record(z.string()).default({}),
  tags: z.record(z.string()).default({}),
  role: z.string().min(1, 'Role ARN is required'),
})

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    logger.info(`[${requestId}] Processing AWS Lambda deployment request`)

    // Parse and validate request body
    const body = await request.json()

    const validationResult = DeployRequestSchema.safeParse(body)
    if (!validationResult.success) {
      logger.warn(`[${requestId}] Invalid request body`, { errors: validationResult.error.errors })
      return NextResponse.json(
        { error: 'Invalid request parameters', details: validationResult.error.errors },
        { status: 400 }
      )
    }

    const params = validationResult.data
    console.log(`[${requestId}] Received params:`, JSON.stringify(params, null, 2))
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
    const zip = new JSZip()

    // Add the main function code
    const fileExtension = getFileExtension(params.runtime)
    const fileName = `index.${fileExtension}`
    zip.file(fileName, params.code)

    // Add dependencies based on runtime
    if (
      params.runtime.startsWith('python') &&
      params.requirements &&
      params.requirements.trim() !== ''
    ) {
      zip.file('requirements.txt', params.requirements)
    } else if (
      params.runtime.startsWith('nodejs') &&
      params.packageJson &&
      params.packageJson.trim() !== ''
    ) {
      zip.file('package.json', params.packageJson)
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })

    // Check if function already exists
    let functionExists = false
    try {
      await lambdaClient.send(new GetFunctionCommand({ FunctionName: params.functionName }))
      functionExists = true
      logger.info(`[${requestId}] Function ${params.functionName} already exists, updating code`)
    } catch (error: any) {
      if (error.name === 'ResourceNotFoundException') {
        functionExists = false
        logger.info(
          `[${requestId}] Function ${params.functionName} does not exist, creating new function`
        )
      } else {
        throw error
      }
    }

    let result: any

    if (functionExists) {
      // Update existing function code
      const updateParams = {
        FunctionName: params.functionName,
        ZipFile: zipBuffer,
      }

      result = await lambdaClient.send(new UpdateFunctionCodeCommand(updateParams))
      logger.info(`[${requestId}] Lambda function code updated: ${result.FunctionArn}`)
    } else {
      // Create new function
      if (!params.role) {
        throw new Error(
          'Role ARN is required for creating new Lambda functions. Please provide a valid IAM Role ARN.'
        )
      }

      const createParams = {
        FunctionName: params.functionName,
        Runtime: params.runtime as Runtime,
        Role: params.role,
        Handler: params.handler || getDefaultHandler(params.runtime),
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

      result = await lambdaClient.send(new CreateFunctionCommand(createParams))
      logger.info(`[${requestId}] Lambda function created: ${result.FunctionArn}`)
    }

    // Get function details for response
    const functionDetails = await lambdaClient.send(
      new GetFunctionCommand({ FunctionName: params.functionName })
    )

    const response = {
      functionArn: functionDetails.Configuration?.FunctionArn || '',
      functionName: functionDetails.Configuration?.FunctionName || '',
      runtime: functionDetails.Configuration?.Runtime || '',
      region: params.region,
      status: functionDetails.Configuration?.State || '',
      lastModified: functionDetails.Configuration?.LastModified || '',
      codeSize: functionDetails.Configuration?.CodeSize || 0,
      description: functionDetails.Configuration?.Description || '',
      timeout: functionDetails.Configuration?.Timeout || 0,
      memorySize: functionDetails.Configuration?.MemorySize || 0,
      environment: functionDetails.Configuration?.Environment?.Variables || {},
      tags: functionDetails.Tags || {},
    }

    return NextResponse.json({
      success: true,
      output: response,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error deploying Lambda function`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to deploy Lambda function',
      },
      { status: 500 }
    )
  }
}

// Helper functions
function getFileExtension(runtime: string): string {
  if (runtime.startsWith('nodejs')) return 'js'
  if (runtime.startsWith('python')) return 'py'
  if (runtime.startsWith('java')) return 'java'
  if (runtime.startsWith('dotnet')) return 'cs'
  if (runtime.startsWith('go')) return 'go'
  if (runtime.startsWith('ruby')) return 'rb'
  return 'js' // default
}

function getDefaultHandler(runtime: string): string {
  if (runtime.startsWith('nodejs')) return 'index.handler'
  if (runtime.startsWith('python')) return 'index.lambda_handler'
  if (runtime.startsWith('java')) return 'com.example.LambdaFunction::handleRequest'
  if (runtime.startsWith('dotnet'))
    return 'LambdaFunction::LambdaFunction.Function::FunctionHandler'
  if (runtime.startsWith('go')) return 'main'
  if (runtime.startsWith('ruby')) return 'index.lambda_handler'
  return 'index.handler' // default
}
