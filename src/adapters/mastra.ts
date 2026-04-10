// Mastra AI adapter for L0
// Allows using Mastra agents directly with L0
//
// This adapter works with the `@mastra/core` package (v0.18+).
// Install it with: npm install @mastra/core

import type { L0Event, L0Adapter } from "../types/l0";
import type { Agent } from "@mastra/core/agent";
import type { MastraModelOutput } from "@mastra/core/stream";

/**
 * Options for wrapping Mastra streams
 */
export interface MastraAdapterOptions {
  /**
   * Include usage information in done event
   * @default true
   */
  includeUsage?: boolean;

  /**
   * Include tool calls as events
   * @default true
   */
  includeToolCalls?: boolean;

  /**
   * Include reasoning content as tokens
   * @default false
   */
  includeReasoning?: boolean;
}

/**
 * Mastra message input types
 */
export type MastraMessageInput =
  | string
  | Array<{ role: "user" | "assistant" | "system"; content: string }>;

/**
 * Wrap a Mastra stream result for use with L0
 *
 * Works with the result from `agent.stream()`
 *
 * @param streamResult - Mastra stream result (MastraModelOutput)
 * @param options - Adapter options
 * @returns Async generator of L0 events
 *
 * @example
 * ```typescript
 * import { Agent } from '@mastra/core/agent';
 * import { l0, wrapMastraStream } from 'l0';
 *
 * const agent = new Agent({
 *   name: 'my-agent',
 *   instructions: 'You are helpful',
 *   model: 'openai/gpt-4o'
 * });
 *
 * const result = await l0({
 *   stream: async () => {
 *     const stream = await agent.stream('Hello!');
 *     return wrapMastraStream(stream);
 *   }
 * });
 * ```
 */
export async function* wrapMastraStream(
  streamResult: MastraModelOutput<any>,
  options: MastraAdapterOptions = {},
): AsyncGenerator<L0Event> {
  const {
    includeUsage = true,
    includeToolCalls = true,
    includeReasoning = false,
  } = options;

  try {
    // Get the text stream from Mastra
    // Use for-await instead of getReader() to avoid "ReadableStream is locked" issues
    const textStream = streamResult.textStream;

    // Stream text chunks
    for await (const value of textStream) {
      if (value) {
        yield {
          type: "token",
          value,
          timestamp: Date.now(),
        };
      }
    }

    // Handle reasoning if enabled
    if (includeReasoning) {
      try {
        const reasoningText = await streamResult.reasoningText;
        if (reasoningText) {
          yield {
            type: "message",
            value: JSON.stringify({
              type: "reasoning",
              reasoning: reasoningText,
            }),
            role: "assistant",
            timestamp: Date.now(),
          };
        }
      } catch {
        // Reasoning not available
      }
    }

    // Handle tool calls if enabled
    if (includeToolCalls) {
      try {
        const toolCalls = await streamResult.toolCalls;
        if (toolCalls && toolCalls.length > 0) {
          yield {
            type: "message",
            value: JSON.stringify({
              type: "tool_calls",
              tool_calls: toolCalls.map((tc: any) => ({
                id: tc.payload?.toolCallId ?? tc.toolCallId,
                name: tc.payload?.toolName ?? tc.toolName,
                arguments: JSON.stringify(tc.payload?.args ?? tc.args),
              })),
            }),
            role: "assistant",
            timestamp: Date.now(),
          };
        }
      } catch {
        // Tool calls not available
      }

      try {
        const toolResults = await streamResult.toolResults;
        if (toolResults && toolResults.length > 0) {
          yield {
            type: "message",
            value: JSON.stringify({
              type: "tool_results",
              tool_results: toolResults.map((tr: any) => ({
                id: tr.payload?.toolCallId ?? tr.toolCallId,
                name: tr.payload?.toolName ?? tr.toolName,
                result: tr.payload?.result ?? tr.result,
              })),
            }),
            role: "assistant",
            timestamp: Date.now(),
          };
        }
      } catch {
        // Tool results not available
      }
    }

    // Get usage and finish reason for done event
    let usage: any;
    let finishReason: string | undefined;

    if (includeUsage) {
      try {
        usage = await streamResult.usage;
      } catch {
        // Usage not available
      }
    }

    try {
      finishReason = await streamResult.finishReason;
    } catch {
      // Finish reason not available
    }

    // Emit complete event
    yield {
      type: "complete",
      timestamp: Date.now(),
      ...(includeUsage && usage ? { usage } : {}),
      ...(finishReason ? { finishReason } : {}),
    } as L0Event;
  } catch (error) {
    yield {
      type: "error",
      error: error instanceof Error ? error : new Error(String(error)),
      timestamp: Date.now(),
    };
  }
}

/**
 * Create a stream factory for a Mastra agent
 *
 * @param agent - Mastra Agent instance
 * @param messages - Messages to send to the agent
 * @param streamOptions - Options passed to agent.stream()
 * @param adapterOptions - L0 adapter options
 * @returns Stream factory function for use with L0
 *
 * @example
 * ```typescript
 * import { Agent } from '@mastra/core/agent';
 * import { l0, mastraStream } from 'l0';
 *
 * const agent = new Agent({
 *   name: 'my-agent',
 *   instructions: 'You are helpful',
 *   model: 'openai/gpt-4o'
 * });
 *
 * const result = await l0({
 *   stream: mastraStream(agent, 'Hello!')
 * });
 * ```
 */
export function mastraStream(
  agent: Agent<any, any, any>,
  messages: MastraMessageInput,
  streamOptions?: Record<string, any>,
  adapterOptions?: MastraAdapterOptions,
): () => Promise<AsyncGenerator<L0Event>> {
  return async () => {
    const streamResult = await agent.stream(
      messages as any,
      streamOptions as any,
    );
    return wrapMastraStream(
      streamResult as unknown as MastraModelOutput<any>,
      adapterOptions,
    );
  };
}

/**
 * Create a simple text stream from a Mastra agent
 *
 * @param agent - Mastra Agent instance
 * @param prompt - User prompt
 * @param options - Additional options
 * @returns Stream factory function for use with L0
 *
 * @example
 * ```typescript
 * import { Agent } from '@mastra/core/agent';
 * import { l0, mastraText } from 'l0';
 *
 * const agent = new Agent({
 *   name: 'my-agent',
 *   instructions: 'You are helpful',
 *   model: 'openai/gpt-4o'
 * });
 *
 * const result = await l0({
 *   stream: mastraText(agent, 'Write a haiku about coding')
 * });
 * ```
 */
export function mastraText(
  agent: Agent<any, any, any>,
  prompt: string,
  options?: Record<string, any> & MastraAdapterOptions,
): () => Promise<AsyncGenerator<L0Event>> {
  const { includeUsage, includeToolCalls, includeReasoning, ...streamOptions } =
    options || {};

  return mastraStream(agent, prompt, streamOptions, {
    includeUsage,
    includeToolCalls,
    includeReasoning,
  });
}

/**
 * Create a structured output stream from a Mastra agent
 *
 * @param agent - Mastra Agent instance
 * @param prompt - User prompt
 * @param schema - Zod schema for structured output
 * @param options - Additional options
 * @returns Stream factory function for use with L0
 *
 * @example
 * ```typescript
 * import { Agent } from '@mastra/core/agent';
 * import { structured, mastraStructured } from 'l0';
 * import { z } from 'zod';
 *
 * const agent = new Agent({
 *   name: 'my-agent',
 *   instructions: 'You are helpful',
 *   model: 'openai/gpt-4o'
 * });
 *
 * const result = await structured({
 *   schema: z.object({ name: z.string(), age: z.number() }),
 *   stream: mastraStructured(agent, 'Generate user data', userSchema)
 * });
 * ```
 */
export function mastraStructured<TSchema>(
  agent: Agent<any, any, any>,
  prompt: string,
  schema: TSchema,
  options?: Record<string, any> & MastraAdapterOptions,
): () => Promise<AsyncGenerator<L0Event>> {
  const { includeUsage, includeToolCalls, includeReasoning, ...streamOptions } =
    options || {};

  return mastraStream(
    agent,
    prompt,
    {
      ...streamOptions,
      structuredOutput: { schema },
    },
    { includeUsage, includeToolCalls, includeReasoning },
  );
}

/**
 * Wrap a Mastra agent's fullStream for complete control
 *
 * @param streamResult - Mastra stream result
 * @param options - Adapter options
 * @returns Async generator of L0 events with all chunk types
 *
 * @example
 * ```typescript
 * import { Agent } from '@mastra/core/agent';
 * import { l0, wrapMastraFullStream } from 'l0';
 *
 * const agent = new Agent({ ... });
 *
 * const result = await l0({
 *   stream: async () => {
 *     const stream = await agent.stream('Hello!');
 *     return wrapMastraFullStream(stream);
 *   }
 * });
 * ```
 */
export async function* wrapMastraFullStream(
  streamResult: MastraModelOutput<any>,
  options: MastraAdapterOptions = {},
): AsyncGenerator<L0Event> {
  const {
    includeUsage = true,
    includeToolCalls = true,
    includeReasoning = false,
  } = options;

  try {
    // Use for-await instead of getReader() to avoid "ReadableStream is locked" issues
    const fullStream = streamResult.fullStream;

    for await (const value of fullStream) {
      if (!value) continue;

      const chunk = value as any;

      // Handle different chunk types
      switch (chunk.type) {
        case "text-delta":
          yield {
            type: "token",
            value: chunk.payload?.text ?? chunk.textDelta,
            timestamp: Date.now(),
          };
          break;

        case "reasoning":
          if (includeReasoning) {
            yield {
              type: "message",
              value: JSON.stringify({
                type: "reasoning",
                reasoning: chunk.payload?.text ?? chunk.textDelta,
              }),
              role: "assistant",
              timestamp: Date.now(),
            };
          }
          break;

        case "tool-call":
          if (includeToolCalls) {
            const payload = chunk.payload ?? chunk;
            yield {
              type: "message",
              value: JSON.stringify({
                type: "tool_call",
                tool_call: {
                  id: payload.toolCallId,
                  name: payload.toolName,
                  arguments: JSON.stringify(payload.args),
                },
              }),
              role: "assistant",
              timestamp: Date.now(),
            };
          }
          break;

        case "tool-result":
          if (includeToolCalls) {
            const payload = chunk.payload ?? chunk;
            yield {
              type: "message",
              value: JSON.stringify({
                type: "tool_result",
                tool_result: {
                  id: payload.toolCallId,
                  name: payload.toolName,
                  result: payload.result,
                },
              }),
              role: "assistant",
              timestamp: Date.now(),
            };
          }
          break;

        case "finish":
          // Get usage for complete event
          let usage: any;
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
            ...(chunk.finishReason ? { finishReason: chunk.finishReason } : {}),
          } as L0Event;
          break;

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
  } catch (error) {
    yield {
      type: "error",
      error: error instanceof Error ? error : new Error(String(error)),
      timestamp: Date.now(),
    };
  }
}

/**
 * Type guard to check if an object is a Mastra stream result
 *
 * Mastra streams have unique properties like `runId`, `messageList`, and `tripwire`
 * that distinguish them from vanilla Vercel AI SDK streams.
 */
export function isMastraStream(obj: unknown): obj is MastraModelOutput<any> {
  if (!obj || typeof obj !== "object") {
    return false;
  }
  const stream = obj as MastraModelOutput<any>;
  // Check for Mastra-specific properties that don't exist on vanilla Vercel AI SDK
  // runId, messageList, and tripwire are unique to MastraModelOutput
  return (
    "textStream" in stream &&
    "text" in stream &&
    "usage" in stream &&
    "finishReason" in stream &&
    // Mastra-specific properties
    "runId" in stream &&
    "messageList" in stream
  );
}

/**
 * Extract text content from a Mastra stream
 */
export async function extractMastraText(
  streamResult: MastraModelOutput<any>,
): Promise<string> {
  return streamResult.text;
}

/**
 * Extract structured output from a Mastra stream
 */
export async function extractMastraObject<T>(
  streamResult: MastraModelOutput<any>,
): Promise<T> {
  return streamResult.object as Promise<T>;
}

/**
 * Mastra adapter for L0
 *
 * Use with `registerAdapter()` for auto-detection or pass directly to `l0({ adapter })`.
 *
 * @example
 * ```typescript
 * import { l0, mastraAdapter } from '@ai2070/l0';
 * import { Agent } from '@mastra/core';
 *
 * const agent = new Agent({
 *   name: 'my-agent',
 *   instructions: 'You are a helpful assistant.',
 *   model: openai('gpt-5-micro'),
 * });
 *
 * // Explicit adapter usage
 * const result = await l0({
 *   stream: () => agent.stream('Hello!'),
 *   adapter: mastraAdapter,
 * });
 * ```
 */
export const mastraAdapter: L0Adapter<
  MastraModelOutput<any>,
  MastraAdapterOptions
> = {
  name: "mastra",
  detect: isMastraStream,
  wrap: wrapMastraStream,
};

// Auto-register for detection when this module is imported
import { registerAdapter } from "./registry";
try {
  registerAdapter(mastraAdapter, { silent: true });
} catch {
  // Already registered, ignore
}

// Re-export Mastra types for convenience
export type { Agent } from "@mastra/core/agent";
export type { MastraModelOutput } from "@mastra/core/stream";
