# L0 Quick Start Guide

Get started with L0 in 5 minutes.

## Installation

```bash
npm install reliable-ai-streams
```

**Optional peer dependencies:** Install the SDK(s) you use:

```bash
# For Vercel AI SDK
npm install ai @ai-sdk/openai

# For OpenAI SDK directly
npm install openai

# For Mastra AI
npm install @mastra/core
```

## Bundle Size

| Import                  | Size  | Gzipped | Description              |
| ----------------------- | ----- | ------- | ------------------------ |
| `reliable-ai-streams` (full)     | 191KB | 56KB    | Everything               |
| `reliable-ai-streams/core`       | 71KB  | 21KB    | Runtime + retry + errors |
| `reliable-ai-streams/guardrails` | 18KB  | 6KB     | Validation rules         |

Use subpath imports for smaller bundles.

## Basic Usage

```typescript
import { l0 } from "reliable-ai-streams/core";
import { recommendedGuardrails } from "reliable-ai-streams/guardrails";
import { recommendedRetry } from "reliable-ai-streams/core";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

const result = await l0({
  stream: () =>
    streamText({
      model: openai("gpt-4o"),
      prompt: "Write a haiku about coding",
    }),
  guardrails: recommendedGuardrails,
  retry: recommendedRetry,
});

for await (const event of result.stream) {
  if (event.type === "token") {
    process.stdout.write(event.value);
  }
}

console.log("\n\nTokens:", result.state.tokenCount);
```

You now have:

- Automatic retry on network failures (doesn't count toward retry limit)
- Guardrails detecting malformed output
- Zero-token detection
- Unified event format

---

## Common Patterns

### Structured Output (Guaranteed JSON)

```typescript
import { structured } from "reliable-ai-streams";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const schema = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string().email(),
});

const result = await structured({
  schema,
  stream: () =>
    streamText({
      model: openai("gpt-4o"),
      prompt: "Generate a user profile as JSON",
    }),
});

// Type-safe access
console.log(result.data.name); // string
console.log(result.data.age); // number
```

Also supports Effect Schema and JSON Schema - see [STRUCTURED_OUTPUT.md](./STRUCTURED_OUTPUT.md).

### Timeout Protection

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),

  // Optional timeout configuration
  timeout: {
    initialToken: 5000, // 5s to first token (default: 5000ms)
    interToken: 10000, // 10s between tokens (default: 10000ms)
  },

  // Optional guardrails
  guardrails: recommendedGuardrails,
});
```

**Note:** Free and low-priority models may take **3-7 seconds** before emitting the first token and **10+ seconds** between tokens.

### Fallback Models

```typescript
const result = await l0({
  stream: () => streamText({ model: openai("gpt-4o"), prompt }),
  fallbackStreams: [
    () => streamText({ model: openai("gpt-4o-mini"), prompt }),
    () => streamText({ model: anthropic("claude-3-haiku"), prompt }),
  ],
});

if (result.state.fallbackIndex > 0) {
  console.log("Used fallback model");
}
```

### Custom Guardrails

```typescript
import { customPatternRule, zeroOutputRule } from "reliable-ai-streams";

const result = await l0({
  stream: () => streamText({ model, prompt }),
  guardrails: [
    zeroOutputRule(),
    customPatternRule([/forbidden/i], "Contains forbidden word", "error"),
  ],
});
```

### Document Processing

```typescript
import { createWindow } from "reliable-ai-streams";

const window = createWindow(longDocument, {
  size: 2000,
  overlap: 200,
  strategy: "paragraph",
});

const results = await window.processAll((chunk) => ({
  stream: () =>
    streamText({
      model,
      prompt: `Summarize: ${chunk.content}`,
    }),
}));
```

### Error Handling

```typescript
import { isL0Error, isNetworkError } from "reliable-ai-streams";

try {
  const result = await l0({ stream, guardrails });
  for await (const event of result.stream) {
    // Process events
  }
} catch (error) {
  if (isL0Error(error)) {
    console.log("Error code:", error.code);
    console.log("Checkpoint:", error.getCheckpoint());
  } else if (isNetworkError(error)) {
    console.log("Network issue - will auto-retry");
  }
}
```

---

## Presets

### Guardrails

```typescript
import {
  minimalGuardrails, // JSON + zero output
  recommendedGuardrails, // + Markdown, patterns
  strictGuardrails, // + LaTeX
  jsonOnlyGuardrails, // JSON + zero output
  markdownOnlyGuardrails, // Markdown + zero output
  latexOnlyGuardrails, // LaTeX + zero output
} from "reliable-ai-streams/guardrails";
```

**Preset contents:**

| Preset       | Rules                                                          |
| ------------ | -------------------------------------------------------------- |
| minimal      | jsonRule, zeroOutputRule                                       |
| recommended  | jsonRule, markdownRule, zeroOutputRule, patternRule            |
| strict       | jsonRule, markdownRule, latexRule, patternRule, zeroOutputRule |
| jsonOnly     | jsonRule, zeroOutputRule                                       |
| markdownOnly | markdownRule, zeroOutputRule                                   |
| latexOnly    | latexRule, zeroOutputRule                                      |

### Retry

```typescript
import {
  minimalRetry, // 2 attempts, linear backoff
  recommendedRetry, // 3 attempts, fixed-jitter backoff
  strictRetry, // 3 attempts, full-jitter backoff
  exponentialRetry, // 4 attempts, exponential backoff
} from "reliable-ai-streams/core";
```

**Preset details:**

| Preset      | attempts | maxRetries | backoff      |
| ----------- | -------- | ---------- | ------------ |
| minimal     | 2        | 4          | linear       |
| recommended | 3        | 6          | fixed-jitter |
| strict      | 3        | 6          | full-jitter  |
| exponential | 4        | 8          | exponential  |

---

## Result State

After consuming the stream:

```typescript
console.log({
  content: result.state.content, // Full output
  tokenCount: result.state.tokenCount, // Token count
  completed: result.state.completed, // Stream finished
  modelRetryCount: result.state.modelRetryCount, // Model retries (counts toward limit)
  networkRetryCount: result.state.networkRetryCount, // Network retries (doesn't count)
  fallbackIndex: result.state.fallbackIndex, // Which stream was used (0 = primary)
  violations: result.state.violations, // Guardrail violations
});
```

---

## Monitoring

Enable built-in telemetry:

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  monitoring: {
    enabled: true,
    includeTimings: true,
    includeNetworkDetails: true,
  },
});

// After stream completes
console.log(result.telemetry);
// { sessionId, duration, metrics: { totalTokens, tokensPerSecond, ... }, ... }
```

---

## Next Steps

| Guide                                          | Description                  |
| ---------------------------------------------- | ---------------------------- |
| [API.md](./API.md)                             | Complete API reference       |
| [STRUCTURED_OUTPUT.md](./STRUCTURED_OUTPUT.md) | Guaranteed JSON with schemas |
| [DOCUMENT_WINDOWS.md](./DOCUMENT_WINDOWS.md)   | Processing long documents    |
| [NETWORK_ERRORS.md](./NETWORK_ERRORS.md)       | Network error handling       |
| [PERFORMANCE.md](./PERFORMANCE.md)             | Performance tuning           |
| [ERROR_HANDLING.md](./ERROR_HANDLING.md)       | Error codes and recovery     |
| [MONITORING.md](./MONITORING.md)               | Telemetry and observability  |
