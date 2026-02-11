'use client'

import { WindowManagerProvider, useWindowManager } from './WindowManager'
import { Window } from './Window'
import { Taskbar } from './Taskbar'
import { DesktopIcon } from './DesktopIcon'
import { Notepad } from './apps/Notepad'
import { FolderView, FolderItem } from './apps/FolderView'
import { Chat } from './apps/Chat'
import { useState, useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

const INSTALL_GUIDE_CONTENT = `# SentryOS Install Guide

Welcome to **SentryOS** - your desktop environment for Sentry demos and presentations.

## Getting Started

This emulated desktop environment provides a Linux-like experience with:

- **Movable Windows** - Drag windows by their title bar
- **Resizable Windows** - Grab any edge or corner to resize
- **Minimize/Maximize** - Use the title bar buttons
- **Taskbar** - View and restore minimized windows

## Adding Custom Content

To add your own markdown files:

1. Place \`.md\` files in the \`public/\` directory
2. Create a desktop icon in \`page.tsx\`
3. Reference your file in the icon's click handler

## Customization

### Colors

The desktop uses Sentry's brand colors:

- Primary: \`#7553FF\` (Blurple)
- Accent: \`#FF45A8\` (Pink)
- Background: \`#0F0C14\` (Deep Purple)

### Fonts

All text uses **JetBrains Mono** for that authentic terminal feel.

## Tips

- Double-click desktop icons to open applications
- Click the taskbar to restore minimized windows
- The clock in the system tray shows current time

---

*Built with Next.js and React for the Sentry team.*`

function DesktopContent() {
  const { windows, openWindow } = useWindowManager()
  const [selectedIcon, setSelectedIcon] = useState<string | null>(null)

  useEffect(() => {
    Sentry.logger.info('Desktop environment initialized', {
      timestamp: new Date().toISOString()
    })

    Sentry.metrics.count('desktop.initialized', 1)

    return () => {
      Sentry.logger.info('Desktop environment unmounted')
    }
  }, [])

  const openInstallGuide = () => {
    Sentry.logger.info('Desktop icon opened', {
      icon: 'install-guide',
      type: 'notepad'
    })

    Sentry.metrics.count('desktop.icon.opened', 1, {
      attributes: { icon: 'install-guide' }
    })
    openWindow({
      id: 'install-guide',
      title: 'Install Guide.md',
      icon: '📄',
      x: 100,
      y: 50,
      width: 600,
      height: 500,
      minWidth: 400,
      minHeight: 300,
      isMinimized: false,
      isMaximized: false,
      content: <Notepad content={INSTALL_GUIDE_CONTENT} filename="Install Guide.md" />
    })
  }

  const openChatWindow = () => {
    Sentry.logger.info('Desktop icon opened', {
      icon: 'chat',
      type: 'chat'
    })

    Sentry.metrics.count('desktop.icon.opened', 1, {
      attributes: { icon: 'chat' }
    })
    openWindow({
      id: 'chat',
      title: 'SentryOS Chat',
      icon: '💬',
      x: 200,
      y: 80,
      width: 500,
      height: 550,
      minWidth: 350,
      minHeight: 400,
      isMinimized: false,
      isMaximized: false,
      content: <Chat />
    })
  }

  const openAgentsFolder = () => {
    Sentry.logger.info('Desktop icon opened', {
      icon: 'agents-folder',
      type: 'folder'
    })

    Sentry.metrics.count('desktop.icon.opened', 1, {
      attributes: { icon: 'agents-folder' }
    })

    const agentsFolderItems: FolderItem[] = []

    openWindow({
      id: 'agents-folder',
      title: 'Agents',
      icon: '📁',
      x: 150,
      y: 100,
      width: 400,
      height: 350,
      minWidth: 300,
      minHeight: 250,
      isMinimized: false,
      isMaximized: false,
      content: <FolderView items={agentsFolderItems} folderName="Agents" />
    })
  }

  const handleDesktopClick = () => {
    setSelectedIcon(null)
    Sentry.logger.info('Desktop clicked (deselect icons)')
  }

  return (
    <div className="fixed inset-0 desktop-wallpaper overflow-hidden" onClick={handleDesktopClick}>
      {/* Centered Sentry logo watermark */}
      <div className="absolute inset-0 bottom-12 flex items-center justify-center pointer-events-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/sentry-logo-glyph-light.svg"
          alt="Sentry"
          width={400}
          height={400}
          className="select-none"
        />
      </div>

      {/* Windows container - pointer-events-none so clicks pass through to desktop/icons */}
      <div className="absolute inset-0 bottom-12 pointer-events-none">
        {windows.map((win) => (
          <Window key={win.id} window={win} />
        ))}
      </div>

      {/* Desktop icons area - z-10 to ensure it's above windows container */}
      <div className="absolute top-4 left-4 flex flex-col gap-2 z-10" onClick={(e) => e.stopPropagation()}>
        <DesktopIcon
          id="install-guide"
          label="Install Guide"
          icon="document"
          onDoubleClick={openInstallGuide}
          selected={selectedIcon === 'install-guide'}
          onSelect={() => setSelectedIcon('install-guide')}
        />
        <DesktopIcon
          id="agents-folder"
          label="Agents"
          icon="folder"
          onDoubleClick={openAgentsFolder}
          selected={selectedIcon === 'agents-folder'}
          onSelect={() => setSelectedIcon('agents-folder')}
        />
        <DesktopIcon
          id="chat"
          label="Chat"
          icon="chat"
          onDoubleClick={openChatWindow}
          selected={selectedIcon === 'chat'}
          onSelect={() => setSelectedIcon('chat')}
        />
      </div>

      {/* Taskbar */}
      <Taskbar />
    </div>
  )
}

export function Desktop() {
  return (
    <WindowManagerProvider>
      <DesktopContent />
    </WindowManagerProvider>
  )
}
