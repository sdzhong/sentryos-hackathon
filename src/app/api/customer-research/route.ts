import { query } from '@anthropic-ai/claude-agent-sdk'
import * as Sentry from '@sentry/nextjs'

const SYSTEM_PROMPT = `You are a Sentry Customer Research Agent. Your role is to help Sentry understand how to best support potential customers by analyzing their technology stack and identifying opportunities where Sentry's error tracking, performance monitoring, and observability solutions can provide value.

When given a company website URL, you should:

1. **Analyze the Tech Stack**: Use Chrome DevTools MCP to inspect the website's DOM and identify:
   - JavaScript frameworks and libraries (React, Vue, Angular, Next.js, etc.)
   - Third-party tools and services (analytics, CDNs, marketing tools, etc.)
   - Frontend technologies and patterns
   - Backend indicators (if visible in client-side code)

2. **Identify Sentry Opportunities**: Based on the tech stack, suggest:
   - Which Sentry SDKs would be most relevant (JavaScript, React, Next.js, etc.)
   - Specific Sentry features that would benefit them (Session Replay, Performance Monitoring, Error Tracking, etc.)
   - Integration opportunities with their existing tools
   - Potential pain points Sentry could solve

3. **Provide Actionable Insights**: Create a summary report that includes:
   - Technology stack overview
   - Recommended Sentry products and features
   - Integration strategy
   - Value proposition tailored to their specific stack

**Important Guidelines:**
- Always start by using Chrome DevTools to analyze the provided website URL
- Be specific about which technologies you detect
- Focus on actionable recommendations
- Present findings in a clear, structured format
- If you can't access a URL or encounter errors, explain what happened

**Available Tools:**
You have access to Chrome DevTools MCP for analyzing websites and inspecting DOM elements.`

interface MessageInput {
  role: 'user' | 'assistant'
  content: string
}

export async function POST(request: Request) {
  const requestStartTime = Date.now()
  const requestId = crypto.randomUUID()

  try {
    Sentry.logger.info('Customer Research API request received', {
      requestId,
      timestamp: new Date().toISOString()
    })

    Sentry.metrics.count('api.customer_research.request', 1, {
      attributes: { endpoint: '/api/customer-research' }
    })

    const { messages } = await request.json() as { messages: MessageInput[] }

    if (!messages || !Array.isArray(messages)) {
      Sentry.logger.warn('Invalid request: missing messages array', { requestId })
      Sentry.metrics.count('api.customer_research.error', 1, {
        attributes: { type: 'validation_error', reason: 'missing_messages' }
      })

      return new Response(
        JSON.stringify({ error: 'Messages array is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const lastUserMessage = messages.filter(m => m.role === 'user').pop()
    if (!lastUserMessage) {
      Sentry.logger.warn('Invalid request: no user message found', {
        requestId,
        messageCount: messages.length
      })

      Sentry.metrics.count('api.customer_research.error', 1, {
        attributes: { type: 'validation_error', reason: 'no_user_message' }
      })

      return new Response(
        JSON.stringify({ error: 'No user message found' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    Sentry.logger.info('Processing customer research request', {
      requestId,
      messageLength: lastUserMessage.content.length,
      conversationLength: messages.length
    })

    Sentry.metrics.distribution('api.customer_research.message_count', messages.length, {
      unit: 'none',
      attributes: { endpoint: '/api/customer-research' }
    })

    // Build conversation context
    const conversationContext = messages
      .slice(0, -1)
      .map((m: MessageInput) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n')

    const fullPrompt = conversationContext
      ? `${SYSTEM_PROMPT}\n\nPrevious conversation:\n${conversationContext}\n\nUser: ${lastUserMessage.content}`
      : `${SYSTEM_PROMPT}\n\nUser: ${lastUserMessage.content}`

    // Create streaming response
    const encoder = new TextEncoder()
    let toolsUsed = 0
    let textChunks = 0
    const streamStartTime = Date.now()

    const stream = new ReadableStream({
      async start(controller) {
        try {
          Sentry.logger.info('Starting Claude agent query for customer research', {
            requestId,
            maxTurns: 15
          })

          for await (const message of query({
            prompt: fullPrompt,
            options: {
              maxTurns: 15,
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

            // Send tool start events
            if (message.type === 'assistant' && 'message' in message) {
              const content = message.message?.content
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === 'tool_use') {
                    toolsUsed++
                    Sentry.logger.info('Tool execution started in customer research', {
                      requestId,
                      tool: block.name,
                      toolId: block.id
                    })

                    Sentry.metrics.count('api.customer_research.tool_use', 1, {
                      attributes: { tool: block.name }
                    })

                    controller.enqueue(encoder.encode(
                      `data: ${JSON.stringify({ type: 'tool_start', tool: block.name })}\n\n`
                    ))
                  }
                }
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

              Sentry.logger.info('Customer research request completed successfully', {
                requestId,
                responseTime,
                streamTime,
                toolsUsed,
                textChunks
              })

              Sentry.metrics.distribution('api.customer_research.response_time', responseTime, {
                unit: 'millisecond',
                attributes: { status: 'success' }
              })

              Sentry.metrics.distribution('api.customer_research.stream_time', streamTime, {
                unit: 'millisecond',
                attributes: { status: 'success' }
              })

              Sentry.metrics.distribution('api.customer_research.tools_per_request', toolsUsed, {
                unit: 'none',
                attributes: { status: 'success' }
              })

              Sentry.metrics.count('api.customer_research.success', 1)

              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({ type: 'done' })}\n\n`
              ))
            }

            // Handle errors
            if (message.type === 'result' && message.subtype !== 'success') {
              Sentry.logger.error('Customer research query did not complete successfully', {
                requestId,
                subtype: message.subtype
              })

              Sentry.metrics.count('api.customer_research.error', 1, {
                attributes: { type: 'query_error', subtype: message.subtype }
              })

              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({ type: 'error', message: 'Query did not complete successfully' })}\n\n`
              ))
            }
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        } catch (error) {
          Sentry.logger.error('Stream error in customer research API', {
            requestId,
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
          })

          Sentry.metrics.count('api.customer_research.error', 1, {
            attributes: { type: 'stream_error' }
          })

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
  } catch (error) {
    const responseTime = Date.now() - requestStartTime

    Sentry.logger.error('Customer Research API error', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      responseTime
    })

    Sentry.metrics.count('api.customer_research.error', 1, {
      attributes: { type: 'request_error' }
    })

    Sentry.metrics.distribution('api.customer_research.response_time', responseTime, {
      unit: 'millisecond',
      attributes: { status: 'error' }
    })

    Sentry.captureException(error)

    return new Response(
      JSON.stringify({ error: 'Failed to process customer research request. Check server logs for details.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
