# L0 API Reference

Complete API reference for L0.

> Most applications should simply use `import { l0 } from "@ai2070/l0"`.
> Only optimize imports if you're targeting edge runtimes or strict bundle constraints.
> See [Subpath Imports](#subpath-imports-bundle-optimization) for details.

## Table of Contents

- [Core Functions](#core-functions)
- [Lifecycle Callbacks](#lifecycle-callbacks)
- [Type-Safe Generics](#type-safe-generics)
- [Structured Output](#structured-output)
- [Document Windows](#document-windows)
- [Consensus](#consensus)
- [Guardrails](#guardrails)
- [Retry Configuration](#retry-configuration)
- [Smart Continuation Deduplication](#smart-continuation-deduplication)
- [Error Handling](#error-handling)
- [State Machine](#state-machine)
- [Metrics](#metrics)
- [Pipeline](#pipeline)
- [Async Checks](#async-checks)
- [Formatting Helpers](#formatting-helpers)
- [Utility Functions](#utility-functions)
- [OpenAI SDK Adapter](#openai-sdk-adapter)
- [Mastra Adapter](#mastra-adapter)
- [Types](#types)
- [Subpath Imports (Bundle Optimization)](#subpath-imports-bundle-optimization)

---

## Core Functions

### l0(options)

Main streaming runtime with guardrails and retry logic.

```typescript
import { l0 } from "@ai2070/l0";

const result = await l0({
  // Required: Stream factory
  stream: () => streamText({ model, prompt }),

  // Optional: Fallback streams
  fallbackStreams: [() => streamText({ model: fallbackModel, prompt })],

  // Optional: Guardrails
  guardrails: recommendedGuardrails,

  // Optional: Retry configuration
  retry: {
    attempts: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    backoff: "fixed-jitter", // "exponential" | "linear" | "fixed" | "full-jitter"

    // Optional: specify which error types to retry on, defaults to all recoverable errors
    retryOn: [
      "zero_output",
      "guardrail_violation",
      "drift",
      "incomplete",
      "network_error",
      "timeout",
      "rate_limit",
      "server_error",
    ],
  },

  // Optional: Timeouts (ms), default as follows
  timeout: {
    initialToken: 5000, // 5s to first token
    interToken: 10000, // 10s between tokens
  },

  // Optional: Check intervals, default as follows
  checkIntervals: {
    guardrails: 15, // Check every N tokens
    drift: 25,
    checkpoint: 20,
  },

  // Optional: Abort signal
  signal: abortController.signal,

  // Optional: Lifecycle callbacks
  onStart: (attempt, isRetry, isFallback) => {},
  onComplete: (state) => {},
  onError: (error, willRetry, willFallback) => {},
  onEvent: (event) => {},
  onViolation: (violation) => {},
  onRetry: (attempt, reason) => {},
  onFallback: (index, reason) => {},
  onResume: (checkpoint, tokenCount) => {},
  onCheckpoint: (checkpoint, tokenCount) => {},
  onTimeout: (type, elapsedMs) => {},
  onAbort: (tokenCount, contentLength) => {},
  onDrift: (types, confidence) => {},
  onToolCall: (toolName, toolCallId, args) => {},
});

// Consume stream
for await (const event of result.stream) {
  switch (event.type) {
    case "token":
      console.log(event.value);
      break;
    case "complete":
      console.log("Complete");
      break;
    case "error":
      console.error(event.error);
      break;
  }
}

// Access final state
console.log(result.state.content);
console.log(result.state.tokenCount);
```

**Returns:** `L0Result`

| Property    | Type                     | Description                          |
| ----------- | ------------------------ | ------------------------------------ |
| `stream`    | `AsyncIterable<L0Event>` | Event stream                         |
| `text`      | `string`                 | Full accumulated text (after stream) |
| `state`     | `L0State`                | Runtime state                        |
| `errors`    | `Error[]`                | Any errors that occurred             |
| `telemetry` | `L0Telemetry`            | Telemetry data (if monitoring on)    |
| `abort`     | `() => void`             | Abort controller for cancellation    |

---

## Lifecycle Callbacks

L0 provides a complete set of lifecycle callbacks for monitoring and responding to runtime events. All callbacks are optional and are pure side-effect handlers (they don't affect execution flow).

### Callback Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            L0 LIFECYCLE FLOW                                │
└─────────────────────────────────────────────────────────────────────────────┘

                                ┌──────────┐
                                │  START   │
                                └────┬─────┘
                                     │
                                     ▼
                      ┌──────────────────────────────┐
                      │ onStart(attempt, false, false) │
                      └──────────────┬───────────────┘
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                              STREAMING PHASE                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         onEvent(event)                              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│  During streaming, these callbacks fire as conditions occur:               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ onCheckpoint │  │  onToolCall  │  │   onDrift    │  │  onTimeout   │   │
│  │ (checkpoint, │  │ (toolName,   │  │ (types,      │  │ (type,       │   │
│  │  tokenCount) │  │  id, args)   │  │  confidence) │  │  elapsedMs)  │   │
│  └──────────────┘  └──────────────┘  └──────┬───────┘  └──────┬───────┘   │
│                                             │                  │           │
│                                             └────────┬─────────┘           │
│                                                      │ triggers retry      │
└──────────────────────────────────────────────────────┼─────────────────────┘
                                                       │
              ┌────────────────────────────────────────┼────────────────┐
              │                    │                   │                │
              ▼                    ▼                   ▼                ▼
        ┌─────────┐          ┌───────────┐      ┌──────────┐      ┌─────────┐
        │ SUCCESS │          │   ERROR   │      │VIOLATION │      │  ABORT  │
        └────┬────┘          └─────┬─────┘      └────┬─────┘      └────┬────┘
             │                     │                 │                 │
             │                     │                 ▼                 ▼
             │                     │          ┌─────────────┐   ┌───────────┐
             │                     │          │ onViolation │   │  onAbort  │
             │                     │          └──────┬──────┘   │(tokenCount│
             │                     │                 │          │ contentLen)│
             │                     ▼                 ▼          └───────────┘
             │              ┌────────────────────────────────┐
             │              │ onError(error, willRetry,      │
             │              │         willFallback)          │
             │              └──────────────┬─────────────────┘
             │                             │
             │                 ┌───────────┼───────────┐
             │                 │           │           │
             │                 ▼           ▼           ▼
             │           ┌──────────┐ ┌──────────┐ ┌──────────┐
             │           │  RETRY   │ │ FALLBACK │ │  FATAL   │
             │           └────┬─────┘ └────┬─────┘ └────┬─────┘
             │                │            │            │
             │                ▼            ▼            │
             │          ┌───────────┐ ┌───────────┐     │
             │          │ onRetry() │ │onFallback │     │
             │          └─────┬─────┘ └─────┬─────┘     │
             │                │             │           │
             │                │    ┌────────┘           │
             │                │    │                    │
             │                ▼    ▼                    │
             │          ┌─────────────────────┐         │
             │          │  Has checkpoint?    │         │
             │          └──────────┬──────────┘         │
             │                YES  │  NO                │
             │                ┌────┴────┐               │
             │                ▼         ▼               │
             │          ┌──────────┐    │               │
             │          │ onResume │    │               │
             │          └────┬─────┘    │               │
             │               │          │               │
             │               ▼          ▼               │
             │          ┌─────────────────────────┐     │
             │          │onStart(attempt, isRetry,│     │
             │          │        isFallback)      │─────┼──► Back to STREAMING
             │          └─────────────────────────┘     │
             │                                          │
             ▼                                          ▼
      ┌─────────────┐                            ┌──────────┐
      │ onComplete  │                            │  THROW   │
      │   (state)   │                            │  ERROR   │
      └─────────────┘                            └──────────┘
```

### Callback Reference

| Callback       | Signature                                                                       | When Called                            |
| -------------- | ------------------------------------------------------------------------------- | -------------------------------------- |
| `onStart`      | `(attempt: number, isRetry: boolean, isFallback: boolean) => void`              | New execution attempt begins           |
| `onComplete`   | `(state: L0State) => void`                                                      | Stream finished successfully           |
| `onError`      | `(error: Error, willRetry: boolean, willFallback: boolean) => void`             | Error occurred (before retry decision) |
| `onEvent`      | `(event: L0Event) => void`                                                      | Any streaming event emitted            |
| `onViolation`  | `(violation: GuardrailViolation) => void`                                       | Guardrail violation detected           |
| `onRetry`      | `(attempt: number, reason: string) => void`                                     | Retry triggered (same model)           |
| `onFallback`   | `(index: number, reason: string) => void`                                       | Switching to fallback model            |
| `onResume`     | `(checkpoint: string, tokenCount: number) => void`                              | Continuing from checkpoint             |
| `onCheckpoint` | `(checkpoint: string, tokenCount: number) => void`                              | Checkpoint saved                       |
| `onTimeout`    | `(type: "initial" \| "inter", elapsedMs: number) => void`                       | Timeout occurred                       |
| `onAbort`      | `(tokenCount: number, contentLength: number) => void`                           | Stream aborted                         |
| `onDrift`      | `(types: string[], confidence?: number) => void`                                | Drift detected                         |
| `onToolCall`   | `(toolName: string, toolCallId: string, args: Record<string, unknown>) => void` | Tool call detected                     |

> **Note:** All callbacks are fire-and-forget. They execute via microtasks and never block the stream. Errors in callbacks are silently caught and do not affect stream processing.

> **Important:** The `onStart` callback is called for the initial attempt, retry attempts, and fallback attempts. Internally, `SESSION_START` is emitted once at session start, `ATTEMPT_START` is emitted for retries, and `FALLBACK_START` is emitted for fallbacks. All three events trigger the `onStart` callback.

### Usage Example

```typescript
import { l0 } from "@ai2070/l0";

const result = await l0({
  stream: () => streamText({ model, prompt }),
  fallbackStreams: [() => streamText({ model: fallbackModel, prompt })],

  // Lifecycle callbacks
  onStart: (attempt, isRetry, isFallback) => {
    console.log(`Starting attempt ${attempt}`);
    if (isRetry) console.log("  (retry)");
    if (isFallback) console.log("  (fallback model)");
  },

  onComplete: (state) => {
    console.log(`Completed with ${state.tokenCount} tokens`);
    console.log(`Duration: ${state.duration}ms`);
  },

  onError: (error, willRetry, willFallback) => {
    console.error(`Error: ${error.message}`);
    if (willRetry) console.log("  Will retry...");
    if (willFallback) console.log("  Will try fallback...");
  },

  onEvent: (event) => {
    if (event.type === "token") {
      process.stdout.write(event.value);
    }
  },

  onViolation: (violation) => {
    console.warn(`Guardrail violation: ${violation.rule}`);
    console.warn(`  ${violation.message}`);
  },

  onRetry: (attempt, reason) => {
    console.log(`Retrying (attempt ${attempt}): ${reason}`);
  },

  onFallback: (index, reason) => {
    console.log(`Switching to fallback ${index}: ${reason}`);
  },

  onResume: (checkpoint, tokenCount) => {
    console.log(`Resuming from checkpoint (${tokenCount} tokens)`);
  },

  onCheckpoint: (checkpoint, tokenCount) => {
    console.log(`Checkpoint saved (${tokenCount} tokens)`);
  },

  onTimeout: (type, elapsedMs) => {
    console.log(`Timeout: ${type} after ${elapsedMs}ms`);
  },

  onAbort: (tokenCount, contentLength) => {
    console.log(`Aborted after ${tokenCount} tokens (${contentLength} chars)`);
  },

  onDrift: (types, confidence) => {
    console.log(
      `Drift detected: ${types.join(", ")} (confidence: ${confidence})`,
    );
  },

  onToolCall: (toolName, toolCallId, args) => {
    console.log(`Tool call: ${toolName} (${toolCallId})`);
    console.log(`  Args: ${JSON.stringify(args)}`);
  },
});
```

### Callback Details

#### onStart

Called at the beginning of each execution attempt.

```typescript
onStart: (attempt: number, isRetry: boolean, isFallback: boolean) => void
```

- `attempt`: 1-based attempt number (first attempt is 1)
- `isRetry`: true if this is a retry of the same stream
- `isFallback`: true if using a fallback stream

#### onComplete

Called when the stream finishes successfully.

```typescript
onComplete: (state: L0State) => void
```

- `state`: Final runtime state with content, tokenCount, duration, etc.

#### onError

Called when an error occurs, before the retry/fallback decision is made.

```typescript
onError: (error: Error, willRetry: boolean, willFallback: boolean) => void
```

- `error`: The error that occurred
- `willRetry`: true if L0 will retry with the same stream
- `willFallback`: true if L0 will try a fallback stream

#### onEvent

Called for every streaming event. Use for logging, progress tracking, or custom processing.

```typescript
onEvent: (event: L0Event) => void
```

#### onViolation

Called when a guardrail violation is detected.

```typescript
onViolation: (violation: GuardrailViolation) => void
```

#### onRetry

Called when a retry is triggered (same model, not fallback).

```typescript
onRetry: (attempt: number, reason: string) => void
```

- `attempt`: The retry attempt number
- `reason`: Why the retry was triggered (e.g., "guardrail_violation", "timeout")

#### onFallback

Called when switching to a fallback stream.

```typescript
onFallback: (index: number, reason: string) => void
```

- `index`: 0-based index of the fallback stream being used (0 = first fallback)
- `reason`: Why the fallback was triggered

#### onResume

Called when resuming from a checkpoint (when `continueFromLastKnownGoodToken` is enabled).

```typescript
onResume: (checkpoint: string, tokenCount: number) => void
```

- `checkpoint`: The checkpoint content being resumed from
- `tokenCount`: Number of tokens in the checkpoint

#### onCheckpoint

Called when a checkpoint is saved (content has passed guardrails and can be safely resumed from).

```typescript
onCheckpoint: (checkpoint: string, tokenCount: number) => void
```

- `checkpoint`: The checkpoint content
- `tokenCount`: Number of tokens in the checkpoint

#### onTimeout

Called when a timeout occurs (initial token or inter-token).

```typescript
onTimeout: (type: "initial" | "inter", elapsedMs: number) => void
```

- `type`: The timeout type - "initial" for first token timeout, "inter" for inter-token timeout
- `elapsedMs`: Time elapsed before timeout triggered

#### onAbort

Called when the stream is aborted (user abort or external signal).

```typescript
onAbort: (tokenCount: number, contentLength: number) => void
```

- `tokenCount`: Number of tokens received before abort
- `contentLength`: Length of content received before abort

#### onDrift

Called when drift is detected in the generated content.

```typescript
onDrift: (types: string[], confidence?: number) => void
```

- `types`: Array of drift types detected (e.g., "repetition", "topic_shift")
- `confidence`: Optional drift confidence score (0-1)

#### onToolCall

Called when a tool call is detected in the stream. L0 does not execute tools - this is for observability only.

```typescript
onToolCall: (toolName: string, toolCallId: string, args: Record<string, unknown>) => void
```

- `toolName`: Name of the tool being called
- `toolCallId`: Unique identifier for this tool call
- `args`: Arguments passed to the tool

---

## Type-Safe Generics

All L0 functions support generic type parameters to forward your output types through the entire call chain. This enables full type inference without manual casting.

### l0\<TOutput\>()

The core `l0()` function accepts a generic type parameter:

```typescript
import { l0 } from "@ai2070/l0";

interface UserProfile {
  name: string;
  age: number;
  email: string;
}

const result = await l0<UserProfile>({
  stream: () => streamText({ model, prompt }),
});

// result is L0Result<UserProfile>
// Generic enables type inference in structured output and callbacks
```

### parallel\<TOutput\>()

Run multiple operations with typed results:

```typescript
import { parallel } from "@ai2070/l0";

interface TaskResult {
  summary: string;
  score: number;
}

const results = await parallel<TaskResult>([
  { stream: () => streamText({ model, prompt: "Task 1" }) },
  { stream: () => streamText({ model, prompt: "Task 2" }) },
  { stream: () => streamText({ model, prompt: "Task 3" }) },
]);

// results is ParallelResult<TaskResult>
// results.results is Array<L0Result<TaskResult> | null>
for (const result of results.results) {
  if (result) {
    console.log(result.state.content); // typed access
  }
}
```

### parallelAll\<TOutput\>()

Unlimited concurrency variant:

```typescript
import { parallelAll } from "@ai2070/l0";

const results = await parallelAll<TaskResult>(operations);
// Same typing as parallel<TOutput>()
```

### sequential\<TOutput\>()

Sequential execution with typed results:

```typescript
import { sequential } from "@ai2070/l0";

const results = await sequential<TaskResult>(operations);
// Executes one at a time, same result type
```

### batched\<TOutput\>()

Batch processing with typed results:

```typescript
import { batched } from "@ai2070/l0";

const results = await batched<TaskResult>(operations, 3);
// Processes in batches of 3
```

### race\<TOutput\>()

First successful result wins:

```typescript
import { race } from "@ai2070/l0";

interface FastResponse {
  answer: string;
  confidence: number;
}

const result = await race<FastResponse>([
  { stream: () => streamText({ model: openai("gpt-4o"), prompt }) },
  { stream: () => streamText({ model: anthropic("claude-3-opus"), prompt }) },
  { stream: () => streamText({ model: google("gemini-pro"), prompt }) },
]);

// result is RaceResult<FastResponse>
// result.winnerIndex tells you which model won
console.log(`Model ${result.winnerIndex} won`);
```

### consensus\<TSchema\>()

Multi-model agreement with schema inference:

```typescript
import { consensus } from "@ai2070/l0";
import { z } from "zod";

const schema = z.object({
  answer: z.string(),
  confidence: z.number(),
});

const result = await consensus<typeof schema>({
  streams: [
    () => streamText({ model: openai("gpt-4o"), prompt }),
    () => streamText({ model: anthropic("claude-3-opus"), prompt }),
    () => streamText({ model: google("gemini-pro"), prompt }),
  ],
  schema,
  strategy: "majority",
  threshold: 0.6,
});

// result.consensus is z.infer<typeof schema>
console.log(result.consensus.answer);
console.log(result.confidence);
```

### pipe\<TInput, TOutput\>()

Pipelines with typed input and output:

```typescript
import { pipe } from "@ai2070/l0";

interface DocumentInput {
  text: string;
  language: string;
}

interface AnalysisOutput {
  sentiment: string;
  keywords: string[];
  summary: string;
}

const result = await pipe<DocumentInput, AnalysisOutput>({
  input: { text: "Long document...", language: "en" },
  stages: [
    {
      name: "extract",
      stream: (input) =>
        streamText({ model, prompt: `Extract from: ${input.text}` }),
    },
    {
      name: "analyze",
      stream: (prev) => streamText({ model, prompt: `Analyze: ${prev}` }),
    },
    {
      name: "summarize",
      stream: (prev) => streamText({ model, prompt: `Summarize: ${prev}` }),
    },
  ],
});
```

### Type Inference Table

| Function           | Generic           | Result Type               |
| ------------------ | ----------------- | ------------------------- |
| `l0<T>()`          | `TOutput`         | `L0Result<TOutput>`       |
| `parallel<T>()`    | `TOutput`         | `ParallelResult<TOutput>` |
| `parallelAll<T>()` | `TOutput`         | `ParallelResult<TOutput>` |
| `sequential<T>()`  | `TOutput`         | `ParallelResult<TOutput>` |
| `batched<T>()`     | `TOutput`         | `ParallelResult<TOutput>` |
| `race<T>()`        | `TOutput`         | `RaceResult<TOutput>`     |
| `consensus<T>()`   | `TSchema`         | `ConsensusResult<T>`      |
| `pipe<I, O>()`     | `TInput, TOutput` | `PipeResult<TOutput>`     |

### Best Practices

1. **Define interfaces for your outputs** - Create explicit interfaces for structured data:

```typescript
interface ChatResponse {
  message: string;
  tokens: number;
  model: string;
}

const result = await l0<ChatResponse>({ stream });
```

2. **Use Zod inference with structured()** - The `structured()` function already infers types from your schema:

```typescript
const schema = z.object({ name: z.string(), age: z.number() });
const result = await structured({ schema, stream });
// result.data is automatically typed as { name: string; age: number }
```

3. **Combine with const assertions** - For literal types:

```typescript
const result = await l0<{ status: "success" | "error"; code: number }>({
  stream,
});
```

---

## Structured Output

### structured(options)

Guaranteed valid JSON matching a Zod schema. Supports Effect Schema and JSON Schema via adapters.

```typescript
import { structured } from "@ai2070/l0";
import { z } from "zod";

const schema = z.object({
  name: z.string(),
  age: z.number(),
  tags: z.array(z.string())
});

const result = await structured({
  schema,
  stream: () => streamText({ model, prompt }),

  // Optional: Fallbacks
  fallbackStreams: [...],

  // Optional: Auto-correction (default: true)
  autoCorrect: true,

  // Optional: Strict mode - reject unknown fields (default: false)
  strictMode: false,

  // Optional: Validation retries (default: 2)
  retry: { attempts: 2 }
});

// Type-safe access
console.log(result.data.name);    // string
console.log(result.data.age);     // number
console.log(result.corrected);    // boolean - was auto-corrected
console.log(result.corrections);  // string[] - corrections made
console.log(result.raw);          // string - raw output
```

### structuredObject(shape, options)

Helper to create structured output with a simple object schema.

```typescript
import { structuredObject } from "@ai2070/l0";
import { z } from "zod";

const result = await structuredObject(
  {
    amount: z.number(),
    approved: z.boolean(),
  },
  {
    stream: () => streamText({ model, prompt }),
  },
);
```

### structuredArray(itemSchema, options)

Helper to create structured output with an array schema.

```typescript
import { structuredArray } from "@ai2070/l0";
import { z } from "zod";

const result = await structuredArray(z.object({ name: z.string() }), {
  stream: () => streamText({ model, prompt }),
});
```

### structuredStream(options)

Streaming structured output - yields tokens as they arrive, validates at end.

```typescript
import { structuredStream } from "@ai2070/l0";
import { z } from "zod";

const { stream, result, abort } = await structuredStream({
  schema: z.object({ name: z.string() }),
  stream: () => streamText({ model, prompt }),
});

// Stream tokens in real-time
for await (const event of stream) {
  if (event.type === "token") {
    console.log(event.value);
  }
}

// Get validated result
const validated = await result;
console.log(validated.data);
```

### Structured Output Presets

```typescript
import {
  minimalStructured, // { autoCorrect: false, retry: { attempts: 1 } }
  recommendedStructured, // { autoCorrect: true, retry: { attempts: 2 } }
  strictStructured, // { autoCorrect: true, strictMode: true, retry: { attempts: 3 } }
} from "@ai2070/l0";

const result = await structured({
  schema,
  stream,
  ...recommendedStructured,
});
```

### Effect Schema Support

```typescript
import { registerEffectSchemaAdapter, wrapEffectSchema } from "@ai2070/l0";
import * as S from "@effect/schema/Schema";

// Register the adapter once
registerEffectSchemaAdapter({
  isSchema: (s) => S.isSchema(s),
  decode: (schema, data) => S.decodeUnknownSync(schema)(data),
  // ...
});

// Wrap Effect Schema for use with structured()
const schema = wrapEffectSchema(
  S.Struct({
    name: S.String,
    age: S.Number,
  }),
);

const result = await structured({ schema, stream });
```

### JSON Schema Support

```typescript
import {
  registerJSONSchemaAdapter,
  wrapJSONSchema,
  createSimpleJSONSchemaAdapter,
} from "@ai2070/l0";

// Register with your preferred validator (e.g., Ajv)
registerJSONSchemaAdapter(createSimpleJSONSchemaAdapter(ajvValidate));

// Wrap JSON Schema for use with structured()
const schema = wrapJSONSchema({
  type: "object",
  properties: {
    name: { type: "string" },
    age: { type: "number" },
  },
  required: ["name", "age"],
});

const result = await structured({ schema, stream });
```

---

## Document Windows

### createWindow(document, options)

Create a window for processing long documents.

```typescript
import { createWindow } from "@ai2070/l0";

const window = createWindow(longDocument, {
  size: 2000, // Tokens per chunk
  overlap: 200, // Overlap between chunks
  strategy: "paragraph", // "token" | "char" | "paragraph" | "sentence"
});

// Navigation
const current = window.current(); // Current chunk
const next = window.next(); // Move to next
const prev = window.prev(); // Move to previous
window.jump(5); // Jump to chunk 5

// Process all chunks
const results = await window.processAll(
  (chunk) => ({
    stream: () => streamText({ model, prompt: chunk.content }),
  }),
  { concurrency: 3 }, // Parallel processing
);

// Stats
console.log(window.stats());
// { totalChunks, currentIndex, processedCount, ... }
```

---

## Consensus

### consensus(options)

Multi-generation consensus for high-confidence results.

```typescript
import { consensus } from "@ai2070/l0";

const result = await consensus({
  streams: [
    () => streamText({ model, prompt }),
    () => streamText({ model, prompt }),
    () => streamText({ model, prompt }),
  ],

  // Optional: Schema for structured consensus
  schema: z.object({ answer: z.string() }),

  // Optional: Strategy, default as follows
  strategy: "majority", // "majority" | "unanimous" | "weighted" | "best"
  threshold: 0.8,

  // Optional: Conflict resolution, default as follows
  resolveConflicts: "vote", // "vote" | "merge" | "best" | "fail"

  // Optional: Weights (for "weighted" strategy), default: equal-weighted
  weights: [1.0, 0.8, 0.6],
});

console.log(result.consensus); // Agreed output
console.log(result.confidence); // 0-1 confidence score
console.log(result.agreements); // Agreement details
console.log(result.disagreements); // Disagreement details
```

### quickConsensus(outputs, threshold?)

Quick check if outputs agree.

```typescript
import { quickConsensus } from "@ai2070/l0";

const hasConsensus = quickConsensus(["A", "A", "B"], 0.6); // true
```

### getConsensusValue(outputs)

Get most common value from outputs.

```typescript
import { getConsensusValue } from "@ai2070/l0";

const value = getConsensusValue(["A", "A", "B"]); // "A"
```

---

## Guardrails

### Built-in Rules

```typescript
import {
  jsonRule, // JSON structure validation
  strictJsonRule, // Strict JSON (complete only)
  markdownRule, // Markdown validation
  latexRule, // LaTeX environment validation
  zeroOutputRule, // Zero/empty output detection
  patternRule, // Known bad patterns
  customPatternRule, // Custom regex patterns
} from "@ai2070/l0";
```

### Presets

```typescript
import {
  minimalGuardrails, // jsonRule, zeroOutputRule
  recommendedGuardrails, // jsonRule, markdownRule, zeroOutputRule, patternRule
  strictGuardrails, // jsonRule, markdownRule, latexRule, patternRule, zeroOutputRule
  jsonOnlyGuardrails, // jsonRule, zeroOutputRule
  markdownOnlyGuardrails, // markdownRule, zeroOutputRule
  latexOnlyGuardrails, // latexRule, zeroOutputRule
} from "@ai2070/l0";
```

| Preset                   | Rules Included                                                           |
| ------------------------ | ------------------------------------------------------------------------ |
| `minimalGuardrails`      | `jsonRule`, `zeroOutputRule`                                             |
| `recommendedGuardrails`  | `jsonRule`, `markdownRule`, `zeroOutputRule`, `patternRule`              |
| `strictGuardrails`       | `jsonRule`, `markdownRule`, `latexRule`, `patternRule`, `zeroOutputRule` |
| `jsonOnlyGuardrails`     | `jsonRule`, `zeroOutputRule`                                             |
| `markdownOnlyGuardrails` | `markdownRule`, `zeroOutputRule`                                         |
| `latexOnlyGuardrails`    | `latexRule`, `zeroOutputRule`                                            |

### Custom Guardrails

```typescript
const customRule: GuardrailRule = {
  name: "min-length",
  streaming: false, // Only check complete output
  severity: "error",
  recoverable: true,
  check: (context) => {
    if (context.completed && context.content.length < 100) {
      return [
        {
          rule: "min-length",
          message: "Output too short",
          severity: "error",
          recoverable: true,
        },
      ];
    }
    return [];
  },
};
```

### GuardrailEngine

```typescript
import { GuardrailEngine } from "@ai2070/l0";

const engine = new GuardrailEngine({
  rules: [jsonRule(), markdownRule()],
  stopOnFatal: true,
  enableStreaming: true,
});

const result = engine.check({
  content: "...",
  completed: true,
  tokenCount: 100,
});
```

---

## Retry Configuration

### Presets

```typescript
import {
  minimalRetry, // { attempts: 2, maxRetries: 4, backoff: "linear" }
  recommendedRetry, // { attempts: 3, maxRetries: 6, backoff: "fixed-jitter" }
  strictRetry, // { attempts: 3, maxRetries: 6, backoff: "full-jitter" }
  exponentialRetry, // { attempts: 4, maxRetries: 8, backoff: "exponential" }
} from "@ai2070/l0";
```

| Preset             | attempts | maxRetries | backoff        | baseDelay | maxDelay |
| ------------------ | -------- | ---------- | -------------- | --------- | -------- |
| `minimalRetry`     | 2        | 4          | `linear`       | 1000ms    | 10000ms  |
| `recommendedRetry` | 3        | 6          | `fixed-jitter` | 1000ms    | 10000ms  |
| `strictRetry`      | 3        | 6          | `full-jitter`  | 1000ms    | 10000ms  |
| `exponentialRetry` | 4        | 8          | `exponential`  | 1000ms    | 10000ms  |

### Centralized Defaults

```typescript
import { RETRY_DEFAULTS, ERROR_TYPE_DELAY_DEFAULTS } from "@ai2070/l0";

// RETRY_DEFAULTS
// { attempts: 3, maxRetries: 6, baseDelay: 1000, maxDelay: 10000, backoff: "fixed-jitter", ... }

// ERROR_TYPE_DELAY_DEFAULTS
// { connectionDropped: 1000, fetchError: 500, timeout: 1000, ... }
```

### Custom Configuration

```typescript
const result = await l0({
  stream,
  // Optional: default as follows
  retry: {
    attempts: 3, // LLM errors only
    maxRetries: 6, // Absolute cap (LLM + network)
    baseDelay: 1000,
    maxDelay: 10000,
    backoff: "fixed-jitter", // "exponential" | "linear" | "fixed" | "full-jitter" | "fixed-jitter"

    // Optional: specify which error types to retry on, defaults to all recoverable errors
    retryOn: [
      "zero_output",
      "guardrail_violation",
      "drift",
      "incomplete",
      "network_error",
      "timeout",
      "rate_limit",
      "server_error",
    ],

    maxErrorHistory: 100, // Default: Infinite
    errorTypeDelays: {
      connectionDropped: 2000,
      timeout: 1500,
      dnsError: 5000,
    },
  },
});
```

### Custom Retry Logic

Override default retry behavior with custom functions:

#### shouldRetry (Async Veto Callback)

The `shouldRetry` callback provides async control over retry decisions. It can only **veto** retries, never force them.

```typescript
const result = await l0({
  stream,
  retry: {
    attempts: 3,
    shouldRetry: async (error, state, attempt, category) => {
      // Veto retry if we already have substantial content
      if (state.tokenCount > 100) return false;

      // Veto retry for context length errors
      if (error.message.includes("context_length_exceeded")) return false;

      // Check external service before retrying
      const canRetry = await checkRateLimitService();
      if (!canRetry) return false;

      // Return true to allow default retry behavior
      return true;
    },
  },
});
```

#### Key Behavior

The final retry decision follows this formula:

```
shouldRetry = defaultDecision && shouldRetry(...)
```

**What this means:**

| Default Decision | shouldRetry Returns | Final Result | Explanation             |
| ---------------- | ------------------- | ------------ | ----------------------- |
| `true`           | `true`              | **Retry**    | Both agree to retry     |
| `true`           | `false`             | **No retry** | User vetoed the retry   |
| `false`          | `true`              | **No retry** | User cannot force retry |
| `false`          | `false`             | **No retry** | Both agree not to retry |

#### Permitted vs Forbidden

**✓ Permitted:**

- User can veto any retry by returning `false`
- User can set high `attempts` limit for many retries
- User function can return `true` forever (preserves default behavior)

**✗ Forbidden (user cannot force retry when):**

- Fatal errors (401, 403) - always skipped
- `attempts` limit exhausted for model errors
- `maxRetries` absolute cap reached
- Exception thrown in `shouldRetry` (treated as veto)

#### shouldRetry Parameters

| Parameter  | Type            | Description                                    |
| ---------- | --------------- | ---------------------------------------------- |
| `error`    | `Error`         | The error that occurred                        |
| `state`    | `L0State`       | Current state (content, tokenCount, etc.)      |
| `attempt`  | `number`        | Current attempt (0-based)                      |
| `category` | `ErrorCategory` | Error category (network/transient/model/fatal) |

#### Error Categories

| Category    | Default Behavior             | Counts Toward `attempts` |
| ----------- | ---------------------------- | ------------------------ |
| `network`   | Retry forever with backoff   | No                       |
| `transient` | Retry forever (429, 5xx)     | No                       |
| `model`     | Retry up to `attempts` limit | Yes                      |
| `content`   | Retry up to `attempts` limit | Yes                      |
| `fatal`     | Never retry (401, 403)       | N/A                      |

#### Events Emitted

| Event             | When                       | Key Fields                                     |
| ----------------- | -------------------------- | ---------------------------------------------- |
| `RETRY_FN_START`  | Before calling shouldRetry | `attempt`, `category`, `defaultShouldRetry`    |
| `RETRY_FN_RESULT` | After callback returns     | `userResult`, `finalShouldRetry`, `durationMs` |
| `RETRY_FN_ERROR`  | If callback throws         | `error`, `finalShouldRetry` (always false)     |

#### Example: Conditional Veto Based on Content

```typescript
const result = await l0({
  stream,
  retry: {
    attempts: 5,
    shouldRetry: async (error, state, attempt, category) => {
      // Don't retry if we have usable partial content
      if (state.tokenCount > 50 && state.content.includes("conclusion")) {
        console.log("Keeping partial content, skipping retry");
        return false;
      }

      // Log retry decision for debugging
      console.log(`Retry decision: attempt=${attempt}, category=${category}`);

      // Allow default behavior
      return true;
    },
  },
});
```

#### calculateDelay

Custom delay calculation function to override default backoff behavior:

```typescript
const result = await l0({
  stream,
  retry: {
    attempts: 3,
    baseDelay: 1000,
    calculateDelay: (context) => {
      // context: { attempt, totalAttempts, category, reason, error, defaultDelay }

      // Different delays based on error category
      if (context.category === "network") return 500;
      if (context.reason === "rate_limit") return 5000;

      // Custom exponential backoff with full jitter
      const base = 1000;
      const cap = 30000;
      const temp = Math.min(cap, base * Math.pow(2, context.attempt));
      return Math.random() * temp;
    },
  },
});
```

| Property        | Type   | Description                          |
| --------------- | ------ | ------------------------------------ |
| `attempt`       | number | Current retry attempt (0-based)      |
| `totalAttempts` | number | Total attempts including network     |
| `category`      | string | Error category (network/model/fatal) |
| `reason`        | string | Error reason code                    |
| `error`         | Error  | The error that occurred              |
| `defaultDelay`  | number | Default delay that would be used     |

### Error Type Delays

Custom delays for specific network error types. Overrides `baseDelay` for fine-grained control.

```typescript
errorTypeDelays: {
  // Connection errors, default as follows
  connectionDropped: 2000,  // Connection dropped mid-stream
  econnreset: 1500,         // Connection reset by peer
  econnrefused: 3000,       // Connection refused

  // Fetch/network errors
  fetchError: 500,          // Generic fetch failure
  dnsError: 5000,           // DNS resolution failed
  timeout: 1500,            // Request timeout

  // Streaming errors
  sseAborted: 1000,         // Server-sent events aborted
  noBytes: 500,             // No bytes received
  partialChunks: 1000,      // Incomplete chunks received

  // Runtime errors
  runtimeKilled: 5000,      // Runtime process killed
  backgroundThrottle: 2000, // Background tab throttling

  // Fallback
  unknown: 1000,            // Unknown error type
}
```

### RetryManager

```typescript
import { RetryManager } from "@ai2070/l0";

const manager = new RetryManager({
  attempts: 3,
  backoff: "fixed-jitter",
});

const result = await manager.execute(async () => {
  return await riskyOperation();
});
```

---

## Smart Continuation Deduplication

When using `continueFromLastKnownGoodToken`, LLMs often repeat words from the end of the checkpoint at the beginning of their continuation. L0 automatically detects and removes this overlap.

### How It Works

```typescript
// Checkpoint: "Hello world"
// LLM continues with: "world is great"
// Without deduplication: "Hello worldworld is great"
// With deduplication: "Hello world is great" ✓
```

Deduplication is **enabled by default** when `continueFromLastKnownGoodToken: true`. The deduplication window is bounded (maxOverlap) to guarantee stable O(n) streaming performance. The algorithm:

1. Buffers incoming continuation tokens until overlap can be detected
2. Finds the longest suffix of the checkpoint that matches a prefix of the continuation
3. Removes the overlapping portion from the continuation
4. Emits only the non-overlapping content

### Configuration

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  continueFromLastKnownGoodToken: true,

  // Deduplication enabled by default, explicitly disable:
  deduplicateContinuation: false,

  // Or configure options:
  deduplicationOptions: {
    minOverlap: 2, // Minimum chars to consider overlap (default: 2)
    maxOverlap: 500, // Maximum chars to check (default: 500)
    caseSensitive: true, // Case-sensitive matching (default: true)
    normalizeWhitespace: false, // Normalize whitespace for matching (default: false)
  },
});
```

### Options

| Option                | Type    | Default | Description                                                                   |
| --------------------- | ------- | ------- | ----------------------------------------------------------------------------- |
| `minOverlap`          | number  | 2       | Minimum overlap length to detect (avoids false positives)                     |
| `maxOverlap`          | number  | 500     | Maximum overlap length to check (performance limit)                           |
| `caseSensitive`       | boolean | true    | Whether matching is case-sensitive                                            |
| `normalizeWhitespace` | boolean | false   | Normalize whitespace when matching (`"hello  world"` matches `"hello world"`) |

### Examples

**Case-insensitive matching:**

```typescript
// Checkpoint: "Hello World"
// Continuation: "world is great"
// With caseSensitive: false → "Hello World is great"

const result = await l0({
  stream: () => streamText({ model, prompt }),
  continueFromLastKnownGoodToken: true,
  deduplicationOptions: { caseSensitive: false },
});
```

**Multi-word overlap:**

```typescript
// Checkpoint: "The quick brown fox"
// Continuation: "brown fox jumps over"
// Result: "The quick brown fox jumps over"
```

**Code continuation:**

```typescript
// Checkpoint: 'function hello() {\n  console.log("Hello'
// Continuation: 'console.log("Hello, World!");\n}'
// Result: 'function hello() {\n  console.log("Hello, World!");\n}'
```

### Utility Functions

The overlap detection is also available as standalone utilities:

```typescript
import { detectOverlap, deduplicateContinuation } from "@ai2070/l0";

// Full result with metadata
const result = detectOverlap("Hello world", "world is great");
// {
//   hasOverlap: true,
//   overlapLength: 5,
//   overlapText: "world",
//   deduplicatedContinuation: " is great"
// }

// Convenience wrapper - just the deduplicated string
const text = deduplicateContinuation("Hello world", "world is great");
// " is great"

// With options
const result2 = detectOverlap("Hello World", "world test", {
  caseSensitive: false,
  minOverlap: 3,
});
```

---

## Error Handling

### L0Error

```typescript
import { isL0Error, L0Error } from "@ai2070/l0";

try {
  await l0({ stream, guardrails });
} catch (error) {
  if (isL0Error(error)) {
    console.log(error.code); // L0ErrorCode
    console.log(error.context.tokenCount);
    console.log(error.hasCheckpoint); // Has checkpoint for continuation?
    console.log(error.getCheckpoint()); // Last good content
    console.log(error.toDetailedString());
  }
}
```

### Error Codes

| Code                        | Description            |
| --------------------------- | ---------------------- |
| `STREAM_ABORTED`            | Stream aborted         |
| `INITIAL_TOKEN_TIMEOUT`     | First token timeout    |
| `INTER_TOKEN_TIMEOUT`       | Token gap timeout      |
| `ZERO_OUTPUT`               | No meaningful output   |
| `GUARDRAIL_VIOLATION`       | Guardrail failed       |
| `FATAL_GUARDRAIL_VIOLATION` | Fatal guardrail        |
| `INVALID_STREAM`            | Invalid stream factory |
| `ALL_STREAMS_EXHAUSTED`     | All fallbacks failed   |
| `NETWORK_ERROR`             | Network failure        |
| `DRIFT_DETECTED`            | Output drift           |

### Network Errors

```typescript
import {
  isNetworkError,
  analyzeNetworkError,
  NetworkErrorType,
} from "@ai2070/l0";

if (isNetworkError(error)) {
  const analysis = analyzeNetworkError(error);
  console.log(analysis.type); // NetworkErrorType
  console.log(analysis.retryable); // boolean
  console.log(analysis.suggestion); // string
}
```

### Error Categories

```typescript
import { ErrorCategory, getErrorCategory } from "@ai2070/l0";

const category = getErrorCategory(error);
// ErrorCategory.NETWORK   - Transient, retry without limit
// ErrorCategory.TIMEOUT   - Transient, retry with backoff
// ErrorCategory.PROVIDER  - API/model error, may retry
// ErrorCategory.CONTENT   - Guardrails/drift, may retry
// ErrorCategory.INTERNAL  - Bug, don't retry
```

---

## State Machine

L0 includes a lightweight state machine for tracking runtime state. Useful for debugging and monitoring.

### RuntimeState

```typescript
import { StateMachine, RuntimeStates, type RuntimeState } from "@ai2070/l0";

// Use RuntimeStates constants instead of string literals
const {
  INIT,
  WAITING_FOR_TOKEN,
  STREAMING,
  CONTINUATION_MATCHING,
  CHECKPOINT_VERIFYING,
  RETRYING,
  FALLBACK,
  FINALIZING,
  COMPLETE,
  ERROR,
} = RuntimeStates;

type RuntimeState =
  | "init" // Initial setup
  | "waiting_for_token" // Waiting for first chunk
  | "streaming" // Receiving tokens
  | "continuation_matching" // Buffering for overlap detection
  | "checkpoint_verifying" // Validating checkpoint before continuation
  | "retrying" // About to retry same stream
  | "fallback" // Switching to fallback stream
  | "finalizing" // Finalizing (final guardrails, etc.)
  | "complete" // Success
  | "error"; // Failed
```

### StateMachine

```typescript
import { RuntimeStates } from "@ai2070/l0";

const sm = new StateMachine();

// Transition to a new state (use constants)
sm.transition(RuntimeStates.STREAMING);

// Get current state
sm.get(); // "streaming"

// Check if in one of multiple states
sm.is(RuntimeStates.STREAMING, RuntimeStates.CONTINUATION_MATCHING); // true

// Check if terminal
sm.isTerminal(); // false (true for "complete" or "error")

// Subscribe to state changes
const unsubscribe = sm.subscribe((state) => {
  console.log(`State changed to: ${state}`);
});

// Get history for debugging
sm.getHistory();
// [{ from: "init", to: "awaiting_first_token", timestamp: 1234567890 }, ...]

// Reset to initial state
sm.reset();
```

---

## Metrics

Simple counters for runtime metrics. OpenTelemetry is opt-in via separate adapter.

### Metrics Class

```typescript
import { Metrics } from "@ai2070/l0";

const metrics = new Metrics();

// Available counters
metrics.requests; // Total stream requests
metrics.tokens; // Total tokens processed
metrics.retries; // Total retry attempts
metrics.networkRetryCount; // Network retries (subset)
metrics.errors; // Total errors
metrics.violations; // Guardrail violations
metrics.driftDetections; // Drift detections
metrics.fallbacks; // Fallback activations
metrics.completions; // Successful completions
metrics.timeouts; // Timeouts (initial + inter-token)

// Get snapshot
const snapshot = metrics.snapshot();

// Reset all counters
metrics.reset();

// Serialize for logging
JSON.stringify(metrics); // Uses toJSON()
```

---

## Pipeline

Simple pipeline for event processing. Just an array of functions - no framework.

### Stage Function

```typescript
import { type Stage, type PipelineContext, runStages } from "@ai2070/l0";

// A stage receives an event and returns it (modified or not), or null to filter
type Stage = (event: L0Event, ctx: PipelineContext) => L0Event | null;

// Example: logging stage
const loggingStage: Stage = (event, ctx) => {
  console.log(`Event: ${event.type}`);
  return event; // Pass through
};

// Example: filtering stage
const filterEmptyTokens: Stage = (event, ctx) => {
  if (event.type === "token" && !event.value?.trim()) {
    return null; // Filter out
  }
  return event;
};
```

### Running Stages

```typescript
import { runStages, createPipelineContext } from "@ai2070/l0";

const stages: Stage[] = [loggingStage, filterEmptyTokens];

const ctx = createPipelineContext(state, stateMachine, monitor, signal);

// Run event through all stages
const result = runStages(stages, event, ctx);
// Returns final event, or null if filtered
```

### PipelineContext

```typescript
interface PipelineContext {
  state: L0State; // Runtime state
  stateMachine: StateMachine;
  monitor: L0Monitor;
  signal?: AbortSignal;
  scratch: Map<string, unknown>; // Scratch space for stages
}
```

---

## Async Checks

Non-blocking wrappers for guardrails and drift detection. Uses fast/slow path pattern.

### Async Guardrails

```typescript
import { runAsyncGuardrailCheck } from "@ai2070/l0";

// Fast path: returns immediately if check is quick
// Slow path: defers to setImmediate and calls onComplete
const result = runAsyncGuardrailCheck(
  guardrailEngine,
  context,
  (asyncResult) => {
    // Called if check was deferred
    handleGuardrailResult(asyncResult);
  },
);

if (result) {
  // Fast path succeeded, handle immediately
  handleGuardrailResult(result);
}
// If undefined, check is running async
```

### Async Drift Detection

```typescript
import { runAsyncDriftCheck } from "@ai2070/l0";

const result = runAsyncDriftCheck(
  driftDetector,
  content,
  delta,
  (asyncResult) => {
    // Called if check was deferred
    if (asyncResult.detected) {
      handleDrift(asyncResult.types);
    }
  },
);

if (result?.detected) {
  // Fast path found drift
  handleDrift(result.types);
}
```

### How It Works

1. **Fast path**: Delta-only check or small content - runs synchronously
2. **Slow path**: Large content (>10KB) - defers via `setImmediate()` to avoid blocking event loop

This prevents guardrails/drift from causing token delays that could trigger false timeouts.

---

## Formatting Helpers

### Context

```typescript
import { formatContext, formatDocument, formatInstructions } from "@ai2070/l0";

formatContext(content, { role: "user" });
formatDocument(content, { title: "Doc", author: "Me" });
formatInstructions("Generate JSON only");
```

### Memory

```typescript
import { formatMemory, createMemoryEntry } from "@ai2070/l0";

const memory = [
  createMemoryEntry("user", "Hello"),
  createMemoryEntry("assistant", "Hi!"),
];

formatMemory(memory, { maxEntries: 10 });
```

### Output

```typescript
import {
  formatJsonOutput,
  formatStructuredOutput,
  cleanOutput,
} from "@ai2070/l0";

formatJsonOutput({ strict: true });
formatStructuredOutput("json", { schema: "..." });
cleanOutput("Sure! Here's the JSON: {...}"); // "{...}"
```

### Tools

```typescript
import {
  formatTool,
  formatTools,
  createTool,
  createParameter,
} from "@ai2070/l0";

const tool = createTool("search", "Search the web", [
  createParameter("query", "string", "Search query", true),
]);

formatTool(tool);
formatTools([tool1, tool2]);
```

---

## Utility Functions

### Text Normalization

```typescript
import {
  normalizeNewlines,
  normalizeWhitespace,
  normalizeForModel,
  dedent,
  indent,
  trimText,
} from "@ai2070/l0";
```

### JSON Repair

```typescript
import {
  repairJson,
  isValidJson,
  parseOrRepairJson,
  extractJson,
  balanceBraces,
  balanceBrackets,
} from "@ai2070/l0";
```

### Token Utilities

```typescript
import {
  isMeaningfulToken,
  hasMeaningfulContent,
  countMeaningfulTokens,
  estimateTokenCount,
  detectRepeatedTokens,
  detectOverlap,
  deduplicateContinuation,
} from "@ai2070/l0";

// Detect overlap between checkpoint suffix and continuation prefix
const result = detectOverlap("Hello world", "world is great");
// result.hasOverlap === true
// result.overlapText === "world"
// result.deduplicatedContinuation === " is great"

// Convenience wrapper - returns just the deduplicated string
const deduplicated = deduplicateContinuation("Hello world", "world is great");
// deduplicated === " is great"
```

### Timer Utilities

```typescript
import {
  sleep,
  withTimeout,
  exponentialBackoff,
  linearBackoff,
  fullJitterBackoff,
  calculateBackoff,
} from "@ai2070/l0";
```

### Comparison

```typescript
import {
  deepEqual,
  compareStrings,
  levenshteinSimilarity,
  cosineSimilarity,
} from "@ai2070/l0";
```

---

## OpenAI SDK Adapter

L0 provides an adapter for using the OpenAI SDK directly instead of the Vercel AI SDK.

### wrapOpenAIStream(stream, options?)

Wrap an OpenAI SDK stream for use with L0.

```typescript
import OpenAI from "openai";
import { l0, wrapOpenAIStream } from "@ai2070/l0";

const openai = new OpenAI();

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
```

**Options:**

| Option                      | Type      | Default | Description                       |
| --------------------------- | --------- | ------- | --------------------------------- |
| `includeUsage`              | `boolean` | `true`  | Include usage info in done event  |
| `includeToolCalls`          | `boolean` | `true`  | Include tool calls as events      |
| `emitFunctionCallsAsTokens` | `boolean` | `false` | Emit function call args as tokens |

### openaiStream(client, params, options?)

Create a stream factory from OpenAI client and params.

```typescript
import OpenAI from "openai";
import { l0, openaiStream } from "@ai2070/l0";

const openai = new OpenAI();

const result = await l0({
  stream: openaiStream(openai, {
    model: "gpt-4o",
    messages: [{ role: "user", content: "Hello!" }],
  }),
});
```

### openaiText(client, model, prompt, options?)

Simple text generation helper.

```typescript
import OpenAI from "openai";
import { l0, openaiText } from "@ai2070/l0";

const openai = new OpenAI();

const result = await l0({
  stream: openaiText(openai, "gpt-4o", "Write a haiku about coding"),
});

// Or with messages array
const result2 = await l0({
  stream: openaiText(openai, "gpt-4o", [
    { role: "system", content: "You are a poet." },
    { role: "user", content: "Write a haiku." },
  ]),
});
```

### openaiJSON(client, model, prompt, options?)

JSON output with `response_format: { type: "json_object" }`.

```typescript
import OpenAI from "openai";
import { structured, openaiJSON } from "@ai2070/l0";
import { z } from "zod";

const openai = new OpenAI();

const result = await structured({
  schema: z.object({ name: z.string(), age: z.number() }),
  stream: openaiJSON(openai, "gpt-4o", "Generate user data as JSON"),
});
```

### openaiWithTools(client, model, messages, tools, options?)

Tool/function calling support.

```typescript
import OpenAI from "openai";
import { l0, openaiWithTools } from "@ai2070/l0";

const openai = new OpenAI();

const result = await l0({
  stream: openaiWithTools(
    openai,
    "gpt-4o",
    [{ role: "user", content: "What's the weather in Tokyo?" }],
    [
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get weather for a location",
          parameters: {
            type: "object",
            properties: { location: { type: "string" } },
            required: ["location"],
          },
        },
      },
    ],
  ),
});

// Tool calls appear as message events
for await (const event of result.stream) {
  if (event.type === "message") {
    const data = JSON.parse(event.value);
    if (data.type === "tool_calls") {
      console.log(data.tool_calls);
      // [{ id: "...", name: "get_weather", arguments: '{"location":"Tokyo"}' }]
    }
  }
}
```

### Utility Functions

```typescript
import { isOpenAIChunk, extractOpenAIText } from "@ai2070/l0";

// Type guard for OpenAI chunks
if (isOpenAIChunk(chunk)) {
  // chunk has choices[].delta structure
}

// Extract all text from a stream
const text = await extractOpenAIText(stream);
```

---

## Mastra Adapter

L0 provides an adapter for using Mastra agents directly. Requires `@mastra/core` v0.18+.

### wrapMastraStream(streamResult, options?)

Wrap a Mastra stream result for use with L0.

```typescript
import { Agent } from "@mastra/core/agent";
import { l0, wrapMastraStream } from "@ai2070/l0";

const agent = new Agent({
  name: "my-agent",
  instructions: "You are helpful",
  model: "openai/gpt-4o",
});

const result = await l0({
  stream: async () => {
    const stream = await agent.stream("Hello!");
    return wrapMastraStream(stream);
  },
});
```

**Options:**

| Option             | Type      | Default | Description                      |
| ------------------ | --------- | ------- | -------------------------------- |
| `includeUsage`     | `boolean` | `true`  | Include usage info in done event |
| `includeToolCalls` | `boolean` | `true`  | Include tool calls as events     |
| `includeReasoning` | `boolean` | `false` | Include reasoning content        |

### mastraStream(agent, messages, streamOptions?, adapterOptions?)

Create a stream factory from a Mastra agent.

```typescript
import { Agent } from "@mastra/core/agent";
import { l0, mastraStream } from "@ai2070/l0";

const agent = new Agent({
  name: "my-agent",
  instructions: "You are helpful",
  model: "openai/gpt-4o",
});

const result = await l0({
  stream: mastraStream(agent, "Hello!"),
});

// With messages array
const result2 = await l0({
  stream: mastraStream(agent, [
    { role: "system", content: "You are a poet." },
    { role: "user", content: "Write a haiku." },
  ]),
});
```

### mastraText(agent, prompt, options?)

Simple text generation helper.

```typescript
import { Agent } from "@mastra/core/agent";
import { l0, mastraText } from "@ai2070/l0";

const agent = new Agent({
  name: "writer",
  instructions: "...",
  model: "openai/gpt-4o",
});

const result = await l0({
  stream: mastraText(agent, "Write a haiku about coding"),
});
```

### mastraStructured(agent, prompt, schema, options?)

Structured output with schema validation.

```typescript
import { Agent } from "@mastra/core/agent";
import { structured, mastraStructured } from "@ai2070/l0";
import { z } from "zod";

const agent = new Agent({
  name: "extractor",
  instructions: "...",
  model: "openai/gpt-4o",
});

const schema = z.object({ name: z.string(), age: z.number() });

const result = await structured({
  schema,
  stream: mastraStructured(agent, "Generate user data", schema),
});
```

### wrapMastraFullStream(streamResult, options?)

Wrap Mastra's fullStream for complete control over all chunk types.

```typescript
import { Agent } from "@mastra/core/agent";
import { l0, wrapMastraFullStream } from "@ai2070/l0";

const agent = new Agent({ ... });

const result = await l0({
  stream: async () => {
    const stream = await agent.stream("Hello!");
    return wrapMastraFullStream(stream);
  }
});

// Handles all chunk types: text-delta, tool-call, tool-result, reasoning, finish
```

### Utility Functions

```typescript
import {
  isMastraStream,
  extractMastraText,
  extractMastraObject,
} from "@ai2070/l0";

// Type guard for Mastra streams
if (isMastraStream(stream)) {
  // stream is MastraModelOutput
}

// Extract text from stream result
const text = await extractMastraText(stream);

// Extract structured output
const obj = await extractMastraObject<UserData>(stream);
```

---

## Types

### L0Options

Configuration for the main `l0()` wrapper function.

```typescript
interface L0Options {
  // Required: Stream factory function
  stream: () => Promise<StreamTextResult> | StreamTextResult;

  // Optional fallback streams (tried in order if primary fails)
  fallbackStreams?: Array<() => Promise<StreamTextResult> | StreamTextResult>;

  // User context attached to all observability events (immutable for session)
  context?: Record<string, unknown>;

  // Guardrail rules to apply during streaming
  guardrails?: GuardrailRule[];

  // Retry configuration
  retry?: RetryOptions;

  // Timeout configuration (in milliseconds), default as follows
  timeout?: {
    initialToken?: number; // Max wait for first token (default: 5000)
    interToken?: number; // Max wait between tokens (default: 10000)
  };

  // Check intervals (in tokens)
  checkIntervals?: {
    guardrails?: number; // Run guardrails every N tokens (default: 15)
    drift?: number; // Run drift detection every N tokens (default: 25)
    checkpoint?: number; // Save checkpoint every N tokens (default: 20)
  };

  // Abort signal for cancellation
  signal?: AbortSignal;

  // Built-in monitoring configuration
  monitoring?: {
    enabled?: boolean; // Enable telemetry collection (default: false)
    sampleRate?: number; // Sample rate 0-1 (default: 1.0)
    includeNetworkDetails?: boolean; // Include detailed network error info
    includeTimings?: boolean; // Include timing metrics
    metadata?: Record<string, any>; // Custom metadata to attach
  };

  // Enable drift detection (default: false)
  detectDrift?: boolean;

  // Enable zero-token detection (default: true)
  detectZeroTokens?: boolean;

  // Continue from checkpoint on retry/fallback (default: false)
  // WARNING: Do not use with structured output/streamObject
  continueFromLastKnownGoodToken?: boolean;

  // Custom function to build continuation prompt (used with continueFromLastKnownGoodToken)
  buildContinuationPrompt?: (checkpoint: string) => string;

  // Enable automatic overlap deduplication when continuing (default: true when continuation enabled)
  // LLMs often repeat words from checkpoint end; this removes the overlap automatically
  deduplicateContinuation?: boolean;

  // Options for continuation deduplication
  deduplicationOptions?: {
    minOverlap?: number; // Minimum overlap chars to detect (default: 2)
    maxOverlap?: number; // Maximum overlap chars to check (default: 500)
    caseSensitive?: boolean; // Case-sensitive matching (default: true)
    normalizeWhitespace?: boolean; // Normalize whitespace for matching (default: false)
  };

  // Interceptors for preprocessing/postprocessing
  interceptors?: L0Interceptor[];

  // Custom adapter for wrapping the stream (for SDKs not natively supported)
  adapter?: L0Adapter | string;

  // Options to pass to the adapter's wrap() function
  adapterOptions?: unknown;

  // Event callbacks
  onEvent?: (event: L0Event) => void;
  onViolation?: (violation: GuardrailViolation) => void;
  onRetry?: (attempt: number, reason: string) => void;
}
```

### L0Result

Result returned from `l0()` execution.

```typescript
interface L0Result {
  // Async iterator for streaming events
  stream: AsyncIterable<L0Event>;

  // Full accumulated text (available after stream completes)
  text?: string;

  // State and metadata from the execution
  state: L0State;

  // Any errors that occurred
  errors: Error[];

  // Telemetry data (if monitoring enabled)
  telemetry?: L0Telemetry;

  // Abort controller for canceling the stream
  abort: () => void;
}
```

### L0State

Internal state tracking for L0 runtime.

```typescript
interface L0State {
  // Current accumulated output
  content: string;

  // Last known good checkpoint
  checkpoint: string;

  // Total tokens received
  tokenCount: number;

  // Model retry count (counts toward retry limit)
  modelRetryCount: number;

  // Network retry count (doesn't count toward limit)
  networkRetryCount: number;

  // Index of current fallback stream (0 = primary, 1+ = fallback)
  fallbackIndex: number;

  // Guardrail violations encountered
  violations: GuardrailViolation[];

  // Whether drift was detected
  driftDetected: boolean;

  // Whether stream completed successfully
  completed: boolean;

  // Timestamp of first token
  firstTokenAt?: number;

  // Timestamp of last token
  lastTokenAt?: number;

  // Total duration in milliseconds
  duration?: number;

  // Network errors encountered (categorized)
  networkErrors: CategorizedNetworkError[];

  // Whether continuation from checkpoint was used (resumed from prior content)
  resumed: boolean;

  // The checkpoint content used for continuation (if any)
  resumePoint?: string;

  // Character offset where resume occurred (for debugging)
  resumeFrom?: number;

  // Multimodal data outputs collected during streaming
  dataOutputs: L0DataPayload[];

  // Last progress update received (for long-running operations)
  lastProgress?: L0Progress;
}
```

### L0Event

Unified event format that L0 normalizes all streaming events into.

```typescript
interface L0Event {
  // Event type
  type: "token" | "message" | "data" | "progress" | "error" | "complete";

  // Text value (for token/message events)
  value?: string;

  // Role (for message events)
  role?: string;

  // Multimodal data payload (for data events)
  data?: L0DataPayload;

  // Progress information (for progress events)
  progress?: L0Progress;

  // Error (for error events)
  error?: Error;

  // Error category/reason (for error events)
  reason?: ErrorCategory;

  // Event timestamp
  timestamp?: number;

  // Usage information (typically on complete event)
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cost?: number; // Cost in USD (if available)
    [key: string]: unknown;
  };
}
```

### L0DataPayload

Multimodal data payload for non-text content.

```typescript
interface L0DataPayload {
  // Content type: "text" | "image" | "audio" | "video" | "file" | "json" | "binary"
  contentType: L0ContentType;

  // MIME type (e.g., "image/png", "audio/mp3")
  mimeType?: string;

  // Data as base64 string (for binary content)
  base64?: string;

  // Data as URL (for remote content)
  url?: string;

  // Data as raw bytes (for binary content in Node.js)
  bytes?: Uint8Array;

  // Structured data (for JSON content type)
  json?: unknown;

  // Optional metadata about the content
  metadata?: {
    width?: number; // For images/video
    height?: number; // For images/video
    duration?: number; // For audio/video (seconds)
    size?: number; // File size in bytes
    filename?: string; // Original filename
    seed?: number; // Generation seed
    model?: string; // Model used for generation
    [key: string]: unknown;
  };
}
```

### L0Progress

Progress information for long-running operations.

```typescript
interface L0Progress {
  percent?: number; // Progress percentage (0-100)
  step?: number; // Current step number
  totalSteps?: number; // Total steps
  message?: string; // Status message
  eta?: number; // Estimated time remaining in ms
}
```

### Observability Event Types

L0 observability events (via `onEvent`) include structured metadata for error handling and recovery decisions.

#### FailureType

Classifies what went wrong when an error occurs.

| Value         | Description                                                 |
| ------------- | ----------------------------------------------------------- |
| `network`     | Connection drops, DNS errors, SSL failures, fetch errors    |
| `model`       | Model refused, content filter triggered, malformed response |
| `tool`        | Tool execution failed                                       |
| `timeout`     | Initial token or inter-token timeout exceeded               |
| `abort`       | User-initiated or signal-triggered abort                    |
| `zero_output` | Empty response from model                                   |
| `unknown`     | Unclassified error                                          |

#### RecoveryStrategy

What L0 decided to do after a failure.

| Value      | Description                             |
| ---------- | --------------------------------------- |
| `retry`    | Will retry the same stream              |
| `fallback` | Will try the next fallback stream       |
| `continue` | Will continue despite error (non-fatal) |
| `halt`     | Will stop, no recovery possible         |

#### RecoveryPolicy

Policy configuration that determined the recovery strategy.

```typescript
interface RecoveryPolicy {
  retryEnabled: boolean; // Whether retry is enabled in config
  fallbackEnabled: boolean; // Whether fallback streams are configured
  maxRetries: number; // Maximum retry attempts configured
  maxFallbacks: number; // Maximum fallback streams configured
  attempt: number; // Current retry attempt (1-based)
  fallbackIndex: number; // Current fallback index (0-based)
  retriesRemaining: number; // Retries left before fallback/halt
  fallbacksRemaining: number; // Fallbacks left before halt
}
```

#### Error Code Mapping

Complete mapping of L0 error codes to failure types, categories, and retry behavior.

| Error Code                  | FailureType   | Category    | Counts Toward Limit | Description                              |
| --------------------------- | ------------- | ----------- | ------------------- | ---------------------------------------- |
| `NETWORK_ERROR`             | `network`     | `network`   | No                  | Connection drops, DNS, SSL, fetch errors |
| `INITIAL_TOKEN_TIMEOUT`     | `timeout`     | `transient` | No                  | No first token within timeout            |
| `INTER_TOKEN_TIMEOUT`       | `timeout`     | `transient` | No                  | Gap between tokens exceeded threshold    |
| `ZERO_OUTPUT`               | `zero_output` | `content`   | Yes                 | Model returned empty response            |
| `GUARDRAIL_VIOLATION`       | `model`       | `content`   | Yes                 | Recoverable guardrail rule violated      |
| `FATAL_GUARDRAIL_VIOLATION` | `model`       | `content`   | Yes                 | Fatal guardrail, no retry                |
| `DRIFT_DETECTED`            | `model`       | `content`   | Yes                 | Output drifted from expected pattern     |
| `STREAM_ABORTED`            | `abort`       | `provider`  | N/A                 | User or signal aborted stream            |
| `ALL_STREAMS_EXHAUSTED`     | `unknown`     | `provider`  | N/A                 | All retries and fallbacks failed         |
| `INVALID_STREAM`            | `unknown`     | `internal`  | N/A                 | Stream factory returned invalid object   |
| `ADAPTER_NOT_FOUND`         | `unknown`     | `internal`  | N/A                 | No adapter found for stream type         |
| `FEATURE_NOT_ENABLED`       | `unknown`     | `internal`  | N/A                 | Feature requires explicit enablement     |

**Category Behavior:**

- `network` / `transient`: Retry indefinitely with backoff, doesn't count toward retry limit
- `content` / `model`: Counts toward retry limit, may trigger fallback
- `provider` / `internal`: Usually fatal, no automatic retry

#### Example: Using Observability Events

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  onEvent: (event) => {
    if (event.type === "ERROR") {
      console.log(`Failure: ${event.failureType}`); // "network" | "timeout" | ...
      console.log(`Recovery: ${event.recoveryStrategy}`); // "retry" | "fallback" | ...
      console.log(`Policy:`, event.policy); // { retryEnabled, attempt, ... }
    }
  },
});
```

### L0Telemetry

Telemetry data collected during L0 execution.

```typescript
interface L0Telemetry {
  sessionId: string;
  startTime: number;
  endTime?: number;
  duration?: number;

  metrics: {
    timeToFirstToken?: number;
    avgInterTokenTime?: number;
    tokensPerSecond?: number;
    totalTokens: number;
    totalRetries: number;
    networkRetryCount: number;
    modelRetryCount: number;
  };

  network: {
    errorCount: number;
    errorsByType: Record<string, number>;
    errors?: Array<{
      type: string;
      message: string;
      timestamp: number;
      retried: boolean;
      delay?: number;
    }>;
  };

  guardrails?: {
    violationCount: number;
    violationsByRule: Record<string, number>;
    violationsByRuleAndSeverity: Record<
      string,
      {
        warning: number;
        error: number;
        fatal: number;
      }
    >;
    violationsBySeverity: {
      warning: number;
      error: number;
      fatal: number;
    };
  };

  drift?: {
    detected: boolean;
    types: string[];
  };

  continuation?: {
    enabled: boolean;
    used: boolean;
    checkpointContent?: string;
    checkpointLength?: number;
    continuationCount?: number;
  };

  metadata?: Record<string, any>;
}
```

### L0Interceptor

Interceptor for preprocessing and postprocessing L0 execution.

```typescript
interface L0Interceptor {
  // Optional name for the interceptor
  name?: string;

  // Before hook - runs before stream starts
  // Can modify options, inject metadata, add authentication, etc.
  before?: (options: L0Options) => L0Options | Promise<L0Options>;

  // After hook - runs after stream completes
  // Can inspect output, post-process content, log results, etc.
  after?: (result: L0Result) => L0Result | Promise<L0Result>;

  // Error hook - runs if an error occurs
  onError?: (error: Error, options: L0Options) => void | Promise<void>;
}
```

### L0Adapter

Interface for custom stream adapters. Adapters normalize foreign SDK streams to L0Events.

```typescript
interface L0Adapter<StreamType = unknown, Options = unknown> {
  // Unique identifier for this adapter
  name: string;

  // Optional type guard for auto-detection (required for registerAdapter())
  detect?(input: unknown): input is StreamType;

  // Convert provider stream → L0Events
  // MUST yield events in exact order, include timestamp, never throw
  wrap(stream: StreamType, options?: Options): AsyncGenerator<L0Event>;
}
```

**Adapter Rules:**

- MUST yield events in exact order received
- MUST include timestamp on every event
- MUST convert errors to `{ type: "error" }` events (never throw)
- MUST yield `{ type: "complete" }` exactly once at end
- MUST NOT modify text content, buffer/batch chunks, or perform retries

### RetryOptions

Retry configuration options. See [BackoffStrategy](#backoffstrategy), [RetryReason](#retryreason), and [RETRY_DEFAULTS](#retry_defaults) for type details.

```typescript
interface RetryOptions {
  // Max retry attempts for model failures (default: 3)
  // Network and transient errors do not count toward this limit
  attempts?: number;

  // Absolute maximum retries across ALL error types (default: 6)
  // Hard cap including network errors, transient errors, and model errors
  maxRetries?: number;

  // Backoff strategy (default: "fixed-jitter")
  backoff?: BackoffStrategy;

  // Base delay in milliseconds (default: 1000)
  baseDelay?: number;

  // Maximum delay cap in milliseconds (default: 10000)
  maxDelay?: number;

  // What types of errors to retry on (see RETRY_DEFAULTS.retryOn for defaults)
  retryOn?: RetryReason[];

  // Custom delays for specific network error types
  errorTypeDelays?: {
    connectionDropped?: number;
    fetchError?: number;
    econnreset?: number;
    econnrefused?: number;
    sseAborted?: number;
    noBytes?: number;
    partialChunks?: number;
    runtimeKilled?: number;
    backgroundThrottle?: number;
    dnsError?: number;
    timeout?: number;
    unknown?: number;
  };

  // Async callback to veto retry decisions (can only narrow, never force retries)
  // Return true to allow default behavior, false to veto retry
  // Fatal errors always bypass this callback
  shouldRetry?: (
    error: Error,
    state: L0State,
    attempt: number,
    category: ErrorCategory,
  ) => Promise<boolean>;

  // Custom function to calculate retry delay
  // Return number for custom delay, undefined to use default calculation
  calculateDelay?: (context: {
    attempt: number;
    totalAttempts: number;
    category: ErrorCategory;
    reason: string;
    error: Error;
    defaultDelay: number;
  }) => number | undefined;
}
```

### CategorizedNetworkError

Categorized network error for telemetry.

```typescript
interface CategorizedNetworkError {
  type: string;
  message: string;
  timestamp: number;
  retried: boolean;
  delay?: number;
  attempt?: number;
}
```

### CheckpointValidationResult

Result of checkpoint validation for continuation.

```typescript
interface CheckpointValidationResult {
  // Whether to skip continuation and start fresh
  skipContinuation: boolean;

  // Guardrail violations found in checkpoint
  violations: GuardrailViolation[];

  // Whether drift was detected
  driftDetected: boolean;

  // Drift types if detected
  driftTypes: string[];
}
```

### GuardrailRule

```typescript
interface GuardrailRule {
  name: string;
  description?: string;
  streaming?: boolean;
  severity?: "warning" | "error" | "fatal";
  recoverable?: boolean;
  check: (context: GuardrailContext) => GuardrailViolation[];
}
```

### GuardrailContext

Context passed to guardrail check functions.

```typescript
interface GuardrailContext {
  content: string; // Current accumulated content
  checkpoint: string; // Last checkpoint content
  delta: string; // New content since last check
  tokenCount: number; // Total tokens received
  completed: boolean; // Whether stream is complete
}
```

### GuardrailViolation

```typescript
interface GuardrailViolation {
  rule: string;
  message: string;
  severity: "warning" | "error" | "fatal";
  recoverable: boolean;
  context?: Record<string, any>;
}
```

### ConsensusResult

```typescript
interface ConsensusResult<T> {
  consensus: T;
  confidence: number;
  outputs: ConsensusOutput[];
  agreements: Agreement[];
  disagreements: Disagreement[];
  analysis: ConsensusAnalysis;
  status: "success" | "partial" | "failed";
}
```

### CorrectionType

Types of auto-corrections that can be applied to structured output.

````typescript
type CorrectionType =
  | "close_brace" // Add missing closing brace
  | "close_bracket" // Add missing closing bracket
  | "remove_trailing_comma" // Remove trailing commas
  | "strip_markdown_fence" // Remove ```json fences
  | "strip_json_prefix" // Remove "json:" prefix
  | "remove_prefix_text" // Remove text before JSON
  | "remove_suffix_text" // Remove text after JSON
  | "fix_quotes" // Fix quote issues
  | "remove_comments" // Remove comments from JSON
  | "escape_control_chars" // Escape control characters
  | "fill_missing_fields" // Fill missing required fields
  | "remove_unknown_fields" // Remove unknown fields (strict mode)
  | "coerce_types" // Coerce types to match schema
  | "extract_json"; // Extract JSON from surrounding text
````

### BackoffStrategy

Backoff strategy options for retry delays. Defined in `src/types/retry.ts`.

```typescript
type BackoffStrategy =
  | "exponential" // Classic exponential backoff (delay * 2^attempt)
  | "linear" // Linear increase (delay * attempt)
  | "fixed" // Constant delay
  | "full-jitter" // Random delay between 0 and exponential value
  | "fixed-jitter"; // AWS-style: base delay + random jitter (DEFAULT)
```

### RetryReason

Reasons that can trigger a retry. Defined in `src/types/retry.ts`.

```typescript
type RetryReason =
  | "zero_output" // LLM returned no content
  | "guardrail_violation" // Output failed guardrail check
  | "drift" // Output drifted from expected format
  | "unknown" // Unknown error (opt-in only, not in defaults)
  | "incomplete" // Output was truncated/incomplete
  | "network_error" // Network connectivity issues
  | "timeout" // Request timed out
  | "rate_limit" // 429 rate limit hit
  | "server_error"; // 5xx server errors
```

### ErrorCategory

Error classification enum for routing and handling decisions. Defined in `src/types/retry.ts`.

```typescript
enum ErrorCategory {
  NETWORK = "network", // Network/connection failures - retry forever with backoff
  TRANSIENT = "transient", // Transient errors (429, 503, timeouts) - retry forever with backoff
  MODEL = "model", // Model-side errors (bad response) - counts toward retry limit
  CONTENT = "content", // Content errors (guardrails, drift) - counts toward retry limit
  PROVIDER = "provider", // Provider/API errors - may retry depending on status
  FATAL = "fatal", // Fatal errors - don't retry (auth failures, invalid config)
  INTERNAL = "internal", // Internal errors (bugs) - don't retry
}
```

| Category    | Retry Behavior                     | Counts Toward Limit |
| ----------- | ---------------------------------- | ------------------- |
| `NETWORK`   | Retry indefinitely with backoff    | No                  |
| `TRANSIENT` | Retry indefinitely with backoff    | No                  |
| `MODEL`     | Retry up to `attempts` limit       | Yes                 |
| `CONTENT`   | Retry up to `attempts` limit       | Yes                 |
| `PROVIDER`  | May retry depending on status code | Depends             |
| `FATAL`     | Never retry                        | N/A                 |
| `INTERNAL`  | Never retry                        | N/A                 |

### RuntimeState

State machine states for tracking runtime execution. Defined in `src/runtime/state-machine.ts`.

```typescript
// Use RuntimeStates constants instead of string literals
import { RuntimeStates } from "@ai2070/l0";

type RuntimeState =
  | "init" // RuntimeStates.INIT
  | "waiting_for_token" // RuntimeStates.WAITING_FOR_TOKEN
  | "streaming" // RuntimeStates.STREAMING
  | "continuation_matching" // RuntimeStates.CONTINUATION_MATCHING
  | "checkpoint_verifying" // RuntimeStates.CHECKPOINT_VERIFYING
  | "retrying" // RuntimeStates.RETRYING
  | "fallback" // RuntimeStates.FALLBACK
  | "finalizing" // RuntimeStates.FINALIZING
  | "complete" // RuntimeStates.COMPLETE
  | "error"; // RuntimeStates.ERROR
```

### MetricsSnapshot

Snapshot of runtime metrics. Defined in `src/runtime/metrics.ts`.

```typescript
interface MetricsSnapshot {
  requests: number;
  tokens: number;
  retries: number;
  networkRetryCount: number;
  errors: number;
  violations: number;
  driftDetections: number;
  fallbacks: number;
  completions: number;
  timeouts: number;
}
```

### Stage

Pipeline stage function type. Defined in `src/runtime/pipeline.ts`.

```typescript
type Stage = (event: L0Event, ctx: PipelineContext) => L0Event | null;
```

### PipelineContext

Context passed through pipeline stages. Defined in `src/runtime/pipeline.ts`.

```typescript
interface PipelineContext {
  state: L0State;
  stateMachine: StateMachine;
  monitor: L0Monitor;
  signal?: AbortSignal;
  scratch: Map<string, unknown>;
}
```

### RETRY_DEFAULTS

Centralized default values for retry configuration. Defined in `src/types/retry.ts`.

```typescript
const RETRY_DEFAULTS = {
  attempts: 3, // Model failure attempts
  maxRetries: 6, // Hard cap across all error types
  baseDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
  networkMaxDelay: 30000, // 30 seconds for network errors
  backoff: "fixed-jitter", // AWS-style backoff
  retryOn: [
    "zero_output",
    "guardrail_violation",
    "drift",
    "incomplete",
    "network_error",
    "timeout",
    "rate_limit",
    "server_error",
  ],
};
```

---

## Subpath Imports (Bundle Optimization)

L0 provides subpath exports for reduced bundle sizes. Most applications should use the main import, but edge runtimes or strict bundle constraints may benefit from subpath imports.

### Bundle Sizes (minified)

| Import                  | Size  | Gzipped | Description                                      |
| ----------------------- | ----- | ------- | ------------------------------------------------ |
| `@ai2070/l0` (full)     | 191KB | 56KB    | Everything                                       |
| `@ai2070/l0/core`       | 71KB  | 21KB    | Runtime + retry + errors                         |
| `@ai2070/l0/structured` | 61KB  | 18KB    | Structured output                                |
| `@ai2070/l0/consensus`  | 72KB  | 21KB    | Multi-model consensus                            |
| `@ai2070/l0/parallel`   | 58KB  | 17KB    | Parallel/race operations                         |
| `@ai2070/l0/window`     | 62KB  | 18KB    | Document chunking                                |
| `@ai2070/l0/guardrails` | 18KB  | 6KB     | Validation rules                                 |
| `@ai2070/l0/monitoring` | 27KB  | 7KB     | OTel/Sentry                                      |
| `@ai2070/l0/drift`      | 4KB   | 2KB     | Drift detection                                  |
| `@ai2070/l0/openai`     | —     | —       | OpenAI SDK adapter                               |
| `@ai2070/l0/mastra`     | —     | —       | Mastra adapter                                   |
| `@ai2070/l0/anthropic`  | —     | —       | Anthropic SDK adapter (reference implementation) |

### Usage

```typescript
// Main import (recommended for most apps)
import { l0, structured, consensus } from "@ai2070/l0";

// Subpath imports (for edge runtimes / strict bundle constraints)
import { l0 } from "@ai2070/l0/core";
import { structured } from "@ai2070/l0/structured";
import { consensus } from "@ai2070/l0/consensus";
import { parallel, race } from "@ai2070/l0/parallel";
import { createWindow } from "@ai2070/l0/window";
import { recommendedGuardrails } from "@ai2070/l0/guardrails";
import { createSentryHandler } from "@ai2070/l0/monitoring";
import { DriftDetector } from "@ai2070/l0/drift";
import { openaiAdapter } from "@ai2070/l0/openai";
import { anthropicAdapter } from "@ai2070/l0/anthropic";
import { mastraAdapter } from "@ai2070/l0/mastra";
```

### When to Use Subpath Imports

- **Edge runtimes** (Cloudflare Workers, Vercel Edge) with strict size limits
- **Browser bundles** where every KB matters
- **Lambda/serverless** with cold start concerns

For Node.js servers and most applications, the full import is fine.

---

## See Also

- [QUICKSTART.md](./QUICKSTART.md) - Getting started
- [STRUCTURED_OUTPUT.md](./STRUCTURED_OUTPUT.md) - Structured output guide
- [DOCUMENT_WINDOWS.md](./DOCUMENT_WINDOWS.md) - Document processing
- [NETWORK_ERRORS.md](./NETWORK_ERRORS.md) - Network error handling
- [PERFORMANCE.md](./PERFORMANCE.md) - Performance tuning
- [ERROR_HANDLING.md](./ERROR_HANDLING.md) - Error handling guide
- [GUARDRAILS.md](./GUARDRAILS.md) - Guardrail rules reference
- [MONITORING.md](./MONITORING.md) - Monitoring and telemetry
- [INTERCEPTORS_AND_PARALLEL.md](./INTERCEPTORS_AND_PARALLEL.md) - Interceptors and parallel operations
- [MULTIMODAL.md](./MULTIMODAL.md) - Multimodal content handling
- [CONSENSUS.md](./CONSENSUS.md) - Multi-model consensus
- [CUSTOM_ADAPTERS.md](./CUSTOM_ADAPTERS.md) - Building custom adapters
- [EVENT_SOURCING.md](./EVENT_SOURCING.md) - Event recording and replay
- [FORMATTING.md](./FORMATTING.md) - Prompt formatting helpers
