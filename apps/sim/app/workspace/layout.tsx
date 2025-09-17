'use client'

import { useEffect } from 'react'
import { useSession } from '@/lib/auth-client'
import { isProd } from '@/lib/environment'
import { SocketProvider } from '@/contexts/socket-context'

interface WorkspaceRootLayoutProps {
  children: React.ReactNode
}

export default function WorkspaceRootLayout({ children }: WorkspaceRootLayoutProps) {
  const session = useSession()

  console.log('🌟 WorkspaceRootLayout rendered!', {
    hasSession: !!session.data,
    timestamp: new Date().toISOString(),
  })

  const user = session.data?.user
    ? {
        id: session.data.user.id,
        name: session.data.user.name ?? undefined,
        email: session.data.user.email,
      }
    : undefined

  // Check if user needs email verification
  useEffect(() => {
    console.log('🔍 Workspace verification check:', {
      hasUser: !!session.data?.user,
      isProd,
      userEmail: session.data?.user?.email,
      emailVerified: session.data?.user?.emailVerified,
      pathname: window.location.pathname,
    })

    // In production, redirect unverified users to verification page
    if (session.data?.user && isProd) {
      const user = session.data.user
      if (!user.emailVerified && user.email) {
        console.log('🚨 User needs verification - redirecting to /verify')
        // Only redirect if not already on a verification-related page
        if (
          !window.location.pathname.startsWith('/verify') &&
          !window.location.pathname.startsWith('/login') &&
          !window.location.pathname.startsWith('/signup')
        ) {
          const verifyUrl = new URL('/verify', window.location.origin)
          verifyUrl.searchParams.set('email', encodeURIComponent(user.email))
          window.location.href = verifyUrl.toString()
        }
      } else {
        console.log('✅ User verification status OK:', {
          emailVerified: user.emailVerified,
          hasEmail: !!user.email,
        })
      }
    } else {
      console.log('⚠️ Verification check skipped:', {
        reason: !session.data?.user ? 'no user' : !isProd ? 'not prod' : 'unknown',
      })
    }
  }, [session.data?.user])

  return <SocketProvider user={user}>{children}</SocketProvider>
}
