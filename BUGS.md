# Bug Report

## High Severity

### 1. Initial token timeout ineffective for hanging streams

**File:** `src/runtime/l0.ts:716-797`

The timeout sets a flag checked inside the `for await` loop body. If the stream never yields a chunk, the loop body never runs and the flag is never checked. The timeout becomes a no-op for truly hanging streams.

**Fix:** Use `Promise.race` to race the first chunk against a timeout promise.

### 2. `abort()` broken when user provides their own AbortSignal

**File:** `src/runtime/l0.ts:289,1981`

When a user passes an `AbortSignal`, `signal` is set to the user's signal. But `result.abort()` only aborts the _internal_ controller, which nothing checks. The stream keeps running.

**Fix:** Combine both signals, or check both in the abort condition.

### 3. `l0WithWindow` context restoration is dead code

**File:** `src/window.ts:440-498`

On drift detection, `currentChunkIndex` is incremented but never used to fetch the new chunk or update `l0Options`. Every retry uses the same original input until `maxAttempts` is exhausted.

**Fix:** Accept a `processFn: (chunk) => L0Options` and rebuild options from the new chunk.

### 4. `structuredStream` deadlocks if stream isn't consumed

**File:** `src/structured.ts:504-530`

`resultPromise` awaits `streamDone`, which only resolves when the stream generator is fully iterated. A caller doing `const { result } = await structuredStream(opts); await result;` without reading `stream` hangs forever.

**Fix:** Auto-consume the stream internally and tee events to an optional consumer, or document this requirement prominently.

### 5. Structural brace-counting includes braces inside JSON strings

**File:** `src/utils/autoCorrect.ts:170-188`

Simple regex `/{/g` counts `{` inside quoted string values, leading to spurious closing braces appended. JSON containing code or templates gets corrupted.

**Fix:** Parse character-by-character tracking string context, similar to `findFirstJSONDelimiter` and `extractJSON` in the same file.

### 6. Potential infinite loop in `chunkByChars` when `overlap >= size`

**File:** `src/utils/chunking.ts:120-160`

`startPos = endPos - overlap` can cause `startPos` to never advance. The existing guard only works if a chunk was created; whitespace-only regions skip it.

**Fix:** Add a guard ensuring `startPos` always advances past the previous start position.

## Medium Severity

### 7. `inferReason` never receives `error` argument — network sub-classification is dead code

**File:** `src/runtime/retry.ts:71,165-196`

Called as `this.inferReason(classification)` without passing `error`. The network error analysis (`analyzeNetworkError`) never runs; all network errors get generic `"network_error"` instead of `"timeout"`, `"dns"`, etc.

**Fix:** Change the call to `this.inferReason(classification, error)`.

### 8. Double retry counting between RetryManager and l0.ts

**File:** `src/runtime/retry.ts` + `src/runtime/l0.ts`

Both `RetryManager` internal state and `l0.ts`'s `retryAttempt` variable track attempts. `recordRetry()` increments the internal counter while the caller maintains a separate one, effectively halving allowed retries for some error types.

**Fix:** Use the `RetryManager`'s internal state exclusively, or make `shouldRetry()` stateless by accepting the attempt count as a parameter.

### 9. Guardrail engine `hasFatalViolations` resets on each check

**File:** `src/guardrails/engine.ts:180-185`

Fatal violation flags are computed from only the _current_ check's violations, not the cumulative `this.state.violations`. A fatal violation from a previous check is silently forgotten.

**Fix:** Use `||=` to accumulate: `this.state.hasFatalViolations = this.state.hasFatalViolations || violations.some(v => v.severity === "fatal")`.

### 10. `isValidJSON` gate makes auto-correction unreachable in structured guardrail

**File:** `src/structured.ts:273-298`

The guardrail checks `isValidJSON()` first and short-circuits. `tryParseAndValidate` (which contains auto-correction logic) is never reached for fixable-but-invalid JSON, causing unnecessary retries.

**Fix:** Remove the `isValidJSON` early-return and rely solely on `tryParseAndValidate`.

### 11. Regex `/g` flag + `test()` then `replace()` skips matches

**File:** `src/utils/autoCorrect.ts:191-194`

`test()` advances `lastIndex` on the global regex, then `replace()` starts from that offset, missing the first trailing comma.

**Fix:** Don't use `test()` — just call `replace()` unconditionally and check if the result changed.

### 12. Backslash escape tracked outside strings in JSON guardrail

**File:** `src/guardrails/json.ts:59-62`

`escapeNext = true` fires for `\` even outside strings. If an LLM emits `\{`, the `{` is skipped and brace counting is corrupted.

**Fix:** Only set `escapeNext` when `state.inString` is true: `if (char === "\\" && state.inString)`.

### 13. `jsonRule()` closure state unsafe under concurrent use

**File:** `src/guardrails/json.ts:276-375`

Incremental state is captured in a single closure. Concurrent streams sharing the same rule instance (e.g. in consensus) will corrupt each other's state.

**Fix:** Key the incremental state per stream/context identity, or document that each concurrent stream must create its own `jsonRule()` instance.

### 14. Consensus timeout timer never cleared

**File:** `src/consensus.ts:160-168`

If `Promise.all` resolves before the timeout, the `setTimeout` keeps running and fires an unhandled rejection.

**Fix:** Store the timer ID and `clearTimeout` after the race resolves.

### 15. `isNetworkError` missing SSL error check

**File:** `src/utils/errors.ts:636-650`

`isNetworkError()` doesn't check `isSSLError()`, but `analyzeNetworkError()` does. SSL errors are classified as network errors in one function but not the other.

**Fix:** Add `isSSLError(error)` to the `isNetworkError` check chain.

### 16. Anthropic adapter `||` drops valid zero token counts

**File:** `src/adapters/anthropic.ts:230,244`

`usage.input_tokens || usage.output_tokens` is falsy when both are 0 (valid for cached requests). Usage data is silently dropped.

**Fix:** Use nullish checks: `usage.input_tokens != null || usage.output_tokens != null`.

### 17. Token estimation uses absolute position, not relative

**File:** `src/utils/chunking.ts:50-57`

`endPos % 4 === 0` counts tokens based on absolute document position. Chunks starting at different offsets get inconsistent sizes.

**Fix:** Use `(endPos - startPos) % 4 === 0` instead.

### 18. Custom `estimateTokens` ignored for actual chunking

**File:** `src/utils/chunking.ts:39-80`

The provided estimator is only used for metadata, while chunking uses a hardcoded 4-chars-per-token heuristic. Reported `tokenCount` disagrees with actual chunk sizing.

**Fix:** Use the provided `estimateTokens` function in the chunking loop, or document that it is metadata-only.

## Low Severity

### 19. Drift detectors fire permanently once triggered

**File:** `src/runtime/drift.ts:205-223`

`format_collapse` and `hedging` checks examine the immutable content prefix. Once triggered, they fire on every subsequent check for the entire stream.

**Fix:** Only run these checks once (on the first call or first N tokens) and cache the result, or deduplicate so the same drift type is not re-reported.

### 20. Fallback log message off-by-one

**File:** `src/runtime/l0.ts:1818-1821`

`fallbackIndex++` is called before the log message, so stream indices in the message are both off by one.

**Fix:** Use `fallbackIndex - 1` and `fallbackIndex` in the message string.

### 21. `countIdenticalOutputs` counts first-output matches, not largest group

**File:** `src/consensus.ts:389-394`

If the first output is an outlier, this returns 1 even if four other outputs are identical.

**Fix:** Count all groups and return the maximum.

### 22. `extractJSON` fallback tries `{}` regex before `[]` regardless of delimiter

**File:** `src/utils/autoCorrect.ts:343-354`

When the detected opening delimiter is `[`, the fallback still tries `{...}` first and may extract an inner object instead.

**Fix:** Use the detected `openChar`/`closeChar` to select which fallback regex to try first.

### 23. `createChunk` uses `indexOf` to re-find content position

**File:** `src/utils/chunking.ts:457-482`

For repeated content, `indexOf` can match the wrong occurrence. Callers already know the position and should pass it directly.

**Fix:** Pass the known `startPos` through directly rather than re-searching with `indexOf`.
