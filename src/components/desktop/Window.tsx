'use client'

import { useState, useEffect, useRef } from 'react'
import { Rnd } from 'react-rnd'
import { X, Minus, Square, Copy } from 'lucide-react'
import * as Sentry from '@sentry/nextjs'
import { WindowState } from './types'
import { useWindowManager } from './WindowManager'

interface WindowProps {
  window: WindowState
}

export function Window({ window: win }: WindowProps) {
  const {
    closeWindow,
    minimizeWindow,
    maximizeWindow,
    focusWindow,
    updateWindowPosition,
    updateWindowSize
  } = useWindowManager()

  const [mounted, setMounted] = useState(false)
  const dragStartTime = useRef<number>(0)
  const resizeStartTime = useRef<number>(0)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted || win.isMinimized) {
    return null
  }

  const position = win.isMaximized
    ? { x: 0, y: 0 }
    : { x: win.x, y: win.y }

  const size = win.isMaximized
    ? { width: '100%', height: 'calc(100% - 48px)' }
    : { width: win.width, height: win.height }

  return (
    <Rnd
      position={position}
      size={size}
      minWidth={win.minWidth}
      minHeight={win.minHeight}
      disableDragging={win.isMaximized}
      enableResizing={!win.isMaximized}
      dragHandleClassName="window-drag-handle"
      style={{ zIndex: win.zIndex }}
      onDragStart={() => {
        focusWindow(win.id)
        dragStartTime.current = Date.now()

        Sentry.logger.info('Window drag started', {
          windowId: win.id,
          windowTitle: win.title
        })
      }}
      onDragStop={(_e, d) => {
        if (!win.isMaximized) {
          const dragDuration = Date.now() - dragStartTime.current

          Sentry.metrics.distribution('window.drag_duration', dragDuration, {
            unit: 'millisecond',
            attributes: { windowId: win.id }
          })

          updateWindowPosition(win.id, d.x, d.y)
        }
      }}
      onResizeStart={() => {
        resizeStartTime.current = Date.now()

        Sentry.logger.info('Window resize started', {
          windowId: win.id,
          windowTitle: win.title
        })
      }}
      onResizeStop={(_e, _dir, ref, _delta, pos) => {
        if (!win.isMaximized) {
          const resizeDuration = Date.now() - resizeStartTime.current

          Sentry.metrics.distribution('window.resize_duration', resizeDuration, {
            unit: 'millisecond',
            attributes: { windowId: win.id }
          })

          updateWindowSize(win.id, ref.offsetWidth, ref.offsetHeight)
          updateWindowPosition(win.id, pos.x, pos.y)
        }
      }}
      onMouseDown={() => focusWindow(win.id)}
      bounds="parent"
      className={`absolute pointer-events-auto ${win.isFocused ? 'window-focused' : 'window-shadow'}`}
    >
      <div className="flex flex-col h-full bg-[#1e1a2a] rounded overflow-hidden border border-[#362552]">
        {/* Title bar */}
        <div
          className="window-drag-handle flex items-center justify-between h-8 px-2 bg-[#2a2438] border-b border-[#362552] cursor-move select-none"
        >
          <div className="flex items-center gap-2 text-sm text-[#9086a3] truncate">
            <span className="text-base">{win.icon}</span>
            <span className="truncate">{win.title}</span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation()
                minimizeWindow(win.id)
              }}
              className="p-1 rounded hover:bg-[#362552] transition-colors"
              title="Minimize"
            >
              <Minus className="w-3.5 h-3.5 text-[#9086a3]" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                maximizeWindow(win.id)
              }}
              className="p-1 rounded hover:bg-[#362552] transition-colors"
              title={win.isMaximized ? 'Restore' : 'Maximize'}
            >
              {win.isMaximized ? (
                <Copy className="w-3.5 h-3.5 text-[#9086a3]" />
              ) : (
                <Square className="w-3.5 h-3.5 text-[#9086a3]" />
              )}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                closeWindow(win.id)
              }}
              className="p-1 rounded hover:bg-[#ff4757] transition-colors group"
              title="Close"
            >
              <X className="w-3.5 h-3.5 text-[#9086a3] group-hover:text-white" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {win.content}
        </div>
      </div>
    </Rnd>
  )
}
