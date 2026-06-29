# Advanced Usage

## Core Features

| Feature                                                               | Description                                                     |
| --------------------------------------------------------------------- | --------------------------------------------------------------- |
| [Full Configuration Example](#full-configuration-example)             | Complete example with all available options                     |
| [Streaming Runtime](#streaming-runtime)                               | Token-by-token normalization, checkpoints, resumable generation |
| [Retry Logic](#retry-logic)                                           | Smart retries with backoff, network vs model error distinction  |
| [Network Protection](#network-protection)                             | Auto-recovery from 12+ network failure types                    |
| [Structured Output](#structured-output)                               | Guaranteed valid JSON with Zod, Effect Schema, or JSON Schema   |
| [Fallback Models](#fallback-models)                                   | Sequential fallback when primary model fails                    |
| [Document Windows](#document-windows)                                 | Automatic chunking for long documents                           |
| [Formatting Helpers](#formatting-helpers)                             | Context, memory, tools, and output formatting utilities         |
| [Last-Known-Good Token Resumption](#last-known-good-token-resumption) | Resume from last checkpoint on retry/fallback (opt-in)          |
| [Guardrails](#guardrails)                                             | JSON, Markdown, LaTeX validation, pattern detection             |
| [Consensus](#consensus)                                               | Multi-model agreement with voting strategies                    |
| [Parallel Operations](#parallel-operations)                           | Race, batch, pool patterns for concurrent LLM calls             |
| [Pipe: Streaming Pipelines](#pipe-streaming-pipelines)                | Chain steps (summarize → translate → format) with state passing |
| [Type-Safe Generics](#type-safe-generics)                             | Forward output types through all L0 functions                   |
| [Custom Adapters (BYOA)](#custom-adapters-byoa)                       | Bring your own adapter for any LLM provider                     |
| [Multimodal Support](#multimodal-support)                             | Image, audio, video generation with progress tracking           |
| [Lifecycle Callbacks](#lifecycle-callbacks)                           | Full observability into every stream phase                      |
| [Event Sourcing](#event-sourcing)                                     | Record/replay streams for testing and audit trails              |
| [Error Handling](#error-handling)                                     | Typed errors with categorization and recovery hints             |
| [Monitoring](#monitoring)                                             | Built-in OTel and Sentry integrations                           |
| [Testing](#testing)                                                   | 3,000+ tests covering all features and SDK adapters             |

---

## Full Configuration Example

Complete example showing all available options:

```typescript
import { l0, recommendedGuardrails, recommendedRetry } from "reliable-ai-streams";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

const result = await l0({
  // Primary model stream
  stream: () =>
    streamText({
      model: openai("gpt-4o"),
      prompt,
    }),

  // Fallback models (tried in order if primary fails)
  fallbackStreams: [() => streamText({ model: openai("gpt-4o-mini"), prompt })],

  // Guardrails presets:
  // minimalGuardrails       // jsonRule, zeroOutputRule
  // recommendedGuardrails   // jsonRule, markdownRule, zeroOutputRule, patternRule
  // strictGuardrails        // jsonRule, markdownRule, latexRule, patternRule, zeroOutputRule
  // jsonOnlyGuardrails      // jsonRule, zeroOutputRule
  // markdownOnlyGuardrails  // markdownRule, zeroOutputRule
  // latexOnlyGuardrails     // latexRule, zeroOutputRule
  guardrails: recommendedGuardrails,

  // Retry configuration
  retry: {
    attempts: 3, // LLM errors only
    maxRetries: 6, // Total (LLM + network)
    baseDelay: 1000,
    maxDelay: 10000,
    backoff: "fixed-jitter", // "exponential" | "linear" | "fixed" | "full-jitter"
  },
  // Or use presets:
  // minimalRetry       // { attempts: 2, maxRetries: 4, backoff: "linear" }
  // recommendedRetry   // { attempts: 3, maxRetries: 6, backoff: "fixed-jitter" }
  // strictRetry        // { attempts: 3, maxRetries: 6, backoff: "full-jitter" }
  // exponentialRetry   // { attempts: 4, maxRetries: 8, backoff: "exponential" }

  // Timeout configuration
  timeout: {
    initialToken: 5000, // 5s to first token
    interToken: 10000, // 10s between tokens
  },

  // Guardrail check intervals (optimized for high-throughput streaming)
  checkIntervals: {
    guardrails: 15, // Check every N tokens
    drift: 25,
    checkpoint: 20,
  },

  // User context (attached to all observability events)
  context: { requestId: "req_123", userId: "user_456" },

  // Abort signal
  signal: abortController.signal,

  // Enable telemetry
  monitoring: { enabled: true },

  // Lifecycle callbacks (all optional)
  onStart: (attempt, isRetry, isFallback) => {},
  onComplete: (state) => {},
  onError: (error, willRetry, willFallback) => {},
  onViolation: (violation) => {},
  onRetry: (attempt, reason) => {},
  onFallback: (index, reason) => {},
  onToolCall: (toolName, toolCallId, args) => {},
});

// Read the stream
for await (const event of result.stream) {
  if (event.type === "token") {
    process.stdout.write(event.value);
  }
}
```

---

## Streaming Runtime

L0 wraps `streamText()` with deterministic behavior:

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),

  // Optional: Timeouts (ms)
  timeout: {
    initialToken: 5000, // 5s to first token
    interToken: 10000, // 10s between tokens
  },

  signal: abortController.signal,
});

// Unified event format
for await (const event of result.stream) {
  switch (event.type) {
    case "token":
      console.log(event.value);
      break;
    case "complete":
      console.log("Complete");
      break;
    case "error":
      console.error(event.error, event.reason); // reason: ErrorCategory
      break;
  }
}

// Access final state
console.log(result.state.content); // Full accumulated content
console.log(result.state.tokenCount); // Total tokens received
console.log(result.state.checkpoint); // Last stable checkpoint
```

⚠️ Free and low-priority models may take **3–7 seconds** before emitting the first token and **10 seconds** between tokens.

---

## Retry Logic

Smart retry system that distinguishes network errors from model errors:

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: {
    attempts: 3, // Model errors only (default: 3)
    maxRetries: 6, // Absolute cap across all error types (default: 6)
    baseDelay: 1000,
    maxDelay: 10000,
    backoff: "fixed-jitter", // or "exponential", "linear", "fixed", "full-jitter"

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

    // Custom delays per error type (overrides baseDelay)
    errorTypeDelays: {
      connectionDropped: 2000,
      timeout: 1500,
      dnsError: 5000,
    },
  },
});
```

### Retry Behavior

| Error Type           | Category    | Retries | Counts Toward `attempts` | Counts Toward `maxRetries` |
| -------------------- | ----------- | ------- | ------------------------ | -------------------------- |
| Network disconnect   | `NETWORK`   | Yes     | No                       | Yes                        |
| Zero output          | `CONTENT`   | Yes     | **Yes**                  | Yes                        |
| Timeout              | `TRANSIENT` | Yes     | No                       | Yes                        |
| 429 rate limit       | `TRANSIENT` | Yes     | No                       | Yes                        |
| 503 server error     | `TRANSIENT` | Yes     | No                       | Yes                        |
| Guardrail violation  | `CONTENT`   | Yes     | **Yes**                  | Yes                        |
| Drift detected       | `CONTENT`   | Yes     | **Yes**                  | Yes                        |
| Model error          | `MODEL`     | Yes     | **Yes**                  | Yes                        |
| Auth error (401/403) | `FATAL`     | No      | -                        | -                          |
| Invalid config       | `INTERNAL`  | No      | -                        | -                          |

---

## Network Protection

Automatic detection and recovery from network failures:

```typescript
import { isNetworkError, analyzeNetworkError } from "reliable-ai-streams";

try {
  await l0({ stream, retry: recommendedRetry });
} catch (error) {
  if (isNetworkError(error)) {
    const analysis = analyzeNetworkError(error);
    console.log(analysis.type); // "connection_dropped", "timeout", etc.
    console.log(analysis.retryable); // true/false
    console.log(analysis.suggestion); // Recovery suggestion
  }
}
```

Detected error types: connection dropped, fetch errors, ECONNRESET, ECONNREFUSED, SSE aborted, DNS errors, timeouts, mobile background throttle, and more.

---

## Structured Output

Guaranteed valid JSON matching your schema. Supports **Zod** (v3/v4), **Effect Schema**, and **JSON Schema**:

### With Zod

```typescript
import { structured } from "reliable-ai-streams";
import { z } from "zod";

const schema = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string().email(),
});

const result = await structured({
  schema,
  stream: () => streamText({ model, prompt: "Generate user data as JSON" }),
  autoCorrect: true, // Fix trailing commas, missing braces, etc.
});

// Type-safe access
console.log(result.data.name); // string
console.log(result.data.age); // number
console.log(result.corrected); // true if auto-corrected
```

### With Effect Schema

```typescript
import {
  structured,
  registerEffectSchemaAdapter,
  wrapEffectSchema,
} from "reliable-ai-streams";
import { Schema } from "effect";

// Register the adapter once at app startup
registerEffectSchemaAdapter({
  decodeUnknownSync: (schema, data) => Schema.decodeUnknownSync(schema)(data),
  decodeUnknownEither: (schema, data) => {
    try {
      return { _tag: "Right", right: Schema.decodeUnknownSync(schema)(data) };
    } catch (error) {
      return {
        _tag: "Left",
        left: { _tag: "ParseError", issue: error, message: error.message },
      };
    }
  },
  formatError: (error) => error.message,
});

// Define schema with Effect
const schema = Schema.Struct({
  name: Schema.String,
  age: Schema.Number,
  email: Schema.String,
});

// Use with structured()
const result = await structured({
  schema: wrapEffectSchema(schema),
  stream: () => streamText({ model, prompt: "Generate user data as JSON" }),
  autoCorrect: true,
});

console.log(result.data.name); // string - fully typed
```

### With JSON Schema

```typescript
import {
  structured,
  registerJSONSchemaAdapter,
  wrapJSONSchema,
} from "reliable-ai-streams";
import Ajv from "ajv"; // Or any JSON Schema validator

// Register adapter once at app startup (example with Ajv)
const ajv = new Ajv({ allErrors: true });
registerJSONSchemaAdapter({
  validate: (schema, data) => {
    const validate = ajv.compile(schema);
    const valid = validate(data);
    if (valid) return { valid: true, data };
    return {
      valid: false,
      errors: (validate.errors || []).map((e) => ({
        path: e.instancePath || "/",
        message: e.message || "Validation failed",
        keyword: e.keyword,
        params: e.params,
      })),
    };
  },
  formatErrors: (errors) =>
    errors.map((e) => `${e.path}: ${e.message}`).join(", "),
});

// Define schema with JSON Schema
const schema = {
  type: "object",
  properties: {
    name: { type: "string" },
    age: { type: "number" },
    email: { type: "string", format: "email" },
  },
  required: ["name", "age", "email"],
};

// Use with structured()
const result = await structured({
  schema: wrapJSONSchema<{ name: string; age: number; email: string }>(schema),
  stream: () => streamText({ model, prompt: "Generate user data as JSON" }),
  autoCorrect: true,
});

console.log(result.data.name); // string - typed via generic
```

### Helper Functions

```typescript
import {
  structuredObject,
  structuredArray,
  structuredStream,
} from "reliable-ai-streams";

// Quick object schema
const result = await structuredObject(
  {
    name: z.string(),
    age: z.number(),
  },
  { stream },
);

// Quick array schema
const result = await structuredArray(z.object({ name: z.string() }), {
  stream,
});

// Streaming with end validation
const { stream, result, abort } = await structuredStream({
  schema,
  stream: () => streamText({ model, prompt }),
});

for await (const event of stream) {
  if (event.type === "token") console.log(event.value);
}
const validated = await result;
```

### Structured Output Presets

```typescript
import {
  minimalStructured,
  recommendedStructured,
  strictStructured,
} from "reliable-ai-streams";

// minimalStructured:     { autoCorrect: false, retry: { attempts: 1 } }
// recommendedStructured: { autoCorrect: true, retry: { attempts: 2 } }
// strictStructured:      { autoCorrect: true, strictMode: true, retry: { attempts: 3 } }

const result = await structured({
  schema,
  stream,
  ...recommendedStructured,
});
```

---

## Fallback Models

Sequential fallback when primary model fails:

```typescript
const result = await l0({
  stream: () => streamText({ model: openai("gpt-4o"), prompt }),
  fallbackStreams: [
    () => streamText({ model: openai("gpt-4o-mini"), prompt }),
    () => streamText({ model: anthropic("claude-3-haiku"), prompt }),
  ],
});

// Check which model succeeded
console.log(result.state.fallbackIndex); // 0 = primary, 1+ = fallback
```

---

## Document Windows

Process documents that exceed context limits:

```typescript
import { createWindow } from "reliable-ai-streams";

const window = createWindow(longDocument, {
  size: 2000, // Tokens per chunk
  overlap: 200, // Overlap between chunks
  strategy: "paragraph", // or "token", "sentence", "char"
});

// Process all chunks
const results = await window.processAll((chunk) => ({
  stream: () =>
    streamText({
      model,
      prompt: `Summarize: ${chunk.content}`,
    }),
}));

// Or navigate manually
const first = window.current();
const next = window.next();
```

---

## Formatting Helpers

Utilities for context, memory, output instructions, and tool definitions:

```typescript
import { formatContext, formatMemory, formatTool, formatJsonOutput } from "reliable-ai-streams";

// Wrap documents with XML/Markdown/bracket delimiters
const context = formatContext(document, { label: "Documentation", delimiter: "xml" });

// Format conversation history (conversational, structured, or compact)
const memory = formatMemory(messages, { style: "conversational", maxEntries: 10 });

// Define tools with JSON schema, TypeScript, or natural language
const tool = formatTool({ name: "search", description: "Search", parameters: [...] });

// Request strict JSON output
const instruction = formatJsonOutput({ strict: true, schema: "..." });
```

See [FORMATTING.md](./FORMATTING.md) for complete API reference.

---

## Last-Known-Good Token Resumption

When a stream fails mid-generation, L0 can resume from the last known good checkpoint instead of starting over. This preserves already-generated content and reduces latency on retries.

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: { attempts: 3 },

  // Enable continuation from last checkpoint (opt-in)
  continueFromLastKnownGoodToken: true,
});

// Check if continuation was used
console.log(result.state.resumed); // true if resumed from checkpoint
console.log(result.state.resumePoint); // The checkpoint content
console.log(result.state.resumeFrom); // Character offset where resume occurred
```

### How It Works

1. L0 maintains a checkpoint of successfully received tokens (every N tokens, configurable via `checkIntervals.checkpoint`)
2. When a retry or fallback is triggered, the checkpoint is validated against guardrails and drift detection
3. If validation passes, the checkpoint content is emitted first to the consumer
4. The `buildContinuationPrompt` callback (if provided) is called to allow updating the prompt for continuation
5. Telemetry tracks whether continuation was enabled, used, and the checkpoint details

### Using buildContinuationPrompt

To have the LLM actually continue from where it left off (rather than just replaying tokens locally), use `buildContinuationPrompt` to modify the prompt:

```typescript
let continuationPrompt = "";
const originalPrompt = "Write a detailed analysis of...";

const result = await l0({
  stream: () =>
    streamText({
      model: openai("gpt-4o"),
      prompt: continuationPrompt || originalPrompt,
    }),
  continueFromLastKnownGoodToken: true,
  buildContinuationPrompt: (checkpoint) => {
    // Update the prompt to tell the LLM to continue from checkpoint
    continuationPrompt = `${originalPrompt}\n\nContinue from where you left off:\n${checkpoint}`;
    return continuationPrompt;
  },
  retry: { attempts: 3 },
});
```

When LLMs continue from a checkpoint, they often repeat words from the end. L0 automatically detects and removes this overlap (enabled by default). See [API Reference](./API.md#smart-continuation-deduplication) for configuration options.

### Example: Resuming After Network Error

```typescript
const result = await l0({
  stream: () =>
    streamText({
      model: openai("gpt-4o"),
      prompt: "Write a detailed analysis of...",
    }),
  fallbackStreams: [() => streamText({ model: openai("gpt-4o-mini"), prompt })],
  retry: { attempts: 3 },
  continueFromLastKnownGoodToken: true,
  checkIntervals: { checkpoint: 10 }, // Save checkpoint every 10 tokens
  monitoring: { enabled: true },
});

for await (const event of result.stream) {
  if (event.type === "token") {
    process.stdout.write(event.value);
  }
}

// Check telemetry for continuation usage
if (result.telemetry?.continuation?.used) {
  console.log(
    "\nResumed from checkpoint of length:",
    result.telemetry.continuation.checkpointLength,
  );
}
```

### Checkpoint Validation

Before using a checkpoint for continuation, L0 validates it:

- **Guardrails**: All configured guardrails are run against the checkpoint content
- **Drift Detection**: If enabled, checks for format drift in the checkpoint
- **Fatal Violations**: If any guardrail returns a fatal violation, the checkpoint is discarded and retry starts fresh

### Important Limitations

> ⚠️ **Do NOT use `continueFromLastKnownGoodToken` with structured output or `streamObject()`.**
>
> Continuation works by prepending checkpoint content to the next generation. For JSON/structured output, this can corrupt the data structure because:
>
> - The model may not properly continue the JSON syntax
> - Partial objects could result in invalid JSON
> - Schema validation may fail on malformed output
>
> For structured output, let L0 retry from scratch to ensure valid JSON.

```typescript
// ✅ GOOD - Text generation with continuation
const result = await l0({
  stream: () => streamText({ model, prompt: "Write an essay..." }),
  continueFromLastKnownGoodToken: true,
});

// ❌ BAD - Do NOT use with structured output
const result = await structured({
  schema: mySchema,
  stream: () => streamText({ model, prompt }),
  continueFromLastKnownGoodToken: true, // DON'T DO THIS
});
```

---

## Guardrails

Pure functions that validate streaming output without rewriting it:

```typescript
import {
  jsonRule,
  markdownRule,
  zeroOutputRule,
  patternRule,
  customPatternRule,
} from "reliable-ai-streams";

const result = await l0({
  stream: () => streamText({ model, prompt }),
  guardrails: [
    jsonRule(), // Validates JSON structure
    markdownRule(), // Validates Markdown fences/tables
    zeroOutputRule(), // Detects empty output
    patternRule(), // Detects "As an AI..." patterns
    customPatternRule([/forbidden/i], "Custom violation"),
  ],
});
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
} from "reliable-ai-streams";
```

| Preset                  | Rules Included                                                           |
| ----------------------- | ------------------------------------------------------------------------ |
| `minimalGuardrails`     | `jsonRule`, `zeroOutputRule`                                             |
| `recommendedGuardrails` | `jsonRule`, `markdownRule`, `zeroOutputRule`, `patternRule`              |
| `strictGuardrails`      | `jsonRule`, `markdownRule`, `latexRule`, `patternRule`, `zeroOutputRule` |

### Fast/Slow Path Execution

L0 uses a two-path strategy to avoid blocking the streaming loop:

| Path     | When                     | Behavior                                    |
| -------- | ------------------------ | ------------------------------------------- |
| **Fast** | Delta < 1KB, total < 5KB | Synchronous check, immediate result         |
| **Slow** | Large content            | Deferred via `setImmediate()`, non-blocking |

For long outputs, tune the check frequency:

```typescript
await l0({
  stream,
  guardrails: recommendedGuardrails,
  checkIntervals: {
    guardrails: 50, // Check every 50 tokens (default: 5)
  },
});
```

See [GUARDRAILS.md](./GUARDRAILS.md) for full documentation.

---

## Consensus

Multi-generation consensus for high-confidence results:

```typescript
import { consensus } from "reliable-ai-streams";

const result = await consensus({
  streams: [
    () => streamText({ model, prompt }),
    () => streamText({ model, prompt }),
    () => streamText({ model, prompt }),
  ],
  strategy: "majority", // or "unanimous", "weighted", "best"
  threshold: 0.8,
});

console.log(result.consensus); // Agreed output
console.log(result.confidence); // 0-1 confidence score
console.log(result.agreements); // What they agreed on
console.log(result.disagreements); // Where they differed
```

---

## Parallel Operations

Run multiple LLM calls concurrently with different patterns:

### Race - First Response Wins

```typescript
import { race } from "reliable-ai-streams";

const result = await race([
  { stream: () => streamText({ model: openai("gpt-4o"), prompt }) },
  { stream: () => streamText({ model: anthropic("claude-3-opus"), prompt }) },
  { stream: () => streamText({ model: google("gemini-pro"), prompt }) },
]);
// Returns first successful response, cancels others
console.log(result.winnerIndex); // 0-based index of winning stream
console.log(result.state.content); // Content from winning stream
```

### Parallel with Concurrency Control

```typescript
import { parallel } from "reliable-ai-streams";

const results = await parallel(
  [
    { stream: () => streamText({ model, prompt: "Task 1" }) },
    { stream: () => streamText({ model, prompt: "Task 2" }) },
    { stream: () => streamText({ model, prompt: "Task 3" }) },
  ],
  {
    concurrency: 2, // Max 2 concurrent
    failFast: false, // Continue on errors
  },
);

console.log(results.successCount);
console.log(results.results[0]?.state.content);
```

### Fall-Through vs Race

| Pattern      | Execution                   | Cost               | Best For                          |
| ------------ | --------------------------- | ------------------ | --------------------------------- |
| Fall-through | Sequential, next on failure | Low (pay for 1)    | High availability, cost-sensitive |
| Race         | Parallel, first wins        | High (pay for all) | Low latency, speed-critical       |

```typescript
// Fall-through: Try models sequentially
const result = await l0({
  stream: () => streamText({ model: openai("gpt-4o"), prompt }),
  fallbackStreams: [
    () => streamText({ model: openai("gpt-4o-mini"), prompt }),
    () => streamText({ model: anthropic("claude-3-haiku"), prompt }),
  ],
});

// Race: All models simultaneously, first wins
const result = await race([
  { stream: () => streamText({ model: openai("gpt-4o"), prompt }) },
  { stream: () => streamText({ model: anthropic("claude-3-opus"), prompt }) },
]);
```

### Operation Pool

For dynamic workloads, use `OperationPool` to process operations with a shared concurrency limit:

```typescript
import { createPool } from "reliable-ai-streams";

const pool = createPool(3); // Max 3 concurrent operations

// Add operations dynamically
const result1 = pool.execute({
  stream: () => streamText({ model, prompt: "Task 1" }),
});
const result2 = pool.execute({
  stream: () => streamText({ model, prompt: "Task 2" }),
});

// Wait for all operations to complete
await pool.drain();

// Pool methods
pool.getQueueLength(); // Pending operations
pool.getActiveWorkers(); // Currently executing
```

---

## Pipe: Streaming Pipelines

Chain multiple streaming steps where each step receives the output of the previous:

```typescript
import { pipe } from "reliable-ai-streams";

const result = await pipe(
  [
    {
      name: "summarize",
      fn: (input) => ({
        stream: () =>
          streamText({
            model: openai("gpt-4o"),
            prompt: `Summarize this document: ${input}`,
          }),
      }),
    },
    {
      name: "translate",
      fn: (summary) => ({
        stream: () =>
          streamText({
            model: openai("gpt-4o"),
            prompt: `Translate to French: ${summary}`,
          }),
      }),
    },
    {
      name: "format",
      fn: (translation) => ({
        stream: () =>
          streamText({
            model: openai("gpt-4o"),
            prompt: `Format as bullet points: ${translation}`,
          }),
      }),
    },
  ],
  longDocument, // Initial input
  { name: "summarize-translate-format" },
);

console.log(result.output); // Final formatted output
console.log(result.steps); // Results from each step
console.log(result.duration); // Total pipeline duration
```

### Reusable Pipelines

Create pipelines that can be reused with different inputs:

```typescript
import { createPipeline, createStep } from "reliable-ai-streams";

// Create reusable steps
const summarizeStep = createStep(
  "summarize",
  (doc) => `Summarize: ${doc}`,
  (prompt) => streamText({ model: openai("gpt-4o"), prompt }),
);

const translateStep = createStep(
  "translate",
  (text) => `Translate to Spanish: ${text}`,
  (prompt) => streamText({ model: openai("gpt-4o"), prompt }),
);

// Create reusable pipeline
const pipeline = createPipeline([summarizeStep, translateStep], {
  name: "doc-processor",
  stopOnError: true,
});

// Run multiple times
const result1 = await pipeline.run(document1);
const result2 = await pipeline.run(document2);

// Clone and modify
const extendedPipeline = pipeline.clone().addStep({
  name: "review",
  fn: (text) => ({
    stream: () =>
      streamText({
        model: openai("gpt-4o"),
        prompt: `Review for accuracy: ${text}`,
      }),
  }),
});
```

### Conditional Steps

Skip steps based on conditions:

```typescript
const result = await pipe(
  [
    {
      name: "analyze",
      fn: (input) => ({
        stream: () => streamText({ model, prompt: `Analyze: ${input}` }),
      }),
    },
    {
      name: "translate",
      // Only run if input is not already in English
      condition: (input) => !input.startsWith("[EN]"),
      fn: (text) => ({
        stream: () => streamText({ model, prompt: `Translate: ${text}` }),
      }),
    },
  ],
  input,
);
```

### Transform Step Output

Process step results before passing to the next step:

```typescript
const result = await pipe(
  [
    {
      name: "extract",
      fn: (input) => ({
        stream: () =>
          streamText({ model, prompt: `Extract key points: ${input}` }),
      }),
      // Transform L0 result to custom format
      transform: (l0Result) => ({
        points: l0Result.state.content.split("\n"),
        tokenCount: l0Result.state.tokenCount,
      }),
    },
    {
      name: "summarize",
      fn: (extracted) => ({
        stream: () =>
          streamText({
            model,
            prompt: `Summarize these ${extracted.points.length} points: ${extracted.points.join(", ")}`,
          }),
      }),
    },
  ],
  document,
);
```

### Pipeline Options

```typescript
const result = await pipe(steps, input, {
  name: "my-pipeline",
  stopOnError: true, // Stop on first error (default: true)
  timeout: 60000, // 60s timeout for entire pipeline
  signal: abortController.signal,
  monitoring: { enabled: true },

  onStart: (input) => console.log("Pipeline started"),
  onProgress: (step, total) => console.log(`Step ${step}/${total}`),
  onComplete: (result) => console.log(`Done in ${result.duration}ms`),
  onError: (error, stepIndex) => console.error(`Step ${stepIndex} failed`),
});
```

### Pipeline Presets

```typescript
import { fastPipeline, reliablePipeline, productionPipeline } from "reliable-ai-streams";

// Fast: fail fast, no monitoring
await pipe(steps, input, { ...fastPipeline });

// Reliable: continue on errors, monitoring enabled
await pipe(steps, input, { ...reliablePipeline });

// Production: timeouts, monitoring, graceful failures
await pipe(steps, input, { ...productionPipeline });
```

---

## Type-Safe Generics

All L0 functions support generic type parameters to forward your output types:

```typescript
import { l0, parallel, race, consensus } from "reliable-ai-streams";

// Typed output (compile-time type annotation)
interface UserProfile {
  name: string;
  age: number;
  email: string;
}

const result = await l0<UserProfile>({
  stream: () => streamText({ model, prompt }),
});
// result is L0Result<UserProfile> - generic enables type inference in callbacks

// Works with all parallel operations
const raceResult = await race<UserProfile>([
  { stream: () => streamText({ model: openai("gpt-4o"), prompt }) },
  { stream: () => streamText({ model: anthropic("claude-3-opus"), prompt }) },
]);

const parallelResults = await parallel<UserProfile>(operations);
// parallelResults.results[0]?.state is typed

// Consensus with type inference
const consensusResult = await consensus<typeof schema>({
  streams: [stream1, stream2, stream3],
  schema,
});
```

---

## Custom Adapters (BYOA)

L0 supports custom adapters for integrating any LLM provider. Built-in adapters include `openaiAdapter`, `mastraAdapter`, and `anthropicAdapter` (reference implementation).

### Explicit Adapter Usage

```typescript
import { l0, openaiAdapter } from "reliable-ai-streams";
import OpenAI from "openai";

const openai = new OpenAI();

const result = await l0({
  stream: () =>
    openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: "Hello!" }],
      stream: true,
    }),
  adapter: openaiAdapter,
});
```

### Building Custom Adapters

```typescript
import { toL0Events, type L0Adapter } from "reliable-ai-streams";

interface MyChunk {
  text?: string;
}

const myAdapter: L0Adapter<AsyncIterable<MyChunk>> = {
  name: "myai",

  // Optional: Enable auto-detection
  detect(input): input is AsyncIterable<MyChunk> {
    return !!input && typeof input === "object" && "__myMarker" in input;
  },

  // Convert provider stream to L0 events
  wrap(stream) {
    return toL0Events(stream, (chunk) => chunk.text ?? null);
  },
};
```

### Adapter Invariants

Adapters MUST:

- Preserve text exactly (no trimming, no modification)
- Include timestamps on every event
- Convert errors to error events (never throw)
- Emit complete event exactly once at end

See [CUSTOM_ADAPTERS.md](./CUSTOM_ADAPTERS.md) for complete guide including helper functions, registry API, and testing patterns.

---

## Multimodal Support

L0 supports image, audio, and video generation with progress tracking and data events:

```typescript
import { l0, toMultimodalL0Events, type L0Adapter } from "reliable-ai-streams";

const fluxAdapter: L0Adapter<FluxStream> = {
  name: "flux",
  wrap: (stream) =>
    toMultimodalL0Events(stream, {
      extractProgress: (chunk) =>
        chunk.type === "progress" ? { percent: chunk.percent } : null,
      extractData: (chunk) =>
        chunk.type === "image"
          ? {
              contentType: "image",
              mimeType: "image/png",
              base64: chunk.image,
              metadata: {
                width: chunk.width,
                height: chunk.height,
                seed: chunk.seed,
              },
            }
          : null,
    }),
};

const result = await l0({
  stream: () => fluxGenerate({ prompt: "A cat in space" }),
  adapter: fluxAdapter,
});

for await (const event of result.stream) {
  if (event.type === "progress") console.log(`${event.progress?.percent}%`);
  if (event.type === "data") saveImage(event.data?.base64);
}

// All generated images available in state
console.log(result.state.dataOutputs);
```

See [MULTIMODAL.md](./MULTIMODAL.md) for complete guide.

---

## Lifecycle Callbacks

L0 provides callbacks for every phase of stream execution, giving you full observability into the streaming lifecycle:

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  fallbackStreams: [() => streamText({ model: fallbackModel, prompt })],
  guardrails: recommendedGuardrails,
  continueFromLastKnownGoodToken: true,
  retry: { attempts: 3 },

  // Called when a new execution attempt begins
  onStart: (attempt, isRetry, isFallback) => {
    console.log(`Starting attempt ${attempt}`);
    if (isRetry) console.log("  (retry)");
    if (isFallback) console.log("  (fallback model)");
  },

  // Called when stream completes successfully
  onComplete: (state) => {
    console.log(`Completed with ${state.tokenCount} tokens`);
    console.log(`Duration: ${state.duration}ms`);
  },

  // Called when an error occurs (before retry/fallback decision)
  onError: (error, willRetry, willFallback) => {
    console.error(`Error: ${error.message}`);
    if (willRetry) console.log("  Will retry...");
    if (willFallback) console.log("  Will try fallback...");
  },

  // Called for every L0 event
  onEvent: (event) => {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  },

  // Called when a guardrail violation is detected
  onViolation: (violation) => {
    console.warn(`Violation: ${violation.rule}`);
    console.warn(`  ${violation.message}`);
  },

  // Called when a retry is triggered
  onRetry: (attempt, reason) => {
    console.log(`Retrying (attempt ${attempt}): ${reason}`);
  },

  // Called when switching to a fallback model
  onFallback: (index, reason) => {
    console.log(`Switching to fallback ${index}: ${reason}`);
  },

  // Called when resuming from checkpoint
  onResume: (checkpoint, tokenCount) => {
    console.log(`Resuming from checkpoint (${tokenCount} tokens)`);
  },

  // Called when a checkpoint is saved
  onCheckpoint: (checkpoint, tokenCount) => {
    console.log(`Checkpoint saved (${tokenCount} tokens)`);
  },

  // Called when a timeout occurs
  onTimeout: (type, elapsedMs) => {
    console.log(`Timeout: ${type} after ${elapsedMs}ms`);
  },

  // Called when the stream is aborted
  onAbort: (tokenCount, contentLength) => {
    console.log(`Aborted after ${tokenCount} tokens (${contentLength} chars)`);
  },

  // Called when drift is detected
  onDrift: (types, confidence) => {
    console.log(
      `Drift detected: ${types.join(", ")} (confidence: ${confidence})`,
    );
  },

  // Called when a tool call is detected
  onToolCall: (toolName, toolCallId, args) => {
    console.log(`Tool call: ${toolName} (${toolCallId})`);
    console.log(`  Args: ${JSON.stringify(args)}`);
  },
});
```

## Deterministic Lifecycle Flow

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

| Callback       | When Called                            | Signature                                                                       |
| -------------- | -------------------------------------- | ------------------------------------------------------------------------------- |
| `onStart`      | New execution attempt begins           | `(attempt: number, isRetry: boolean, isFallback: boolean) => void`              |
| `onComplete`   | Stream finished successfully           | `(state: L0State) => void`                                                      |
| `onError`      | Error occurred (before retry decision) | `(error: Error, willRetry: boolean, willFallback: boolean) => void`             |
| `onEvent`      | Any streaming event emitted            | `(event: L0Event) => void`                                                      |
| `onViolation`  | Guardrail violation detected           | `(violation: GuardrailViolation) => void`                                       |
| `onRetry`      | Retry triggered (same model)           | `(attempt: number, reason: string) => void`                                     |
| `onFallback`   | Switching to fallback model            | `(index: number, reason: string) => void`                                       |
| `onResume`     | Continuing from checkpoint             | `(checkpoint: string, tokenCount: number) => void`                              |
| `onCheckpoint` | Checkpoint saved                       | `(checkpoint: string, tokenCount: number) => void`                              |
| `onTimeout`    | Timeout occurred                       | `(type: "initial" \| "inter", elapsedMs: number) => void`                       |
| `onAbort`      | Stream aborted                         | `(tokenCount: number, contentLength: number) => void`                           |
| `onDrift`      | Drift detected                         | `(types: string[], confidence?: number) => void`                                |
| `onToolCall`   | Tool call detected                     | `(toolName: string, toolCallId: string, args: Record<string, unknown>) => void` |

> **Note:** All callbacks are fire-and-forget. They execute via microtasks and never block the stream. Errors in callbacks are silently caught and do not affect stream processing.

> **Important:** The `onStart` callback is called for the initial attempt, retry attempts, and fallback attempts. Internally, `SESSION_START` is emitted once at session start, `ATTEMPT_START` is emitted for retries, and `FALLBACK_START` is emitted for fallbacks. All three events trigger the `onStart` callback.

### Use Cases

```typescript
const callbacks = {
  // Logging and debugging
  onStart: (attempt, isRetry) =>
    logger.info("stream.start", { attempt, isRetry }),
  onComplete: (state) =>
    logger.info("stream.complete", { tokens: state.tokenCount }),
  onError: (err) => logger.error("stream.failed", { error: err.message }),

  // Real-time UI updates
  onRetry: () => showRetryingIndicator(),
  onFallback: () => showFallbackNotice(),

  // Custom metrics collection
  onViolation: (v) => metrics.incrementCounter("violations", { rule: v.rule }),
  onTimeout: (type) => metrics.incrementCounter("timeouts", { type }),
};

// Use callbacks with l0
const { stream } = await l0({
  stream: () => streamText({ model, prompt }),
  ...callbacks,
});

// For real-time UI updates, use onEvent
for await (const event of stream) {
  if (event.type === "token") {
    appendToChat(event.value);
  }
}
```

See [API.md#lifecycle-callbacks](./API.md#lifecycle-callbacks) for complete callback type definitions.

---

## Observability Events

L0 emits structured lifecycle events for every phase of execution. These events enable replay, profiling, debugging, and supervision.

### Stream Initialization Events

```typescript
{
  type: ("SESSION_START", ts, sessionId);
} // anchor for entire session
{
  type: ("STREAM_INIT", ts, model, provider);
} // before contacting provider
{
  type: ("STREAM_READY", ts);
} // connection established, ready to emit
```

### Adapter Events

```typescript
{
  type: ("ADAPTER_WRAP_START", ts, streamType, adapterId?);
}
{
  type: ("ADAPTER_DETECTED", ts, adapterId);
}
{
  type: ("ADAPTER_WRAP_END", ts, adapterId);
}
```

### Timeout Events

```typescript
{
  type: ("TIMEOUT_START", ts, timeoutType, configuredMs);
} // timeoutType: initial|inter
{
  type: ("TIMEOUT_RESET", ts, timeoutType, configuredMs, tokenIndex);
} // timer reset on token
{
  type: ("TIMEOUT_TRIGGERED", ts, timeoutType, elapsedMs, configuredMs);
} // before error event
```

### Network Events

```typescript
{
  type: ("NETWORK_ERROR", ts, error, code, willRetry);
}
{
  type: ("NETWORK_RECOVERY", ts, attemptCount, durationMs);
}
{
  type: ("CONNECTION_DROPPED", ts, reason);
}
{
  type: ("CONNECTION_RESTORED", ts, durationMs);
}
```

### Abort Events

```typescript
{
  type: ("ABORT_REQUESTED", ts, source);
} // source: user|timeout|error
{
  type: ("ABORT_COMPLETED", ts, resourcesFreed);
}
```

### Tool Events

```typescript
// Model requests tool execution
{ type: "TOOL_REQUESTED", ts, toolName, arguments, toolCallId, context? }
{ type: "TOOL_START", ts, toolCallId, toolName }
{ type: "TOOL_RESULT", ts, toolCallId, result, durationMs, context? }
{ type: "TOOL_ERROR", ts, toolCallId, error, durationMs, context? }
{ type: "TOOL_COMPLETED", ts, toolCallId, status }  // status: success|error
```

### Guardrail Events

```typescript
// Phase boundary events
{ type: "GUARDRAIL_PHASE_START", ts, phase, ruleCount }  // phase: pre|post
{ type: "GUARDRAIL_PHASE_END", ts, phase, passed, violations, durationMs }

// Per-rule lifecycle
{ type: "GUARDRAIL_RULE_START", ts, index, ruleId, callbackId }
{ type: "GUARDRAIL_RULE_RESULT", ts, index, ruleId, passed, violation? }
{ type: "GUARDRAIL_RULE_END", ts, index, ruleId, passed, callbackId, durationMs }

// Callback lifecycle (for async/external guardrails)
{ type: "GUARDRAIL_CALLBACK_START", ts, callbackId, index, ruleId }
{ type: "GUARDRAIL_CALLBACK_END", ts, callbackId, index, ruleId, durationMs, success, error? }
```

### Drift Events

```typescript
{
  type: ("DRIFT_CHECK_START", ts, checkpoint, tokenCount, strategy);
}
{
  type: ("DRIFT_CHECK_RESULT", ts, detected, score, metrics, threshold);
}
{
  type: ("DRIFT_CHECK_END", ts, durationMs);
}
{
  type: ("DRIFT_CHECK_SKIPPED", ts, reason);
} // when drift disabled
```

### Checkpoint Events

```typescript
{
  type: ("CHECKPOINT_SAVED", ts, checkpoint, tokenCount);
}
```

### Resume Events

```typescript
{
  type: ("RESUME_START", ts, checkpoint, stateHash, tokenCount);
}
{
  type: ("RESUME_END", ts, checkpoint, durationMs, success);
}
```

### Retry Events

```typescript
{
  type: ("RETRY_START", ts, attempt, maxAttempts);
}
{
  type: ("RETRY_ATTEMPT",
    ts,
    index,
    reason,
    countsTowardLimit,
    isNetwork,
    isModelIssue);
}
{
  type: ("RETRY_END", ts, attempt, success, durationMs);
}
{
  type: ("RETRY_GIVE_UP", ts, attempts, lastError);
} // exhausted
```

### Fallback Events

```typescript
{
  type: ("FALLBACK_START", ts, from, to, reason);
}
{
  type: ("FALLBACK_MODEL_SELECTED", ts, index, model);
}
{
  type: ("FALLBACK_END", ts, index, durationMs);
}
```

### Completion Events

```typescript
{
  type: ("FINALIZATION_START", ts);
} // tokens done, closing session
{
  type: ("FINALIZATION_END", ts, durationMs);
} // all workers closed

// Final session summary for replay
{
  type: ("SESSION_SUMMARY",
    ts,
    tokenCount,
    startTs,
    endTs,
    driftDetected,
    guardrailViolations,
    fallbackDepth,
    retryCount,
    checkpointsCreated);
}

{
  type: ("SESSION_END", ts);
} // hard end-of-stream marker
```

### Consensus Events

```typescript
{
  type: ("CONSENSUS_START", ts);
}

// Per-stream lifecycle
{
  type: ("CONSENSUS_STREAM_START", ts, streamIndex, model);
}
{
  type: ("CONSENSUS_STREAM_END", ts, streamIndex, durationMs, status);
}
{
  type: ("CONSENSUS_OUTPUT_COLLECTED", ts, streamIndex, length, hasErrors);
}

// Analysis and resolution
{
  type: ("CONSENSUS_ANALYSIS",
    ts,
    agreementRatio,
    disagreements,
    strategy,
    similarityMatrix,
    averageSimilarity);
}
{
  type: ("CONSENSUS_RESOLUTION", ts, method, finalSelection, confidence);
} // method: vote|merge|best|fail

{
  type: ("CONSENSUS_END", ts, status, confidence, durationMs);
}
```

### Structured Output Events

```typescript
// Parsing lifecycle
{ type: "PARSE_START", ts, contentLength }
{ type: "PARSE_END", ts, success, durationMs }
{ type: "PARSE_ERROR", ts, error, position }

// Schema validation
{ type: "SCHEMA_VALIDATION_START", ts, schemaType }  // zod|effect|json-schema
{ type: "SCHEMA_VALIDATION_END", ts, valid, errors?, durationMs }

// Auto-correction
{ type: "AUTO_CORRECT_START", ts, issues }
{ type: "AUTO_CORRECT_END", ts, corrected, changes, durationMs }
```

### Continuation Events

```typescript
{
  type: ("CONTINUATION_START", ts, checkpoint, tokenCount);
}
{
  type: ("RESUME_START", ts, checkpoint, tokenCount);
}
```

### Event Reference

| Phase        | Events                                                                   | Purpose                        |
| ------------ | ------------------------------------------------------------------------ | ------------------------------ |
| Session      | `SESSION_START` → `STREAM_INIT` → `STREAM_READY`                         | Stream initialization          |
| Adapter      | `ADAPTER_WRAP_START` → `ADAPTER_DETECTED` → `ADAPTER_WRAP_END`           | Provider detection, transforms |
| Timeout      | `TIMEOUT_START` → `TIMEOUT_RESET` / `TIMEOUT_TRIGGERED`                  | Timer lifecycle                |
| Abort        | `ABORT_REQUESTED` → `ABORT_COMPLETED`                                    | Cancellation lifecycle         |
| Tool         | `TOOL_REQUESTED` → `TOOL_START` → `TOOL_RESULT/ERROR` → `TOOL_COMPLETED` | Tool execution lifecycle       |
| Guardrail    | `PHASE_START` → `RULE_START` → `RULE_RESULT` → `RULE_END` → `PHASE_END`  | Per-rule timing, callbacks     |
| Checkpoint   | `CHECKPOINT_SAVED`                                                       | State persistence              |
| Continuation | `CONTINUATION_START` → `RESUME_START`                                    | Resume from checkpoint         |
| Retry        | `RETRY_START` → `RETRY_ATTEMPT` → `RETRY_END` / `RETRY_GIVE_UP`          | Retry loop observability       |
| Fallback     | `FALLBACK_START` → `FALLBACK_MODEL_SELECTED` → `FALLBACK_END`            | Model switching lifecycle      |
| Structured   | `PARSE_*` → `SCHEMA_VALIDATION_*` → `AUTO_CORRECT_*`                     | Schema validation, repair      |
| Consensus    | `START` → `STREAM_*` → `ANALYSIS` → `RESOLUTION` → `END`                 | Multi-model coordination       |
| Completion   | `COMPLETE` / `ERROR` → `SESSION_END`                                     | Clean shutdown                 |

See [EVENT_SOURCING.md](./EVENT_SOURCING.md) for recording and replay.

---

## Event Sourcing

Every L0 stream operation can be recorded and replayed deterministically. This enables testing, debugging, and audit trails.

```typescript
import {
  createInMemoryEventStore,
  createEventRecorder,
  replay,
} from "reliable-ai-streams";

// Record a stream
const store = createInMemoryEventStore();
const recorder = createEventRecorder(store, "my-stream");

await recorder.recordStart({ prompt: "test", model: "gpt-4" });
await recorder.recordToken("Hello", 0);
await recorder.recordToken(" World", 1);
await recorder.recordComplete("Hello World", 2);

// Replay it - exact same output, no API calls
const result = await replay({
  streamId: "my-stream",
  eventStore: store,
  fireCallbacks: true, // Replay callbacks fire
});

for await (const event of result.stream) {
  console.log(event); // Same events as original
}
```

**Key insight:** Replay is pure stream rehydration. No network, no retries, no guardrail evaluation - derived computations are stored as events.

**Use cases:**

- Deterministic testing - record once, replay in tests
- Production failure reproduction
- Time-travel debugging
- Complete audit trails
- Response caching

See [EVENT_SOURCING.md](./EVENT_SOURCING.md) for complete guide.

---

## Error Handling

L0 provides detailed error context for debugging and recovery:

```typescript
import { isL0Error, L0Error } from "reliable-ai-streams";

try {
  await l0({ stream, guardrails });
} catch (error) {
  if (isL0Error(error)) {
    console.log(error.code); // "GUARDRAIL_VIOLATION", "ZERO_OUTPUT", etc.
    console.log(error.getCheckpoint()); // Last good content for continuation
    console.log(error.context.tokenCount); // Tokens before failure
    console.log(error.hasCheckpoint); // Has checkpoint for continuation?
  }
}
```

Error codes: `STREAM_ABORTED`, `INITIAL_TOKEN_TIMEOUT`, `INTER_TOKEN_TIMEOUT`, `ZERO_OUTPUT`, `GUARDRAIL_VIOLATION`, `FATAL_GUARDRAIL_VIOLATION`, `INVALID_STREAM`, `ALL_STREAMS_EXHAUSTED`, `NETWORK_ERROR`, `DRIFT_DETECTED`

### Error Events

Error events include structured failure and recovery information:

```typescript
import { EventType, type ErrorEvent } from "reliable-ai-streams";

const result = await l0({
  stream: () => streamText({ model, prompt }),
  onEvent: (event) => {
    if (event.type === EventType.ERROR) {
      const e = event as ErrorEvent;
      console.log(e.failureType); // "network" | "model" | "timeout" | "abort" | "zero_output" | "tool" | "unknown"
      console.log(e.recoveryStrategy); // "retry" | "fallback" | "halt"
      console.log(e.policy); // { retryEnabled, fallbackEnabled, maxRetries, attempt, ... }
    }
  },
});
```

See [ERROR_HANDLING.md](./ERROR_HANDLING.md) for complete error handling guide.

---

## Monitoring

Built-in observability via the unified `onEvent` pipeline. All monitoring integrations (OpenTelemetry, Sentry, custom loggers) subscribe to events - no interceptors needed.

### Basic Usage

```typescript
import * as Sentry from "@sentry/node";
import { trace, metrics } from "@opentelemetry/api";
import {
  l0,
  combineEvents,
  createOpenTelemetryHandler,
  createSentryHandler,
} from "reliable-ai-streams";

const result = await l0({
  stream: () => streamText({ model, prompt }),
  onEvent: combineEvents(
    createOpenTelemetryHandler({
      tracer: trace.getTracer("my-app"),
      meter: metrics.getMeter("my-app"),
    }),
    createSentryHandler({ sentry: Sentry }),
    (event) => console.log(event.type), // custom handler
  ),
});
```

### Sentry

```typescript
import * as Sentry from "@sentry/node";
import { l0, createSentryHandler } from "reliable-ai-streams";

const result = await l0({
  stream: () => streamText({ model, prompt }),
  onEvent: createSentryHandler({ sentry: Sentry }),
});
```

**Tracks:** Breadcrumbs for all events, network errors, guardrail violations, performance transactions with TTFT and token count.

### OpenTelemetry

```typescript
import { trace, metrics } from "@opentelemetry/api";
import { l0, createOpenTelemetryHandler } from "reliable-ai-streams";

const result = await l0({
  stream: () => streamText({ model, prompt }),
  onEvent: createOpenTelemetryHandler({
    tracer: trace.getTracer("my-app"),
    meter: metrics.getMeter("my-app"),
  }),
});
```

**Metrics:** `l0.requests`, `l0.tokens`, `l0.retries`, `l0.errors`, `l0.duration`, `l0.time_to_first_token`, `l0.active_streams`

**Span attributes:** Follows [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) with `gen_ai.*` and `l0.*` attributes.

### Event Handler Utilities

```typescript
import {
  EventType,
  combineEvents,
  filterEvents,
  excludeEvents,
} from "reliable-ai-streams";

// Combine multiple handlers
onEvent: combineEvents(handler1, handler2, handler3);

// Filter to specific events
onEvent: filterEvents([EventType.ERROR, EventType.RETRY_ATTEMPT], errorHandler);

// Exclude noisy events
onEvent: excludeEvents([EventType.TOKEN], logHandler);
```

See [MONITORING.md](./MONITORING.md) for complete integration guides.

---

## Testing

L0 ships with **comprehensive test coverage** across all core reliability systems - including streaming, guardrails, structured output, retry logic, fallbacks, pipelines, consensus, observability, and distributed tracing.

### Test Coverage

| Category          | Tests  | Description                      |
| ----------------- | ------ | -------------------------------- |
| Unit Tests        | 3,000+ | Fast, mocked, no API calls       |
| Integration Tests | 250+   | Real API calls, all SDK adapters |

```bash
# Run unit tests (fast, no API keys needed)
npm test

# Run integration tests (requires API keys)
OPENAI_API_KEY=sk-... ANTHROPIC_API_KEY=sk-... npm run test:integration
```

### SDK Adapter Matrix

L0 supports all major provider SDKs with full end-to-end testing:

| Adapter           | Integration | Version Range                  |
| ----------------- | ----------- | ------------------------------ |
| **Vercel AI SDK** | ✓           | `^5.0.0` · `^6.0.0`            |
| **OpenAI SDK**    | ✓           | `^4.0.0` · `^5.0.0` · `^6.0.0` |
| **Mastra AI**     | ✓           | `>= 0.24.0`                    |

### Feature Test Matrix

Every major reliability feature in L0 has dedicated test suites:

| Feature               | Unit | Integration | Notes                                    |
| --------------------- | ---- | ----------- | ---------------------------------------- |
| **Streaming**         | ✓    | ✓           | Token events, completion                 |
| **Guardrails**        | ✓    | ✓           | JSON/Markdown/LaTeX, patterns, drift     |
| **Structured Output** | ✓    | ✓           | Zod schemas, auto-correction             |
| **Retry Logic**       | ✓    | ✓           | Backoff, error classification            |
| **Network Errors**    | ✓    | –           | 12+ simulated error types                |
| **Fallback Models**   | ✓    | ✓           | Sequential fallthrough                   |
| **Parallel / Race**   | ✓    | ✓           | Concurrency, cancellation                |
| **Pipeline**          | ✓    | ✓           | Multi-step streaming workflows           |
| **Consensus**         | ✓    | ✓           | Unanimous, weighted, best-match          |
| **Document Windows**  | ✓    | ✓           | Token, paragraph, sentence chunking      |
| **Continuation**      | ✓    | ✓           | Last-known-good token resumption         |
| **Monitoring**        | ✓    | ✓           | OTel, Sentry, metrics, tokens, retries   |
| **Sentry**            | ✓    | ✓           | Error tagging, breadcrumbs, performance  |
| **OpenTelemetry**     | ✓    | ✓           | GenAI semantic conventions, spans, TTFT  |
| **Event Sourcing**    | ✓    | ✓           | Record/replay, deterministic testing     |
| **Interceptors**      | ✓    | –           | All built-in interceptors validated      |
| **Drift Detection**   | ✓    | –           | Pattern detection, entropy, format drift |
| **Custom Adapters**   | ✓    | ✓           | OpenAI, Anthropic, Mastra adapters       |
| **Multimodal**        | ✓    | ✓           | Data/progress events, state tracking     |

---
