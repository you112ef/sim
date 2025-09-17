'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { client } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('useVerification')

interface UseVerificationParams {
  hasResendKey: boolean
}

interface UseVerificationReturn {
  otp: string
  email: string
  isLoading: boolean
  isVerified: boolean
  isInvalidOtp: boolean
  errorMessage: string
  isOtpComplete: boolean
  isFromSignup: boolean
  verifyCode: () => Promise<void>
  resendCode: () => void
  handleOtpChange: (value: string) => void
  goBackToAuth: () => void
}

export function useVerification({ hasResendKey }: UseVerificationParams): UseVerificationReturn {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [otp, setOtp] = useState('')
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isVerified, setIsVerified] = useState(false)
  const [isInvalidOtp, setIsInvalidOtp] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null)
  const [isInviteFlow, setIsInviteFlow] = useState(false)
  const [isFromSignup, setIsFromSignup] = useState(false)

  useEffect(() => {
    const redirectParam = searchParams.get('redirectAfter')
    if (redirectParam) {
      setRedirectUrl(redirectParam)
    }

    const inviteFlowParam = searchParams.get('invite_flow')
    if (inviteFlowParam === 'true') {
      setIsInviteFlow(true)
    }

    const fromSignupParam = searchParams.get('fromSignup')
    if (fromSignupParam === 'true') {
      setIsFromSignup(true)
    }

    const emailParam = searchParams.get('email')
    if (emailParam) {
      setEmail(decodeURIComponent(emailParam))
    }
  }, [searchParams])

  // Auto-send OTP when arriving from workspace redirect (not from signup)
  useEffect(() => {
    logger.info('Auto-send OTP effect running', {
      email: !!email,
      isFromSignup,
      isLoading,
      hasResendKey,
      shouldSend: email && !isFromSignup && !isLoading && hasResendKey,
    })

    if (email && !isFromSignup && !isLoading && hasResendKey) {
      logger.info('Auto-sending OTP for workspace redirect', { email })
      client.emailOtp
        .sendVerificationOtp({
          email,
          type: 'email-verification',
        })
        .then(() => {
          logger.info('Initial OTP sent successfully')
        })
        .catch((error) => {
          logger.error('Failed to send initial OTP:', error)
          setErrorMessage('Failed to send verification code. Please try again later.')
        })
    }
  }, [email, isFromSignup, isLoading, hasResendKey])

  // Enable the verify button when all 6 digits are entered
  const isOtpComplete = otp.length === 6

  async function verifyCode() {
    if (!isOtpComplete || !email) return

    setIsLoading(true)
    setIsInvalidOtp(false)
    setErrorMessage('')

    try {
      const response = await client.emailOtp.verifyEmail({
        email,
        otp,
      })

      if (response && !response.error) {
        setIsVerified(true)

        setTimeout(() => {
          if (isInviteFlow && redirectUrl) {
            window.location.href = redirectUrl
          } else {
            window.location.href = '/workspace'
          }
        }, 1000)
      } else {
        logger.info('Setting invalid OTP state - API error response')
        const message = 'Invalid verification code. Please check and try again.'
        setIsInvalidOtp(true)
        setErrorMessage(message)
        logger.info('Error state after API error:', {
          isInvalidOtp: true,
          errorMessage: message,
        })
        setOtp('')
      }
    } catch (error: any) {
      let message = 'Verification failed. Please check your code and try again.'

      if (error.message?.includes('expired')) {
        message = 'The verification code has expired. Please request a new one.'
      } else if (error.message?.includes('invalid')) {
        logger.info('Setting invalid OTP state - caught error')
        message = 'Invalid verification code. Please check and try again.'
      } else if (error.message?.includes('attempts')) {
        message = 'Too many failed attempts. Please request a new code.'
      }

      setIsInvalidOtp(true)
      setErrorMessage(message)
      logger.info('Error state after caught error:', {
        isInvalidOtp: true,
        errorMessage: message,
      })

      setOtp('')
    } finally {
      setIsLoading(false)
    }
  }

  function resendCode() {
    if (!email || !hasResendKey) return

    setIsLoading(true)
    setErrorMessage('')

    client.emailOtp
      .sendVerificationOtp({
        email,
        type: 'email-verification',
      })
      .then(() => {})
      .catch(() => {
        setErrorMessage('Failed to resend verification code. Please try again later.')
      })
      .finally(() => {
        setIsLoading(false)
      })
  }

  function handleOtpChange(value: string) {
    if (value.length === 6) {
      setIsInvalidOtp(false)
      setErrorMessage('')
    }
    setOtp(value)
  }

  async function goBackToAuth() {
    const targetPage = isFromSignup ? '/signup' : '/login'
    const urlParams = new URLSearchParams()

    if (isInviteFlow && redirectUrl) {
      urlParams.set('invite_flow', 'true')
      urlParams.set('callbackUrl', redirectUrl)
    }

    const queryString = urlParams.toString()
    const fullUrl = queryString ? `${targetPage}?${queryString}` : targetPage

    // If coming from signup, user has a session but wants to start over
    // Sign them out first, then redirect
    try {
      await client.signOut()
      // Use window.location to ensure clean redirect after signout
      window.location.href = fullUrl
    } catch (error) {
      // If signout fails, still try to navigate
      router.push(fullUrl)
    }
  }

  useEffect(() => {
    if (otp.length === 6 && email && !isLoading && !isVerified) {
      const timeoutId = setTimeout(() => {
        verifyCode()
      }, 300)

      return () => clearTimeout(timeoutId)
    }
  }, [otp, email, isLoading, isVerified])

  return {
    otp,
    email,
    isLoading,
    isVerified,
    isInvalidOtp,
    errorMessage,
    isOtpComplete,
    isFromSignup,
    verifyCode,
    resendCode,
    handleOtpChange,
    goBackToAuth,
  }
}
