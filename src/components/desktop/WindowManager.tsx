'use client'

import { useState, useCallback, createContext, useContext, ReactNode } from 'react'
import * as Sentry from '@sentry/nextjs'
import { WindowState } from './types'

interface WindowManagerContextType {
  windows: WindowState[]
  openWindow: (window: Omit<WindowState, 'zIndex' | 'isFocused'>) => void
  closeWindow: (id: string) => void
  minimizeWindow: (id: string) => void
  maximizeWindow: (id: string) => void
  restoreWindow: (id: string) => void
  focusWindow: (id: string) => void
  updateWindowPosition: (id: string, x: number, y: number) => void
  updateWindowSize: (id: string, width: number, height: number) => void
  topZIndex: number
}

const WindowManagerContext = createContext<WindowManagerContextType | null>(null)

export function useWindowManager() {
  const context = useContext(WindowManagerContext)
  if (!context) {
    throw new Error('useWindowManager must be used within WindowManagerProvider')
  }
  return context
}

export function WindowManagerProvider({ children }: { children: ReactNode }) {
  const [windows, setWindows] = useState<WindowState[]>([])
  const [topZIndex, setTopZIndex] = useState(100)

  const openWindow = useCallback((window: Omit<WindowState, 'zIndex' | 'isFocused'>) => {
    Sentry.logger.info('Window opened: %s', [window.title])
    Sentry.metrics.increment('window.opened', 1, { tags: { window_id: window.id } })
    setTopZIndex(currentZ => {
      const newZ = currentZ + 1
      setWindows(prev => {
        const existing = prev.find(w => w.id === window.id)
        if (existing) {
          if (existing.isMinimized) {
            return prev.map(w =>
              w.id === window.id
                ? { ...w, isMinimized: false, isFocused: true, zIndex: newZ }
                : { ...w, isFocused: false }
            )
          }
          return prev.map(w =>
            w.id === window.id
              ? { ...w, isFocused: true, zIndex: newZ }
              : { ...w, isFocused: false }
          )
        }
        return [
          ...prev.map(w => ({ ...w, isFocused: false })),
          { ...window, zIndex: newZ, isFocused: true }
        ]
      })
      return newZ
    })
  }, [])

  const closeWindow = useCallback((id: string) => {
    Sentry.logger.info('Window closed: %s', [id])
    Sentry.metrics.increment('window.closed', 1, { tags: { window_id: id } })
    setWindows(prev => prev.filter(w => w.id !== id))
  }, [])

  const minimizeWindow = useCallback((id: string) => {
    Sentry.logger.info('Window minimized: %s', [id])
    Sentry.metrics.increment('window.minimized', 1, { tags: { window_id: id } })
    setWindows(prev => prev.map(w =>
      w.id === id ? { ...w, isMinimized: true, isFocused: false } : w
    ))
  }, [])

  const maximizeWindow = useCallback((id: string) => {
    setWindows(prev => {
      const win = prev.find(w => w.id === id)
      const action = win?.isMaximized ? 'restored' : 'maximized'
      Sentry.logger.info('Window %s: %s', [action, id])
      Sentry.metrics.increment(`window.${action}`, 1, { tags: { window_id: id } })
      return prev.map(w =>
        w.id === id ? { ...w, isMaximized: !w.isMaximized } : w
      )
    })
  }, [])

  const restoreWindow = useCallback((id: string) => {
    setTopZIndex(currentZ => {
      const newZ = currentZ + 1
      setWindows(prev => prev.map(w =>
        w.id === id
          ? { ...w, isMinimized: false, isFocused: true, zIndex: newZ }
          : { ...w, isFocused: false }
      ))
      return newZ
    })
  }, [])

  const focusWindow = useCallback((id: string) => {
    setTopZIndex(currentZ => {
      const newZ = currentZ + 1
      setWindows(prev => prev.map(w =>
        w.id === id
          ? { ...w, isFocused: true, zIndex: newZ }
          : { ...w, isFocused: false }
      ))
      return newZ
    })
  }, [])

  const updateWindowPosition = useCallback((id: string, x: number, y: number) => {
    setWindows(prev => prev.map(w =>
      w.id === id ? { ...w, x, y } : w
    ))
  }, [])

  const updateWindowSize = useCallback((id: string, width: number, height: number) => {
    setWindows(prev => prev.map(w =>
      w.id === id ? { ...w, width, height } : w
    ))
  }, [])

  return (
    <WindowManagerContext.Provider value={{
      windows,
      openWindow,
      closeWindow,
      minimizeWindow,
      maximizeWindow,
      restoreWindow,
      focusWindow,
      updateWindowPosition,
      updateWindowSize,
      topZIndex
    }}>
      {children}
    </WindowManagerContext.Provider>
  )
}
