import {
  ApiGatewayV2Client,
  CreateApiCommand,
  CreateIntegrationCommand,
  CreateRouteCommand,
  CreateStageCommand,
  GetApisCommand,
  GetStagesCommand,
} from '@aws-sdk/client-apigatewayv2'
import { AddPermissionCommand, GetFunctionCommand, LambdaClient } from '@aws-sdk/client-lambda'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console-logger'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('AWSLambdaDeployEndpointAPI')

// Validation schema for the request body
const DeployEndpointRequestSchema = z.object({
  accessKeyId: z.string().min(1, 'AWS Access Key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS Secret Access Key is required'),
  region: z.string().min(1, 'AWS Region is required'),
  functionName: z.string().min(1, 'Function name is required'),
  endpointName: z.string().min(1, 'Endpoint name is required'),
  role: z.string().min(1, 'Role ARN is required'),
})

type DeployEndpointRequest = z.infer<typeof DeployEndpointRequestSchema>

interface DeployEndpointResponse {
  functionArn: string
  functionName: string
  endpointName: string
  endpointUrl: string
  region: string
  status: string
  lastModified: string
  apiGatewayId: string
  stageName: string
}

/**
 * Check if a Lambda function exists
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
 * Get Lambda function details
 */
async function getFunctionDetails(lambdaClient: LambdaClient, functionName: string): Promise<any> {
  return await lambdaClient.send(new GetFunctionCommand({ FunctionName: functionName }))
}

/**
 * Check if API Gateway HTTP API already exists
 */
async function checkApiExists(
  apiGatewayClient: ApiGatewayV2Client,
  apiName: string
): Promise<string | null> {
  try {
    const apis = await apiGatewayClient.send(new GetApisCommand({}))
    const existingApi = apis.Items?.find((api: any) => api.Name === apiName)
    return existingApi?.ApiId || null
  } catch (error) {
    logger.error('Error checking for existing API', { error })
    return null
  }
}

/**
 * Create a new API Gateway HTTP API
 */
async function createApiGateway(
  apiGatewayClient: ApiGatewayV2Client,
  apiName: string
): Promise<string> {
  const createApiResponse = await apiGatewayClient.send(
    new CreateApiCommand({
      Name: apiName,
      ProtocolType: 'HTTP',
      Description: `HTTP API for Lambda function ${apiName}`,
    })
  )

  if (!createApiResponse.ApiId) {
    throw new Error('Failed to create API Gateway - no ID returned')
  }

  return createApiResponse.ApiId
}

/**
 * Create API Gateway integration with Lambda
 */
async function createApiIntegration(
  apiGatewayClient: ApiGatewayV2Client,
  apiId: string,
  functionArn: string
): Promise<string> {
  const integration = await apiGatewayClient.send(
    new CreateIntegrationCommand({
      ApiId: apiId,
      IntegrationType: 'AWS_PROXY',
      IntegrationUri: functionArn,
      IntegrationMethod: 'POST',
      PayloadFormatVersion: '2.0',
    })
  )

  if (!integration.IntegrationId) {
    throw new Error('Failed to create integration - no ID returned')
  }

  return integration.IntegrationId
}

/**
 * Create a route for the API Gateway
 */
async function createApiRoute(
  apiGatewayClient: ApiGatewayV2Client,
  apiId: string,
  integrationId: string
): Promise<void> {
  await apiGatewayClient.send(
    new CreateRouteCommand({
      ApiId: apiId,
      RouteKey: 'ANY /',
      Target: `integrations/${integrationId}`,
    })
  )
}

/**
 * Add Lambda permission for API Gateway
 */
async function addLambdaPermission(
  lambdaClient: LambdaClient,
  functionName: string,
  apiId: string,
  region: string,
  accountId: string
): Promise<void> {
  try {
    await lambdaClient.send(
      new AddPermissionCommand({
        FunctionName: functionName,
        StatementId: `api-gateway-${apiId}`,
        Action: 'lambda:InvokeFunction',
        Principal: 'apigateway.amazonaws.com',
        SourceArn: `arn:aws:execute-api:${region}:${accountId}:${apiId}/*/*`,
      })
    )
  } catch (error: any) {
    // If permission already exists, that's fine
    if (error.name !== 'ResourceConflictException') {
      throw error
    }
  }
}

/**
 * Check if a stage exists for the API Gateway
 */
async function checkStageExists(
  apiGatewayClient: ApiGatewayV2Client,
  apiId: string,
  stageName: string
): Promise<boolean> {
  try {
    const stages = await apiGatewayClient.send(
      new GetStagesCommand({
        ApiId: apiId,
      })
    )
    return stages.Items?.some((stage: any) => stage.StageName === stageName) || false
  } catch (error) {
    logger.error('Error checking for existing stage', { error })
    return false
  }
}

/**
 * Create a stage for the API Gateway
 */
async function createApiStage(
  apiGatewayClient: ApiGatewayV2Client,
  apiId: string
): Promise<string> {
  const stageName = 'prod'

  // Check if stage already exists
  const stageExists = await checkStageExists(apiGatewayClient, apiId, stageName)

  if (stageExists) {
    logger.info(`Stage ${stageName} already exists for API ${apiId}`)
    return stageName
  }

  logger.info(`Creating new stage ${stageName} for API ${apiId}`)
  const stage = await apiGatewayClient.send(
    new CreateStageCommand({
      ApiId: apiId,
      StageName: stageName,
      AutoDeploy: true,
    })
  )

  return stage.StageName || stageName
}

/**
 * Ensure API is deployed by waiting for deployment to complete
 */
async function ensureApiDeployed(
  apiGatewayClient: ApiGatewayV2Client,
  apiId: string,
  stageName: string
): Promise<void> {
  // In API Gateway v2, AutoDeploy: true should handle deployment automatically
  // But we can add a small delay to ensure the deployment completes
  await new Promise((resolve) => setTimeout(resolve, 2000))

  logger.info(`API Gateway deployment completed for API ${apiId}, stage ${stageName}`)
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    logger.info(`[${requestId}] Processing AWS Lambda deploy endpoint request`)

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

    const validationResult = DeployEndpointRequestSchema.safeParse(body)
    if (!validationResult.success) {
      logger.warn(`[${requestId}] Invalid request body`, { errors: validationResult.error.errors })
      return createErrorResponse('Invalid request parameters', 400, 'VALIDATION_ERROR')
    }

    const params = validationResult.data

    // Log the deployment payload (excluding sensitive credentials)
    logger.info(`[${requestId}] AWS Lambda deploy endpoint payload received`, {
      functionName: params.functionName,
      endpointName: params.endpointName,
      region: params.region,
      accessKeyId: params.accessKeyId ? `${params.accessKeyId.substring(0, 4)}...` : undefined,
      hasSecretAccessKey: !!params.secretAccessKey,
      hasRole: !!params.role,
      role: params.role ? `${params.role.substring(0, 20)}...` : undefined,
    })

    logger.info(`[${requestId}] Deploying Lambda function as endpoint: ${params.functionName}`)

    // Create Lambda client
    const lambdaClient = new LambdaClient({
      region: params.region,
      credentials: {
        accessKeyId: params.accessKeyId,
        secretAccessKey: params.secretAccessKey,
      },
    })

    // Create API Gateway v2 client
    const apiGatewayClient = new ApiGatewayV2Client({
      region: params.region,
      credentials: {
        accessKeyId: params.accessKeyId,
        secretAccessKey: params.secretAccessKey,
      },
    })

    // Check if Lambda function exists
    const functionExists = await checkFunctionExists(lambdaClient, params.functionName)
    if (!functionExists) {
      logger.error(`[${requestId}] Lambda function ${params.functionName} does not exist`)
      return createErrorResponse(
        `Lambda function ${params.functionName} does not exist. Please deploy the function first.`,
        404,
        'FUNCTION_NOT_FOUND'
      )
    }

    // Get function details
    const functionDetails = await getFunctionDetails(lambdaClient, params.functionName)
    const functionArn = functionDetails.Configuration?.FunctionArn

    if (!functionArn) {
      logger.error(`[${requestId}] Failed to get function ARN for ${params.functionName}`)
      return createErrorResponse('Failed to get function ARN', 500, 'FUNCTION_ARN_ERROR')
    }

    // Extract account ID from function ARN
    const accountId = functionArn.split(':')[4]
    if (!accountId) {
      logger.error(`[${requestId}] Failed to extract account ID from function ARN: ${functionArn}`)
      return createErrorResponse(
        'Failed to extract account ID from function ARN',
        500,
        'ACCOUNT_ID_ERROR'
      )
    }

    // Check if API Gateway already exists
    let apiId = await checkApiExists(apiGatewayClient, params.endpointName)

    if (!apiId) {
      logger.info(`[${requestId}] Creating new API Gateway HTTP API: ${params.endpointName}`)
      apiId = await createApiGateway(apiGatewayClient, params.endpointName)
    } else {
      logger.info(
        `[${requestId}] Using existing API Gateway HTTP API: ${params.endpointName} (${apiId})`
      )
    }

    // Create API integration with Lambda
    logger.info(`[${requestId}] Creating API Gateway integration`)
    const integrationId = await createApiIntegration(apiGatewayClient, apiId, functionArn)

    // Create route for the API
    logger.info(`[${requestId}] Creating API Gateway route`)
    await createApiRoute(apiGatewayClient, apiId, integrationId)

    // Add Lambda permission for API Gateway
    logger.info(`[${requestId}] Adding Lambda permission for API Gateway`)
    await addLambdaPermission(lambdaClient, params.functionName, apiId, params.region, accountId)

    // Create stage for the API Gateway
    logger.info(`[${requestId}] Creating API Gateway stage`)
    const stageName = await createApiStage(apiGatewayClient, apiId)

    if (!stageName) {
      logger.error(`[${requestId}] Failed to create or get stage for API ${apiId}`)
      return createErrorResponse('Failed to create API Gateway stage', 500, 'STAGE_CREATION_ERROR')
    }

    // Ensure API is deployed
    logger.info(`[${requestId}] Ensuring API Gateway deployment is complete`)
    await ensureApiDeployed(apiGatewayClient, apiId, stageName)

    // Construct the endpoint URL
    const endpointUrl = `https://${apiId}.execute-api.${params.region}.amazonaws.com/${stageName}/`

    const response: DeployEndpointResponse = {
      functionArn,
      functionName: params.functionName,
      endpointName: params.endpointName,
      endpointUrl,
      region: params.region,
      status: 'ACTIVE',
      lastModified: new Date().toISOString(),
      apiGatewayId: apiId,
      stageName,
    }

    logger.info(`[${requestId}] Lambda function endpoint deployment completed successfully`, {
      functionName: params.functionName,
      endpointName: params.endpointName,
      endpointUrl,
      apiGatewayId: apiId,
    })

    return createSuccessResponse({
      success: true,
      output: response,
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Error deploying Lambda function endpoint`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    // Handle specific AWS errors
    let errorMessage = 'Failed to deploy Lambda function endpoint'
    let statusCode = 500

    if (error.name === 'AccessDeniedException') {
      errorMessage = 'Access denied. Please check your AWS credentials and permissions.'
      statusCode = 403
    } else if (error.name === 'InvalidParameterValueException') {
      errorMessage = `Invalid parameter: ${error.message}`
      statusCode = 400
    } else if (error.name === 'ResourceConflictException') {
      errorMessage = 'Resource conflict. The API may be in use or being updated.'
      statusCode = 409
    } else if (error.name === 'ServiceException') {
      errorMessage = 'AWS service error. Please try again later.'
      statusCode = 503
    } else if (error instanceof Error) {
      errorMessage = error.message
    }

    return createErrorResponse(errorMessage, statusCode, 'DEPLOYMENT_ERROR')
  }
}
