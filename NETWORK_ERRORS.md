# Network Error Handling Guide

L0 provides comprehensive network error detection and automatic recovery.

## Quick Start

```typescript
import { l0, recommendedRetry } from "reliable-ai-streams";

const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: recommendedRetry, // Handles all network errors automatically
});

console.log("Network retries:", result.state.networkRetryCount);
console.log("Model retries:", result.state.modelRetryCount);
```

---

## Supported Error Types

| Error Type          | Description                | Retries | Base Delay |
| ------------------- | -------------------------- | ------- | ---------- |
| Connection Dropped  | Connection lost mid-stream | Yes     | 1000ms     |
| fetch() TypeError   | Fetch API failure          | Yes     | 500ms      |
| ECONNRESET          | Connection reset by peer   | Yes     | 1000ms     |
| ECONNREFUSED        | Server refused connection  | Yes     | 2000ms     |
| SSE Aborted         | Server-sent events aborted | Yes     | 500ms      |
| No Bytes            | Server sent no data        | Yes     | 500ms      |
| Partial Chunks      | Incomplete data received   | Yes     | 500ms      |
| Runtime Killed      | Lambda/Edge timeout        | Yes     | 2000ms     |
| Background Throttle | Mobile tab backgrounded    | Yes     | 5000ms     |
| DNS Error           | Host not found             | Yes     | 3000ms     |
| SSL Error           | Certificate/TLS error      | **No**  | -          |
| Timeout             | Request timed out          | Yes     | 1000ms     |
| Unknown             | Unknown network error      | Yes     | 1000ms     |

**Key:** Network errors do NOT count toward the model retry limit.

---

## Error Categories

L0 classifies errors into categories that determine retry behavior:

```typescript
import { ErrorCategory } from "reliable-ai-streams";

enum ErrorCategory {
  NETWORK = "network", // Retry forever, doesn't count toward limit
  TRANSIENT = "transient", // Retry forever (429, 503, timeouts), doesn't count
  MODEL = "model", // Model errors, counts toward retry limit
  CONTENT = "content", // Guardrails/drift, counts toward limit
  PROVIDER = "provider", // Provider/API errors
  FATAL = "fatal", // Don't retry (auth, SSL, config)
  INTERNAL = "internal", // Internal bugs, don't retry
}
```

---

## Error Detection

```typescript
import {
  isNetworkError,
  analyzeNetworkError,
  NetworkErrorType,
} from "reliable-ai-streams";

try {
  await l0({ stream, retry: recommendedRetry });
} catch (error) {
  if (isNetworkError(error)) {
    const analysis = analyzeNetworkError(error);
    console.log("Type:", analysis.type); // NetworkErrorType
    console.log("Retryable:", analysis.retryable);
    console.log("Counts toward limit:", analysis.countsTowardLimit);
    console.log("Suggestion:", analysis.suggestion);
    console.log("Context:", analysis.context);
  }
}
```

### NetworkErrorType Enum

```typescript
import { NetworkErrorType } from "reliable-ai-streams";

enum NetworkErrorType {
  CONNECTION_DROPPED = "connection_dropped",
  FETCH_ERROR = "fetch_error",
  ECONNRESET = "econnreset",
  ECONNREFUSED = "econnrefused",
  SSE_ABORTED = "sse_aborted",
  NO_BYTES = "no_bytes",
  PARTIAL_CHUNKS = "partial_chunks",
  RUNTIME_KILLED = "runtime_killed",
  BACKGROUND_THROTTLE = "background_throttle",
  DNS_ERROR = "dns_error",
  SSL_ERROR = "ssl_error",
  TIMEOUT = "timeout",
  UNKNOWN = "unknown",
}
```

### NetworkErrorAnalysis Interface

```typescript
interface NetworkErrorAnalysis {
  type: NetworkErrorType;
  retryable: boolean;
  countsTowardLimit: boolean;
  suggestion: string;
  context?: Record<string, any>;
}
```

### Specific Error Checks

```typescript
import {
  isConnectionDropped,
  isECONNRESET,
  isECONNREFUSED,
  isSSEAborted,
  isTimeoutError,
  isDNSError,
  isSSLError,
} from "reliable-ai-streams";

if (isConnectionDropped(error)) {
  // Connection was dropped mid-stream
}

if (isTimeoutError(error)) {
  // Request timed out
}

if (isSSLError(error)) {
  // SSL/TLS error - NOT retryable
}
```

---

## Retry Configuration

### Retry Presets

```typescript
import {
  minimalRetry,
  recommendedRetry,
  strictRetry,
  exponentialRetry,
} from "reliable-ai-streams";

// minimalRetry: 2 attempts, 4 max, linear backoff
// recommendedRetry: 3 attempts, 6 max, fixed-jitter backoff (default)
// strictRetry: 3 attempts, 6 max, full-jitter backoff
// exponentialRetry: 4 attempts, 8 max, exponential backoff
```

### Retry Defaults

```typescript
import { RETRY_DEFAULTS, ERROR_TYPE_DELAY_DEFAULTS } from "reliable-ai-streams";

// RETRY_DEFAULTS
{
  attempts: 3,           // Max model failure retries
  maxRetries: 6,         // Absolute max across ALL error types
  baseDelay: 1000,       // Base delay in ms
  maxDelay: 10000,       // Max delay cap in ms
  networkMaxDelay: 30000, // Max delay for network errors
  backoff: "fixed-jitter",
  retryOn: [
    "zero_output",
    "guardrail_violation",
    "drift",
    "incomplete",
    "network_error",
    "timeout",
    "rate_limit",
    "server_error"
  ]
}

// ERROR_TYPE_DELAY_DEFAULTS
{
  connectionDropped: 1000,
  fetchError: 500,
  econnreset: 1000,
  econnrefused: 2000,
  sseAborted: 500,
  noBytes: 500,
  partialChunks: 500,
  runtimeKilled: 2000,
  backgroundThrottle: 5000,
  dnsError: 3000,
  timeout: 1000,
  unknown: 1000
}
```

### Custom Delay Configuration

Configure different delays for each error type:

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: {
    attempts: 3,
    maxRetries: 6, // Absolute cap across ALL error types
    backoff: "fixed-jitter",
    errorTypeDelays: {
      connectionDropped: 2000, // 2s for connection drops
      fetchError: 500, // 0.5s for fetch errors
      econnreset: 1500, // 1.5s for ECONNRESET
      econnrefused: 3000, // 3s for ECONNREFUSED
      sseAborted: 1000, // 1s for SSE aborted
      noBytes: 500, // 0.5s for no bytes
      partialChunks: 750, // 0.75s for partial chunks
      runtimeKilled: 5000, // 5s for runtime kills
      backgroundThrottle: 10000, // 10s for background throttle
      dnsError: 4000, // 4s for DNS errors
      timeout: 2000, // 2s for timeouts
      unknown: 1000, // 1s for unknown errors
    },
  },
});
```

### Backoff Strategies

```typescript
type BackoffStrategy =
  | "exponential" // 2^n * baseDelay
  | "linear" // n * baseDelay
  | "fixed" // baseDelay (constant)
  | "full-jitter" // random(0, 2^n * baseDelay)
  | "fixed-jitter"; // random(baseDelay/2, baseDelay * 1.5) - AWS-style
```

---

## Environment-Specific Configuration

### Mobile

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: {
    attempts: 3,
    maxRetries: 8, // Allow more retries on mobile
    backoff: "full-jitter",
    errorTypeDelays: {
      backgroundThrottle: 15000, // Wait longer for mobile
      timeout: 3000, // More lenient timeouts
      connectionDropped: 2500, // Mobile networks unstable
    },
  },

  // Optional: Timeouts (ms), default as follows
  timeout: {
    initialToken: 5000, // 5s to first token
    interToken: 10000, // 10s between tokens
  },
});
```

### Edge Runtime

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: {
    attempts: 3,
    maxRetries: 4, // Keep total retries low
    backoff: "fixed-jitter",
    maxDelay: 5000, // Keep delays short
    errorTypeDelays: {
      runtimeKilled: 2000, // Quick retry on timeout
      timeout: 1500,
    },
  },

  // Optional: Timeouts (ms), default as follows
  timeout: {
    initialToken: 5000, // 5s to first token
    interToken: 10000, // 10s between tokens
  },
});
```

---

## Retry Manager

For advanced use cases, use the RetryManager directly:

```typescript
import { createRetryManager, ErrorCategory } from "reliable-ai-streams";

const manager = createRetryManager({
  attempts: 3,
  maxRetries: 6,
  backoff: "fixed-jitter",
});

// Categorize an error
const categorized = manager.categorizeError(error);
console.log("Category:", categorized.category);
console.log("Retryable:", categorized.retryable);
console.log("Counts toward limit:", categorized.countsTowardLimit);
console.log("Reason:", categorized.reason);

// Check if should retry
const decision = manager.shouldRetry(error);
console.log("Should retry:", decision.shouldRetry);
console.log("Delay:", decision.delay);
console.log("Reason:", decision.reason);

// Execute with automatic retry
const result = await manager.execute(
  async () => {
    // Your async operation
  },
  (context) => {
    // onRetry callback
    console.log("Retrying...", context.state.attempt);
  },
);

// Get state
const state = manager.getState();
console.log("Model retries:", state.attempt);
console.log("Network retries:", state.networkRetryCount);
console.log("Transient retries:", state.transientRetries);
console.log("Total delay:", state.totalDelay);

// Reset state
manager.reset();
```

### Helper Functions

```typescript
import { isRetryableError, getErrorCategory } from "reliable-ai-streams";

// Quick check if error is retryable
if (isRetryableError(error)) {
  // Can retry this error
}

// Get error category
const category = getErrorCategory(error);
if (category === ErrorCategory.NETWORK) {
  // Network error
}
```

---

## Monitoring

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: recommendedRetry,
  monitoring: {
    onRetry: (attempt, error) => {
      if (isNetworkError(error)) {
        logger.warn("Network retry", {
          attempt,
          type: analyzeNetworkError(error).type,
        });
      }
    },
  },
});

// After completion
console.log("Network retries:", result.state.networkRetryCount);
console.log("Model retries:", result.state.modelRetryCount);
```

---

## Utility Functions

```typescript
import {
  suggestRetryDelay, // Get recommended delay for error
  describeNetworkError, // Human-readable description
  isStreamInterrupted, // Check if stream was interrupted
} from "reliable-ai-streams";

// Get suggested delay with exponential backoff
const delay = suggestRetryDelay(error, attemptNumber);

// With custom delays
const customDelay = suggestRetryDelay(
  error,
  attemptNumber,
  {
    [NetworkErrorType.CONNECTION_DROPPED]: 2000,
    [NetworkErrorType.TIMEOUT]: 1500,
  },
  30000, // maxDelay
);

// Get description
const description = describeNetworkError(error);
// "Network error: econnreset (Connection was reset by peer)"

// Check if stream was interrupted mid-flight
if (isStreamInterrupted(error, tokenCount)) {
  console.log("Partial content in checkpoint");
}
```

---

## L0Error Class

L0 provides an enhanced error class with recovery context:

```typescript
import { L0Error, isL0Error, L0ErrorCodes } from "reliable-ai-streams";

try {
  await l0({ stream, retry: recommendedRetry });
} catch (error) {
  if (isL0Error(error)) {
    console.log("Code:", error.code);
    console.log("Category:", error.category);
    console.log("Has checkpoint:", error.hasCheckpoint);
    console.log("Checkpoint:", error.getCheckpoint());
    console.log("Timestamp:", error.timestamp);
    console.log("Details:", error.toDetailedString());
    console.log("JSON:", error.toJSON());
  }
}
```

### L0 Error Codes

```typescript
const L0ErrorCodes = {
  STREAM_ABORTED: "STREAM_ABORTED",
  INITIAL_TOKEN_TIMEOUT: "INITIAL_TOKEN_TIMEOUT",
  INTER_TOKEN_TIMEOUT: "INTER_TOKEN_TIMEOUT",
  ZERO_OUTPUT: "ZERO_OUTPUT",
  GUARDRAIL_VIOLATION: "GUARDRAIL_VIOLATION",
  FATAL_GUARDRAIL_VIOLATION: "FATAL_GUARDRAIL_VIOLATION",
  INVALID_STREAM: "INVALID_STREAM",
  ALL_STREAMS_EXHAUSTED: "ALL_STREAMS_EXHAUSTED",
  NETWORK_ERROR: "NETWORK_ERROR",
  DRIFT_DETECTED: "DRIFT_DETECTED",
  ADAPTER_NOT_FOUND: "ADAPTER_NOT_FOUND",
  FEATURE_NOT_ENABLED: "FEATURE_NOT_ENABLED",
};
```

### L0ErrorContext Interface

```typescript
interface L0ErrorContext {
  code: L0ErrorCode;
  checkpoint?: string;
  tokenCount?: number;
  contentLength?: number;
  modelRetryCount?: number;
  networkRetryCount?: number;
  fallbackIndex?: number;
  metadata?: Record<string, unknown>;
}
```

---

## Best Practices

1. **Use `recommendedRetry`** - Handles all network errors automatically with sensible defaults
2. **Set `maxRetries`** - Prevent infinite loops with an absolute cap across all error types
3. **Set appropriate timeouts** - Higher for mobile/edge, lower for fast models
4. **Customize delays per error type** - Tune for your infrastructure
5. **Monitor network retries** - Alert if consistently high
6. **Handle checkpoints** - Partial content preserved in `result.state.checkpoint`
7. **Use `maxErrorHistory`** - Prevent memory leaks in long-running processes

```typescript
// Production configuration
const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: {
    attempts: 3,
    maxRetries: 6, // Absolute cap
    backoff: "full-jitter",
    maxDelay: 10000,
    maxErrorHistory: 100, // Prevent memory leaks
    errorTypeDelays: {
      connectionDropped: 1000,
      runtimeKilled: 3000,
      backgroundThrottle: 10000,
    },
  },

  // Optional: Timeouts (ms)
  timeout: {
    initialToken: 5000, // 5s to first token
    interToken: 10000, // 10s between tokens
  },
});

// Check results
if (result.state.networkRetryCount > 0) {
  logger.warn(`Experienced ${result.state.networkRetryCount} network retries`);
}
```

---

## See Also

- [API.md](./API.md) - Complete API reference
- [ERROR_HANDLING.md](./ERROR_HANDLING.md) - Error codes and L0Error
- [PERFORMANCE.md](./PERFORMANCE.md) - Performance tuning
