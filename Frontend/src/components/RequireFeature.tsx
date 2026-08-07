import React from 'react'

interface RequireFeatureProps {
  phone: string
  feature: string
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface RequireFeatureState {
  loading: boolean
  hasAccess: boolean
}

export class RequireFeature extends React.Component<RequireFeatureProps, RequireFeatureState> {
  state: RequireFeatureState = { loading: true, hasAccess: false }

  async checkAccess() {
    try {
      const token = localStorage.getItem('user_token') || ''
      const res = await fetch('/api/user/package', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch package')
      const data = await res.json()
      const features = data.features || {}
      this.setState({ loading: false, hasAccess: features[this.props.feature] === true })
    } catch {
      this.setState({ loading: false, hasAccess: false })
    }
  }

  componentDidMount() {
    this.checkAccess()
  }

  componentDidUpdate(prevProps: RequireFeatureProps) {
    if (prevProps.phone !== this.props.phone || prevProps.feature !== this.props.feature) {
      this.checkAccess()
    }
  }

  render() {
    if (this.state.loading) {
      return <div className="h-10 rounded-lg bg-slate-100 animate-pulse" />
    }
    if (this.state.hasAccess) {
      return <>{this.props.children}</>
    }
    if (this.props.fallback) {
      return <>{this.props.fallback}</>
    }
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center dark:border-slate-700 dark:bg-slate-800">
        <div className="text-3xl mb-3">🔒</div>
        <h3 className="text-lg font-semibold mb-2">Feature Locked</h3>
        <p className="text-sm text-slate-500 mb-4">
          This feature is not included in your current package. Please upgrade your subscription to access it.
        </p>
        <a
          href="/packages"
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Upgrade Plan
        </a>
      </div>
    )
  }
}

export function LockedFeature({ feature, onUpgrade }: { feature: string; onUpgrade?: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center dark:border-slate-600 dark:bg-slate-800">
      <div className="text-3xl mb-3">🔒</div>
      <h3 className="text-lg font-semibold mb-2">{feature}</h3>
      <p className="text-sm text-slate-500 mb-4">
        This feature is not included in your current package.
      </p>
      <a
        href="/packages"
        className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        onClick={onUpgrade}
      >
        Upgrade to Unlock
      </a>
    </div>
  )
}
