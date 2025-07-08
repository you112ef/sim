import {
  GetFunctionCommand,
  GetFunctionConfigurationCommand,
  LambdaClient,
} from '@aws-sdk/client-lambda'
import JSZip from 'jszip'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console-logger'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('AWSLambdaFetchAPI')

// Validation schema for the request body
const FetchRequestSchema = z.object({
  accessKeyId: z.string().min(1, 'AWS Access Key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS Secret Access Key is required'),
  region: z.string().min(1, 'AWS Region is required'),
  functionName: z.string().min(1, 'Function name is required'),
  role: z.string().min(1, 'IAM Role ARN is required'),
})

type FetchRequest = z.infer<typeof FetchRequestSchema>

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
  codeFiles: Record<string, string>
  handler: string
  role: string
}

/**
 * Extract code from Lambda function ZIP file
 */
async function extractCodeFromZip(
  zipBuffer: Buffer,
  runtime: string
): Promise<{ mainCode: string; allFiles: Record<string, string> }> {
  try {
    const zip = await JSZip.loadAsync(zipBuffer)
    const allFiles = Object.keys(zip.files)
    logger.info('Files in ZIP:', allFiles)

    // Extract all text files
    const allFilesContent: Record<string, string> = {}
    let mainCode = ''

    // Determine the main file based on runtime
    let mainFile = 'index.js' // default
    if (runtime.startsWith('python')) {
      mainFile = 'index.py'
    } else if (runtime.startsWith('java')) {
      mainFile = 'index.java'
    } else if (runtime.startsWith('dotnet')) {
      mainFile = 'index.cs'
    } else if (runtime.startsWith('go')) {
      mainFile = 'index.go'
    } else if (runtime.startsWith('ruby')) {
      mainFile = 'index.rb'
    }

    logger.info('Looking for main file:', mainFile)

    // Extract all non-directory files
    for (const fileName of allFiles) {
      if (!fileName.endsWith('/')) {
        try {
          const fileContent = await zip.file(fileName)?.async('string')
          if (fileContent !== undefined) {
            allFilesContent[fileName] = fileContent

            // Set main code if this is the main file
            if (fileName === mainFile) {
              mainCode = fileContent
              logger.info('Found main file content, length:', mainCode.length)
            }
          }
        } catch (error) {
          logger.warn(`Failed to extract file ${fileName}:`, error)
        }
      }
    }

    // If main file not found, try to find any code file
    if (!mainCode) {
      const codeFiles = Object.keys(allFilesContent).filter(
        (file) =>
          file.endsWith('.js') ||
          file.endsWith('.py') ||
          file.endsWith('.java') ||
          file.endsWith('.cs') ||
          file.endsWith('.go') ||
          file.endsWith('.rb')
      )

      logger.info('Found code files:', codeFiles)

      if (codeFiles.length > 0) {
        const firstCodeFile = codeFiles[0]
        mainCode = allFilesContent[firstCodeFile]
        logger.info('Using first code file as main, length:', mainCode.length)
      }
    }

    // If still no main code, use the first file
    if (!mainCode && Object.keys(allFilesContent).length > 0) {
      const firstFile = Object.keys(allFilesContent)[0]
      mainCode = allFilesContent[firstFile]
      logger.info('Using first file as main, length:', mainCode.length)
    }

    logger.info(`Extracted ${Object.keys(allFilesContent).length} files`)
    return { mainCode, allFiles: allFilesContent }
  } catch (error) {
    logger.error('Failed to extract code from ZIP', { error })
    return { mainCode: '', allFiles: {} }
  }
}

/**
 * Get detailed information about a Lambda function including code
 */
async function getFunctionDetailsWithCode(
  lambdaClient: LambdaClient,
  functionName: string,
  region: string,
  accessKeyId: string,
  secretAccessKey: string
): Promise<LambdaFunctionDetails> {
  // Get function configuration
  const functionConfig = await lambdaClient.send(
    new GetFunctionConfigurationCommand({ FunctionName: functionName })
  )

  // Get function code
  const functionCode = await lambdaClient.send(
    new GetFunctionCommand({ FunctionName: functionName })
  )

  let codeFiles: Record<string, string> = {}
  if (functionCode.Code?.Location) {
    try {
      logger.info('Downloading code from:', functionCode.Code.Location)
      
      const response = await fetch(functionCode.Code.Location)
      logger.info('Fetch response status:', response.status)
      
      if (response.ok) {
        const zipBuffer = Buffer.from(await response.arrayBuffer())
        logger.info('ZIP buffer size:', zipBuffer.length)
        const extractedCode = await extractCodeFromZip(zipBuffer, functionConfig.Runtime || '')
        codeFiles = extractedCode.allFiles
        logger.info('Extracted files count:', Object.keys(codeFiles).length)
      } else {
        logger.warn('Fetch failed with status:', response.status)
        const errorText = await response.text()
        logger.warn('Error response:', errorText)
      }
    } catch (fetchError) {
      logger.error('Failed to download function code using fetch', { fetchError })
    }
  } else {
    logger.info('No code location found in function response')
  }

  return {
    functionArn: functionConfig.FunctionArn || '',
    functionName: functionConfig.FunctionName || '',
    runtime: functionConfig.Runtime || '',
    region,
    status: functionConfig.State || '',
    lastModified: functionConfig.LastModified || '',
    codeSize: functionConfig.CodeSize || 0,
    description: functionConfig.Description || '',
    timeout: functionConfig.Timeout || 0,
    memorySize: functionConfig.MemorySize || 0,
    environment: functionConfig.Environment?.Variables || {},
    tags: {}, // Tags need to be fetched separately if needed
    codeFiles,
    handler: functionConfig.Handler || '',
    role: functionConfig.Role || '',
  }
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    logger.info(`[${requestId}] Processing AWS Lambda fetch request`)

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

    const validationResult = FetchRequestSchema.safeParse(body)
    if (!validationResult.success) {
      logger.warn(`[${requestId}] Invalid request body`, { errors: validationResult.error.errors })
      return createErrorResponse('Invalid request parameters', 400, 'VALIDATION_ERROR')
    }

    const params = validationResult.data
    
    // Log the payload (excluding sensitive credentials)
    logger.info(`[${requestId}] AWS Lambda fetch payload received`, {
      functionName: params.functionName,
      region: params.region,
      accessKeyId: params.accessKeyId ? `${params.accessKeyId.substring(0, 4)}...` : undefined,
      hasSecretAccessKey: !!params.secretAccessKey,
      hasFunctionName: !!params.functionName,
      hasRole: !!params.role,
      role: params.role ? `${params.role.substring(0, 20)}...` : undefined,
    })
    
    logger.info(`[${requestId}] Fetching Lambda function: ${params.functionName}`)

    // Create Lambda client
    const lambdaClient = new LambdaClient({
      region: params.region,
      credentials: {
        accessKeyId: params.accessKeyId,
        secretAccessKey: params.secretAccessKey,
      },
    })

    // Fetch function details and code
    try {
      const functionDetails = await getFunctionDetailsWithCode(
        lambdaClient,
        params.functionName,
        params.region,
        params.accessKeyId,
        params.secretAccessKey
      )

      logger.info(`[${requestId}] Successfully fetched Lambda function: ${params.functionName}`, {
        functionName: functionDetails.functionName,
        filesCount: Object.keys(functionDetails.codeFiles).length,
        hasFiles: Object.keys(functionDetails.codeFiles).length > 0,
      })

      return createSuccessResponse({
        success: true,
        output: functionDetails,
      })
    } catch (fetchError: any) {
      // Handle ResourceNotFoundException gracefully - return empty function details
      if (fetchError.name === 'ResourceNotFoundException') {
        logger.info(`[${requestId}] Lambda function '${params.functionName}' not found, returning empty response`)
        
        const emptyFunctionDetails: LambdaFunctionDetails = {
          functionArn: '',
          functionName: params.functionName,
          runtime: '',
          region: params.region,
          status: '',
          lastModified: '',
          codeSize: 0,
          description: '',
          timeout: 0,
          memorySize: 0,
          environment: {},
          tags: {},
          codeFiles: {},
          handler: '',
          role: '',
        }

        return createSuccessResponse({
          success: true,
          output: emptyFunctionDetails,
        })
      }
      
      // Re-throw other errors to be handled by the outer catch block
      throw fetchError
    }
  } catch (error: any) {
    logger.error(`[${requestId}] Failed to fetch Lambda function`, {
      error: error.message,
      stack: error.stack,
    })

    // Handle specific AWS errors
    // Note: ResourceNotFoundException is now handled gracefully in the inner try-catch

    if (error.name === 'AccessDeniedException') {
      return createErrorResponse(
        'Access denied. Please check your AWS credentials and permissions.',
        403,
        'ACCESS_DENIED'
      )
    }

    if (error.name === 'InvalidParameterValueException') {
      return createErrorResponse('Invalid parameter value provided', 400, 'INVALID_PARAMETER')
    }

    return createErrorResponse('Failed to fetch Lambda function', 500, 'FETCH_ERROR')
  }
}
