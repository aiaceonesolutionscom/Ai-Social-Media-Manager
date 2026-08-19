import React, { useEffect, useState } from 'react'
import { Navigate, Link } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { useUserAuth } from '../contexts/UserAuthContext'

interface RequireUserProps {
  children: React.ReactNode
}

export function RequireUser({ children }: RequireUserProps): React.ReactElement {
  const { isAuthenticated, loading } = useUserAuth()
  const { isSignedIn } = useAuth()
  const [showFallback, setShowFallback] = useState(false)

  useEffect(() => {
    if (!loading && !isAuthenticated && isSignedIn) {
      const t = setTimeout(() => setShowFallback(true), 6000)
      return () => clearTimeout(t)
    }
    setShowFallback(false)
  }, [loading, isAuthenticated, isSignedIn])

  if (loading) {
    return <LoadingState />
  }
  if (isAuthenticated) {
    return <>{children}</>
  }
  if (isSignedIn) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
        <p className="text-sm text-slate-500 dark:text-slate-400">Setting up your session...</p>
        {showFallback && (
          <Link to="/login" className="text-xs text-indigo-600 underline underline-offset-2 dark:text-indigo-300">
            Taking too long? Use email &amp; password instead
          </Link>
        )}
      </div>
    )
  }
  return <Navigate to="/login" replace />
}

function LoadingState() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
    </div>
  )
}
