import { query } from '@anthropic-ai/claude-agent-sdk'
import * as Sentry from '@sentry/nextjs'

const SYSTEM_PROMPT = `You are a helpful personal assistant designed to help with general research, questions, and tasks.

Your role is to:
- Answer questions on any topic accurately and thoroughly
- Help with research by searching the web for current information
- Assist with writing, editing, and brainstorming
- Provide explanations and summaries of complex topics
- Help solve problems and think through decisions

Guidelines:
- Be friendly, clear, and conversational
- Use web search when you need current information, facts you're unsure about, or real-time data
- Keep responses concise but complete - expand when the topic warrants depth
- Use markdown formatting when it helps readability (bullet points, code blocks, etc.)
- Be honest when you don't know something and offer to search for answers`

interface MessageInput {
  role: 'user' | 'assistant'
  content: string
}

export async function POST(request: Request) {
  const requestStartTime = Date.now()
  const requestId = crypto.randomUUID()

  // Set conversation ID for multi-turn tracking
  Sentry.setConversationId(requestId)

  try {
    Sentry.logger.info('Chat API request received', {
      requestId,
      timestamp: new Date().toISOString()
    })

    Sentry.metrics.count('api.chat.request', 1, {
      attributes: { endpoint: '/api/chat' }
    })

    const { messages } = await request.json() as { messages: MessageInput[] }

    if (!messages || !Array.isArray(messages)) {
      Sentry.logger.warn('Invalid chat request: missing messages array', {
        requestId
      })

      Sentry.metrics.count('api.chat.error', 1, {
        attributes: { type: 'validation_error', reason: 'missing_messages' }
      })

      return new Response(
        JSON.stringify({ error: 'Messages array is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    Sentry.metrics.distribution('api.chat.message_count', messages.length, {
      unit: 'none',
      attributes: { endpoint: '/api/chat' }
    })

    const lastUserMessage = messages.filter(m => m.role === 'user').pop()
    if (!lastUserMessage) {
      Sentry.logger.warn('Invalid chat request: no user message found', {
        requestId,
        messageCount: messages.length
      })

      Sentry.metrics.count('api.chat.error', 1, {
        attributes: { type: 'validation_error', reason: 'no_user_message' }
      })

      return new Response(
        JSON.stringify({ error: 'No user message found' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    Sentry.logger.info('Processing chat message', {
      requestId,
      messageLength: lastUserMessage.content.length,
      conversationLength: messages.length
    })

    const conversationContext = messages
      .slice(0, -1)
      .map((m: MessageInput) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n')

    const fullPrompt = conversationContext
      ? `${SYSTEM_PROMPT}\n\nPrevious conversation:\n${conversationContext}\n\nUser: ${lastUserMessage.content}`
      : `${SYSTEM_PROMPT}\n\nUser: ${lastUserMessage.content}`

    // Start AI agent monitoring span
    return await Sentry.startSpan(
      {
        op: 'gen_ai.invoke_agent',
        name: 'invoke_agent Chat Assistant',
        attributes: {
          'gen_ai.agent.name': 'Chat Assistant',
          'gen_ai.request.model': 'claude-sonnet-4-5-20250929',
          'gen_ai.operation.name': 'chat_completion',
          'gen_ai.request.messages': JSON.stringify(messages),
          'gen_ai.conversation.id': requestId,
          'gen_ai.request.max_turns': 10,
        },
      },
      async (agentSpan) => {
        const encoder = new TextEncoder()
        let toolsUsed = 0
        let textChunks = 0
        let totalInputTokens = 0
        let totalOutputTokens = 0
        const streamStartTime = Date.now()
        const toolExecutions: Array<{ name: string; duration: number }> = []

        const stream = new ReadableStream({
          async start(controller) {
            try {
              Sentry.logger.info('Starting Claude agent query', {
                requestId,
                maxTurns: 10
              })

              for await (const message of query({
                prompt: fullPrompt,
                options: {
                  maxTurns: 10,
                  tools: { type: 'preset', preset: 'claude_code' },
                  permissionMode: 'bypassPermissions',
                  allowDangerouslySkipPermissions: true,
                  includePartialMessages: true,
                  cwd: process.cwd(),
                }
              })) {
                // Handle streaming text deltas
                if (message.type === 'stream_event' && 'event' in message) {
                  const event = message.event
                  if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                    textChunks++
                    controller.enqueue(encoder.encode(
                      `data: ${JSON.stringify({ type: 'text_delta', text: event.delta.text })}\n\n`
                    ))
                  }
                }

                // Track tool executions
                if (message.type === 'assistant' && 'message' in message) {
                  const content = message.message?.content
                  if (Array.isArray(content)) {
                    for (const block of content) {
                      if (block.type === 'tool_use') {
                        toolsUsed++
                        const toolStartTime = Date.now()

                        // Create execute_tool span
                        await Sentry.startSpan(
                          {
                            op: 'gen_ai.execute_tool',
                            name: `execute_tool ${block.name}`,
                            attributes: {
                              'gen_ai.tool.name': block.name,
                              'gen_ai.tool.input': JSON.stringify(block.input || {}),
                              'gen_ai.tool.type': 'function',
                            },
                          },
                          async (toolSpan) => {
                            Sentry.logger.info('Tool execution started', {
                              requestId,
                              tool: block.name,
                              toolId: block.id
                            })

                            Sentry.metrics.count('api.chat.tool_use', 1, {
                              attributes: { tool: block.name }
                            })

                            controller.enqueue(encoder.encode(
                              `data: ${JSON.stringify({ type: 'tool_start', tool: block.name })}\n\n`
                            ))

                            const toolDuration = Date.now() - toolStartTime
                            toolExecutions.push({ name: block.name, duration: toolDuration })

                            toolSpan.setAttribute('gen_ai.tool.duration_ms', toolDuration)
                          }
                        )
                      }
                    }
                  }

                  // Track token usage from message
                  if (message.message?.usage) {
                    const usage = message.message.usage
                    if (usage.input_tokens) totalInputTokens += usage.input_tokens
                    if (usage.output_tokens) totalOutputTokens += usage.output_tokens
                  }
                }

                // Send tool progress updates
                if (message.type === 'tool_progress') {
                  controller.enqueue(encoder.encode(
                    `data: ${JSON.stringify({ type: 'tool_progress', tool: message.tool_name, elapsed: message.elapsed_time_seconds })}\n\n`
                  ))
                }

                // Signal completion
                if (message.type === 'result' && message.subtype === 'success') {
                  const responseTime = Date.now() - requestStartTime
                  const streamTime = Date.now() - streamStartTime

                  // Set final agent span attributes
                  agentSpan.setAttribute('gen_ai.usage.input_tokens', totalInputTokens)
                  agentSpan.setAttribute('gen_ai.usage.output_tokens', totalOutputTokens)
                  agentSpan.setAttribute('gen_ai.response.tools_used_count', toolsUsed)
                  agentSpan.setAttribute('gen_ai.response.text_chunks', textChunks)
                  agentSpan.setAttribute('gen_ai.agent.duration_ms', responseTime)
                  agentSpan.setAttribute('gen_ai.agent.stream_duration_ms', streamTime)
                  agentSpan.setAttribute('gen_ai.tool_executions', JSON.stringify(toolExecutions))

                  Sentry.logger.info('Chat request completed successfully', {
                    requestId,
                    responseTime,
                    streamTime,
                    toolsUsed,
                    textChunks,
                    totalInputTokens,
                    totalOutputTokens
                  })

                  Sentry.metrics.distribution('api.chat.response_time', responseTime, {
                    unit: 'millisecond',
                    attributes: { status: 'success' }
                  })

                  Sentry.metrics.distribution('api.chat.stream_time', streamTime, {
                    unit: 'millisecond',
                    attributes: { status: 'success' }
                  })

                  Sentry.metrics.distribution('api.chat.tools_per_request', toolsUsed, {
                    unit: 'none',
                    attributes: { status: 'success' }
                  })

                  Sentry.metrics.distribution('api.chat.input_tokens', totalInputTokens, {
                    unit: 'none',
                    attributes: { model: 'claude-sonnet-4-5' }
                  })

                  Sentry.metrics.distribution('api.chat.output_tokens', totalOutputTokens, {
                    unit: 'none',
                    attributes: { model: 'claude-sonnet-4-5' }
                  })

                  Sentry.metrics.count('api.chat.success', 1)

                  controller.enqueue(encoder.encode(
                    `data: ${JSON.stringify({ type: 'done' })}\n\n`
                  ))
                }

                // Handle errors
                if (message.type === 'result' && message.subtype !== 'success') {
                  Sentry.logger.error('Chat query did not complete successfully', {
                    requestId,
                    subtype: message.subtype
                  })

                  Sentry.metrics.count('api.chat.error', 1, {
                    attributes: { type: 'query_error', subtype: message.subtype }
                  })

                  agentSpan.setStatus({ code: 2, message: 'Query failed' })

                  controller.enqueue(encoder.encode(
                    `data: ${JSON.stringify({ type: 'error', message: 'Query did not complete successfully' })}\n\n`
                  ))
                }
              }

              controller.enqueue(encoder.encode('data: [DONE]\n\n'))
              controller.close()
            } catch (error) {
              Sentry.logger.error('Stream error in chat API', {
                requestId,
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined
              })

              Sentry.metrics.count('api.chat.error', 1, {
                attributes: { type: 'stream_error' }
              })

              agentSpan.setStatus({ code: 2, message: 'Stream error' })
              Sentry.captureException(error)

              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({ type: 'error', message: 'Stream error occurred' })}\n\n`
              ))
              controller.close()
            }
          }
        })

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        })
      }
    )
  } catch (error) {
    const responseTime = Date.now() - requestStartTime

    Sentry.logger.error('Chat API error', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      responseTime
    })

    Sentry.metrics.count('api.chat.error', 1, {
      attributes: { type: 'request_error' }
    })

    Sentry.metrics.distribution('api.chat.response_time', responseTime, {
      unit: 'millisecond',
      attributes: { status: 'error' }
    })

    Sentry.captureException(error)

    return new Response(
      JSON.stringify({ error: 'Failed to process chat request. Check server logs for details.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  } finally {
    // Clear conversation ID
    Sentry.setConversationId(null)
  }
}
