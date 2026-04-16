# Bug Report

Bugs discovered and fixed across two analysis passes.

## Pass 1 — 17 bugs fixed

### High Severity

#### 1. Initial token timeout ineffective for hanging streams

**File:** `src/runtime/l0.ts`

The timeout set a flag checked inside the `for await` loop body. If the stream never yielded a chunk, the loop body never ran and the flag was never checked.

**Fix:** The timeout callback now calls `abortController.abort()` to break the stream, and a post-loop check throws `INITIAL_TOKEN_TIMEOUT` if no tokens arrived.

#### 2. `abort()` broken when user provides their own AbortSignal

**File:** `src/runtime/l0.ts`

When a user passed an `AbortSignal`, the internal `abortController.signal` was unused. Calling `result.abort()` had no effect because only the internal controller was aborted.

**Fix:** External signals are now forwarded to the internal controller via an `abort` event listener. The internal signal is always used for stream checks.

#### 5. Structural brace-counting includes braces inside JSON strings

**File:** `src/utils/autoCorrect.ts`

Simple regex `/{/g` counted `{` inside quoted string values, leading to spurious closing braces being appended.

**Fix:** Character-by-character parsing that tracks string context, similar to `findFirstJSONDelimiter`.

#### 6. Potential infinite loop in `chunkByChars` when `overlap >= size`

**File:** `src/utils/chunking.ts`

`startPos = endPos - overlap` could cause `startPos` to never advance when overlap exceeds size.

**Status:** Known issue, existing guard partially covers it.

### Medium Severity

#### 7. `inferReason` never receives `error` argument

**File:** `src/runtime/retry.ts`

Called as `this.inferReason(classification)` without passing `error`. Network error sub-classification (`analyzeNetworkError`) was dead code.

**Fix:** Changed to `this.inferReason(classification, error)`.

#### 9. GuardrailEngine `hasFatalViolations` resets on each check

**File:** `src/guardrails/engine.ts`

Fatal/error violation flags were computed from only the current check's violations. A fatal violation from a previous check was silently forgotten.

**Fix:** Used `||=` pattern to accumulate flags across checks.

#### 10. `isValidJSON` gate makes auto-correction unreachable

**File:** `src/structured.ts`

The guardrail checked `isValidJSON()` first and short-circuited. `tryParseAndValidate` (which contains auto-correction) was never reached for fixable JSON.

**Fix:** Removed the `isValidJSON` early-return, relying solely on `tryParseAndValidate`.

#### 11. Regex `/g` flag + `test()` then `replace()` skips matches

**File:** `src/utils/autoCorrect.ts`

`test()` advanced `lastIndex` on the global regex, then `replace()` started from that offset, missing the first trailing comma.

**Fix:** Replaced `test()` + `replace()` with a single `replace()` and result comparison.

#### 12. Backslash escape tracked outside strings in JSON guardrail

**File:** `src/guardrails/json.ts`

`escapeNext = true` fired for `\` even outside strings. If an LLM emitted `\{`, the `{` was skipped and brace counting was corrupted.

**Fix:** Only set `escapeNext` when `state.inString` is true.

#### 14. Consensus timeout timer never cleared

**File:** `src/consensus.ts`

If `Promise.all` resolved before the timeout, the `setTimeout` kept running and fired an unhandled rejection.

**Fix:** Store the timer ID and `clearTimeout` in a `finally` block.

#### 15. `isNetworkError` missing SSL error check

**File:** `src/utils/errors.ts`

`isNetworkError()` didn't include `isSSLError()`, creating inconsistency with `analyzeNetworkError()`.

**Fix:** Added `isSSLError(error)` to the check chain.

#### 16. Anthropic adapter `||` drops valid zero token counts

**File:** `src/adapters/anthropic.ts`

`usage.input_tokens || usage.output_tokens` was falsy when both were 0 (valid for cached requests).

**Fix:** Changed to `usage.input_tokens != null || usage.output_tokens != null`.

#### 17. Token estimation uses absolute position, not relative

**File:** `src/utils/chunking.ts`

`endPos % 4 === 0` counted tokens based on absolute document position, creating inconsistent chunk sizes.

**Fix:** Changed to `(endPos - startPos) % 4 === 0`.

### Low Severity

#### 19. Drift detectors fire permanently once triggered

**File:** `src/runtime/drift.ts`

`format_collapse` and `hedging` checks examined the immutable content prefix. Once triggered, they re-ran the regex on every subsequent check.

**Fix:** Results are now cached on first check and reused. `reset()` clears the cache.

#### 20. Fallback log message off-by-one

**File:** `src/runtime/l0.ts`

`fallbackIndex++` was called before the log message, so stream indices were both off by one.

**Fix:** Use `fallbackIndex - 1` and `fallbackIndex` in the message string.

#### 21. `countIdenticalOutputs` counts first-output matches, not largest group

**File:** `src/consensus.ts`

If the first output was an outlier, this returned 1 even if four other outputs were identical.

**Fix:** Count all groups and return the maximum.

#### 22. `extractJSON` fallback tries `{}` regex before `[]` regardless of delimiter

**File:** `src/utils/autoCorrect.ts`

When the detected opening delimiter was `[`, the fallback still tried `{...}` first.

**Fix:** Use the detected `openChar` to select which fallback regex to try first.

#### 23. `createChunk` uses `indexOf` to re-find content position

**File:** `src/utils/chunking.ts`

For repeated content, `indexOf` could match the wrong occurrence.

**Fix:** Use the known `startPos` directly instead of re-searching.

---

## Pass 2 — 10 bugs fixed

### High Severity

#### P2-1. `findFirstJSONDelimiter` escape tracking outside strings

**File:** `src/utils/autoCorrect.ts`

Backslash outside a quoted string triggered `escapeNext`, causing the next character (e.g. `{`) to be skipped. File paths like `C:\files\{...}` would fail to find the JSON delimiter.

**Fix:** Only set `escapeNext` when `inString` is true.

#### P2-2. Comment stripping destroys `//` and `/* */` inside JSON string values

**File:** `src/utils/autoCorrect.ts`

The comment-removal regex operated on the entire text, including inside JSON strings. URLs like `https://example.com` were corrupted.

**Fix:** String-aware character-by-character comment stripping that only removes comments outside quoted strings.

#### P2-9. `initialTimeoutId` not cleared in catch block

**File:** `src/runtime/l0.ts`

When a stream factory threw before yielding tokens, the initial timeout timer kept ticking. On retry, the old timer could fire and abort the new attempt.

**Fix:** Hoisted `initialTimeoutId` declaration above the try block and added `clearTimeout` in the catch block.

### Medium Severity

#### P2-3. `withTimeout` timer leak

**File:** `src/utils/timers.ts`

The `withTimeout` function used `Promise.race` with `timeout()`, but never cleared the timer on success. The dangling timer caused unhandled rejections.

**Fix:** Replaced with explicit `setTimeout` + `clearTimeout` in a `finally` block.

#### P2-4. `consensusUtils` `indexOf` produces wrong indices for duplicate refs

**File:** `src/utils/consensusUtils.ts`

`outputs.indexOf(o)` returned the first matching reference, producing duplicate indices when the same object appeared multiple times.

**Fix:** Use the map callback index parameter instead.

#### P2-5. `consensusUtils` division by zero when fields is empty

**File:** `src/utils/consensusUtils.ts`

`overallAgreement` divided by `Object.keys(fields).length`, producing `NaN` when all outputs had null data.

**Fix:** Guard against empty fields with a ternary, defaulting to 0.

#### P2-7. Consensus `minSimilarity`/`maxSimilarity` inverted with 1 output

**File:** `src/consensus.ts`

With 0 comparisons, `minSimilarity` stayed at 1.0 and `maxSimilarity` stayed at 0.0 (inverted).

**Fix:** After the comparison loop, normalize both to 1.0 when `comparisons === 0`.

#### P2-8. Consensus weights misaligned when some streams fail

**File:** `src/consensus.ts`

`defaultWeights` was indexed by position in the original streams array, but `successfulOutputs` was a filtered subset. Custom weights were applied to the wrong outputs.

**Fix:** Map weights via `successfulOutputs.map(o => defaultWeights[o.index])` to align by original stream index.

### Low Severity

#### P2-6. Sub-chunk `startPos` in `chunkByParagraphs`/`chunkBySentences`

**File:** `src/utils/chunking.ts`

When large paragraphs/sentences were split via `chunkByChars`, the sub-chunks' positions were looked up via `document.indexOf()` which could match wrong occurrences or return -1 for trimmed content.

**Fix:** Calculate the parent's position in the document first, then offset sub-chunk positions arithmetically.

#### P2-10. `state.duration` excludes time-to-first-token

**File:** `src/runtime/l0.ts`

Duration was calculated from `firstTokenAt` instead of `startTime`, excluding TTFT from the total.

**Fix:** Changed to `Date.now() - startTime`.

---

## Pass 3 (Final Sweep) — 7 bugs fixed, plus 3 reviewer fixes

### High Severity

#### P3-1. `extractJSON` balanced brace matching escape outside strings

**File:** `src/utils/autoCorrect.ts`

Same bug class as P2-1 but in the balanced brace matching loop of `extractJSON()`. Backslash outside a JSON string triggered `escapeNext`, skipping the next character and corrupting depth counting.

**Fix:** Only set `escapeNext` when `inString` is true.

#### P3-2. Vercel AI adapter reader lock leak

**File:** `src/adapters/vercel-ai.ts`

`fullStream.getReader()` acquired a reader that was never released via `reader.releaseLock()`. If the generator was abandoned early (e.g., during retry/fallback), the ReadableStream remained locked permanently.

**Fix:** Wrapped the read loop in `try/finally` with `reader.releaseLock()` in the finally block.

#### P3-4. `structured` and `structuredStream` `abort()` broken with user signal

**File:** `src/structured.ts`

Same bug class as Bug 2 (l0.ts abort). When a user provided their own `AbortSignal`, the returned `abort()` method only aborted the internal controller that L0 wasn't listening to.

**Fix:** Wire external signal to internal controller via `addEventListener('abort', ...)`, always pass internal signal to L0.

### Medium Severity

#### P3-3. DriftDetector not reset between retries

**File:** `src/runtime/l0.ts`

The `driftDetector` instance was reused across retry attempts without calling `reset()`. Cached `formatCollapseDetected`, `hedgingDetected`, entropy history, and window comparisons carried stale data from previous attempts, causing false drift detections.

**Fix:** Call `driftDetector.reset()` in the retry state-reset block.

#### P3-5. Inter-token timeout fires during tool call execution

**File:** `src/runtime/l0.ts`

`lastTokenEmissionTime` was only updated for token events. During tool calls that produced message/data/progress events, the inter-token timer kept running and could fire spuriously.

**Fix:** Update `lastTokenEmissionTime` for message, data, and progress events.

#### P3-6. Initial token timeout not cleared by non-token events

**File:** `src/runtime/l0.ts`

The initial token timeout was only cleared when the first token arrived. Streams that started with non-token events (e.g., tool call before text) would be aborted even though the stream was active.

**Fix:** Clear the initial timeout on any incoming chunk, not just tokens.

### Low Severity

#### P3-7. `calculateConfidence` returns 1.0 for single surviving output

**File:** `src/consensus.ts`

When only 1 stream succeeded out of many, confidence was 1.0 — contradicting the `"partial"` status and misleading callers.

**Fix:** Return 0.5 for single-output consensus.

### Reviewer Fixes

#### R-1. Drift detection caching locks in false negatives on incomplete early chunks

**File:** `src/runtime/drift.ts`

The `=== null` caching pattern for `formatCollapseDetected` and `hedgingDetected` locked in `false` on the first check, even if the content was incomplete (e.g., only "He" had arrived, not "Here is the code:"). Once cached as `false`, the check never re-ran.

**Fix:** Changed from `=== null` guard to `||` latch pattern: `this.history.formatCollapseDetected = this.history.formatCollapseDetected || this.detectFormatCollapse(content)`. This re-checks on every call until detected, then latches `true` permanently. Type changed from `boolean | null` to `boolean`.

#### R-2. Initial timeout abort permanently kills session controller, blocking retries

**File:** `src/runtime/l0.ts`

The initial token timeout callback called `abortController.abort()` on the session-level controller. Once aborted, the signal stayed aborted permanently, and the retry check `!signal?.aborted` blocked all subsequent retry attempts.

**Fix:** Introduced a per-iteration `iterationAbortController` that the timeout aborts instead. The session-level controller is no longer touched by the timeout. The `for await` loop checks both signals separately — iteration abort triggers a `break` (handled by the post-loop timeout check), while session abort throws `STREAM_ABORTED`.

---

## Test Coverage

- `tests/bugfix-regressions.test.ts` — 24 regression tests (Pass 1)
- `tests/bugfix-regressions-pass2.test.ts` — 12 regression tests (Pass 2)
- `tests/bugfix-regressions-pass3.test.ts` — 11 regression tests (Pass 3)
- Full suite: 3,270+ tests passing
