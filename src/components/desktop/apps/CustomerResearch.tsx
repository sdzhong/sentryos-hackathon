'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Building2, Bot, User, Loader2, Wrench, Search, Globe, FileText, Terminal } from 'lucide-react'
import * as Sentry from '@sentry/nextjs'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

interface ToolStatus {
  name: string
  status: 'running' | 'complete'
  elapsed?: number
}

// Map tool names to friendly display names and icons
const toolDisplayInfo: Record<string, { name: string; icon: 'search' | 'globe' | 'file' | 'terminal' | 'wrench' }> = {
  'WebSearch': { name: 'Web Search', icon: 'search' },
  'WebFetch': { name: 'Fetching URL', icon: 'globe' },
  'Read': { name: 'Reading File', icon: 'file' },
  'Write': { name: 'Writing File', icon: 'file' },
  'Edit': { name: 'Editing File', icon: 'file' },
  'Glob': { name: 'Finding Files', icon: 'file' },
  'Grep': { name: 'Searching Content', icon: 'search' },
  'Bash': { name: 'Running Command', icon: 'terminal' },
  'Task': { name: 'Running Task', icon: 'wrench' },
}

const ToolIcon = ({ type }: { type: 'search' | 'globe' | 'file' | 'terminal' | 'wrench' }) => {
  const iconClass = "w-3 h-3"
  switch (type) {
    case 'search': return <Search className={iconClass} />
    case 'globe': return <Globe className={iconClass} />
    case 'file': return <FileText className={iconClass} />
    case 'terminal': return <Terminal className={iconClass} />
    default: return <Wrench className={iconClass} />
  }
}

export function CustomerResearch() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: `# Welcome to Sentry Customer Research Agent 🔍

I help analyze potential customer websites to identify how Sentry can best support their technology stack.

**What I can do:**
- Analyze website tech stacks using Chrome DevTools
- Identify third-party tools and frameworks
- Recommend relevant Sentry SDKs and features
- Suggest integration strategies

**To get started:**
Simply provide a company website URL, and I'll research their technology stack to create a tailored Sentry recommendation.

Example: "Analyze https://example.com"`,
      timestamp: new Date()
    }
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [currentTool, setCurrentTool] = useState<ToolStatus | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, currentTool])

  useEffect(() => {
    Sentry.logger.info('Customer Research component mounted')
    Sentry.metrics.count('customer_research.opened', 1)

    return () => {
      Sentry.logger.info('Customer Research component unmounted', {
        messageCount: messages.length
      })

      Sentry.metrics.distribution('customer_research.session_message_count', messages.length, {
        unit: 'none'
      })
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    const messageStartTime = Date.now()
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date()
    }

    Sentry.logger.info('Customer research query sent', {
      messageId: userMessage.id,
      messageLength: userMessage.content.length,
      conversationLength: messages.length + 1
    })

    Sentry.metrics.count('customer_research.message.sent', 1, {
      attributes: { role: 'user' }
    })

    Sentry.metrics.distribution('customer_research.message.length', userMessage.content.length, {
      unit: 'character',
      attributes: { role: 'user' }
    })

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)
    setCurrentTool(null)

    try {
      const response = await fetch('/api/customer-research', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [...messages, userMessage].map(m => ({
            role: m.role,
            content: m.content
          }))
        })
      })

      if (!response.ok) {
        Sentry.logger.error('Customer research API request failed', {
          status: response.status,
          statusText: response.statusText
        })

        Sentry.metrics.count('customer_research.error', 1, {
          attributes: { type: 'api_error', status: response.status.toString() }
        })

        throw new Error('Failed to get response')
      }

      Sentry.logger.info('Customer research API response received', {
        status: response.status
      })

      // Handle SSE streaming response
      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No response body')
      }

      const decoder = new TextDecoder()
      let streamingContent = ''
      const streamingMessageId = crypto.randomUUID()

      // Add placeholder message for streaming content
      setMessages(prev => [...prev, {
        id: streamingMessageId,
        role: 'assistant',
        content: '',
        timestamp: new Date()
      }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') continue

            try {
              const parsed = JSON.parse(data)

              if (parsed.type === 'text_delta') {
                streamingContent += parsed.text
                setCurrentTool(null)
                setMessages(prev => prev.map(msg =>
                  msg.id === streamingMessageId
                    ? { ...msg, content: streamingContent }
                    : msg
                ))
              } else if (parsed.type === 'tool_start') {
                Sentry.logger.info('Tool execution started in customer research', {
                  tool: parsed.tool
                })

                Sentry.metrics.count('customer_research.tool.started', 1, {
                  attributes: { tool: parsed.tool }
                })

                setCurrentTool({
                  name: parsed.tool,
                  status: 'running'
                })
              } else if (parsed.type === 'tool_progress') {
                setCurrentTool(prev => prev ? {
                  ...prev,
                  elapsed: parsed.elapsed
                } : null)
              } else if (parsed.type === 'done') {
                const responseTime = Date.now() - messageStartTime

                Sentry.logger.info('Customer research response completed', {
                  messageId: userMessage.id,
                  responseTime,
                  responseLength: streamingContent.length
                })

                Sentry.metrics.distribution('customer_research.response_time', responseTime, {
                  unit: 'millisecond',
                  attributes: { status: 'success' }
                })

                Sentry.metrics.distribution('customer_research.response.length', streamingContent.length, {
                  unit: 'character',
                  attributes: { role: 'assistant' }
                })

                Sentry.metrics.count('customer_research.message.received', 1, {
                  attributes: { role: 'assistant' }
                })

                setCurrentTool(null)
              } else if (parsed.type === 'error') {
                Sentry.logger.error('Customer research streaming error', {
                  messageId: userMessage.id,
                  error: parsed.message
                })

                Sentry.metrics.count('customer_research.error', 1, {
                  attributes: { type: 'stream_error' }
                })

                streamingContent = 'Sorry, I encountered an error processing your request.'
                setMessages(prev => prev.map(msg =>
                  msg.id === streamingMessageId
                    ? { ...msg, content: streamingContent }
                    : msg
                ))
                setCurrentTool(null)
              }
            } catch {
              // Ignore parse errors for incomplete chunks
            }
          }
        }
      }

      // If no content was streamed, remove the placeholder
      if (!streamingContent) {
        Sentry.logger.warn('No content streamed in customer research response')
        setMessages(prev => prev.filter(msg => msg.id !== streamingMessageId))
      }
    } catch (error) {
      const responseTime = Date.now() - messageStartTime

      Sentry.logger.error('Customer research request failed', {
        messageId: userMessage.id,
        error: error instanceof Error ? error.message : 'Unknown error',
        responseTime
      })

      Sentry.metrics.count('customer_research.error', 1, {
        attributes: { type: 'request_error' }
      })

      Sentry.metrics.distribution('customer_research.response_time', responseTime, {
        unit: 'millisecond',
        attributes: { status: 'error' }
      })

      Sentry.captureException(error)

      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please check your connection and try again.',
        timestamp: new Date()
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
      setCurrentTool(null)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <div className="h-full flex flex-col bg-[#1e1a2a]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#362552] bg-[#2a2438]">
        <Building2 className="w-5 h-5 text-[#7553ff]" />
        <span className="text-sm text-[#e8e4f0]">Customer Research Agent</span>
        <span className="ml-auto text-xs text-[#9086a3]">Powered by Sentry + Claude</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
          >
            <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
              message.role === 'user' ? 'bg-[#ff45a8]/20' : 'bg-[#7553ff]/20'
            }`}>
              {message.role === 'user' ? (
                <User className="w-4 h-4 text-[#ff45a8]" />
              ) : (
                <Bot className="w-4 h-4 text-[#7553ff]" />
              )}
            </div>
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 ${
                message.role === 'user'
                  ? 'bg-[#ff45a8]/10 text-[#e8e4f0]'
                  : 'bg-[#2a2438] text-[#e8e4f0]'
              }`}
            >
              <div className="text-sm chat-markdown">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    code({ className, children, ...props }) {
                      const match = /language-(\w+)/.exec(className || '')
                      const isInline = !match && !String(children).includes('\n')
                      return isInline ? (
                        <code className="bg-[#1e1a2a] px-1.5 py-0.5 rounded text-[#ff45a8] text-xs" {...props}>
                          {children}
                        </code>
                      ) : (
                        <SyntaxHighlighter
                          style={oneDark}
                          language={match ? match[1] : 'text'}
                          PreTag="div"
                          customStyle={{
                            margin: '0.5rem 0',
                            padding: '0.75rem',
                            borderRadius: '0.375rem',
                            fontSize: '0.75rem',
                            background: '#1e1a2a',
                          }}
                        >
                          {String(children).replace(/\n$/, '')}
                        </SyntaxHighlighter>
                      )
                    },
                    a({ href, children }) {
                      return (
                        <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#7553ff] hover:text-[#c4b5fd] underline">
                          {children}
                        </a>
                      )
                    },
                    ul({ children }) {
                      return <ul className="list-disc list-inside my-1 space-y-0.5">{children}</ul>
                    },
                    ol({ children }) {
                      return <ol className="list-decimal list-inside my-1 space-y-0.5">{children}</ol>
                    },
                    li({ children }) {
                      return <li className="text-sm">{children}</li>
                    },
                    p({ children }) {
                      return <p className="my-1">{children}</p>
                    },
                    h1({ children }) {
                      return <h1 className="text-lg font-bold mt-2 mb-1 text-[#e8e4f0]">{children}</h1>
                    },
                    h2({ children }) {
                      return <h2 className="text-base font-semibold mt-2 mb-1 text-[#c4b5fd]">{children}</h2>
                    },
                    h3({ children }) {
                      return <h3 className="text-sm font-semibold mt-1.5 mb-0.5 text-[#c4b5fd]">{children}</h3>
                    },
                    blockquote({ children }) {
                      return <blockquote className="border-l-2 border-[#7553ff] pl-2 my-1 text-[#9086a3] italic">{children}</blockquote>
                    },
                    table({ children }) {
                      return <table className="border-collapse my-2 text-xs w-full">{children}</table>
                    },
                    th({ children }) {
                      return <th className="border border-[#362552] px-2 py-1 bg-[#1e1a2a] text-left font-semibold">{children}</th>
                    },
                    td({ children }) {
                      return <td className="border border-[#362552] px-2 py-1">{children}</td>
                    },
                    hr() {
                      return <hr className="border-[#362552] my-2" />
                    },
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
              <span className="text-[10px] text-[#9086a3] mt-1 block">
                {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-[#7553ff]/20">
              <Bot className="w-4 h-4 text-[#7553ff]" />
            </div>
            <div className="bg-[#2a2438] rounded-lg px-3 py-2 space-y-2">
              {currentTool ? (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 px-2 py-1 bg-[#7553ff]/20 rounded text-[#7553ff]">
                    <ToolIcon type={toolDisplayInfo[currentTool.name]?.icon || 'wrench'} />
                    <span className="text-xs font-medium">
                      {toolDisplayInfo[currentTool.name]?.name || currentTool.name}
                    </span>
                  </div>
                  <Loader2 className="w-3 h-3 text-[#7553ff] animate-spin" />
                  {currentTool.elapsed !== undefined && (
                    <span className="text-[10px] text-[#9086a3]">
                      {currentTool.elapsed.toFixed(1)}s
                    </span>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-[#7553ff] animate-spin" />
                  <span className="text-sm text-[#9086a3]">Analyzing...</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-[#362552] bg-[#2a2438]">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter a company website URL to analyze..."
            className="flex-1 bg-[#1e1a2a] text-[#e8e4f0] text-sm rounded px-3 py-2 border border-[#362552] focus:border-[#7553ff] focus:outline-none resize-none placeholder:text-[#9086a3]"
            rows={2}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-3 py-2 bg-[#7553ff] hover:bg-[#8c6fff] disabled:bg-[#362552] disabled:cursor-not-allowed rounded transition-colors"
          >
            <Send className="w-5 h-5 text-white" />
          </button>
        </div>
        <p className="text-[10px] text-[#9086a3] mt-1.5">Press Enter to send, Shift+Enter for new line</p>
      </form>
    </div>
  )
}
