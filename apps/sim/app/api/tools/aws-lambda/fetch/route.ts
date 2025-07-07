import {
  GetFunctionCommand,
  GetFunctionConfigurationCommand,
  LambdaClient,
} from '@aws-sdk/client-lambda'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import JSZip from 'jszip'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console-logger'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('AWSLambdaFetchAPI')

// Validation schema for the request body
const FetchRequestSchema = z.object({
  accessKeyId: z.string().min(1, 'AWS Access Key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS Secret Access Key is required'),
  region: z.string().min(1, 'AWS Region is required'),
  functionName: z.string().min(1, 'Function name is required'),
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
async function extractCodeFromZip(zipBuffer: Buffer, runtime: string): Promise<{ mainCode: string; allFiles: Record<string, string> }> {
  try {
    const zip = await JSZip.loadAsync(zipBuffer)
    
    // Log all files in the ZIP for debugging
    const allFiles = Object.keys(zip.files)
    console.log('Files in ZIP:', allFiles)
    
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

    console.log('Looking for main file:', mainFile)

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
              console.log('Found main file content, length:', mainCode.length)
            }
          }
        } catch (error) {
          console.log(`Failed to extract file ${fileName}:`, error)
        }
      }
    }

    // If main file not found, try to find any code file
    if (!mainCode) {
      const codeFiles = Object.keys(allFilesContent).filter(file => 
        file.endsWith('.js') || file.endsWith('.py') || file.endsWith('.java') || 
        file.endsWith('.cs') || file.endsWith('.go') || file.endsWith('.rb')
      )

      console.log('Found code files:', codeFiles)

      if (codeFiles.length > 0) {
        const firstCodeFile = codeFiles[0]
        mainCode = allFilesContent[firstCodeFile]
        console.log('Using first code file as main, length:', mainCode.length)
      }
    }

    // If still no main code, use the first file
    if (!mainCode && Object.keys(allFilesContent).length > 0) {
      const firstFile = Object.keys(allFilesContent)[0]
      mainCode = allFilesContent[firstFile]
      console.log('Using first file as main, length:', mainCode.length)
    }

    console.log(`Extracted ${Object.keys(allFilesContent).length} files`)
    return { mainCode, allFiles: allFilesContent }
  } catch (error) {
    console.error('Failed to extract code from ZIP', { error })
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
      console.log('Downloading code from:', functionCode.Code.Location)
      
      // Parse the S3 URL to extract bucket and key
      const s3Url = new URL(functionCode.Code.Location)
      const bucketName = s3Url.hostname.split('.')[0]
      const objectKey = s3Url.pathname.substring(1) // Remove leading slash
      
      console.log('Parsed S3 details:', { bucketName, objectKey })
      
      // Create S3 client with the same credentials
      const s3Client = new S3Client({
        region: region,
        credentials: {
          accessKeyId: accessKeyId,
          secretAccessKey: secretAccessKey,
        },
      })
      
      // Download the object directly using AWS SDK
      const getObjectCommand = new GetObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
      })
      
      const s3Response = await s3Client.send(getObjectCommand)
      
      if (s3Response.Body) {
        // Convert the readable stream to buffer
        const chunks: Uint8Array[] = []
        const reader = s3Response.Body.transformToWebStream().getReader()
        
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
        }
        
        const zipBuffer = Buffer.concat(chunks)
        console.log('ZIP buffer size:', zipBuffer.length)
        const extractedCode = await extractCodeFromZip(zipBuffer, functionConfig.Runtime || '')
        codeFiles = extractedCode.allFiles
        console.log('Extracted files count:', Object.keys(codeFiles).length)
      }
    } catch (error) {
      console.error('Failed to download function code using S3 SDK', { error })
      
      // Fallback to fetch method if S3 SDK fails
      try {
        console.log('Trying fallback fetch method...')
        const response = await fetch(functionCode.Code.Location)
        console.log('Fetch response status:', response.status)
        if (response.ok) {
          const zipBuffer = Buffer.from(await response.arrayBuffer())
          console.log('ZIP buffer size (fetch):', zipBuffer.length)
          const extractedCode = await extractCodeFromZip(zipBuffer, functionConfig.Runtime || '')
          codeFiles = extractedCode.allFiles
          console.log('Extracted files count (fetch):', Object.keys(codeFiles).length)
        } else {
          console.log('Fetch failed with status:', response.status)
          const errorText = await response.text()
          console.log('Error response:', errorText)
        }
      } catch (fetchError) {
        console.error('Fetch fallback also failed', { fetchError })
      }
    }
  } else {
    console.log('No code location found in function response')
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
    const functionDetails = await getFunctionDetailsWithCode(
      lambdaClient,
      params.functionName,
      params.region,
      params.accessKeyId,
      params.secretAccessKey
    )

    console.log('Final function details:', {
      functionName: functionDetails.functionName,
      filesCount: Object.keys(functionDetails.codeFiles).length,
      hasFiles: Object.keys(functionDetails.codeFiles).length > 0,
      allFields: Object.keys(functionDetails)
    })

    logger.info(`[${requestId}] Successfully fetched Lambda function: ${params.functionName}`)

    // Return the response directly to see if createSuccessResponse is filtering fields
    return new Response(JSON.stringify({
      success: true,
      output: functionDetails
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Failed to fetch Lambda function`, {
      error: error.message,
      stack: error.stack,
    })

    // Handle specific AWS errors
    if (error.name === 'ResourceNotFoundException') {
      let functionName = 'unknown'
      try {
        const errorBody = await request.json()
        functionName = errorBody?.functionName || 'unknown'
      } catch {
        // Ignore parsing errors for error handling
      }
      return createErrorResponse(
        `Lambda function '${functionName}' not found`,
        404,
        'FUNCTION_NOT_FOUND'
      )
    }

    if (error.name === 'AccessDeniedException') {
      return createErrorResponse(
        'Access denied. Please check your AWS credentials and permissions.',
        403,
        'ACCESS_DENIED'
      )
    }

    if (error.name === 'InvalidParameterValueException') {
      return createErrorResponse(
        'Invalid parameter value provided',
        400,
        'INVALID_PARAMETER'
      )
    }

    return createErrorResponse(
      'Failed to fetch Lambda function',
      500,
      'FETCH_ERROR'
    )
  }
} 