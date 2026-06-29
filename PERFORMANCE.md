# Performance Tuning Guide

This guide covers performance optimization for L0 in production environments.

> **Bundle size tip:** For smaller bundles, use subpath imports:
>
> ```typescript
> import { l0 } from "reliable-ai-streams/core"; // ~15KB minimal runtime
> import { createWindow } from "reliable-ai-streams/window";
> import { consensus } from "reliable-ai-streams/consensus";
> ```

## Table of Contents

- [Timeout Configuration](#timeout-configuration)
- [Retry Optimization](#retry-optimization)
- [Guardrail Performance](#guardrail-performance)
- [Memory Management](#memory-management)
- [Streaming Best Practices](#streaming-best-practices)
- [Document Window Tuning](#document-window-tuning)
- [Consensus Optimization](#consensus-optimization)

---

## Timeout Configuration

### Initial Token Timeout

The time to wait for the first token. Default is 5000ms. Set based on your model and network conditions:

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  timeout: {
    initialToken: 3000, // 3 seconds for first token
  },
});
```

**Recommendations:**

- **Fast models (gpt-5-mini, Claude Haiku):** 1500-2000ms
- **Standard models (GPT-4o, Claude Sonnet):** 2000-3000ms
- **Large models (GPT-4, Claude Opus):** 3000-5000ms
- **Edge/mobile networks:** Add 1000-2000ms buffer

### Inter-Token Timeout

Maximum gap between tokens during streaming. Default is 10000ms (10 seconds):

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  timeout: {
    interToken: 1000, // 1 second max gap
  },
});
```

**Recommendations:**

- **Most use cases:** 1000ms
- **Long-form generation:** 2000ms (models may pause to "think")
- **Code generation:** 1500ms (complex reasoning)

### Combined Timeout Configuration

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  timeout: {
    initialToken: 5000, // 5 seconds for first token (default)
    interToken: 10000, // 10 seconds between tokens (default)
  },
});
```

---

## Retry Optimization

### Backoff Strategies

Choose based on your use case:

```typescript
import { RETRY_DEFAULTS } from "reliable-ai-streams";

// Fixed jitter (default) - AWS-style fixed base + random jitter
// Good for: Most production workloads (prevents thundering herd)
retry: { backoff: "fixed-jitter", baseDelay: 1000, maxDelay: 10000 }

// Exponential - doubles delay each retry
// Good for: Gradual backpressure on overloaded services
retry: { backoff: "exponential", baseDelay: 1000, maxDelay: 10000 }

// Full jitter - random delay up to exponential max
// Good for: High-concurrency systems
retry: { backoff: "full-jitter", baseDelay: 1000, maxDelay: 10000 }

// Linear - adds baseDelay each retry
// Good for: Predictable delay requirements
retry: { backoff: "linear", baseDelay: 500, maxDelay: 5000 }

// Fixed - same delay every time
// Good for: Simple retry logic, testing
retry: { backoff: "fixed", baseDelay: 1000 }
```

### Retry Limits

L0 has two retry limits:

- **`attempts`**: Maximum retry attempts for model failures (default: 3). Network and transient errors do not count toward this limit.
- **`maxRetries`**: Absolute maximum retries across ALL error types (default: 6). This is a hard cap including network errors.

```typescript
// Conservative (fast failure)
retry: { attempts: 1 }

// Balanced
retry: { attempts: 2 }

// Default (recommended)
retry: { attempts: 3 }

// With custom absolute cap
retry: { attempts: 3, maxRetries: 10 }
```

### Selective Retry Reasons

Only retry on specific error types:

```typescript
// Defaults - all recoverable errors (unknown is NOT included by default)
retry: {
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
}

// Minimal - only retry network issues
retry: {
  retryOn: ["network_error", "timeout"]
}
```

Available retry reasons:

- `zero_output` - No tokens received
- `guardrail_violation` - Guardrail check failed
- `drift` - Content drift detected
- `incomplete` - Stream ended unexpectedly
- `network_error` - Network connectivity issues
- `timeout` - Request timed out
- `rate_limit` - Rate limit (429) response
- `server_error` - Server error (5xx) response
- `unknown` - Unknown error type (not included by default)

### Error-Type-Specific Delays

Configure custom delays for specific network error types:

```typescript
retry: {
  attempts: 3,
  baseDelay: 1000,
  errorTypeDelays: {
    connectionDropped: 1000,   // Default: 1000ms
    fetchError: 500,           // Default: 500ms
    econnreset: 1000,          // Default: 1000ms
    econnrefused: 2000,        // Default: 2000ms
    sseAborted: 500,           // Default: 500ms
    noBytes: 500,              // Default: 500ms
    partialChunks: 500,        // Default: 500ms
    runtimeKilled: 2000,       // Default: 2000ms
    backgroundThrottle: 5000,  // Default: 5000ms
    dnsError: 3000,            // Default: 3000ms
    timeout: 1000,             // Default: 1000ms
    unknown: 1000,             // Default: 1000ms
  }
}
```

### Error Categories

L0 categorizes errors for retry decision-making:

| Category    | Description                            | Counts Toward Limit               |
| ----------- | -------------------------------------- | --------------------------------- |
| `NETWORK`   | Network/connection failures            | No (retries forever with backoff) |
| `TRANSIENT` | Rate limits (429), 503, timeouts       | No (retries forever with backoff) |
| `MODEL`     | Model-side errors (bad response)       | Yes                               |
| `CONTENT`   | Guardrails, drift                      | Yes                               |
| `PROVIDER`  | API errors (may retry based on status) | Depends                           |
| `FATAL`     | Auth failures, invalid config          | No retry                          |
| `INTERNAL`  | Internal bugs                          | No retry                          |

---

## Guardrail Performance

### Check Intervals

Control how often guardrails run during streaming:

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  guardrails: recommendedGuardrails,
  checkIntervals: {
    guardrails: 10, // Check every 10 tokens (default: 5)
    drift: 20, // Check drift every 20 tokens (default: 10)
    checkpoint: 15, // Save checkpoint every 15 tokens (default: 10)
  },
});
```

**Performance Warning:** Both guardrails and drift detection scan the accumulated content at each check interval. For very long outputs (multi-MB), this becomes O(n) per check. Consider:

- Increasing intervals for long-form content
- Using streaming-optimized guardrail rules that only check the delta
- Setting a maximum content length before disabling checks

**Trade-offs:**

- Lower intervals = faster detection, higher CPU
- Higher intervals = lower CPU, delayed detection

**Recommendations:**

- For simple delta-only rules: 1-5 tokens
- For rules that scan full content: 10-20 tokens
- For very long outputs: 50+ tokens

### Guardrail Selection

Only include guardrails you need:

```typescript
// Minimal overhead
guardrails: [zeroOutputRule()];

// Balanced
guardrails: [jsonRule(), zeroOutputRule()];

// Full validation (higher overhead)
guardrails: recommendedGuardrails;
```

### Pattern Matching

For custom patterns, pre-compile regexes:

```typescript
// Pre-compile patterns at module level
const FORBIDDEN_PATTERNS = [/sensitive_keyword/i, /another_pattern/];

// Reuse in guardrails
guardrails: [customPatternRule(FORBIDDEN_PATTERNS, "Forbidden content")];
```

---

## Memory Management

### Error History Limits

Prevent memory leaks in long-running processes:

```typescript
retry: {
  attempts: 3,
  maxErrorHistory: 100  // Keep last 100 errors only (default: unlimited)
}
```

### Stream Consumption

Always consume streams to prevent memory buildup:

```typescript
// Good - fully consume stream
for await (const event of result.stream) {
  // Process events
}

// Bad - abandoned stream may leak
const result = await l0({ stream });
// Never consuming result.stream
```

### Checkpoint Pruning

Checkpoints grow with content. For long generations:

```typescript
// Access checkpoint for recovery
const checkpoint = result.state.checkpoint;

// Clear after use if not needed
result.state.checkpoint = "";
```

---

## Streaming Best Practices

### Token Buffering

L0 uses O(n) token accumulation internally. For custom processing:

```typescript
// Good - efficient accumulation
const tokens: string[] = [];
for await (const event of result.stream) {
  if (event.type === "token") tokens.push(event.value);
}
const content = tokens.join("");

// Avoid - O(n^2) string concatenation
let content = "";
for await (const event of result.stream) {
  if (event.type === "token") content += event.value; // Slow for large outputs
}
```

### Concurrent Streams

Use `AbortController` to cancel unused streams:

```typescript
const controller = new AbortController();

// Race multiple streams
const result = await Promise.race([
  l0({ stream: stream1, signal: controller.signal }),
  l0({ stream: stream2, signal: controller.signal }),
]);

// Cancel losers
controller.abort();
```

---

## Document Window Tuning

### Chunk Size

Balance context vs. token limits:

```typescript
// Small chunks - more API calls, better context per chunk
createWindow(doc, { size: 1000, overlap: 100 });

// Large chunks - fewer calls, may exceed limits
createWindow(doc, { size: 4000, overlap: 400 });
```

**Recommendations by model:**

- **GPT-4o (128K context):** 4000-8000 tokens/chunk
- **GPT-4o-mini (128K context):** 4000-8000 tokens/chunk
- **Claude 3.5 (200K context):** 8000-16000 tokens/chunk
- **Gemini 1.5 (1M context):** 16000+ tokens/chunk

### Overlap Strategy

Maintain context between chunks:

```typescript
// 10% overlap (standard)
createWindow(doc, { size: 2000, overlap: 200 });

// 20% overlap (better continuity)
createWindow(doc, { size: 2000, overlap: 400 });

// No overlap (independent chunks)
createWindow(doc, { size: 2000, overlap: 0 });
```

### Parallel Processing

Process chunks concurrently (default concurrency: 5):

```typescript
const results = await window.processAll(
  (chunk) => ({ stream: () => streamText({ model, prompt: chunk.content }) }),
  { concurrency: 3 }, // Process 3 chunks at a time
);
```

---

## Consensus Optimization

### Stream Count

Balance confidence vs. cost:

```typescript
// Minimum (low confidence)
consensus({ streams: [s1, s2] });

// Recommended (good confidence)
consensus({ streams: [s1, s2, s3] });

// High confidence (expensive)
consensus({ streams: [s1, s2, s3, s4, s5] });
```

### Strategy Selection

Choose based on requirements:

```typescript
// Majority - fastest, good for most cases
consensus({ strategy: "majority", threshold: 0.6 });

// Unanimous - strict, may fail more often
consensus({ strategy: "unanimous", threshold: 1.0 });

// Weighted - when some sources are more reliable
consensus({ strategy: "weighted", weights: [1.0, 0.8, 0.6] });
```

### Early Termination

For structured output comparison, L0 uses early termination in deep equality checks. This means consensus returns faster when outputs obviously differ.

---

## Benchmarks

Typical performance characteristics (measured on Node.js 20):

| Operation                  | Latency | Notes                    |
| -------------------------- | ------- | ------------------------ |
| Guardrail check (JSON)     | <0.1ms  | Per check interval       |
| Guardrail check (Markdown) | <0.2ms  | Per check interval       |
| Pattern detection          | <0.5ms  | Depends on pattern count |
| Deep equality check        | <1ms    | With early termination   |
| Structural similarity      | 1-5ms   | Depends on object depth  |
| Token accumulation         | O(n)    | Linear with token count  |

---

## RETRY_DEFAULTS Reference

L0 exports default retry configuration values:

```typescript
import { RETRY_DEFAULTS } from "reliable-ai-streams";

RETRY_DEFAULTS = {
  attempts: 3, // Maximum model failure retries
  maxRetries: 6, // Absolute maximum across all error types
  baseDelay: 1000, // Base delay in ms
  maxDelay: 10000, // Maximum delay cap in ms
  networkMaxDelay: 30000, // Max delay for network error suggestions
  backoff: "fixed-jitter", // Default backoff strategy
  retryOn: [
    // Default retry reasons
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

## Production Checklist

- [ ] Set appropriate timeouts for your model (`timeout.initialToken`, `timeout.interToken`)
- [ ] Configure retry limits to balance reliability vs. latency (`attempts`, `maxRetries`)
- [ ] Select only needed guardrails
- [ ] Set `maxErrorHistory` for long-running processes
- [ ] Use appropriate chunk sizes for document windows
- [ ] Pre-compile regex patterns for custom guardrails
- [ ] Consume all streams to prevent memory leaks
- [ ] Use `AbortController` for cancellation
- [ ] Consider error-type-specific delays for network errors
- [ ] Increase check intervals for long-form content generation
