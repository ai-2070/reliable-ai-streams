// Vercel AI SDK adapter for L0
// Provides proper handling of tool calls via fullStream
//
// This adapter works with the `ai` package from Vercel.
// Install it with: npm install ai

import type { L0Event, L0Adapter } from "../types/l0";
import type { StreamTextResult, TextStreamPart, ToolSet } from "ai";

/**
 * Vercel AI SDK StreamTextResult with any tool set
 */
export type VercelStreamTextResult = StreamTextResult<ToolSet, never>;

/**
 * Vercel AI SDK stream chunk type
 */
export type VercelStreamChunk = TextStreamPart<ToolSet>;

/**
 * Options for wrapping Vercel AI streams
 */
export interface VercelAIAdapterOptions {
  /**
   * Include usage information in complete event
   * @default true
   */
  includeUsage?: boolean;

  /**
   * Include tool calls as message events
   * @default true
   */
  includeToolCalls?: boolean;
}

/**
 * Wrap a Vercel AI SDK StreamTextResult for use with L0
 *
 * Uses fullStream to capture tool calls and other events.
 *
 * @param streamResult - Vercel AI SDK StreamTextResult
 * @param options - Adapter options
 * @returns Async generator of L0 events
 *
 * @example
 * ```typescript
 * import { streamText } from 'ai';
 * import { openai } from '@ai-sdk/openai';
 * import { l0, vercelAIAdapter } from 'l0';
 *
 * const result = await l0({
 *   stream: () => streamText({
 *     model: openai('gpt-4o'),
 *     prompt: 'Hello!',
 *     tools: { ... }
 *   }),
 *   adapter: vercelAIAdapter,
 * });
 * ```
 */
export async function* wrapVercelAIStream(
  streamResult: VercelStreamTextResult,
  options: VercelAIAdapterOptions = {},
): AsyncGenerator<L0Event> {
  const { includeUsage = true, includeToolCalls = true } = options;

  try {
    const fullStream = streamResult.fullStream;
    const reader = fullStream.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        if (!value) continue;

        const chunk = value as VercelStreamChunk;

        switch (chunk.type) {
          case "text-delta":
            yield {
              type: "token",
              value: chunk.text,
              timestamp: Date.now(),
            };
            break;

          case "tool-call":
            if (includeToolCalls) {
              yield {
                type: "message",
                value: JSON.stringify({
                  type: "tool_call",
                  id: chunk.toolCallId,
                  name: chunk.toolName,
                  arguments: chunk.input,
                }),
                role: "assistant",
                timestamp: Date.now(),
              };
            }
            break;

          case "tool-input-start":
            // Could emit a message event here if needed for streaming tool args
            break;

          case "tool-input-delta":
            // Could accumulate and emit streaming tool args if needed
            break;

          case "tool-result":
            if (includeToolCalls) {
              yield {
                type: "message",
                value: JSON.stringify({
                  type: "tool_result",
                  id: chunk.toolCallId,
                  name: chunk.toolName,
                  result: chunk.output,
                }),
                role: "tool",
                timestamp: Date.now(),
              };
            }
            break;

          case "finish": {
            let usage: unknown;
            if (includeUsage) {
              try {
                usage = await streamResult.usage;
              } catch {
                // Usage not available
              }
            }

            yield {
              type: "complete",
              timestamp: Date.now(),
              ...(includeUsage && usage ? { usage } : {}),
              ...(chunk.finishReason
                ? { finishReason: chunk.finishReason }
                : {}),
            } as L0Event;
            break;
          }

          case "error":
            yield {
              type: "error",
              error:
                chunk.error instanceof Error
                  ? chunk.error
                  : new Error(String(chunk.error)),
              timestamp: Date.now(),
            };
            break;
        }
      }
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    yield {
      type: "error",
      error: error instanceof Error ? error : new Error(String(error)),
      timestamp: Date.now(),
    };
  }
}

/**
 * Type guard to check if an object is a Vercel AI SDK StreamTextResult
 */
export function isVercelAIStream(obj: unknown): obj is VercelStreamTextResult {
  if (!obj || typeof obj !== "object") {
    return false;
  }
  const stream = obj as VercelStreamTextResult;
  return (
    "textStream" in stream &&
    "fullStream" in stream &&
    "text" in stream &&
    "toolCalls" in stream &&
    "usage" in stream &&
    "finishReason" in stream
  );
}

/**
 * Vercel AI SDK adapter for L0
 *
 * Use this adapter to get proper tool call handling with Vercel AI SDK.
 * Without this adapter, L0 uses textStream which doesn't include tool calls.
 *
 * @example
 * ```typescript
 * import { streamText, tool } from 'ai';
 * import { openai } from '@ai-sdk/openai';
 * import { l0, vercelAIAdapter } from 'l0';
 * import { z } from 'zod';
 *
 * const result = await l0({
 *   stream: () => streamText({
 *     model: openai('gpt-4o'),
 *     prompt: 'What is the weather in Tokyo?',
 *     tools: {
 *       get_weather: tool({
 *         description: 'Get weather for a location',
 *         parameters: z.object({ location: z.string() }),
 *       }),
 *     },
 *   }),
 *   adapter: vercelAIAdapter,
 *   onToolCall: (name, id, args) => {
 *     console.log(`Tool called: ${name}`, args);
 *   },
 * });
 * ```
 */
export const vercelAIAdapter: L0Adapter<
  VercelStreamTextResult,
  VercelAIAdapterOptions
> = {
  name: "vercel-ai",
  detect: isVercelAIStream,
  wrap: wrapVercelAIStream,
};

// Auto-register for detection when this module is imported
import { registerAdapter } from "./registry";
try {
  registerAdapter(vercelAIAdapter, { silent: true });
} catch {
  // Already registered, ignore
}
