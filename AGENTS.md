# AGENTS.md

Contributor guide for agents working **on** this repository (L0 / `reliable-ai-streams`).
For writing application code that **uses** the library, read `.claude/skills/use-l0/SKILL.md` instead — it covers consumer semantics (presets, adapters, callbacks, error codes) and is not repeated here.

## Commands

| Task           | Command                                                             |
| -------------- | ------------------------------------------------------------------- |
| Install        | `npm install`                                                       |
| Unit tests     | `npm test` (= `vitest run`, 62 files in `tests/`)                   |
| Single file    | `npx vitest run tests/<name>.test.ts`                               |
| Coverage       | `npm run test:coverage` (v8, global 80% bar)                        |
| Integration    | `npm run test:integration` (needs API keys, never in CI)            |
| Build          | `npm run build` (`tsc --emitDeclarationOnly` + `build.mjs`)         |
| Typecheck only | `npx tsc --emitDeclarationOnly --noEmit`                            |
| Format         | `npm run prettier` (`prettier --write .`, defaults, no config file) |
| Bundle size    | `node scripts/check-size.mjs` (manual; wired to nothing)            |

There is no lint step and no ESLint config. `npm test` + `npm run build` is the full gate CI runs.

## Runtime shape

- `l0()` is a single ~2,000-line async generator in `src/runtime/l0.ts`. Everything else re-exports it (`src/index.ts`, `src/core.ts`).
- Flow inside `l0()`: interceptors `executeBefore` → `EventDispatcher` + `registerCallbackWrappers` → optional `L0Monitor` → `GuardrailEngine` → `RetryManager` → optional `DriftDetector` → `StateMachine`/`Metrics` → `streamGenerator()` returned as `result.stream` → interceptors `executeAfter`.
- Stream source resolution order (`src/runtime/l0.ts`): explicit `options.adapter` → registry auto-detect → Vercel `streamObject` tee → `textStream` → `fullStream` → bare `Symbol.asyncIterator` → `L0Error(INVALID_STREAM)`.
- Extracted helpers: `src/runtime/{state,state-machine,metrics,checkpoint,callbacks,retry,event-dispatcher,callback-wrappers}.ts`. `resetStateForRetry` (`src/runtime/state.ts`) is the single definition of what survives a retry/fallback.
- Two event models, do not conflate: the stream union `L0Event` (`src/types/l0.ts`, what `result.stream` and adapters yield) and observability events (`src/types/observability.ts`, dispatched by `src/runtime/event-dispatcher.ts`). Legacy `L0Options` callbacks are subscribers over the dispatcher (`src/runtime/callback-wrappers.ts`).
- `src/runtime/stream.ts` is dead relative to `l0()` — its only importer is `tests/stream.test.ts`.

## Invariants — do not break

Cross-language invariants are pinned in `tests/fixtures/canonical-spec.json` (`lifecycleInvariants`) and asserted by `tests/canonical-spec.test.ts` / `tests/lifecycle-canonical.test.ts`. `DETERMINISTIC_LIFECYCLE.md` is the prose spec.

- `SESSION_START` emitted exactly once per session, before the retry/fallback loops (`src/runtime/l0.ts`). Retries must not re-emit it.
- `ATTEMPT_START` only for retries (attempt ≥ 2); fallbacks emit `FALLBACK_START`, never `ATTEMPT_START`. `RETRY_ATTEMPT` always precedes `ATTEMPT_START`.
- `RETRY_END` only on success or as `RETRY_GIVE_UP` (`src/runtime/l0.ts`).
- Adapter auto-detection MUST stay ahead of `textStream`/`fullStream` (`src/runtime/l0.ts`) or tool-call observability regresses.
- `onComplete`/`onError`/`onViolation`/`onStart` are driven exclusively through `registerCallbackWrappers`; a direct call from the runtime double-fires (`src/runtime/l0.ts`).
- Content accumulates in `tokenBuffer` and is `join("")`-ed only when a check needs it (`src/runtime/l0.ts`). `state.content += token` reintroduces O(n²).
- The initial-token timeout aborts only `iterationAbortController`, never the session controller, or retries die (`src/runtime/l0.ts`).
- User `retry.shouldRetry` can only veto, never widen; a throw from it counts as veto (`src/runtime/l0.ts`).
- Event handlers are fire-and-forget microtasks and never throw outward (`src/runtime/event-dispatcher.ts`).
- `L0Adapter.wrap()` contract in `src/types/l0.ts`: preserve order and timing, timestamp every event, convert errors to `{ type: "error" }` (never throw), yield `complete` exactly once; `detect()` must be sync and cheap.

## Opt-in feature registration

`src/runtime/l0.ts` holds four mutable module slots (`_driftDetectorFactory`, `_monitorFactory`, `_interceptorManagerFactory`, `_adapterRegistry`) filled by `enableDriftDetection`/`enableMonitoring`/`enableInterceptors`/`enableAdapterRegistry`. The optional modules are imported type-only so they tree-shake away.

- Using a feature without enabling it **throws** `L0Error(FEATURE_NOT_ENABLED)` — interceptors, monitoring, drift, and string adapter names each guard on their slot; it does not degrade. The one silent path is adapter auto-detection, which no-ops when `_adapterRegistry` is null and falls through to `textStream`/`fullStream`.
- Nothing under `src/` calls the enablers; registration is the consumer's job. The only in-repo caller is `tests/enable-features.ts`, pulled in by `tests/setup.ts` via `vitest.config.ts` — so every unit test runs with all features on.
- Adding a new optional subsystem means: type-only import + slot + `enableX` setter + `FEATURE_NOT_ENABLED` guard + wiring in `tests/enable-features.ts`, plus a re-export from `src/index.ts`.

## Adding public API

1. Implement under `src/<area>/`, re-export from the area barrel (`src/guardrails/index.ts`, `src/format/index.ts`, `src/adapters/index.ts`).
2. Re-export from the matching subpath entry **and** `src/index.ts`. Types need `export type` (`isolatedModules`).
3. New subpath ⇒ add `src/<entry>.ts`, add the `exports` key in `package.json` (dist paths mirror `src` via esbuild `outbase`), add it to `scripts/check-size.mjs` `entries` if size-tracked, and update the subpath/size tables in `README.md` and `API.md`.
4. Document in `API.md` (canonical reference) plus the relevant topic guide. `CONTRIBUTING.md` spells this out for guardrail rules and format helpers.

Nothing in CI verifies that `exports` keys resolve to emitted files — check by hand after touching packaging.

Current export keys → entry: `.`→`src/index.ts`, `./core`→`src/core.ts`, `./structured`, `./consensus`, `./window`, `./monitoring`, `./guardrails`, `./drift`, `./pipeline` → same-named `src/*.ts`, `./parallel`→`src/runtime/parallel.ts`, `./zod`→`src/zod/index.ts`, `./utils/chunking`, `./openai`/`./anthropic`/`./mastra`/`./adapters/helpers`→`src/adapters/*.ts`. `src/evaluate.ts` has no key; it ships only through the barrel.

## Source constraints

`tsconfig.json`: ES2022 / ESNext, `lib: ["ES2022"]` (no DOM — guard `crypto`/`localStorage` access), `strict`, `noUncheckedIndexedAccess` (indexed reads are `T | undefined`), `noUnusedLocals`/`noUnusedParameters`, `noImplicitReturns`, `isolatedModules`, `skipLibCheck`.

`include` is `src/**/*` only: `tests/`, `integration/`, `examples/`, `*.mjs`, and `vitest*.config.ts` are **never typechecked** by the build, and vitest transpiles without typechecking. Type errors in tests are invisible to both gates — rely on editor/LSP diagnostics there.

`build.mjs` is a per-file esbuild transpile (`bundle: false`, `format: "esm"`, `target: "node22"`, `outbase: "src"`), so import specifiers are emitted verbatim. Extension style is inconsistent in-tree (`src/index.ts` extensionless, `src/core.ts` `.js`-suffixed); match the file you are editing.

## Tests

- Unit tests live flat in `tests/` as `<topic>.test.ts`. Import source by deep relative path (`../src/runtime/l0`), not the barrel — only `tests/format.test.ts` and `tests/window.test.ts` use `../src/index`.
- `globals: true` is set but every test still imports from `"vitest"` explicitly. Keep that.
- Mock stream/chunk helpers are deliberately duplicated per file (`createMockStream`, `createMockStreamFactory`, `createMockOpenAIChunk`, …). There is no shared `tests/helpers.ts`; do not invent one for a single change.
- The adapter registry is process-global and re-registering a name throws — call `clearAdapters()` in `beforeEach`/`afterEach` around registry tests (see `tests/adapter-registry.test.ts`).
- `mockReset`/`restoreMocks`/`clearMocks` are on; fake timers are not auto-restored (`tests/timers.test.ts` shows the manual pattern). `retry: 0`, `testTimeout: 10000` — timing-flaky tests fail the run outright.
- Behavior covered by `tests/fixtures/canonical-spec.json` or `tests/fixtures/lifecycle-scenarios.json` is changed **in the JSON**, not in the test body; those fixtures are mirrored by a Python implementation.
- Coverage excludes `src/**/index.ts`, `src/adapters/**`, `src/runtime/opentelemetry.ts`, `src/runtime/sentry.ts` (`vitest.config.ts`) — code added there does not move the 80% thresholds.
- Integration tests are `integration/*.integration.ts`, run only by `vitest.integration.config.ts`, gated on `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` through `describeIf`/`hasOpenAI` from `integration/setup.ts` (which also imports `../tests/enable-features`). CI never runs them.

## Peers and version support

All 8 peers are `optional: true` and consumed via `import type`, so nothing is required at runtime. Exceptions: `src/runtime/opentelemetry.ts` value-imports `@opentelemetry/api`, `src/structured.ts` value-imports `zod`. `src/utils/uuid.ts` detects `uuid` with a try/catch and falls back to a built-in v7.

Ranges: `ai ^6||^7`, `openai ^6||^7`, `@anthropic-ai/sdk >=0.50 <1`, `@mastra/core ^1`, `zod ^3||^4`, `effect ^3`, `@sentry/node ^10`, `@opentelemetry/api ^1`.

Supported runtimes: `engines.node >=22.0.0` is the floor for **consumers** of the published package. Local development needs Node >= 22.12.0 because `vitest@5` declares `^22.12.0 || ^24.0.0 || >=26.0.0`; the CI matrix is 22/24/26 and node 25 sits outside that range.

**Widening a peer range requires a lower-bound CI job.** Two exist today: `compat-ai-v6` and `compat-openai-v6` in `.github/workflows/ci.yml`, each pinning the exact floor (`npm install <pkg>@6.0.0 --no-save`) then test + build — pinning `@6` would only prove the newest 6.x. devDependencies pin the upper bound of each range, so without such a job the new lower bound is unverified. `zod` v4 is exercised only through the `zod4: npm:zod@^4` devDependency alias.

## Docs to update

- `API.md` — canonical API reference; every new/changed public option, callback, error code, preset, or subpath lands here.
- `DETERMINISTIC_LIFECYCLE.md` — spec for event ordering/lifecycle; update alongside any change to emission order.
- Topic guides, update when their behavior changes: `GUARDRAILS.md`, `STRUCTURED_OUTPUT.md`, `CONSENSUS.md`, `DOCUMENT_WINDOWS.md`, `ERROR_HANDLING.md`, `NETWORK_ERRORS.md`, `PERFORMANCE.md`, `INTERCEPTORS_AND_PARALLEL.md`, `MONITORING.md`, `EVENT_SOURCING.md`, `FORMATTING.md`, `CUSTOM_ADAPTERS.md`, `MULTIMODAL.md`, `ADVANCED.md`, `QUICKSTART.md`.
- `README.md` — feature/docs-index/bundle-size/benchmark tables.
- Process docs (`CONTRIBUTING.md`, `SECURITY.md`, `SUPPORT.md`, `CLA.md`) and `examples/` only when the workflow or examples themselves change.

No doc is validated by tests or CI; there is no changelog file, and release notes live only in GitHub Releases.

## Release

`.github/workflows/release.yml` fires on a published GitHub release: node 24, `npm install` → `npm test` → `npm run build` → `npm publish --access public`. `prepublishOnly` runs only the build, so a manual `npm publish` skips tests. Published payload is `files: ["dist", "README.md", "LICENSE"]` — the guides are not shipped. Version lives only in `package.json`; lockfiles are gitignored.

## Known landmines

These are real and unfixed; do not "discover" them as bugs mid-task, and do not silently fix them as part of unrelated work.

- `package.json` `exports["."].require` points at `./dist/index.cjs`, which neither build step emits (`build.mjs` is ESM-only).
- `"sideEffects": false`, yet `src/adapters/*.ts` call `registerAdapter(...)` at module scope inside try/catch — importing an adapter has real side effects.
- `src/guardrails/types.ts` is an unused legacy shape (`Rule.validate`) still re-exported by `src/guardrails/index.ts`. The live interface is `GuardrailRule` in `src/types/guardrails.ts`.
- `src/guardrails/async.ts` and `src/runtime/async-drift.ts` are exported but never called by `l0()`; the runtime checks guardrails synchronously.
- `EventDispatcher.emit()` infers its payload type from the argument, so payload keys are not checked against `src/types/observability.ts`. Existing mismatches: `ADAPTER_DETECTED`/`ADAPTER_WRAP_END` emit `adapterId` vs declared `adapterName`, `TIMEOUT_START` emits `configuredMs` vs declared `timeoutMs`, `NETWORK_ERROR` omits the declared required `category`.
- Several declared `EventType`s are never emitted (`SESSION_END`, `SESSION_SUMMARY`, `TOKEN`, `DRIFT_CHECK_*`, `NETWORK_RECOVERY`, `CONNECTION_*`, all `STRUCTURED_*`).
- `integration/multimodal.integration.test.ts` is run by neither config (wrong suffix for the integration include, and `integration/**` is excluded from `npm test`).
- `tests/benchmark.test.ts` runs on every `npm test`; it is a `console.log` benchmark harness with hardware-sensitive thresholds inside the 10s timeout, not a behavioral suite.
- `scripts/check-size.mjs` tracks 9 of 16 subpaths, is referenced by no script or workflow, never exits non-zero, and cannot produce the `/zod` row `README.md` publishes.
- Doc drift: `CONTRIBUTING.md` says TypeScript 5.3+ while devDeps pin `typescript ^7`; `BENCHMARKS.md` says "Node.js 24 LTS with Vitest 4"; `PERFORMANCE.md` cites numbers measured on Node 20.
- `src/runtime/state-machine.ts` performs no transition validation — illegal transitions are not rejected.

## Before yielding

1. `npm test` (full suite; it is ~25s).
2. `npm run build` — the only typecheck of `src/`.
3. `npm run prettier` if you touched formatting-relevant files; CI does not check formatting, but the tree is prettier-clean.
4. Peer-range or engine changes: verify against the actual lower bound (`npm install <pkg>@<major> --no-save`, run tests, restore with `npm install`) and add or update the matching compat job.
