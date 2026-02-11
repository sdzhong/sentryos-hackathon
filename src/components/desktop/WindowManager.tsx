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
    setTopZIndex(currentZ => {
      const newZ = currentZ + 1
      setWindows(prev => {
        const existing = prev.find(w => w.id === window.id)
        if (existing) {
          if (existing.isMinimized) {
            Sentry.logger.info('Window restored from taskbar', {
              windowId: window.id,
              windowTitle: window.title
            })

            Sentry.metrics.count('window.restored', 1, {
              attributes: { windowId: window.id }
            })

            return prev.map(w =>
              w.id === window.id
                ? { ...w, isMinimized: false, isFocused: true, zIndex: newZ }
                : { ...w, isFocused: false }
            )
          }

          Sentry.logger.info('Window focused (already open)', {
            windowId: window.id,
            windowTitle: window.title
          })

          return prev.map(w =>
            w.id === window.id
              ? { ...w, isFocused: true, zIndex: newZ }
              : { ...w, isFocused: false }
          )
        }

        Sentry.logger.info('Window opened', {
          windowId: window.id,
          windowTitle: window.title,
          dimensions: `${window.width}x${window.height}`,
          position: `${window.x},${window.y}`
        })

        Sentry.metrics.count('window.opened', 1, {
          attributes: { windowId: window.id }
        })

        setWindows(windows => {
          const openCount = windows.length + 1
          Sentry.metrics.gauge('window.open_count', openCount)
        })

        return [
          ...prev.map(w => ({ ...w, isFocused: false })),
          { ...window, zIndex: newZ, isFocused: true }
        ]
      })
      return newZ
    })
  }, [])

  const closeWindow = useCallback((id: string) => {
    setWindows(prev => {
      const window = prev.find(w => w.id === id)
      if (window) {
        Sentry.logger.info('Window closed', {
          windowId: id,
          windowTitle: window.title
        })

        Sentry.metrics.count('window.closed', 1, {
          attributes: { windowId: id }
        })

        const newWindows = prev.filter(w => w.id !== id)
        Sentry.metrics.gauge('window.open_count', newWindows.length)
      }

      return prev.filter(w => w.id !== id)
    })
  }, [])

  const minimizeWindow = useCallback((id: string) => {
    setWindows(prev => {
      const window = prev.find(w => w.id === id)
      if (window) {
        Sentry.logger.info('Window minimized', {
          windowId: id,
          windowTitle: window.title
        })

        Sentry.metrics.count('window.minimized', 1, {
          attributes: { windowId: id }
        })
      }

      return prev.map(w =>
        w.id === id ? { ...w, isMinimized: true, isFocused: false } : w
      )
    })
  }, [])

  const maximizeWindow = useCallback((id: string) => {
    setWindows(prev => {
      const window = prev.find(w => w.id === id)
      if (window) {
        const isMaximizing = !window.isMaximized

        Sentry.logger.info(isMaximizing ? 'Window maximized' : 'Window restored from maximize', {
          windowId: id,
          windowTitle: window.title
        })

        Sentry.metrics.count(isMaximizing ? 'window.maximized' : 'window.unmaximized', 1, {
          attributes: { windowId: id }
        })
      }

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
    setWindows(prev => {
      const window = prev.find(w => w.id === id)
      if (window) {
        Sentry.logger.info('Window position updated', {
          windowId: id,
          windowTitle: window.title,
          newPosition: `${x},${y}`
        })

        Sentry.metrics.count('window.moved', 1, {
          attributes: { windowId: id }
        })
      }

      return prev.map(w =>
        w.id === id ? { ...w, x, y } : w
      )
    })
  }, [])

  const updateWindowSize = useCallback((id: string, width: number, height: number) => {
    setWindows(prev => {
      const window = prev.find(w => w.id === id)
      if (window) {
        Sentry.logger.info('Window size updated', {
          windowId: id,
          windowTitle: window.title,
          newSize: `${width}x${height}`
        })

        Sentry.metrics.count('window.resized', 1, {
          attributes: { windowId: id }
        })

        Sentry.metrics.distribution('window.width', width, {
          unit: 'pixel',
          attributes: { windowId: id }
        })

        Sentry.metrics.distribution('window.height', height, {
          unit: 'pixel',
          attributes: { windowId: id }
        })
      }

      return prev.map(w =>
        w.id === id ? { ...w, width, height } : w
      )
    })
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
