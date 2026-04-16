// Anthropic SDK adapter for L0 (reference implementation)
// Allows using Anthropic SDK directly with L0
//
// This adapter works with the `@anthropic-ai/sdk` package.
// Install it with: npm install @anthropic-ai/sdk

import type { L0Event, L0Adapter } from "../types/l0";
import type Anthropic from "@anthropic-ai/sdk";
import type {
  RawMessageStreamEvent,
  RawMessageStartEvent,
  RawMessageDeltaEvent,
  RawContentBlockStartEvent,
  RawContentBlockDeltaEvent,
  RawContentBlockStopEvent,
  MessageCreateParamsBase,
} from "@anthropic-ai/sdk/resources/messages";
import type { MessageStream } from "@anthropic-ai/sdk/lib/MessageStream";

/**
 * Anthropic stream types - can be either MessageStream or raw async iterable
 */
export type AnthropicStream =
  | MessageStream
  | AsyncIterable<RawMessageStreamEvent>;

/**
 * Options for the Anthropic adapter
 */
export interface AnthropicAdapterOptions {
  /**
   * Include usage information in done event
   * @default true
   */
  includeUsage?: boolean;

  /**
   * Include tool use blocks as message events
   * @default true
   */
  includeToolUse?: boolean;
}

/**
 * Type guard to check if an event is an Anthropic stream event
 */
export function isAnthropicStreamEvent(
  event: unknown,
): event is RawMessageStreamEvent {
  if (!event || typeof event !== "object") return false;
  const e = event as Record<string, unknown>;
  if (typeof e.type !== "string") return false;

  return [
    "message_start",
    "content_block_start",
    "content_block_delta",
    "content_block_stop",
    "message_delta",
    "message_stop",
  ].includes(e.type);
}

/**
 * Type guard to detect an Anthropic stream
 * Checks if the input looks like a MessageStream or async iterable of events
 */
export function isAnthropicStream(input: unknown): input is AnthropicStream {
  if (!input || typeof input !== "object") return false;

  // Must be async iterable
  if (!(Symbol.asyncIterator in input)) return false;

  // Check for Anthropic SDK MessageStream markers
  const stream = input as Record<string, unknown>;

  // MessageStream has these specific methods
  if (
    typeof stream.on === "function" &&
    typeof stream.finalMessage === "function"
  ) {
    return true;
  }

  // Check for controller (internal SDK marker)
  if ("controller" in stream && "body" in stream) {
    return true;
  }

  return false;
}

/**
 * Wrap an Anthropic SDK stream for use with L0
 *
 * Works with streams from `anthropic.messages.stream()` or direct event iterables
 *
 * @param stream - Anthropic streaming response
 * @param options - Adapter options
 * @returns Async generator of L0 events
 *
 * @example
 * ```typescript
 * import Anthropic from '@anthropic-ai/sdk';
 * import { l0, wrapAnthropicStream } from 'l0';
 *
 * const anthropic = new Anthropic();
 *
 * const result = await l0({
 *   stream: async () => {
 *     const stream = anthropic.messages.stream({
 *       model: 'claude-sonnet-4-20250514',
 *       max_tokens: 1024,
 *       messages: [{ role: 'user', content: 'Hello!' }]
 *     });
 *     return wrapAnthropicStream(stream);
 *   }
 * });
 * ```
 */
export async function* wrapAnthropicStream(
  stream: AnthropicStream,
  options: AnthropicAdapterOptions = {},
): AsyncGenerator<L0Event> {
  const { includeUsage = true, includeToolUse = true } = options;

  let usage: { input_tokens?: number; output_tokens?: number } = {};
  let emittedDone = false;

  // Track tool use accumulation
  const toolUseAccumulator = new Map<
    number,
    { id: string; name: string; input: string }
  >();

  try {
    for await (const event of stream) {
      const eventType = (event as RawMessageStreamEvent).type;

      switch (eventType) {
        case "message_start": {
          const e = event as RawMessageStartEvent;
          // Capture initial usage
          if (e.message?.usage) {
            usage.input_tokens = e.message.usage.input_tokens;
            usage.output_tokens = e.message.usage.output_tokens;
          }
          // Skip - no L0 event needed
          break;
        }

        case "content_block_start": {
          const e = event as RawContentBlockStartEvent;
          // Track tool use blocks
          if (e.content_block?.type === "tool_use" && includeToolUse) {
            toolUseAccumulator.set(e.index, {
              id: e.content_block.id || "",
              name: e.content_block.name || "",
              input: "",
            });
          }
          // Skip - no L0 event needed for text blocks
          break;
        }

        case "content_block_delta": {
          const e = event as RawContentBlockDeltaEvent;
          if (e.delta?.type === "text_delta" && e.delta.text != null) {
            // Emit text exactly as-is - no trimming, no modification
            yield {
              type: "token",
              value: e.delta.text,
              timestamp: Date.now(),
            };
          } else if (
            e.delta?.type === "input_json_delta" &&
            e.delta.partial_json != null
          ) {
            // Accumulate tool input JSON
            const toolUse = toolUseAccumulator.get(e.index);
            if (toolUse) {
              toolUse.input += e.delta.partial_json;
            }
          }
          break;
        }

        case "content_block_stop": {
          const e = event as RawContentBlockStopEvent;
          // Emit accumulated tool use if present
          if (includeToolUse) {
            const toolUse = toolUseAccumulator.get(e.index);
            if (toolUse) {
              yield {
                type: "message",
                value: JSON.stringify({
                  type: "tool_use",
                  tool_use: {
                    id: toolUse.id,
                    name: toolUse.name,
                    input: toolUse.input,
                  },
                }),
                role: "assistant",
                timestamp: Date.now(),
              };
              toolUseAccumulator.delete(e.index);
            }
          }
          break;
        }

        case "message_delta": {
          const e = event as RawMessageDeltaEvent;
          // Update usage
          if (e.usage?.output_tokens != null) {
            usage.output_tokens = e.usage.output_tokens;
          }
          // Skip - no L0 event needed
          break;
        }

        case "message_stop": {
          // Emit complete exactly once
          if (!emittedDone) {
            emittedDone = true;
            yield {
              type: "complete",
              timestamp: Date.now(),
              ...(includeUsage &&
              (usage.input_tokens != null || usage.output_tokens != null)
                ? { usage }
                : {}),
            } as L0Event;
          }
          break;
        }
      }
    }

    // Ensure complete is emitted if stream ends without message_stop
    if (!emittedDone) {
      emittedDone = true;
      yield {
        type: "complete",
        timestamp: Date.now(),
        ...(includeUsage &&
        (usage.input_tokens != null || usage.output_tokens != null)
          ? { usage }
          : {}),
      } as L0Event;
    }
  } catch (err) {
    // Wrap errors into L0 error events - never throw
    yield {
      type: "error",
      error: err instanceof Error ? err : new Error(String(err)),
      timestamp: Date.now(),
    };
  }
}

/**
 * Anthropic adapter for L0
 *
 * Use with `registerAdapter()` for auto-detection or pass directly to `l0({ adapter })`.
 *
 * @example
 * ```typescript
 * import { l0, anthropicAdapter } from 'l0';
 * import Anthropic from '@anthropic-ai/sdk';
 *
 * const anthropic = new Anthropic();
 *
 * // Explicit adapter usage
 * const result = await l0({
 *   stream: () => anthropic.messages.stream({
 *     model: 'claude-sonnet-4-20250514',
 *     max_tokens: 1024,
 *     messages: [{ role: 'user', content: 'Hello!' }]
 *   }),
 *   adapter: anthropicAdapter,
 * });
 * ```
 */
export const anthropicAdapter: L0Adapter<
  AnthropicStream,
  AnthropicAdapterOptions
> = {
  name: "anthropic",
  detect: isAnthropicStream,
  wrap: wrapAnthropicStream,
};

// Auto-register for detection when this module is imported
import { registerAdapter } from "./registry";
try {
  registerAdapter(anthropicAdapter, { silent: true });
} catch {
  // Already registered, ignore
}

/**
 * Create a stream factory for Anthropic SDK
 *
 * @param client - Anthropic client instance
 * @param params - Message stream parameters
 * @param options - Adapter options
 * @returns Stream factory function for use with L0
 *
 * @example
 * ```typescript
 * import Anthropic from '@anthropic-ai/sdk';
 * import { l0, anthropicStream } from 'l0';
 *
 * const anthropic = new Anthropic();
 *
 * const result = await l0({
 *   stream: anthropicStream(anthropic, {
 *     model: 'claude-sonnet-4-20250514',
 *     max_tokens: 1024,
 *     messages: [{ role: 'user', content: 'Hello!' }]
 *   })
 * });
 * ```
 */
export function anthropicStream(
  client: Anthropic,
  params: MessageCreateParamsBase,
  options?: AnthropicAdapterOptions,
): () => Promise<AsyncGenerator<L0Event>> {
  return async () => {
    const stream = client.messages.stream(params);
    return wrapAnthropicStream(stream, options);
  };
}

/**
 * Create a simple text stream from Anthropic
 *
 * @param client - Anthropic client instance
 * @param model - Model name
 * @param prompt - User prompt
 * @param options - Additional options
 * @returns Stream factory function for use with L0
 *
 * @example
 * ```typescript
 * import Anthropic from '@anthropic-ai/sdk';
 * import { l0, anthropicText } from 'l0';
 *
 * const anthropic = new Anthropic();
 *
 * const result = await l0({
 *   stream: anthropicText(anthropic, 'claude-sonnet-4-20250514', 'Write a haiku')
 * });
 * ```
 */
export function anthropicText(
  client: Anthropic,
  model: string,
  prompt: string,
  options?: {
    maxTokens?: number;
    system?: string;
  } & AnthropicAdapterOptions,
): () => Promise<AsyncGenerator<L0Event>> {
  const {
    maxTokens = 1024,
    system,
    includeUsage,
    includeToolUse,
  } = options || {};

  return anthropicStream(
    client,
    {
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
      ...(system ? { system } : {}),
    },
    { includeUsage, includeToolUse },
  );
}

// Re-export types for convenience
export type {
  RawMessageStreamEvent,
  RawMessageStartEvent,
  RawMessageDeltaEvent,
  RawContentBlockStartEvent,
  RawContentBlockDeltaEvent,
  RawContentBlockStopEvent,
  MessageCreateParamsBase,
} from "@anthropic-ai/sdk/resources/messages";
