# Error Handling Guide

This guide covers error handling patterns and error codes in L0.

## Table of Contents

- [Error Types](#error-types)
- [L0Error Class](#l0error-class)
- [Error Events](#error-events)
- [Error Codes](#error-codes)
- [Error Categories](#error-categories)
- [Network Error Detection](#network-error-detection)
- [Recovery Patterns](#recovery-patterns)
- [Best Practices](#best-practices)

---

## Error Types

L0 distinguishes between different error types for appropriate handling:

### L0 Errors

Errors thrown by L0 itself, with rich context for debugging and recovery:

```typescript
import { isL0Error, L0Error, L0ErrorCodes } from "reliable-ai-streams";

try {
  await l0({ stream, guardrails });
} catch (error) {
  if (isL0Error(error)) {
    // L0-specific error with context
    console.log(error.code); // L0ErrorCode
    console.log(error.category); // ErrorCategory
    console.log(error.context); // L0ErrorContext
    console.log(error.hasCheckpoint); // Has checkpoint for continuation?
    console.log(error.timestamp); // When error occurred
  }
}
```

### Network Errors

Transient failures from network issues:

```typescript
import { isNetworkError, analyzeNetworkError } from "reliable-ai-streams";

try {
  await l0({ stream });
} catch (error) {
  if (isNetworkError(error)) {
    const analysis = analyzeNetworkError(error);
    console.log(analysis.type); // NetworkErrorType
    console.log(analysis.retryable); // boolean
    console.log(analysis.countsTowardLimit); // boolean
    console.log(analysis.suggestion); // string
    console.log(analysis.context); // Additional context
  }
}
```

### Standard Errors

Regular JavaScript errors from invalid configuration or usage:

```typescript
try {
  await l0({ stream: null }); // Invalid
} catch (error) {
  // Standard Error
  console.log(error.message);
}
```

---

## L0Error Class

The `L0Error` class provides structured error information:

```typescript
class L0Error extends Error {
  readonly code: L0ErrorCode;
  readonly context: L0ErrorContext;
  readonly timestamp: number;

  // Properties
  get category(): ErrorCategory;
  get hasCheckpoint(): boolean;

  // Methods
  getCheckpoint(): string | undefined;
  toDetailedString(): string;
  toJSON(): Record<string, unknown>;
}
```

### L0ErrorContext

```typescript
interface L0ErrorContext {
  code: L0ErrorCode;
  checkpoint?: string; // Last good content for continuation
  tokenCount?: number; // Tokens before failure
  contentLength?: number; // Content length before failure
  modelRetryCount?: number; // Model retry attempts made
  networkRetryCount?: number; // Network retries made (don't count toward limit)
  fallbackIndex?: number; // Which fallback was tried (0 = primary)
  metadata?: Record<string, unknown>;
}
```

### Usage Example

```typescript
import { isL0Error } from "reliable-ai-streams";

try {
  const result = await l0({
    stream: () => streamText({ model, prompt }),
    guardrails: strictGuardrails,
  });
} catch (error) {
  if (isL0Error(error)) {
    // Log detailed error info
    console.error(error.toDetailedString());
    // "Message | Tokens: 42 | Retries: 2 | Fallback: 1 | Checkpoint: 150 chars"

    // Access JSON representation
    console.log(error.toJSON());
    // {
    //   name: "L0Error",
    //   code: "GUARDRAIL_VIOLATION",
    //   category: "content",
    //   message: "...",
    //   timestamp: 1699000000000,
    //   hasCheckpoint: true,
    //   checkpoint: 150,
    //   tokenCount: 42,
    //   modelRetryCount: 2,
    //   networkRetryCount: 0,
    //   fallbackIndex: 1
    // }

    // Check if we have a checkpoint for continuation
    if (error.hasCheckpoint) {
      const checkpoint = error.getCheckpoint();
      // Retry with checkpoint context
    }

    // Access specific context
    console.log(`Failed after ${error.context.tokenCount} tokens`);
    console.log(`Model retry attempts: ${error.context.modelRetryCount}`);
  }
}
```

---

## Error Events

When errors occur, L0 emits `ERROR` events with detailed failure and recovery information:

### FailureType

What actually went wrong - the root cause of the failure:

```typescript
import { FailureType } from "reliable-ai-streams";

type FailureType =
  | "network" // Connection drops, DNS, SSL, fetch errors
  | "model" // Model refused, content filter, guardrail violation
  | "tool" // Tool execution failed
  | "timeout" // Initial token or inter-token timeout
  | "abort" // User or signal abort
  | "zero_output" // Empty response from model
  | "unknown"; // Unclassified error
```

### RecoveryStrategy

What L0 decided to do next:

```typescript
import { RecoveryStrategy } from "reliable-ai-streams";

type RecoveryStrategy =
  | "retry" // Will retry the same stream
  | "fallback" // Will try next fallback stream
  | "continue" // Will continue despite error (non-fatal)
  | "halt"; // Will stop, no recovery possible
```

### RecoveryPolicy

Why L0 chose that recovery strategy:

```typescript
import { RecoveryPolicy } from "reliable-ai-streams";

interface RecoveryPolicy {
  retryEnabled: boolean; // Whether retry is enabled in config
  fallbackEnabled: boolean; // Whether fallback streams are configured
  maxRetries: number; // Maximum retry attempts configured
  maxFallbacks: number; // Maximum fallback streams configured
  attempt: number; // Current retry attempt (1-based)
  fallbackIndex: number; // Current fallback index (0 = primary)
}
```

### Handling Error Events

```typescript
import { EventType } from "reliable-ai-streams";
import type { ErrorEvent } from "reliable-ai-streams";

const result = await l0({
  stream: () => streamText({ model, prompt }),
  onEvent: (event) => {
    if (event.type === EventType.ERROR) {
      const e = event as ErrorEvent;

      console.log("Error:", e.error);
      console.log("Error code:", e.errorCode);
      console.log("Failure type:", e.failureType); // "network", "timeout", etc.
      console.log("Recovery:", e.recoveryStrategy); // "retry", "fallback", "halt"
      console.log("Policy:", e.policy);

      // Example: track failure types
      metrics.increment(`l0.failure.${e.failureType}`);
      metrics.increment(`l0.recovery.${e.recoveryStrategy}`);

      // Example: alert on exhausted retries
      if (e.recoveryStrategy === "halt") {
        alerting.send(`L0 halted after ${e.policy.attempt} attempts`);
      }
    }
  },
});
```

### ErrorEvent Interface

```typescript
interface ErrorEvent extends L0ObservabilityEvent {
  type: "ERROR";
  error: string;
  errorCode?: string;
  failureType: FailureType;
  recoveryStrategy: RecoveryStrategy;
  policy: RecoveryPolicy;
}
```

---

## Error Codes

L0 uses specific error codes for programmatic handling:

| Code                        | Description                                       | Category  |
| --------------------------- | ------------------------------------------------- | --------- |
| `STREAM_ABORTED`            | Stream was aborted (user cancellation or timeout) | PROVIDER  |
| `INITIAL_TOKEN_TIMEOUT`     | First token didn't arrive in time                 | TRANSIENT |
| `INTER_TOKEN_TIMEOUT`       | Gap between tokens exceeded limit                 | TRANSIENT |
| `ZERO_OUTPUT`               | Stream produced no meaningful output              | CONTENT   |
| `GUARDRAIL_VIOLATION`       | Content violated a guardrail rule                 | CONTENT   |
| `FATAL_GUARDRAIL_VIOLATION` | Content violated a fatal guardrail                | CONTENT   |
| `INVALID_STREAM`            | Stream factory returned invalid stream            | INTERNAL  |
| `ALL_STREAMS_EXHAUSTED`     | All streams (primary + fallbacks) failed          | PROVIDER  |
| `NETWORK_ERROR`             | Network-level failure                             | NETWORK   |
| `DRIFT_DETECTED`            | Output drifted from expected behavior             | CONTENT   |
| `ADAPTER_NOT_FOUND`         | Named adapter not found in registry               | INTERNAL  |
| `FEATURE_NOT_ENABLED`       | Feature requires explicit enablement              | INTERNAL  |

### L0ErrorCodes Constant

```typescript
import { L0ErrorCodes } from "reliable-ai-streams";

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

### Handling Specific Codes

```typescript
import { isL0Error, L0ErrorCodes } from "reliable-ai-streams";

try {
  await l0({ stream, guardrails });
} catch (error) {
  if (!isL0Error(error)) throw error;

  switch (error.code) {
    case L0ErrorCodes.ZERO_OUTPUT:
      // Model produced nothing - maybe adjust prompt
      console.log("Empty response, adjusting prompt...");
      break;

    case L0ErrorCodes.GUARDRAIL_VIOLATION:
      // Content failed validation - log for review
      console.log("Content violated:", error.context.metadata);
      break;

    case L0ErrorCodes.INITIAL_TOKEN_TIMEOUT:
      // First token slow - network or model overloaded
      console.log("Model slow to respond");
      break;

    case L0ErrorCodes.ALL_STREAMS_EXHAUSTED:
      // All models failed - critical failure
      console.error("All models unavailable");
      break;

    case L0ErrorCodes.ADAPTER_NOT_FOUND:
      // Named adapter not registered
      console.error("Register the adapter first");
      break;

    case L0ErrorCodes.FEATURE_NOT_ENABLED:
      // Feature needs to be enabled
      console.error("Call the enable function first");
      break;

    default:
      throw error;
  }
}
```

---

## Error Categories

L0's retry system categorizes errors for appropriate handling:

```typescript
import { ErrorCategory, getErrorCategory } from "reliable-ai-streams";

// Get category from error
const category = getErrorCategory(error);

// Or from L0Error
if (isL0Error(error)) {
  console.log(error.category);
}

switch (category) {
  case ErrorCategory.NETWORK:
    // Retry forever with backoff, doesn't count toward limit
    break;

  case ErrorCategory.TRANSIENT:
    // Rate limits, server errors, timeouts - retry forever
    break;

  case ErrorCategory.CONTENT:
    // Guardrails, drift, zero output - counts toward retry limit
    break;

  case ErrorCategory.MODEL:
    // Model-side errors - counts toward retry limit
    break;

  case ErrorCategory.PROVIDER:
    // Provider/API errors - may retry depending on status code
    break;

  case ErrorCategory.FATAL:
    // Don't retry (auth errors, SSL, invalid requests)
    break;

  case ErrorCategory.INTERNAL:
    // Internal bugs, invalid config - don't retry
    break;
}
```

### ErrorCategory Enum

```typescript
import { ErrorCategory } from "reliable-ai-streams";

enum ErrorCategory {
  NETWORK = "network", // Retry forever, doesn't count toward limit
  TRANSIENT = "transient", // Retry forever (429, 503), doesn't count
  MODEL = "model", // Model errors, counts toward retry limit
  CONTENT = "content", // Guardrails, drift, counts toward limit
  PROVIDER = "provider", // Provider/API errors
  FATAL = "fatal", // Don't retry (auth, SSL, config)
  INTERNAL = "internal", // Internal bugs, don't retry
}
```

### Category Breakdown

**NETWORK (retry forever, no count)**

- Connection dropped
- fetch() TypeError
- ECONNRESET / ECONNREFUSED
- SSE aborted
- DNS errors

**TRANSIENT (retry forever, no count)**

- 429 rate limit
- 503 server overload
- Timeouts (initial, inter-token)

**CONTENT (retry with limit)**

- Guardrail violations
- Drift detected
- Zero output

**MODEL (retry with limit)**

- Model-caused errors
- Bad response format
- Server error (model-side)

**PROVIDER (may retry)**

- Stream aborted
- All streams exhausted

**FATAL (no retry)**

- 401/403 auth errors
- Invalid request
- SSL errors
- Fatal guardrail violations

**INTERNAL (no retry)**

- Invalid stream
- Adapter not found
- Feature not enabled

---

## Network Error Detection

L0 provides detailed network error analysis:

```typescript
import {
  isNetworkError,
  analyzeNetworkError,
  NetworkErrorType,
} from "reliable-ai-streams";

if (isNetworkError(error)) {
  const analysis = analyzeNetworkError(error);

  console.log(analysis.type); // NetworkErrorType enum
  console.log(analysis.retryable); // boolean
  console.log(analysis.countsTowardLimit); // boolean (always false for network)
  console.log(analysis.suggestion); // Human-readable suggestion
  console.log(analysis.context); // Additional context
}
```

### Network Error Types

| Type                  | Description                        | Retryable |
| --------------------- | ---------------------------------- | --------- |
| `CONNECTION_DROPPED`  | Connection closed unexpectedly     | Yes       |
| `FETCH_ERROR`         | fetch() failed                     | Yes       |
| `ECONNRESET`          | Connection reset by peer           | Yes       |
| `ECONNREFUSED`        | Connection refused                 | Yes       |
| `SSE_ABORTED`         | Server-sent events aborted         | Yes       |
| `NO_BYTES`            | No data received                   | Yes       |
| `PARTIAL_CHUNKS`      | Incomplete data received           | Yes       |
| `RUNTIME_KILLED`      | Runtime terminated (Lambda/Vercel) | Yes       |
| `BACKGROUND_THROTTLE` | Mobile tab backgrounded            | Yes       |
| `DNS_ERROR`           | DNS resolution failed              | Yes       |
| `SSL_ERROR`           | SSL/TLS error                      | No        |
| `TIMEOUT`             | Request timed out                  | Yes       |
| `UNKNOWN`             | Unknown network error              | Yes       |

### Custom Delay by Error Type

```typescript
import { RETRY_DEFAULTS, ERROR_TYPE_DELAY_DEFAULTS } from "reliable-ai-streams";

const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: {
    ...RETRY_DEFAULTS,
    errorTypeDelays: {
      connectionDropped: 2000, // Wait longer for connection issues
      timeout: 500, // Retry faster on timeouts
      dnsError: 5000, // DNS needs more time
    },
  },
});
```

---

## Recovery Patterns

### Checkpoint Recovery

Use checkpoints to resume from last good state:

```typescript
let checkpoint = "";

try {
  const result = await l0({ stream, guardrails });
  for await (const event of result.stream) {
    // Process events
  }
} catch (error) {
  if (isL0Error(error)) {
    checkpoint = error.getCheckpoint() ?? "";

    // Retry with checkpoint context
    const result = await l0({
      stream: () =>
        streamText({
          model,
          prompt: `Continue from: ${checkpoint}\n\nOriginal prompt: ${prompt}`,
        }),
    });
  }
}
```

### Fallback Models

Automatically try cheaper models on failure:

```typescript
const result = await l0({
  stream: () => streamText({ model: openai("gpt-4o"), prompt }),
  fallbackStreams: [
    () => streamText({ model: openai("gpt-5-mini"), prompt }),
    () => streamText({ model: anthropic("claude-3-haiku"), prompt }),
  ],
});

// Check which model succeeded
if (result.state.fallbackIndex > 0) {
  console.log(`Used fallback model ${result.state.fallbackIndex}`);
}
```

### Graceful Degradation

Handle errors at the application level:

```typescript
async function generateWithFallback(prompt: string) {
  try {
    // Try L0 with full guardrails
    return await l0({
      stream: () => streamText({ model, prompt }),
      guardrails: strictGuardrails,
      retry: recommendedRetry,
    });
  } catch (error) {
    if (isL0Error(error) && error.code === L0ErrorCodes.ALL_STREAMS_EXHAUSTED) {
      // All models failed - return cached/default response
      return getCachedResponse(prompt);
    }
    throw error;
  }
}
```

---

## Best Practices

### 1. Always Check Error Type

```typescript
try {
  await l0({ stream, guardrails });
} catch (error) {
  if (isL0Error(error)) {
    // Handle L0-specific errors
  } else if (isNetworkError(error)) {
    // Handle network errors
  } else {
    // Handle other errors
    throw error;
  }
}
```

### 2. Log Error Context

```typescript
catch (error) {
  if (isL0Error(error)) {
    logger.error({
      code: error.code,
      category: error.category,
      tokenCount: error.context.tokenCount,
      modelRetryCount: error.context.modelRetryCount,
      networkRetryCount: error.context.networkRetryCount,
      checkpoint: error.getCheckpoint()?.slice(0, 100),
      timestamp: error.timestamp
    });
  }
}
```

### 3. Set Appropriate Retry Limits

```typescript
// Production: balance reliability vs latency
retry: {
  attempts: 3,           // Model errors (default: 3)
  maxRetries: 6,         // Absolute cap (all errors, default: 6)
  maxErrorHistory: 50    // Prevent memory leaks
}
```

### 4. Use Error Codes for Metrics

```typescript
catch (error) {
  if (isL0Error(error)) {
    metrics.increment(`l0.error.${error.code}`);
    metrics.increment(`l0.error.category.${error.category}`);
    metrics.increment(`l0.error.has_checkpoint.${error.hasCheckpoint}`);
  }
}
```

### 5. Handle Cancellation

```typescript
const controller = new AbortController();

// Cancel on user action
button.onclick = () => controller.abort();

try {
  await l0({
    stream: () => streamText({ model, prompt }),
    signal: controller.signal,
  });
} catch (error) {
  if (isL0Error(error) && error.code === L0ErrorCodes.STREAM_ABORTED) {
    // User cancelled - not an error
    return;
  }
  throw error;
}
```

### 6. Test Error Scenarios

```typescript
import { describe, it, expect } from "vitest";

describe("Error handling", () => {
  it("handles zero output", async () => {
    const mockStream = async function* () {
      // Emit nothing
    };

    await expect(l0({ stream: () => mockStream() })).rejects.toThrow(
      "ZERO_OUTPUT",
    );
  });

  it("handles network errors", async () => {
    const mockStream = async function* () {
      throw new TypeError("NetworkError");
    };

    // Should retry automatically
    await expect(
      l0({
        stream: () => mockStream(),
        retry: { maxRetries: 1 },
      }),
    ).rejects.toThrow();
  });
});
```

---

## Error Reference

### Complete Error Flow

```
Stream starts
    |
    v
[First token received?]--No--> INITIAL_TOKEN_TIMEOUT (TRANSIENT, retry)
    |
    Yes
    v
[Token gap OK?]--No--> INTER_TOKEN_TIMEOUT (TRANSIENT, retry)
    |
    Yes
    v
[Guardrail check]--Fail--> GUARDRAIL_VIOLATION (CONTENT, retry if not fatal)
    |                 |
    Pass        [Fatal?]--Yes--> FATAL_GUARDRAIL_VIOLATION (halt)
    v
[Content accumulates...]
    |
    v
[Stream complete?]--Error--> Check error type
    |                              |
    Yes                    [Network?]--Yes--> NETWORK (retry, no count)
    |                              |
    v                      [Model?]--Yes--> MODEL (retry, counts)
[Final validation]                 |
    |                      [Fatal?]--Yes--> FATAL (halt)
    v                              |
[Zero output?]--Yes--> ZERO_OUTPUT [Internal?]--Yes--> INTERNAL (halt)
    |              (CONTENT, retry)
    No
    v
Success!
```

### Error Code to Category Mapping

```typescript
// From getErrorCategory(code: L0ErrorCode): ErrorCategory

NETWORK_ERROR -> NETWORK
INITIAL_TOKEN_TIMEOUT -> TRANSIENT
INTER_TOKEN_TIMEOUT -> TRANSIENT
GUARDRAIL_VIOLATION -> CONTENT
FATAL_GUARDRAIL_VIOLATION -> CONTENT
DRIFT_DETECTED -> CONTENT
ZERO_OUTPUT -> CONTENT
INVALID_STREAM -> INTERNAL
ADAPTER_NOT_FOUND -> INTERNAL
FEATURE_NOT_ENABLED -> INTERNAL
STREAM_ABORTED -> PROVIDER
ALL_STREAMS_EXHAUSTED -> PROVIDER
```

---

## See Also

- [NETWORK_ERRORS.md](./NETWORK_ERRORS.md) - Network error handling
- [GUARDRAILS.md](./GUARDRAILS.md) - Guardrail violations
- [API.md](./API.md) - Complete API reference
