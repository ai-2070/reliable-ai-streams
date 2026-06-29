# Custom Adapters (BYOA - Bring Your Own Adapter)

L0 supports custom adapters for integrating any LLM provider or streaming source. This guide covers everything you need to build production-ready adapters.

## Adapter Scope

L0 provides **official first-party adapters** for:

- **Vercel AI SDK** - Native support for `streamText()`, plus `vercelAIObjectAdapter` for `streamObject()`
- **OpenAI SDK** - `openaiAdapter` via `reliable-ai-streams/openai`
- **Mastra AI** - `mastraAdapter` via `reliable-ai-streams/mastra`
- **Anthropic SDK** - `anthropicAdapter` via `reliable-ai-streams/anthropic` (reference implementation)

These are the only integrations maintained within the core project.
Support for additional providers is out of scope.

> **Bundle size tip:** Import adapters from their subpaths (`reliable-ai-streams/openai`, etc.) to reduce bundle size. The main `reliable-ai-streams` entry also exports all adapters for convenience.

---

## Table of Contents

- [Overview](#overview)
- [The L0Adapter Interface](#the-l0adapter-interface)
- [Usage Modes](#usage-modes)
- [Building Adapters](#building-adapters)
- [Adapter Invariants](#adapter-invariants)
- [Helper Functions](#helper-functions)
- [Adapter Registry](#adapter-registry)
- [Built-in Adapters](#built-in-adapters)
- [Complete Examples](#complete-examples)
- [Testing Adapters](#testing-adapters)
- [Best Practices](#best-practices)

## Overview

Adapters convert provider-specific streams into L0's unified event format. L0 handles all reliability concerns (retries, timeouts, guardrails), so adapters can focus purely on format conversion.

```
Provider Stream → Adapter → L0Events → L0 Runtime → Reliable Output
```

L0 ships with built-in support for:

- **Vercel AI SDK** - Native support for `streamText()`, plus `vercelAIObjectAdapter` for `streamObject()`
- **OpenAI SDK** - `openaiAdapter`
- **Mastra AI** - `mastraAdapter`
- **Anthropic SDK** - `anthropicAdapter` (reference implementation)

For other providers, create a custom adapter.

## The L0Adapter Interface

```typescript
interface L0Adapter<StreamType = unknown, Options = unknown> {
  /**
   * Unique identifier for this adapter.
   */
  name: string;

  /**
   * Optional type guard for auto-detection.
   * Required ONLY for registerAdapter() auto-detection.
   * Not needed for explicit `adapter: myAdapter` usage.
   */
  detect?(input: unknown): input is StreamType;

  /**
   * Convert provider stream → L0Events.
   */
  wrap(stream: StreamType, options?: Options): AsyncGenerator<L0Event>;
}
```

### L0Event Types

```typescript
interface L0Event {
  type: "token" | "message" | "data" | "progress" | "error" | "complete";
  value?: string; // Text value (token/message)
  role?: string; // Role (message events)
  data?: L0DataPayload; // Multimodal data (data events)
  progress?: L0Progress; // Progress info (progress events)
  error?: Error; // Error (error events)
  timestamp: number; // Required on all events
  usage?: { input_tokens?: number; output_tokens?: number }; // On complete
}
```

### Multimodal Data Types

```typescript
interface L0DataPayload {
  contentType: "image" | "audio" | "video" | "file" | "json";
  mimeType: string;
  url?: string;
  base64?: string;
  bytes?: Uint8Array;
  json?: unknown;
  metadata?: Record<string, unknown>;
}

interface L0Progress {
  percent?: number;
  step?: number;
  totalSteps?: number;
  message?: string;
}
```

## Usage Modes

### 1. Explicit Adapter (Recommended)

Pass the adapter directly. No `detect()` needed.

```typescript
import { l0 } from "reliable-ai-streams/core";
import { anthropicAdapter } from "reliable-ai-streams/anthropic";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const result = await l0({
  stream: () =>
    anthropic.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Hello!" }],
    }),
  adapter: anthropicAdapter,
});
```

### 2. Adapter by Name

Reference a registered adapter by name:

```typescript
import { l0, registerAdapter } from "reliable-ai-streams";
import { anthropicAdapter } from "reliable-ai-streams/anthropic";

// Register once at startup
registerAdapter(anthropicAdapter);

// Use by name
const result = await l0({
  stream: () =>
    anthropic.messages.stream({
      /* ... */
    }),
  adapter: "anthropic",
});
```

### 3. Auto-Detection

Register adapters with `detect()` for automatic stream detection:

```typescript
import { l0, registerAdapter } from "reliable-ai-streams";
import { anthropicAdapter } from "reliable-ai-streams/anthropic";
import { openaiAdapter } from "reliable-ai-streams/openai";

// Register at startup
registerAdapter(anthropicAdapter);
registerAdapter(openaiAdapter);

// L0 auto-detects the adapter
const result = await l0({
  stream: () =>
    anthropic.messages.stream({
      /* ... */
    }),
  // No adapter specified - auto-detected!
});
```

### Stream Resolution Order

When L0 receives a stream, it resolves the adapter in this order:

1. **Explicit adapter object** - `adapter: myAdapter`
2. **Adapter by name** - `adapter: "myai"` → lookup in registry
3. **Native L0 streams** - Already L0Events, no wrapping needed
4. **Auto-detection** - Call `detect()` on registered adapters

## Building Adapters

### Minimal Adapter

```typescript
import type { L0Adapter, L0Event } from "reliable-ai-streams";

interface MyChunk {
  text?: string;
  done?: boolean;
}

type MyStream = AsyncIterable<MyChunk>;

const myAdapter: L0Adapter<MyStream> = {
  name: "myai",

  async *wrap(stream) {
    try {
      for await (const chunk of stream) {
        if (chunk.text) {
          yield {
            type: "token",
            value: chunk.text,
            timestamp: Date.now(),
          };
        }
      }
      yield { type: "complete", timestamp: Date.now() };
    } catch (err) {
      yield {
        type: "error",
        error: err instanceof Error ? err : new Error(String(err)),
        timestamp: Date.now(),
      };
    }
  },
};
```

### Adapter with Auto-Detection

Add `detect()` to enable auto-detection:

```typescript
const myAdapter: L0Adapter<MyStream> = {
  name: "myai",

  // Type guard - must be fast, synchronous, no I/O
  detect(input): input is MyStream {
    if (!input || typeof input !== "object") return false;
    if (!(Symbol.asyncIterator in input)) return false;
    // Check for provider-specific markers
    return "__myai_stream" in input;
  },

  async *wrap(stream) {
    // ... same as above
  },
};
```

### Adapter with Options

```typescript
interface MyAdapterOptions {
  includeUsage?: boolean;
  customField?: string;
}

const myAdapter: L0Adapter<MyStream, MyAdapterOptions> = {
  name: "myai",

  async *wrap(stream, options = {}) {
    const { includeUsage = true } = options;

    for await (const chunk of stream) {
      // Use options in processing
    }

    yield {
      type: "complete",
      timestamp: Date.now(),
      ...(includeUsage ? { usage: { output_tokens: 100 } } : {}),
    };
  },
};

// Use with options
const result = await l0({
  stream: () => getMyStream(),
  adapter: myAdapter,
  adapterOptions: { includeUsage: false },
});
```

## Adapter Invariants

Adapters MUST follow these rules. L0 depends on them for reliability.

### MUST Do

| Requirement                    | Description                                        |
| ------------------------------ | -------------------------------------------------- |
| **Preserve text exactly**      | Never trim, modify, or transform text content      |
| **Include timestamps**         | Every event must have `timestamp: Date.now()`      |
| **Emit events in order**       | Yield events in exact order received from provider |
| **Convert errors to events**   | Catch all errors, yield `{ type: "error" }`        |
| **Emit complete exactly once** | Always yield `{ type: "complete" }` at stream end  |
| **Be synchronous iteration**   | Only async operation is `for await` on the stream  |

### MUST NOT Do

| Forbidden            | Reason                                          |
| -------------------- | ----------------------------------------------- |
| **Modify text**      | L0 guardrails need exact text for validation    |
| **Buffer chunks**    | Breaks streaming, L0 handles batching if needed |
| **Retry internally** | L0 handles all retry logic                      |
| **Throw exceptions** | Convert to error events instead                 |
| **Skip chunks**      | Unless they contain no text (metadata-only)     |
| **Perform I/O**      | No HTTP calls, file reads, etc.                 |

### Example: Correct vs Incorrect

```typescript
// WRONG - modifies text
yield { type: "token", value: chunk.text.trim(), timestamp: Date.now() };

// CORRECT - preserves text exactly
yield { type: "token", value: chunk.text, timestamp: Date.now() };

// WRONG - throws on error
if (chunk.error) throw new Error(chunk.error);

// CORRECT - converts to error event
if (chunk.error) {
  yield { type: "error", error: new Error(chunk.error), timestamp: Date.now() };
  return;
}

// WRONG - missing timestamp
yield { type: "token", value: chunk.text };

// CORRECT - includes timestamp
yield { type: "token", value: chunk.text, timestamp: Date.now() };
```

## Helper Functions

L0 provides helpers to make building correct adapters easier.

### toL0Events

The simplest way to build an adapter:

```typescript
import { toL0Events } from "reliable-ai-streams";
import type { L0Adapter } from "reliable-ai-streams";

const myAdapter: L0Adapter<MyStream> = {
  name: "myai",
  wrap(stream) {
    return toL0Events(stream, (chunk) => chunk.text ?? null);
  },
};
```

`toL0Events` handles:

- Timestamp generation
- Error conversion to error events
- Automatic complete event emission
- Null/undefined filtering

### toL0EventsWithMessages

For streams with both text and structured messages (tool calls, etc.):

```typescript
import { toL0EventsWithMessages } from "reliable-ai-streams";
import type { L0Adapter } from "reliable-ai-streams";

const toolAdapter: L0Adapter<ToolStream> = {
  name: "tool-ai",
  wrap(stream) {
    return toL0EventsWithMessages(stream, {
      extractText: (chunk) => (chunk.type === "text" ? chunk.content : null),
      extractMessage: (chunk) => {
        if (chunk.type === "tool_call") {
          return {
            value: JSON.stringify(chunk.tool),
            role: "assistant",
          };
        }
        return null;
      },
    });
  },
};
```

### toMultimodalL0Events

For streams with multimodal content (images, audio, etc.):

```typescript
import { toMultimodalL0Events } from "reliable-ai-streams";
import type { L0Adapter } from "reliable-ai-streams";

const imageAdapter: L0Adapter<ImageStream> = {
  name: "image-ai",
  wrap(stream) {
    return toMultimodalL0Events(stream, {
      extractText: (chunk) => (chunk.type === "text" ? chunk.text : null),
      extractData: (chunk) => {
        if (chunk.type === "image") {
          return {
            contentType: "image",
            mimeType: "image/png",
            base64: chunk.image,
            metadata: { width: chunk.width, height: chunk.height },
          };
        }
        return null;
      },
      extractProgress: (chunk) => {
        if (chunk.type === "progress") {
          return { percent: chunk.percent, message: chunk.status };
        }
        return null;
      },
    });
  },
};
```

### Event Creation Helpers

For manual adapter implementations:

```typescript
import {
  createAdapterTokenEvent,
  createAdapterDoneEvent,
  createAdapterErrorEvent,
  createAdapterMessageEvent,
  createAdapterDataEvent,
  createAdapterProgressEvent,
  createImageEvent,
  createAudioEvent,
  createJsonDataEvent,
} from "reliable-ai-streams";

async function* manualAdapter(stream: MyStream): AsyncGenerator<L0Event> {
  try {
    for await (const chunk of stream) {
      if (chunk.text) {
        yield createAdapterTokenEvent(chunk.text);
      }
      if (chunk.toolCall) {
        yield createAdapterMessageEvent(
          JSON.stringify(chunk.toolCall),
          "assistant",
        );
      }
      if (chunk.image) {
        yield createImageEvent({
          base64: chunk.image,
          mimeType: "image/png",
          width: chunk.width,
          height: chunk.height,
        });
      }
    }
    yield createAdapterDoneEvent();
  } catch (err) {
    yield createAdapterErrorEvent(err);
  }
}
```

## Adapter Registry

### Registering Adapters

```typescript
import {
  registerAdapter,
  unregisterAdapter,
  unregisterAllExcept,
  clearAdapters,
} from "reliable-ai-streams";

// Register for auto-detection
registerAdapter(myAdapter);

// Register with priority (higher priority = checked first)
// Default priority is 0. Use higher values for specialized adapters.
registerAdapter(mySpecializedAdapter, { priority: 10 });

// Silence warning for adapters without detect()
registerAdapter(adapterWithoutDetect, { silent: true });

// Unregister by name
unregisterAdapter("myai");

// Unregister all adapters except specified ones (useful for testing)
const removed = unregisterAllExcept(["vercel-ai"]);
console.log(removed); // ["openai", "anthropic", "mastra"]

// Clear all (useful in tests)
clearAdapters();
```

### Registry Functions

| Function                             | Description                                                     |
| ------------------------------------ | --------------------------------------------------------------- |
| `registerAdapter(adapter, options?)` | Register for auto-detection. Options: `{ silent?, priority? }`  |
| `unregisterAdapter(name)`            | Remove by name                                                  |
| `unregisterAllExcept(names?)`        | Remove all adapters except those in the array                   |
| `getAdapter(name)`                   | Get adapter by name                                             |
| `getRegisteredStreamAdapters()`      | List all registered names                                       |
| `clearAdapters()`                    | Remove all adapters                                             |
| `detectAdapter(input)`               | Auto-detect adapter for stream (returns highest priority match) |
| `hasMatchingAdapter(input)`          | Check if at least one adapter matches                           |
| `DEFAULT_ADAPTER_PRIORITY`           | Default priority value (0) for adapters                         |

### DX Warning

In development mode, registering an adapter without `detect()` logs a warning:

```
⚠️  Adapter "myai" has no detect() method.
   It will not be used for auto-detection.
   Use explicit `adapter: myAdapter` instead, or add a detect() method.
```

Suppress with `{ silent: true }` or in production (`NODE_ENV=production`).

## Built-in Adapters

### Vercel AI SDK Adapters

L0 has native support for Vercel AI SDK's `streamText()`. For `streamObject()`, use the dedicated `vercelAIObjectAdapter`:

```typescript
import { structured } from "reliable-ai-streams";
import {
  vercelAIObjectAdapter,
  wrapVercelAIObjectStream,
} from "reliable-ai-streams/adapters";
import { streamObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const schema = z.object({
  name: z.string(),
  age: z.number(),
});

// Use with structured() - adapter auto-detected via priority
const result = await structured({
  schema,
  stream: () =>
    streamObject({
      model: openai("gpt-4o"),
      prompt: "Generate a person",
      schema,
    }),
});

// Or explicitly specify the adapter
const result = await structured({
  schema,
  stream: () =>
    streamObject({
      model: openai("gpt-4o"),
      prompt: "Generate a person",
      schema,
    }),
  adapter: vercelAIObjectAdapter,
});
```

#### Why a Separate Adapter?

The standard `vercel-ai` adapter uses `fullStream.getReader()` which locks the ReadableStream. This causes "ReadableStream is locked" errors when L0's `structured()` needs to retry on validation failures. The `vercel-ai-object` adapter uses `textStream` (an AsyncIterable) instead, avoiding the locking issue.

#### Vercel AI Object Adapter Options

```typescript
interface VercelAIObjectAdapterOptions {
  includeUsage?: boolean; // Include usage in complete event (default: true)
}
```

### OpenAI Adapter

```typescript
import { l0 } from "reliable-ai-streams/core";
import {
  openaiAdapter,
  wrapOpenAIStream,
  openaiStream,
  openaiText,
  openaiJSON,
  openaiWithTools,
} from "reliable-ai-streams/openai";
import OpenAI from "openai";

const openai = new OpenAI();

// Option 1: Explicit adapter
const result = await l0({
  stream: () =>
    openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello!" }],
      stream: true,
    }),
  adapter: openaiAdapter,
});

// Option 2: Pre-wrap the stream
const result = await l0({
  stream: async () => {
    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello!" }],
      stream: true,
    });
    return wrapOpenAIStream(stream);
  },
});

// Option 3: Use helper factories
const result = await l0({
  stream: openaiStream(openai, {
    model: "gpt-4o",
    messages: [{ role: "user", content: "Hello!" }],
  }),
});

// Simple text
const result = await l0({
  stream: openaiText(openai, "gpt-4o", "Write a haiku"),
});

// JSON output
const result = await l0({
  stream: openaiJSON(openai, "gpt-4o", "Generate user data"),
});

// With tools
const result = await l0({
  stream: openaiWithTools(openai, "gpt-4o", messages, tools),
});
```

#### OpenAI Adapter Options

```typescript
interface OpenAIAdapterOptions {
  includeUsage?: boolean; // Include usage in complete event (default: true)
  includeToolCalls?: boolean; // Include tool calls as events (default: true)
  emitFunctionCallsAsTokens?: boolean; // Emit function args as tokens (default: false)
  choiceIndex?: number | "all"; // Which choice to use when n > 1 (default: 0)
}
```

### Anthropic Adapter Reference Implementation

```typescript
import { l0 } from "reliable-ai-streams/core";
import {
  anthropicAdapter,
  wrapAnthropicStream,
  anthropicStream,
  anthropicText,
} from "reliable-ai-streams/anthropic";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

// Option 1: Explicit adapter
const result = await l0({
  stream: () =>
    anthropic.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Hello!" }],
    }),
  adapter: anthropicAdapter,
});

// Option 2: Pre-wrap the stream
const result = await l0({
  stream: async () => {
    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Hello!" }],
    });
    return wrapAnthropicStream(stream);
  },
});

// Option 3: Use helper factory
const result = await l0({
  stream: anthropicStream(anthropic, {
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [{ role: "user", content: "Hello!" }],
  }),
});

// Simple text
const result = await l0({
  stream: anthropicText(anthropic, "claude-sonnet-4-20250514", "Write a haiku"),
});
```

#### Anthropic Adapter Options

```typescript
interface AnthropicAdapterOptions {
  includeUsage?: boolean; // Include usage in complete event (default: true)
  includeToolUse?: boolean; // Include tool use blocks as events (default: true)
}
```

### Mastra Adapter

```typescript
import { l0 } from "reliable-ai-streams/core";
import {
  mastraAdapter,
  wrapMastraStream,
  wrapMastraFullStream,
  mastraStream,
  mastraText,
  mastraStructured,
  extractMastraText,
  extractMastraObject,
} from "reliable-ai-streams/mastra";
import { Agent } from "@mastra/core";

const agent = new Agent({
  /* config */
});

// Option 1: Explicit adapter
const result = await l0({
  stream: () => agent.stream("Hello!"),
  adapter: mastraAdapter,
});

// Option 2: Pre-wrap the stream
const result = await l0({
  stream: async () => {
    const stream = await agent.stream("Hello!");
    return wrapMastraStream(stream);
  },
});

// Option 3: Use helper factories
const result = await l0({
  stream: mastraStream(agent, "Hello!"),
});

// Simple text
const result = await l0({
  stream: mastraText(agent, "Write a haiku"),
});

// Structured output
const result = await l0({
  stream: mastraStructured(agent, "Generate user data", userSchema),
});

// Full stream (all chunk types)
const result = await l0({
  stream: async () => {
    const stream = await agent.stream("Hello!");
    return wrapMastraFullStream(stream);
  },
});
```

#### Mastra Adapter Options

```typescript
interface MastraAdapterOptions {
  includeUsage?: boolean; // Include usage in complete event (default: true)
  includeToolCalls?: boolean; // Include tool calls as events (default: true)
  includeReasoning?: boolean; // Include reasoning content as tokens (default: false)
}
```

## Complete Examples

### Custom Provider Adapter

```typescript
import type { L0Adapter, L0Event } from "reliable-ai-streams";
import { toL0Events } from "reliable-ai-streams";

// Define the provider's stream types
interface CustomProviderChunk {
  type: "text" | "metadata" | "end";
  content?: string;
  tokens?: number;
}

type CustomProviderStream = AsyncIterable<CustomProviderChunk> & {
  __customProvider: true;
};

// Build the adapter
export const customProviderAdapter: L0Adapter<CustomProviderStream> = {
  name: "custom-provider",

  // Type guard for auto-detection
  detect(input): input is CustomProviderStream {
    return (
      !!input &&
      typeof input === "object" &&
      Symbol.asyncIterator in input &&
      "__customProvider" in input
    );
  },

  // Stream conversion
  wrap(stream) {
    return toL0Events(stream, (chunk) => {
      if (chunk.type === "text" && chunk.content) {
        return chunk.content;
      }
      return null; // Skip non-text chunks
    });
  },
};
```

### Adapter with Tool Support

Custom adapters that emit tool calls must use L0's **standardized flat format** for tool observability events to work correctly.

#### L0 Tool Call Schema

L0 detects and tracks tool calls/results for observability. Custom adapters **MUST** emit tool messages using this flat format:

```typescript
// Tool call (assistant requests tool execution)
{
  type: "tool_call",
  id: string,        // Unique identifier for this tool call
  name: string,      // Tool/function name
  arguments: object  // Tool arguments (parsed JSON object, not string)
}

// Tool result (tool execution response)
{
  type: "tool_result",
  id: string,        // Must match the tool_call id
  result: unknown,   // Tool execution result
  error?: string     // Optional error message if execution failed
}
```

#### Why This Format?

L0 emits observability events when it detects tool calls:

| Event            | Description                                          |
| ---------------- | ---------------------------------------------------- |
| `TOOL_REQUESTED` | Tool call detected, contains name, id, and arguments |
| `TOOL_START`     | Tool execution began                                 |
| `TOOL_RESULT`    | Tool completed successfully, includes duration       |
| `TOOL_ERROR`     | Tool execution failed                                |
| `TOOL_COMPLETED` | Tool lifecycle finished (success or error)           |

These events enable:

- Duration tracking between tool call and result
- Error monitoring for tool executions
- Tool usage analytics via `onToolCall` callback

#### Complete Example

```typescript
import type { L0Adapter, L0Event } from "reliable-ai-streams";

interface ToolProviderChunk {
  type: "text" | "tool_call" | "tool_result" | "complete";
  text?: string;
  tool?: { id: string; name: string; arguments: Record<string, unknown> };
  result?: { id: string; output: unknown; error?: string };
}

type ToolProviderStream = AsyncIterable<ToolProviderChunk>;

export const toolProviderAdapter: L0Adapter<ToolProviderStream> = {
  name: "tool-provider",

  async *wrap(stream) {
    try {
      for await (const chunk of stream) {
        switch (chunk.type) {
          case "text":
            if (chunk.text) {
              yield {
                type: "token",
                value: chunk.text,
                timestamp: Date.now(),
              };
            }
            break;

          case "tool_call":
            if (chunk.tool) {
              // Use L0's flat format for tool calls
              yield {
                type: "message",
                value: JSON.stringify({
                  type: "tool_call",
                  id: chunk.tool.id,
                  name: chunk.tool.name,
                  arguments: chunk.tool.arguments,
                }),
                role: "assistant",
                timestamp: Date.now(),
              };
            }
            break;

          case "tool_result":
            if (chunk.result) {
              // Use L0's flat format for tool results
              yield {
                type: "message",
                value: JSON.stringify({
                  type: "tool_result",
                  id: chunk.result.id,
                  result: chunk.result.output,
                  error: chunk.result.error,
                }),
                role: "tool",
                timestamp: Date.now(),
              };
            }
            break;

          case "complete":
            yield { type: "complete", timestamp: Date.now() };
            return;
        }
      }

      // Ensure complete is emitted
      yield { type: "complete", timestamp: Date.now() };
    } catch (err) {
      yield {
        type: "error",
        error: err instanceof Error ? err : new Error(String(err)),
        timestamp: Date.now(),
      };
    }
  },
};
```

### Wrapping a REST API

```typescript
import type { L0Adapter, L0Event } from "reliable-ai-streams";

interface SSEMessage {
  data: string;
  event?: string;
}

// Parse SSE stream from fetch response
async function* parseSSE(response: Response): AsyncIterable<SSEMessage> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        yield { data: line.slice(6) };
      }
    }
  }
}

// Adapter wraps the parsed SSE
export const restApiAdapter: L0Adapter<Response> = {
  name: "rest-api",

  async *wrap(response) {
    try {
      for await (const message of parseSSE(response)) {
        if (message.data === "[DONE]") {
          yield { type: "complete", timestamp: Date.now() };
          return;
        }

        const parsed = JSON.parse(message.data);
        if (parsed.text) {
          yield {
            type: "token",
            value: parsed.text,
            timestamp: Date.now(),
          };
        }
      }

      yield { type: "complete", timestamp: Date.now() };
    } catch (err) {
      yield {
        type: "error",
        error: err instanceof Error ? err : new Error(String(err)),
        timestamp: Date.now(),
      };
    }
  },
};

// Usage
const result = await l0({
  stream: async () => {
    const response = await fetch("https://api.example.com/stream", {
      method: "POST",
      body: JSON.stringify({ prompt: "Hello!" }),
    });
    return response;
  },
  adapter: restApiAdapter,
});
```

### Multimodal Adapter (Image Generation)

```typescript
import type { L0Adapter, L0Event } from "reliable-ai-streams";
import { toMultimodalL0Events } from "reliable-ai-streams";

interface ImageGenChunk {
  type: "progress" | "image" | "complete";
  percent?: number;
  message?: string;
  image?: string; // base64
  width?: number;
  height?: number;
  seed?: number;
}

type ImageGenStream = AsyncIterable<ImageGenChunk>;

export const imageGenAdapter: L0Adapter<ImageGenStream> = {
  name: "image-gen",

  wrap(stream) {
    return toMultimodalL0Events(stream, {
      extractProgress: (chunk) => {
        if (chunk.type === "progress") {
          return { percent: chunk.percent, message: chunk.message };
        }
        return null;
      },
      extractData: (chunk) => {
        if (chunk.type === "image" && chunk.image) {
          return {
            contentType: "image",
            mimeType: "image/png",
            base64: chunk.image,
            metadata: {
              width: chunk.width,
              height: chunk.height,
              seed: chunk.seed,
            },
          };
        }
        return null;
      },
    });
  },
};
```

## Testing Adapters

### Unit Test Structure

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { myAdapter } from "./my-adapter";
import { registerAdapter, clearAdapters, detectAdapter } from "reliable-ai-streams";

// Helper to collect events
async function collectEvents(gen: AsyncGenerator<L0Event>): Promise<L0Event[]> {
  const events: L0Event[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

// Helper to create mock stream
async function* mockStream(chunks: MyChunk[]): AsyncIterable<MyChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe("myAdapter", () => {
  beforeEach(() => {
    clearAdapters();
  });

  afterEach(() => {
    clearAdapters();
  });

  it("should preserve exact text content", async () => {
    const stream = mockStream([
      { text: "  Hello  " },
      { text: "\n\nWorld\n\n" },
    ]);

    const events = await collectEvents(myAdapter.wrap(stream));

    expect(events[0]).toMatchObject({ type: "token", value: "  Hello  " });
    expect(events[1]).toMatchObject({ type: "token", value: "\n\nWorld\n\n" });
  });

  it("should include timestamps on all events", async () => {
    const stream = mockStream([{ text: "Hello" }]);
    const events = await collectEvents(myAdapter.wrap(stream));

    for (const event of events) {
      expect(event.timestamp).toBeDefined();
      expect(typeof event.timestamp).toBe("number");
    }
  });

  it("should emit complete event exactly once", async () => {
    const stream = mockStream([{ text: "A" }, { text: "B" }]);
    const events = await collectEvents(myAdapter.wrap(stream));

    const completeEvents = events.filter((e) => e.type === "complete");
    expect(completeEvents).toHaveLength(1);
  });

  it("should convert errors to error events", async () => {
    async function* errorStream(): AsyncIterable<MyChunk> {
      yield { text: "Hello" };
      throw new Error("Stream failed");
    }

    const events = await collectEvents(myAdapter.wrap(errorStream()));

    expect(events[0]).toMatchObject({ type: "token", value: "Hello" });
    expect(events[1].type).toBe("error");
    expect((events[1] as any).error.message).toBe("Stream failed");
  });

  it("should detect stream correctly", () => {
    const validStream = createMyStream();
    const invalidStream = { notMyStream: true };

    expect(myAdapter.detect?.(validStream)).toBe(true);
    expect(myAdapter.detect?.(invalidStream)).toBe(false);
    expect(myAdapter.detect?.(null)).toBe(false);
    expect(myAdapter.detect?.(undefined)).toBe(false);
  });
});
```

### Key Test Cases

1. **Text preservation** - Exact text including whitespace, newlines, special chars
2. **Timestamps** - Every event has numeric timestamp
3. **Complete event** - Emitted exactly once at end
4. **Error handling** - Errors become error events, never thrown
5. **Event ordering** - Events emitted in receive order
6. **Empty streams** - Still emit complete event
7. **Detection** - Type guard returns correct boolean

## Best Practices

### DO

- Use `toL0Events` or `toMultimodalL0Events` helper when possible
- Test with various chunk shapes from your provider
- Handle all edge cases (empty text, missing fields)
- Keep `detect()` fast and synchronous
- Document provider-specific behavior

### DON'T

- Don't trim or normalize text
- Don't add artificial delays
- Don't buffer chunks for batching
- Don't make HTTP calls in `wrap()`
- Don't assume chunk structure without checking

### Performance Tips

1. **Avoid allocations in hot path** - Reuse objects where possible
2. **Keep detect() O(1)** - Only check object properties
3. **Don't parse JSON unnecessarily** - Pass through raw text
4. **Let L0 handle batching** - Yield events immediately

### Error Messages

Provide helpful error messages:

```typescript
detect(input): input is MyStream {
  if (!input || typeof input !== "object") return false;
  if (!(Symbol.asyncIterator in input)) return false;
  if (!("__myMarker" in input)) return false;
  return true;
}
```

If detection fails, L0 shows:

```
No registered adapter detected for stream.
Detectable adapters: [openai, anthropic, myai].
Use explicit `adapter: myAdapter` or register an adapter with detect().
```

---

## See Also

- [API.md](./API.md) - Complete API reference
- [QUICKSTART.md](./QUICKSTART.md) - Getting started guide
- [NETWORK_ERRORS.md](./NETWORK_ERRORS.md) - Error handling and retries
