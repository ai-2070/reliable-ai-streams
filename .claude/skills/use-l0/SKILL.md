---
name: use-l0
description: "Build, debug, and review apps that use the L0 reliability layer (`@ai2070/l0`). TRIGGER when: a file imports `@ai2070/l0` or any subpath (`@ai2070/l0/core`, `/structured`, `/consensus`, `/parallel`, `/window`, `/guardrails`, `/drift`, `/monitoring`, `/openai`, `/anthropic`, `/mastra`, `/zod`); the user asks for L0 retry/guardrail/drift/structured/consensus/pipeline/parallel/race wiring; the user references L0 events, lifecycle callbacks (`onRetry`, `onFallback`, `onDrift`, `onCheckpoint`, `onViolation`, etc.), or `L0Event`/`L0State`/`L0Result` types. SKIP for unrelated AI SDK code that doesn't touch L0."
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
l0({ stream: streamText({ model, prompt }) })

// CORRECT — L0 can re-invoke this on retry/fallback
l0({ stream: () => streamText({ model, prompt }) })
```

The same rule applies to `fallbackStreams`, `consensus({ streams })`, `parallel`, `race`, and pipeline `fn`.

## Pick the right entry point

| You want to…                             | Use                              | Import                       |
| ---------------------------------------- | -------------------------------- | ---------------------------- |
| Wrap a single stream with reliability    | `l0(opts)`                       | `@ai2070/l0` or `/core`      |
| Get guaranteed-valid JSON from a stream  | `structured({ schema, stream })` | `@ai2070/l0` or `/structured`|
| Combine N streams into one answer        | `consensus({ streams })`         | `@ai2070/l0` or `/consensus` |
| Fan out N independent calls              | `parallel(items, opts)`          | `@ai2070/l0` or `/parallel`  |
| First valid stream wins                  | `race(items, opts)`              | `@ai2070/l0` or `/parallel`  |
| Chain steps (summarize → translate)      | `pipe(steps, input)`             | `@ai2070/l0` or `/pipeline`  |
| Process a long doc in chunks             | `processWithWindow` / `l0WithWindow` | `@ai2070/l0` or `/window`|

`structured`, `consensus`, `parallel`, `pipe`, and the window helpers all build on `l0` — they accept the same `retry`, `guardrails`, `timeout`, `signal`, `monitoring` shape and re-emit the same lifecycle.

## Always prefer presets over hand-rolled config

L0 ships tested presets. Reach for them first; only customize when a preset clearly doesn't fit.

```ts
import {
  recommendedRetry, minimalRetry, strictRetry, exponentialRetry,
  recommendedGuardrails, minimalGuardrails, strictGuardrails,
  jsonOnlyGuardrails, markdownOnlyGuardrails,
  recommendedStructured, minimalStructured, strictStructured,
  standardConsensus, strictConsensus, lenientConsensus, bestConsensus,
  smallWindow, mediumWindow, largeWindow, paragraphWindow, sentenceWindow,
  fastPipeline, reliablePipeline, productionPipeline,
} from "@ai2070/l0";
```

Don't invent your own retry counts, backoff strategies, or guardrail lists if a preset name describes the intent.

## Adapter selection

| Source SDK              | How to wrap                                                        |
| ----------------------- | ------------------------------------------------------------------ |
| Vercel AI SDK (`ai`)    | Pass `() => streamText({...})` directly — auto-detected            |
| OpenAI SDK              | `openaiStream(client, { model, messages, ... })`                   |
| Anthropic SDK           | `anthropicStream(client, { model, messages, ... })`                |
| Mastra agent            | `mastraStream(agent, prompt)` / `mastraStructured(agent, schema)`  |
| Anything else           | Build an adapter; see `CUSTOM_ADAPTERS.md` and `adapters/helpers`  |

For custom adapters, use the helpers in `@ai2070/l0`: `toL0Events`, `createAdapterTokenEvent`, `createAdapterDoneEvent`, `createAdapterErrorEvent`. Register with `registerAdapter` (requires `enableAdapterRegistry()` first — see below).

## Optional features must be explicitly enabled

Several subsystems are tree-shaken out by default. If the user wants them, **call the enabler at app boot once**, then use the feature:

```ts
import {
  enableDriftDetection, enableMonitoring,
  enableInterceptors, enableAdapterRegistry,
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
result.state.content      // final assembled text
result.state.tokenCount
result.telemetry          // timing, retries, fallbacks
result.errors             // collected non-fatal errors
```

The runtime emits a richer observability event stream too (`L0ObservabilityEvent`) covering retries, fallbacks, guardrail phases, drift checks, checkpoints, etc. — wire it via `onEvent` or `EventDispatcher` if the user needs full audit telemetry. Use `getText(result)` if you only want the final string and don't care about tokens.

## Structured output

```ts
import { structured } from "@ai2070/l0";
import { z } from "zod";

const schema = z.object({ name: z.string(), age: z.number() });

const r = await structured({
  schema,                                     // zod v3/v4, Effect Schema, or JSON Schema
  stream: () => streamText({ model, prompt }),
  autoCorrect: true,                          // fix trailing commas, missing braces, fences
  // strictMode: true,                        // disable best-effort repairs
});

r.data    // typed, validated parsed object
r.raw     // the assembled string before parse
r.corrected, r.corrections   // what auto-correct did
```

For arrays use `structuredArray({ schema: z.array(item), ... })`; for streaming partial objects use `structuredStream`. Structured outputs intentionally **never resume mid-stream** — that's a safety guarantee, don't try to bypass it.

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

## Common pitfalls (check for these in reviews)

- **Stream passed instead of factory** — breaks retry and fallback. Always `() => streamText(...)`.
- **`fallbackStreams` ordered wrong** — they're tried in array order. Put cheaper/faster fallbacks first.
- **Custom retry config that re-implements a preset** — prefer `recommendedRetry` etc.
- **Optional feature option set without calling its `enable…()`** — silent no-op.
- **Event loop without break/return on `complete`** — works, but allocates extra ticks.
- **Reading `result.state.content` before draining `result.stream`** — final state isn't populated until the stream completes.
- **`consensus` called with 1 stream** — throws `"Consensus requires at least 2 streams"`.
- **Weighted consensus without `weights`** — throws.
- **`AbortController` not propagated** — pass `signal:` to `l0`/`structured`/`consensus`/`pipe`/`parallel` so the user's cancel actually cancels.
- **Mutating `recommendedGuardrails`/preset arrays in place** — they're shared. Spread first: `guardrails: [...recommendedGuardrails, customRule]`.
- **Using `any` for events/state** — import `L0Event`, `L0State`, `L0Result` from `@ai2070/l0`.

## Where to read more (in this repo)

- `API.md` — full options reference
- `ADVANCED.md` — non-trivial patterns
- `STRUCTURED_OUTPUT.md`, `CONSENSUS.md`, `GUARDRAILS.md`, `NETWORK_ERRORS.md`, `ERROR_HANDLING.md`, `DOCUMENT_WINDOWS.md`, `MONITORING.md`, `EVENT_SOURCING.md`, `CUSTOM_ADAPTERS.md`, `MULTIMODAL.md`, `DETERMINISTIC_LIFECYCLE.md`

When the user's question matches one of those documents, read it before recommending — the surface is large and easy to mis-remember.
