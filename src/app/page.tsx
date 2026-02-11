'use client'

import dynamic from 'next/dynamic'
import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

const Desktop = dynamic(
  () => import('@/components/desktop/Desktop').then(mod => mod.Desktop),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 bg-[#0f0c14] flex items-center justify-center">
        <div className="text-[#7553ff] text-xl animate-pulse">Loading SentryOS...</div>
      </div>
    )
  }
)

export default function Home() {
  useEffect(() => {
    const loadStartTime = performance.now()

    Sentry.logger.info('SentryOS application loaded', {
      userAgent: navigator.userAgent,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      timestamp: new Date().toISOString()
    })

    Sentry.metrics.increment('page.load', 1, {
      tags: { page: 'home' }
    })

    const loadTime = performance.now() - loadStartTime
    Sentry.metrics.distribution('page.load_time', loadTime, {
      unit: 'millisecond',
      tags: { page: 'home' }
    })
  }, [])

  return <Desktop />
}
