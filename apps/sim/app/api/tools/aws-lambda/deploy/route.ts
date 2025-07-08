import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { GetFunctionCommand, LambdaClient } from '@aws-sdk/client-lambda'
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
 * Sanitize function name for SAM/CloudFormation resource naming
 * SAM resource names must be alphanumeric only (letters and numbers)
 */
function sanitizeResourceName(functionName: string): string {
  return (
    functionName
      .replace(/[^a-zA-Z0-9]/g, '') // Remove all non-alphanumeric characters
      .replace(/^(\d)/, 'Func$1') // Ensure it starts with a letter if it starts with a number
      .substring(0, 64) || // Ensure reasonable length limit
    'LambdaFunction'
  ) // Fallback if name becomes empty
}

/**
 * Create SAM template for the Lambda function
 */
function createSamTemplate(params: DeployRequest): string {
  // Sanitize the function name for CloudFormation resource naming
  const resourceName = sanitizeResourceName(params.functionName)

  const template = {
    AWSTemplateFormatVersion: '2010-09-09',
    Transform: 'AWS::Serverless-2016-10-31',
    Resources: {
      [resourceName]: {
        Type: 'AWS::Serverless::Function',
        Properties: {
          FunctionName: params.functionName, // Use original function name for actual Lambda function
          CodeUri: './src',
          Handler: params.handler,
          Runtime: params.runtime,
          Role: params.role,
          Timeout: params.timeout,
          MemorySize: params.memorySize,
          Environment: {
            Variables: params.environmentVariables,
          },
          Tags: params.tags,
        },
      },
    },
    Outputs: {
      FunctionArn: {
        Value: { 'Fn::GetAtt': [resourceName, 'Arn'] },
        Export: { Name: `${params.functionName}-Arn` },
      },
    },
  }

  return JSON.stringify(template, null, 2)
}

/**
 * Execute a shell command and return the result
 */
async function execCommand(
  command: string,
  cwd: string,
  env?: Record<string, string>
): Promise<{ stdout: string; stderr: string }> {
  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)

  return await execAsync(command, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
  })
}

/**
 * Deploy Lambda function using SAM CLI
 */
async function deployWithSam(
  params: DeployRequest,
  requestId: string
): Promise<LambdaFunctionDetails> {
  const tempDir = join(tmpdir(), `lambda-deploy-${requestId}`)
  const srcDir = join(tempDir, 'src')

  try {
    // Create temporary directory structure
    await fs.mkdir(tempDir, { recursive: true })
    await fs.mkdir(srcDir, { recursive: true })

    logger.info(`[${requestId}] Created temporary directory: ${tempDir}`)

    // Write SAM template
    const samTemplate = createSamTemplate(params)
    await fs.writeFile(join(tempDir, 'template.yaml'), samTemplate)

    logger.info(`[${requestId}] Created SAM template`)

    // Write source code files
    for (const [filePath, codeContent] of Object.entries(params.code)) {
      const fullPath = join(srcDir, filePath)
      const fileDir = join(fullPath, '..')

      // Ensure directory exists
      await fs.mkdir(fileDir, { recursive: true })
      await fs.writeFile(fullPath, codeContent)

      logger.info(`[${requestId}] Created source file: ${filePath}`)
    }

    // Set AWS credentials in environment
    const env = {
      AWS_ACCESS_KEY_ID: params.accessKeyId,
      AWS_SECRET_ACCESS_KEY: params.secretAccessKey,
      AWS_DEFAULT_REGION: params.region,
    }

    // Build the SAM application
    logger.info(`[${requestId}] Building SAM application...`)
    const buildCommand = 'sam build --no-cached'
    const buildResult = await execCommand(buildCommand, tempDir, env)

    logger.info(`[${requestId}] SAM build output:`, {
      stdout: buildResult.stdout,
      stderr: buildResult.stderr,
    })

    if (buildResult.stderr && !buildResult.stderr.includes('Successfully built')) {
      logger.warn(`[${requestId}] SAM build warnings:`, { stderr: buildResult.stderr })
    }

    logger.info(`[${requestId}] SAM build completed`)

    // Deploy the SAM application
    logger.info(`[${requestId}] Deploying SAM application...`)
    const stackName = `${sanitizeResourceName(params.functionName)}Stack`
    const deployCommand = [
      'sam deploy',
      '--no-confirm-changeset',
      '--no-fail-on-empty-changeset',
      `--stack-name ${stackName}`,
      `--region ${params.region}`,
      '--resolve-s3',
      '--capabilities CAPABILITY_IAM',
      '--no-progressbar',
    ].join(' ')

    const deployResult = await execCommand(deployCommand, tempDir, env)

    logger.info(`[${requestId}] SAM deploy output:`, {
      stdout: deployResult.stdout,
      stderr: deployResult.stderr,
    })

    if (
      deployResult.stderr &&
      !deployResult.stderr.includes('Successfully created/updated stack')
    ) {
      logger.warn(`[${requestId}] SAM deploy warnings:`, { stderr: deployResult.stderr })
    }

    logger.info(`[${requestId}] SAM deploy completed`)

    // Get function details using AWS SDK
    const lambdaClient = new LambdaClient({
      region: params.region,
      credentials: {
        accessKeyId: params.accessKeyId,
        secretAccessKey: params.secretAccessKey,
      },
    })

    const functionDetails = await getFunctionDetails(
      lambdaClient,
      params.functionName,
      params.region
    )

    return functionDetails
  } catch (error) {
    logger.error(`[${requestId}] Error during SAM deployment`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    throw error
  } finally {
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true })
      logger.info(`[${requestId}] Cleaned up temporary directory: ${tempDir}`)
    } catch (cleanupError) {
      logger.warn(`[${requestId}] Failed to clean up temporary directory`, {
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      })
    }
  }
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
      logger.warn(`[${requestId}] Invalid request body`, {
        errors: validationResult.error.errors,
        codeField: body.code,
        codeType: typeof body.code,
        hasCode: 'code' in body,
        bodyKeys: Object.keys(body),
      })
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

    logger.info(`[${requestId}] Deploying Lambda function with SAM: ${params.functionName}`)

    // Deploy using SAM CLI
    const functionDetails = await deployWithSam(params, requestId)

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

    if (error.message?.includes('sam: command not found')) {
      errorMessage = 'SAM CLI is not installed or not available in PATH'
      statusCode = 500
    } else if (error.name === 'AccessDeniedException') {
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
