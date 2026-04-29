---
name: use-l0
description: "Build, debug, and review apps that use the L0 reliability layer (`@ai2070/l0`). TRIGGER when: a file imports `@ai2070/l0` or any subpath (`@ai2070/l0/core`, `/structured`, `/consensus`, `/parallel`, `/pipeline`, `/window`, `/guardrails`, `/drift`, `/monitoring`, `/openai`, `/anthropic`, `/mastra`, `/zod`, `/adapters/helpers`, `/utils/chunking`); the user asks for L0 retry/guardrail/drift/structured/consensus/pipeline/parallel/race wiring; the user references L0 events, lifecycle callbacks (`onRetry`, `onFallback`, `onDrift`, `onCheckpoint`, `onViolation`, etc.), or `L0Event`/`L0State`/`L0Result` types. SKIP for unrelated AI SDK code that doesn't touch L0."
---

# Use L0 effectively

L0 (`@ai2070/l0`) is a thin, deterministic wrapper around any LLM stream that adds retry, fallback, guardrails, drift detection, structured output, consensus, pipelines, parallel/race, and full event sourcing. It is **streaming-first** and **adapter-based** — it never owns model calls, it wraps them.

## Mental model

```
   model stream factory  ─▶  l0()  ─▶  result.stream  ─▶  for await (event)
        ^                     |
        |                     +─▶  result.state    (final L0State, after stream drains)
        |                     +─▶  result.telemetry
        |                     +─▶  result.errors
        +─ MUST be a thunk so L0 can re-invoke it on retry/fallback
```

L0 wraps **factories**, not streams. The single most common mistake is passing a stream object directly:

```ts
// WRONG — retries cannot recreate the stream
l0({ stream: streamText({ model, prompt }) });

// CORRECT — L0 can re-invoke this on retry/fallback
l0({ stream: () => streamText({ model, prompt }) });
```

The same rule applies to `fallbackStreams`, `consensus({ streams })`, `parallel`, `race`, and pipeline `fn`.

## Pick the right entry point

| You want to…                            | Use                                  | Import                        |
| --------------------------------------- | ------------------------------------ | ----------------------------- |
| Wrap a single stream with reliability   | `l0(opts)`                           | `@ai2070/l0` or `/core`       |
| Get guaranteed-valid JSON from a stream | `structured({ schema, stream })`     | `@ai2070/l0` or `/structured` |
| Combine N streams into one answer       | `consensus({ streams })`             | `@ai2070/l0` or `/consensus`  |
| Fan out N independent calls             | `parallel(items, opts)`              | `@ai2070/l0` or `/parallel`   |
| First valid stream wins                 | `race(items, opts)`                  | `@ai2070/l0` or `/parallel`   |
| Chain steps (summarize → translate)     | `pipe(steps, input)`                 | `@ai2070/l0` or `/pipeline`   |
| Process a long doc in chunks            | `processWithWindow` / `l0WithWindow` | `@ai2070/l0` or `/window`     |

`structured`, `consensus`, `parallel`, `pipe`, and the window helpers all build on `l0` — they accept the same `retry`, `guardrails`, `timeout`, `signal`, `monitoring` shape and re-emit the same lifecycle.

## Always prefer presets over hand-rolled config

L0 ships tested presets. Reach for them first; only customize when a preset clearly doesn't fit.

```ts
import {
  recommendedRetry,
  minimalRetry,
  strictRetry,
  exponentialRetry,
  recommendedGuardrails,
  minimalGuardrails,
  strictGuardrails,
  jsonOnlyGuardrails,
  markdownOnlyGuardrails,
  recommendedStructured,
  minimalStructured,
  strictStructured,
  standardConsensus,
  strictConsensus,
  lenientConsensus,
  bestConsensus,
  smallWindow,
  mediumWindow,
  largeWindow,
  paragraphWindow,
  sentenceWindow,
  fastPipeline,
  reliablePipeline,
  productionPipeline,
} from "@ai2070/l0";
```

Don't invent your own retry counts, backoff strategies, or guardrail lists if a preset name describes the intent.

## Adapter selection

| Source SDK           | How to wrap                                                       |
| -------------------- | ----------------------------------------------------------------- |
| Vercel AI SDK (`ai`) | Pass `() => streamText({...})` directly — auto-detected           |
| OpenAI SDK           | `openaiStream(client, { model, messages, ... })`                  |
| Anthropic SDK        | `anthropicStream(client, { model, messages, ... })`               |
| Mastra agent         | `mastraStream(agent, prompt)` / `mastraStructured(agent, schema)` |
| Anything else        | Build an adapter; see `CUSTOM_ADAPTERS.md` and `adapters/helpers` |

For custom adapters, use the helpers in `@ai2070/l0`: `toL0Events`, `createAdapterTokenEvent`, `createAdapterDoneEvent`, `createAdapterErrorEvent`. Register with `registerAdapter` (requires `enableAdapterRegistry()` first — see below).

## Optional features must be explicitly enabled

Several subsystems are tree-shaken out by default. If the user wants them, **call the enabler at app boot once**, then use the feature:

```ts
import {
  enableDriftDetection,
  enableMonitoring,
  enableInterceptors,
  enableAdapterRegistry,
} from "@ai2070/l0";
import { DriftDetector } from "@ai2070/l0/drift";

enableDriftDetection(() => new DriftDetector());
```

Forgetting the enabler is a silent no-op — the option is accepted but never fires. If a user reports "my `onDrift` never runs," check for a missing `enableDriftDetection`.

## Stream consumption

```ts
const result = await l0({ stream: () => streamText({ model, prompt }) });

for await (const event of result.stream) {
  if (event.type === "token") process.stdout.write(event.value);
  if (event.type === "error") console.error(event.error);
  if (event.type === "complete") break;
}

// After the loop drains, these are populated:
result.state.content; // final assembled text
result.state.tokenCount;
result.telemetry; // timing, retries, fallbacks
result.errors; // collected non-fatal errors
```

The runtime emits a richer observability event stream too (`L0ObservabilityEvent`) covering retries, fallbacks, guardrail phases, drift checks, checkpoints, etc. — wire it via `onEvent` or `EventDispatcher` if the user needs full audit telemetry. Use `getText(result)` if you only want the final string and don't care about tokens.

## Structured output

```ts
import { structured } from "@ai2070/l0";
import { z } from "zod";

const schema = z.object({ name: z.string(), age: z.number() });

const r = await structured({
  schema, // zod v3/v4 wired by default; see below for Effect/JSON Schema
  stream: () => streamText({ model, prompt }),
  autoCorrect: true, // fix trailing commas, missing braces, fences
  // strictMode: true,                        // disable best-effort repairs
});

r.data; // typed, validated parsed object
r.raw; // the assembled string before parse
(r.corrected, r.corrections); // what auto-correct did
```

For arrays use `structuredArray({ schema: z.array(item), ... })`; for streaming partial objects use `structuredStream`. Structured outputs intentionally **never resume mid-stream** (see "Continuation" below) — that's a safety guarantee, don't try to bypass it.

### Schema adapters (Zod works out of the box, others do not)

Zod v3 and v4 are detected automatically. **Effect Schema and JSON Schema must be registered once** before `structured()` will accept them — if you forget, the schema is treated as opaque and parsing silently falls back to unvalidated JSON:

```ts
import {
  registerEffectSchemaAdapter,
  registerJSONSchemaAdapter,
  createSimpleJSONSchemaAdapter,
} from "@ai2070/l0";

registerJSONSchemaAdapter(createSimpleJSONSchemaAdapter());
// For Effect Schema, supply your own adapter wrapping @effect/schema's decoder.
```

Do this once at boot, same pattern as `enableDriftDetection`.

## Consensus

`consensus` requires **≥ 2 streams**. Strategies: `"majority"` (default), `"unanimous"`, `"weighted"` (requires `weights`), `"best"`. Conflict resolution: `"vote"`, `"merge"`, `"best"`, `"fail"`. Pass a `schema` to get field-level agreement on structured data.

```ts
const r = await consensus({
  streams: [() => streamText({...}), () => streamText({...}), () => streamText({...})],
  strategy: "majority",
  minimumAgreement: 0.6,
  resolveConflicts: "vote",
});
r.consensus      // the resolved value
r.confidence     // 0..1
r.analysis       // per-output diagnostics
```

## Subpath imports for bundle size

Default to the full barrel `import { ... } from "@ai2070/l0"` for app code — it tree-shakes well. Only switch to `@ai2070/l0/core`, `/structured`, `/consensus`, `/parallel`, `/window`, `/guardrails`, `/monitoring`, `/drift`, `/zod`, `/openai`, `/anthropic`, `/mastra` when targeting edge runtimes or strict bundle budgets.

## Lifecycle callbacks

L0 exposes the full lifecycle as plain options on `l0()`. Prefer these to wrapping the event stream yourself when the user just wants a hook:

`onStart`, `onToken`, `onEvent`, `onCheckpoint`, `onViolation`, `onDrift`, `onTimeout`, `onRetry`, `onFallback`, `onResume`, `onToolCall`, `onAbort`, `onError`, `onComplete`.

## Error handling

L0 throws `L0Error` instances with a typed `code` field. **Don't string-match error messages; branch on `code`.**

```ts
import {
  l0,
  isL0Error,
  L0ErrorCodes,
  isNetworkError,
  analyzeNetworkError,
} from "@ai2070/l0";

try {
  await l0({ stream: () => streamText({ model, prompt }) });
} catch (err) {
  if (isL0Error(err)) {
    switch (err.code) {
      case L0ErrorCodes.INITIAL_TOKEN_TIMEOUT:
      case L0ErrorCodes.INTER_TOKEN_TIMEOUT:
        /* model was too slow */ break;
      case L0ErrorCodes.ZERO_OUTPUT:
        /* model produced nothing */ break;
      case L0ErrorCodes.FATAL_GUARDRAIL_VIOLATION:
        /* hard fail */ break;
      case L0ErrorCodes.ALL_STREAMS_EXHAUSTED:
        /* primary + all fallbacks failed */ break;
      case L0ErrorCodes.STREAM_ABORTED:
        /* user signal fired */ break;
    }
    err.context; // recovery hints, attempt history
  } else if (isNetworkError(err)) {
    const info = analyzeNetworkError(err); // { type, retryable, countsTowardLimit, suggestion }
  }
}
```

Full code list: `STREAM_ABORTED`, `INITIAL_TOKEN_TIMEOUT`, `INTER_TOKEN_TIMEOUT`, `ZERO_OUTPUT`, `GUARDRAIL_VIOLATION`, `FATAL_GUARDRAIL_VIOLATION`, `INVALID_STREAM`, `ALL_STREAMS_EXHAUSTED`, `NETWORK_ERROR`, `DRIFT_DETECTED` (and more in `L0ErrorCodes`).

Network errors typically don't count toward the retry limit — L0 treats transport failures as free retries.

## Continuation (opt-in token resumption)

Off by default. Enable only for long-form text generation where a mid-stream failure should pick up from the last-good checkpoint rather than restart the whole prompt. **Never enable for structured output** (`structured` rejects it anyway).

```ts
let continuationPrompt = "";
await l0({
  stream: () =>
    streamText({ model, prompt: continuationPrompt || originalPrompt }),
  continueFromLastKnownGoodToken: true,
  buildContinuationPrompt: (checkpoint) => {
    continuationPrompt = `${originalPrompt}\n\nContinue from:\n${checkpoint}`;
    return continuationPrompt;
  },
  deduplicateContinuation: true, // default: strips overlap between checkpoint tail and new start
});
```

Because L0 wraps factories (not prompts), you must thread the new prompt through a closure as shown. The `deduplicateContinuation` flag prevents `"...Hello world" + "world is great"` from producing `"...Hello worldworld is great"`.

## Guardrails: streaming flag and the async path

Each `GuardrailRule` has a `streaming` field:

- `streaming: true` — rule runs at every `checkIntervals.guardrails` tokens (default: every 5). Use for cheap checks that inspect the delta or a small recent window. Runs inline on the hot path; keep it fast.
- `streaming: false` (or unset) — rule runs only at completion. Use for expensive full-content scans (full JSON parse, large regex, etc.).

For truly heavy checks (LLM-as-judge, embedding similarity, network calls), **don't block the stream** — use the async helpers:

```ts
import { runAsyncGuardrailCheck, createGuardrailEngine } from "@ai2070/l0";

const engine = createGuardrailEngine([heavyRule]);
runAsyncGuardrailCheck(engine, context, (result) => {
  if (!result.passed) {
    /* handle violation after the fact */
  }
});
```

Rule `severity`: `"warning"` (logged only), `"error"` (triggers retry if `recoverable`), `"fatal"` (aborts immediately, no retry).

## Interceptors

Middleware around `l0()` calls. Call `enableInterceptors()` once, then attach via `InterceptorManager`. Built-ins: `loggingInterceptor`, `metadataInterceptor`, `authInterceptor`, `timingInterceptor`, `validationInterceptor`, `rateLimitInterceptor(max, windowMs)`, `cachingInterceptor(cache, getKey)`, `transformInterceptor`, `analyticsInterceptor`. Compose via `createInterceptorManager([...])` and pass `before`/`onError`/`after` hooks. Ideal for cross-cutting concerns the user doesn't want to repeat per-call.

## Event sourcing and replay

For audit logs, deterministic tests, and time-travel debugging. Call `enableInterceptors()` is **not** needed; the event sourcing API is independent.

```ts
import {
  createEventRecorder,
  createInMemoryEventStore,
  replay,
} from "@ai2070/l0";

const store = createInMemoryEventStore();
const recorder = createEventRecorder(store);

const result = await l0({
  stream: () => streamText({ model, prompt }),
  onEvent: recorder, // recorder is an event handler
});

// Later, deterministically reproduce:
const replayed = await replay(store, result.state.streamId);
```

Persisted stores: `FileEventStore`, `LocalStorageEventStore`, `CompositeEventStore`, `withTTL(store, ms)`. Custom backends via `registerStorageAdapter`.

## Multimodal streams

For image / audio / video / data output adapters, use the event-builder helpers: `createImageEvent`, `createAudioEvent`, `createJsonDataEvent`, `createAdapterProgressEvent`, `createAdapterDataEvent`. Consumers read `data` events alongside `token` events. See `MULTIMODAL.md`.

## Format helpers

`@ai2070/l0` ships prompt- and output-shaping utilities so apps don't reinvent them:

- `formatContext(context, opts)`, `formatMultipleContexts`, `formatDocument`, `formatInstructions` — build system prompts with escaped delimiters.
- `formatMemory`, `createMemoryEntry`, `mergeMemory`, `truncateMemory` — chat-style memory assembly.
- `formatTool`, `formatTools`, `createTool`, `parseFunctionCall` — tool-use JSON.
- `extractJsonFromOutput`, `cleanOutput`, `normalizeWhitespace`, `dedent` — post-processing.

Prefer these over hand-rolled string concatenation; they handle escape-sequence edge cases that bite.

## Testing L0 code

Unit tests should mock `l0` / `structured` / `consensus` rather than hit real models.

```ts
import { vi } from "vitest";

vi.mock("@ai2070/l0", async (orig) => {
  const actual = await orig<typeof import("@ai2070/l0")>();
  return { ...actual, l0: vi.fn() };
});

import { l0 } from "@ai2070/l0";

const mockL0 = vi.mocked(l0);
mockL0.mockResolvedValue({
  stream: (async function* () {
    yield { type: "token", value: "hello" };
    yield { type: "complete" };
  })(),
  state: { content: "hello", tokenCount: 1 } as any,
  telemetry: {} as any,
  errors: [],
  abort: () => {},
} as any);
```

For integration tests against real providers, use `vitest.integration.config.ts` (already set up in this repo's own tests).

## Common pitfalls (check for these in reviews)

- **Stream passed instead of factory** — breaks retry and fallback. Always `() => streamText(...)`.
- **`fallbackStreams` ordered wrong** — tried in array order. Put cheaper/faster fallbacks first.
- **Custom retry config that re-implements a preset** — prefer `recommendedRetry` etc.
- **Optional feature option set without calling its `enable…()`** — silent no-op. Same for `registerEffectSchemaAdapter` / `registerJSONSchemaAdapter`.
- **Reading `result.state.content` before draining `result.stream`** — final state isn't populated until the stream completes.
- **`consensus` called with 1 stream** — throws `"Consensus requires at least 2 streams"`.
- **Weighted consensus without `weights`** — throws.
- **`continueFromLastKnownGoodToken: true` on `structured()`** — structured rejects continuation. Don't enable it for JSON output.
- **Heavy guardrail with `streaming: true`** — blocks the token loop. Either set `streaming: false` (run at completion) or use `runAsyncGuardrailCheck`.
- **Mutating `recommendedGuardrails` / preset arrays in place** — they're shared. Spread first: `guardrails: [...recommendedGuardrails, customRule]`.
- **`AbortController` not propagated** — pass `signal:` to `l0`/`structured`/`consensus`/`pipe`/`parallel` so the user's cancel actually cancels.
- **String-matching error messages** — branch on `err.code` (`L0ErrorCodes.*`) or `isNetworkError(err)`. Messages change, codes are stable.
- **Using `any` for events/state** — import `L0Event`, `L0State`, `L0Result` from `@ai2070/l0`.

## Where to read more (in this repo)

- `API.md` — full options reference
- `ADVANCED.md` — non-trivial patterns
- `STRUCTURED_OUTPUT.md`, `CONSENSUS.md`, `GUARDRAILS.md`, `NETWORK_ERRORS.md`, `ERROR_HANDLING.md`, `DOCUMENT_WINDOWS.md`, `MONITORING.md`, `EVENT_SOURCING.md`, `CUSTOM_ADAPTERS.md`, `MULTIMODAL.md`, `DETERMINISTIC_LIFECYCLE.md`

When the user's question matches one of those documents, read it before recommending — the surface is large and easy to mis-remember.
