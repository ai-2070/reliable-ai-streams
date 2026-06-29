> **Rename note:** This project was previously called L0. The package/repository is being renamed to reliable-ai-streams. Existing imports remain supported. Install: `npm install reliable-ai-streams`

# L0 - Deterministic Streaming Execution Substrate (DSES) for AI

### The missing reliability and observability layer for all AI streams.

![L0: The Missing AI Reliability Substrate](img/l0-banner.jpg)

<p align="center">
  <a href="https://www.npmjs.com/package/@ai2070/l0">
    <img src="https://img.shields.io/npm/v/@ai2070/l0?color=brightgreen&label=npm" alt="npm version">
  </a>
  <a href="https://bundlephobia.com/package/@ai2070/l0">
    <img src="https://img.shields.io/bundlephobia/minzip/@ai2070/l0?label=minzipped" alt="minzipped size">
  </a>
  <a href="https://packagephobia.com/result?p=@ai2070/l0">
    <img src="https://packagephobia.com/badge?p=@ai2070/l0" alt="install size">
  </a>
  <img src="https://img.shields.io/badge/types-included-blue?logo=typescript&logoColor=white" alt="Types Included">
  <a href="https://github.com/ai-2070/l0/actions">
    <img src="https://img.shields.io/github/actions/workflow/status/ai-2070/l0/ci.yml?label=tests" alt="CI status">
  </a>
  <img src="https://img.shields.io/badge/license-Apache_2.0-green" alt="Apache 2.0 License">
</p>

> LLMs produce high-value reasoning over a low-integrity transport layer.
> Streams stall, drop tokens, reorder events, violate timing guarantees, and expose no deterministic contract.
>
> This breaks retries. It breaks supervision. It breaks reproducibility.
> It makes reliable AI systems impossible to build on top of raw provider streams.
>
> **L0 is the deterministic execution substrate that fixes the transport - with guardrails designed specifically for the streaming layer: stream-neutral, pattern-based, loop-safe, and timing-aware.**
>
> **The result: production-grade, integrity-preserving, deterministic AI streams you can finally build real systems on.**

It works with **OpenAI**, **Vercel AI SDK**, **Mastra AI**, and **custom adapters**. Supports **multimodal streams**, tool calls, and provides full deterministic replay.

```bash
npm install @ai2070/l0
```

**Also available in Python:** [@ai-2070/l0-python](https://github.com/ai-2070/l0-python) `uv add ai2070-l0` - native implementation with full lifecycle and event signature parity.

_Production-grade reliability. Just pass your stream. L0'll take it from here._

L0 includes 3,000+ tests covering all major reliability features.

```
   Any AI Stream                    L0 Layer                         Your App
 ─────────────────    ┌──────────────────────────────────────┐    ─────────────
                      │                                      │
   Vercel AI SDK      │   Retry · Fallback · Resume          │      Reliable
   OpenAI / Mastra ──▶│   Guardrails · Timeouts · Consensus  │─────▶ Output
   Custom Streams     │   Full Observability                 │
                      │                                      │
                      └──────────────────────────────────────┘
 ─────────────────                                                ─────────────
  text / image /           L0 = Token-Level Reliability
  video / audio
```

**Upcoming versions:**

- **1.0.0** - API freeze

## Features

| Feature                                          | Description                                                                                                                                                                                                                 |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **🔁 Smart Retries**                             | Model-aware retries with fixed-jitter backoff. Automatic retries for zero-token output, network stalls, SSE disconnects, and provider overloads.                                                                            |
| **🌐 Network Protection**                        | Automatic recovery from dropped streams, slow responses, backgrounding, 429/503 load shedding, DNS errors, and partial chunks.                                                                                              |
| **🔀 Model Fallbacks**                           | Automatically fallback to secondary models (e.g., 4o → 4o-mini → Claude/Gemini) with full retry logic.                                                                                                                      |
| **💥 Zero-Token/Stall Protection**               | Detects when model produces nothing or stalls mid-stream. Automatically retries or switches to fallbacks.                                                                                                                   |
| 📍 **Last-Known-Good Token Resumption**          | When a stream interrupts, L0 resumes generation from the last structurally valid token (Opt-in).                                                                                                                            |
| **🧠 Drift Detection**                           | Detects tone shifts, duplicated sentences, entropy spikes, markdown collapse, and meta-AI patterns before corruption.                                                                                                       |
| **🧱 Structured Output**                         | Guaranteed-valid JSON with Zod (v3/v4), Effect Schema, or JSON Schema. Auto-corrects missing braces, commas, and markdown fences.                                                                                           |
| **🩹 JSON Auto-Healing + Markdown Fence Repair** | Automatic correction of truncated or malformed JSON (missing braces, brackets, quotes), and repair of broken Markdown code fences. Ensures clean extraction of structured data from noisy LLM output.                       |
| **🛡️ Guardrails**                                | JSON, Markdown, LaTeX, and pattern validation with fast/slow path execution. Delta-only checks run sync; full-content scans defer to async to never block streaming.                                                        |
| **⚡ Race: Fastest-Model Wins**                  | Run multiple models or providers in parallel and return the fastest valid stream. Ideal for ultra-low-latency chat and high-availability systems.                                                                           |
| **🌿 Parallel: Fan-Out / Fan-In**                | Start multiple streams simultaneously and collect structured or summarized results. Perfect for agent-style multi-model workflows.                                                                                          |
| **🔗 Pipe: Streaming Pipelines**                 | Compose multiple streaming steps (e.g., summarize → refine → translate) with safe state passing and guardrails between each stage.                                                                                          |
| **🧩 Consensus: Agreement Across Models**        | Combine multiple model outputs using unanimous, weighted, or best-match consensus. Guarantees high-confidence generation for safety-critical tasks.                                                                         |
| **📄 Document Windows**                          | Built-in chunking (token, paragraph, sentence, character). Ideal for long documents, transcripts, or multi-page processing.                                                                                                 |
| **🎨 Formatting Helpers**                        | Extract JSON/code from markdown fences, strip thinking tags, normalize whitespace, and clean LLM output for downstream processing.                                                                                          |
| **📊 Monitoring**                                | Built-in integrations with OpenTelemetry and Sentry for metrics, tracing, and error tracking.                                                                                                                               |
| **🔔 Lifecycle Callbacks**                       | `onStart`, `onToken`, `onEvent`, `onCheckpoint`, `onViolation`, `onDrift`, `onTimeout`, `onRetry`, `onFallback`, `onResume`, `onToolCall`, `onAbort`, `onError`, `onComplete` - full observability into every stream phase. |
| **📡 Streaming-First Runtime**                   | Thin, deterministic wrapper over `streamText()` with unified event types (`token`, `error`, `complete`) for easy UIs.                                                                                                       |
| **📼 Atomic Event Logs**                         | Record every token, retry, fallback, and guardrail check as immutable events. Full audit trail for debugging and compliance.                                                                                                |
| **🔄 Byte-for-Byte Replays**                     | Deterministically replay any recorded stream to reproduce exact output. Perfect for testing, and time-travel debugging.                                                                                                     |
| **⛔ Safety-First Defaults**                     | Continuation off by default. Structured objects never resumed. No silent corruption. Integrity always preserved.                                                                                                            |
| **⚡ Tiny & Explicit**                           | 21KB gzipped core. Tree-shakeable with subpath exports (`/core`, `/structured`, `/consensus`, `/parallel`, `/window`). No frameworks, no heavy abstractions.                                                                |
| **🔌 Custom Adapters (BYOA)**                    | Bring your own adapter for any LLM provider. Built-in adapters for Vercel AI SDK, OpenAI, and Mastra.                                                                                                                       |
| **🖼️ Multimodal Support**                        | Build adapters for image/audio/video generation (FLUX.2, Stable Diffusion, Veo 3, CSM). Progress tracking, data events, and state management for non-text outputs.                                                          |
| **🚀 Nvidia Blackwell-Ready**                    | Optimized for 1000+ tokens/s streaming. Ready for next-gen GPU inference speeds.                                                                                                                                            |
| **🧪 Battle-Tested**                             | 3,000+ unit tests and 250+ integration tests validating real streaming, retries, and advanced behavior.                                                                                                                     |

> **Know what you're doing?** [Skip the tutorial](./ADVANCED.md)

## Quick Start

### With Vercel AI SDK: Minimal Usage

```typescript
import { l0, recommendedGuardrails, recommendedRetry } from "@ai2070/l0";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

const result = await l0({
  // Primary model stream
  stream: () =>
    streamText({
      model: openai("gpt-5-mini"),
      prompt,
    }),
});

// Read the stream
for await (const event of result.stream) {
  if (event.type === "token") process.stdout.write(event.value);
}
```

### Vercel AI SDK: With Reliability

```typescript
import { l0, recommendedGuardrails, recommendedRetry } from "@ai2070/l0";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

const result = await l0({
  stream: () => streamText({ model: openai("gpt-4o"), prompt }),
  fallbackStreams: [() => streamText({ model: openai("gpt-4o-mini"), prompt })],

  // Optional: Content-agnostic, text-based guardrails
  guardrails: recommendedGuardrails,

  // Optional: Retry configuration, default as follows
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

  // Optional: Timeout configuration, default as follows
  timeout: {
    initialToken: 5000, // 5s to first token
    interToken: 10000, // 10s between tokens
  },

  onError: (error, willRetry) => console.log(`Error: ${error.message}`),
});

for await (const event of result.stream) {
  if (event.type === "token") process.stdout.write(event.value);
}
```

**See Also: [API.md](./API.md) for all options, [ADVANCED.md](./ADVANCED.md) for full examples**

### With OpenAI SDK

```typescript
import OpenAI from "openai";
import { l0, openaiStream, recommendedGuardrails } from "@ai2070/l0";

const openai = new OpenAI();

const result = await l0({
  stream: openaiStream(openai, {
    model: "gpt-4o",
    messages: [{ role: "user", content: "Generate a haiku about coding" }],
  }),
  guardrails: recommendedGuardrails,
});

for await (const event of result.stream) {
  if (event.type === "token") process.stdout.write(event.value);
}
```

### With Mastra AI

```typescript
import { Agent } from "@mastra/core/agent";
import { l0, mastraStream, recommendedGuardrails } from "@ai2070/l0";

const agent = new Agent({
  name: "haiku-writer",
  instructions: "You are a poet who writes haikus",
  model: "openai/gpt-4o",
});

const result = await l0({
  stream: mastraStream(agent, "Generate a haiku about coding"),
  guardrails: recommendedGuardrails,
});

for await (const event of result.stream) {
  if (event.type === "token") process.stdout.write(event.value);
}
```

### Structured Output with Zod

```typescript
import { structured } from "@ai2070/l0";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const schema = z.object({
  name: z.string(),
  age: z.number(),
  occupation: z.string(),
});

const result = await structured({
  schema,
  stream: () =>
    streamText({
      model: openai("gpt-4o-mini"),
      prompt:
        "Generate a fictional person as JSON with name, age, and occupation",
    }),
  autoCorrect: true, // Fix trailing commas, missing braces, markdown fences
});

console.log(result.data); // { name: "Alice", age: 32, occupation: "Engineer" }
```

### Lifecycle Events

```typescript
import { l0 } from "@ai2070/l0";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

const result = await l0({
  stream: () => streamText({ model: openai("gpt-4o"), prompt }),

  onEvent: (event) => {
    if (event.type === "token") process.stdout.write(event.value || "");
    if (event.type === "error") console.error("Error:", event.error);
    if (event.type === "complete") console.log("\nDone!");
  },
});

for await (const _ of result.stream) {
  // Events already handled by onEvent
}
```

### Fallback Models & Providers

```typescript
import { l0 } from "@ai2070/l0";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";

const result = await l0({
  // Primary model
  stream: () => streamText({ model: openai("gpt-4o"), prompt }),

  // Fallbacks: tried in order if primary fails (supports both model and provider fallbacks)
  fallbackStreams: [
    () => streamText({ model: openai("gpt-4o-mini"), prompt }),
    () => streamText({ model: anthropic("claude-sonnet-4-20250514"), prompt }),
  ],

  onFallback: (index, reason) => console.log(`Switched to fallback ${index}`),
});
```

### Parallel Execution

```typescript
import { parallel } from "@ai2070/l0";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

const prompts = ["Name a fruit", "Name a color", "Name an animal"];

const results = await parallel(
  prompts.map((prompt) => ({
    stream: () => streamText({ model: openai("gpt-4o-mini"), prompt }),
  })),
  { concurrency: 3 },
);

results.results.forEach((r, i) => {
  console.log(`${prompts[i]}: ${r?.state.content.trim()}`);
});
```

### Pipe: Streaming Pipelines

```typescript
import { pipe } from "@ai2070/l0";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

const result = await pipe(
  [
    {
      name: "summarize",
      fn: (input) => ({
        stream: () =>
          streamText({
            model: openai("gpt-4o"),
            prompt: `Summarize: ${input}`,
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
  ],
  longDocument,
);

console.log(result.output); // French translation of summary
```

## Philosophy

- **No magic** - Everything is explicit and predictable
- **Streaming-first** - Built for real-time token delivery
- **Signals, not rewrites** - Guardrails detect issues, don't modify output
- **Model-agnostic** - Works with any model
- **Zero dependencies** - Only (optional) peer dependency is the Vercel AI SDK, the OpenAI SDK, or Mastra AI

---

**Bundle sizes (minified):**

| Import                  | Size  | Gzipped | Description              |
| ----------------------- | ----- | ------- | ------------------------ |
| `@ai2070/l0` (full)     | 191KB | 56KB    | Everything               |
| `@ai2070/l0/core`       | 71KB  | 21KB    | Runtime + retry + errors |
| `@ai2070/l0/structured` | 61KB  | 18KB    | Structured output        |
| `@ai2070/l0/consensus`  | 72KB  | 21KB    | Multi-model consensus    |
| `@ai2070/l0/parallel`   | 58KB  | 17KB    | Parallel/race operations |
| `@ai2070/l0/window`     | 62KB  | 18KB    | Document chunking        |
| `@ai2070/l0/guardrails` | 18KB  | 6KB     | Validation rules         |
| `@ai2070/l0/monitoring` | 27KB  | 7KB     | OTel/Sentry              |
| `@ai2070/l0/drift`      | 4KB   | 2KB     | Drift detection          |
| `@ai2070/l0/zod`        | 12KB  | 4KB     | Zod 4 validation schemas |

Dependency-free. Tree-shakeable subpath exports for minimal bundles.

> Most applications should simply use `import { l0 } from "@ai2070/l0"`.
> Only optimize imports if you're targeting edge runtimes or strict bundle constraints.

### Zod Validation Schemas

L0 exports Zod 4 schemas for runtime validation of all L0 types:

```typescript
import {
  L0StateSchema,
  L0EventSchema,
  GuardrailViolationSchema,
} from "@ai2070/l0/zod";

// Validate runtime data
const state = L0StateSchema.parse(unknownData);

// Type-safe validation
const result = L0EventSchema.safeParse(event);
if (result.success) {
  console.log(result.data.type);
}
```

Schemas are available for all core types: `L0State`, `L0Event`, `L0Telemetry`, `RetryOptions`, `GuardrailViolation`, `ConsensusResult`, `PipelineResult`, and more.

## Performance

Benchmarks on Apple M1 Max, Node.js 24, zero-delay mock streams (2000 tokens):

| Scenario                 | Tokens/s    | Avg Duration | TTFT        |
| ------------------------ | ----------- | ------------ | ----------- |
| Baseline (raw streaming) | 4,459,021   | 0.45 ms      | 0.00 ms     |
| L0 Core (no features)    | 1,068,683   | 1.87 ms      | 0.04 ms     |
| L0 + JSON Guardrail      | 615,031     | 3.28 ms      | 0.20 ms     |
| L0 + All Guardrails      | 337,174     | 5.93 ms      | 0.08 ms     |
| L0 + Drift Detection     | 609,546     | 3.37 ms      | 0.07 ms     |
| **L0 Full Stack**        | **259,478** | **7.73 ms**  | **0.08 ms** |

Full stack = JSON + Markdown + zero-output guardrails + drift detection + checkpointing. See [BENCHMARKS.md](./BENCHMARKS.md) for details.

## Documentation

| Guide                                                          | Description                   |
| -------------------------------------------------------------- | ----------------------------- |
| [ADVANCED.md](./ADVANCED.md)                                   | Advanced usage                |
| [QUICKSTART.md](./QUICKSTART.md)                               | 5-minute getting started      |
| [API.md](./API.md)                                             | Complete API reference        |
| [GUARDRAILS.md](./GUARDRAILS.md)                               | Guardrails and validation     |
| [STRUCTURED_OUTPUT.md](./STRUCTURED_OUTPUT.md)                 | Structured output guide       |
| [CONSENSUS.md](./CONSENSUS.md)                                 | Multi-generation consensus    |
| [DOCUMENT_WINDOWS.md](./DOCUMENT_WINDOWS.md)                   | Document chunking guide       |
| [NETWORK_ERRORS.md](./NETWORK_ERRORS.md)                       | Network error handling        |
| [ERROR_HANDLING.md](./ERROR_HANDLING.md)                       | Error handling guide          |
| [PERFORMANCE.md](./PERFORMANCE.md)                             | Performance tuning            |
| [INTERCEPTORS_AND_PARALLEL.md](./INTERCEPTORS_AND_PARALLEL.md) | Interceptors and parallel ops |
| [MONITORING.md](./MONITORING.md)                               | Telemetry and metrics         |
| [EVENT_SOURCING.md](./EVENT_SOURCING.md)                       | Record/replay, audit trails   |
| [FORMATTING.md](./FORMATTING.md)                               | Formatting helpers            |
| [CUSTOM_ADAPTERS.md](./CUSTOM_ADAPTERS.md)                     | Build your own adapters       |
| [MULTIMODAL.md](./MULTIMODAL.md)                               | Image/audio/video support     |
| [DETERMINISTIC_LIFECYCLE.md](./DETERMINISTIC_LIFECYCLE.md)     | Lifecycle specification       |

---

## Support

L0 is developed and maintained independently. If your company depends on L0 or wants to support ongoing development (including the Python version, website docs, and future tooling), feel free to reach out:

**makerseven7@gmail.com**

---

## License

Apache-2.0
