# Interceptors & Parallel Operations

> **Bundle size tip:** For smaller bundles, use subpath imports:
>
> ```typescript
> import { parallel, race } from "reliable-ai-streams/parallel";
> ```

## Interceptors

Interceptors provide hooks into the L0 execution pipeline for **request/response transformation**: auth injection, validation, rate limiting, and content transforms.

> **Note:** For **observability** (tracing, metrics, error tracking), use the `onEvent` callback instead of interceptors. See the [Monitoring section in README.md](./README.md#monitoring) for OpenTelemetry and Sentry integration patterns.

### Interface

```typescript
interface L0Interceptor {
  /**
   * Optional name for the interceptor
   */
  name?: string;

  /**
   * Before hook - runs before stream starts
   * Can modify options, inject metadata, add authentication, etc.
   */
  before?: (options: L0Options) => L0Options | Promise<L0Options>;

  /**
   * After hook - runs after stream completes
   * Can inspect output, post-process content, log results, etc.
   */
  after?: (result: L0Result) => L0Result | Promise<L0Result>;

  /**
   * Error hook - runs if an error occurs
   */
  onError?: (error: Error, options: L0Options) => void | Promise<void>;
}
```

### Built-In Interceptors

```typescript
import {
  loggingInterceptor, // Log execution start/complete/error
  metadataInterceptor, // Inject metadata into monitoring
  authInterceptor, // Add authentication tokens
  timingInterceptor, // Track detailed timing (enables monitoring)
  validationInterceptor, // Validate output content
  rateLimitInterceptor, // Throttle requests
  cachingInterceptor, // Cache results based on prompt hash
  transformInterceptor, // Post-process content
  analyticsInterceptor, // Send to analytics services
} from "reliable-ai-streams";

const result = await l0({
  stream: () => streamText({ model, prompt }),
  interceptors: [
    loggingInterceptor(console),
    metadataInterceptor({ user_id: "user_123" }),
    rateLimitInterceptor(10, 60000), // 10 requests per minute
    validationInterceptor((content) => content.length >= 100),
    transformInterceptor((content) => content.replace(/[*_`]/g, "")),
  ],
});
```

### Built-In Interceptor Details

#### loggingInterceptor

Logs L0 operations to a logger interface:

```typescript
loggingInterceptor(logger?: { info: Function, error: Function })

// Logs on before: "L0 execution starting" with hasGuardrails, hasRetry, hasMonitoring
// Logs on after: "L0 execution completed" with completed, tokens, retries, networkRetryCount, violations
// Logs on error: "L0 execution failed" with error message
```

#### metadataInterceptor

Injects metadata into monitoring (enables monitoring if not already):

```typescript
metadataInterceptor(metadata: Record<string, any>)

// Merges provided metadata into options.monitoring.metadata
```

#### authInterceptor

Adds authentication data to monitoring metadata:

```typescript
authInterceptor(getAuth: () => Record<string, any> | Promise<Record<string, any>>)

// Calls getAuth() and adds result to options.monitoring.metadata.auth
```

#### timingInterceptor

Enables detailed timing tracking:

```typescript
timingInterceptor();

// Sets monitoring.enabled = true, monitoring.includeTimings = true
// Generates a sessionId and tracks start time
```

#### validationInterceptor

Validates output content after completion:

```typescript
validationInterceptor(
  validate: (content: string) => boolean | Promise<boolean>,
  onInvalid?: (content: string) => void
)

// Throws "Output validation failed" if validate returns false
// Calls onInvalid callback if provided before throwing
```

#### rateLimitInterceptor

Throttles requests within a time window:

```typescript
rateLimitInterceptor(maxRequests: number, windowMs: number)

// Throws "Rate limit exceeded. Wait Xms before retrying." if over limit
// Tracks requests in a sliding window
```

#### cachingInterceptor

Caches results based on a custom cache key:

```typescript
cachingInterceptor(
  cache: Map<string, L0Result>,
  getCacheKey: (options: L0Options) => string
)

// Throws CachedResultError with cached result if key exists
// Note: Requires external handling to catch CachedResultError
```

#### transformInterceptor

Post-processes content after completion:

```typescript
transformInterceptor(transform: (content: string) => string | Promise<string>)

// Replaces result.state.content with transformed content
```

#### analyticsInterceptor

Sends execution data to an analytics service:

```typescript
analyticsInterceptor(track: (event: string, data: any) => void | Promise<void>)

// Tracks: "l0_started", "l0_completed", "l0_failed"
// Includes duration, tokens, retries, completed status, error message
```

### Custom Interceptor

```typescript
const myInterceptor: L0Interceptor = {
  name: "my-interceptor",
  before: async (options) => {
    console.log("Starting...");
    return options;
  },
  after: async (result) => {
    console.log("Completed!");
    return result;
  },
  onError: async (error, options) => {
    console.error("Failed:", error.message);
  },
};
```

### Execution Order

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  interceptors: [
    authInterceptor(getAuth), // before: 1st
    rateLimitInterceptor(10, 60000), // before: 2nd
    loggingInterceptor(), // before: 3rd
    validationInterceptor(validate), // after: 1st
    transformInterceptor(transform), // after: 2nd
  ],
});
// Before hooks: 1 → 2 → 3 (in order)
// After hooks: 1 → 2 (in order, not reversed)
// Error hooks: called for all interceptors if error occurs
```

### InterceptorManager

For advanced use cases, you can use the `InterceptorManager` class directly:

```typescript
import { InterceptorManager, createInterceptorManager } from "reliable-ai-streams";

const manager = createInterceptorManager([
  loggingInterceptor(),
  validationInterceptor(validate),
]);

// Execute hooks manually
const modifiedOptions = await manager.executeBefore(options);
const modifiedResult = await manager.executeAfter(result);
await manager.executeError(error, options);

// Get execution contexts for debugging
const contexts = manager.getContexts();
// Returns: Array<{ name, phase, timestamp, duration? }>

// Reset contexts
manager.reset();
```

---

## Parallel Operations

### Basic Usage

```typescript
import { parallel } from "reliable-ai-streams";

const results = await parallel(
  [
    {
      stream: () =>
        streamText({ model, prompt: "Translate to Spanish: Hello" }),
    },
    {
      stream: () => streamText({ model, prompt: "Translate to French: Hello" }),
    },
    {
      stream: () => streamText({ model, prompt: "Translate to German: Hello" }),
    },
  ],
  {
    concurrency: 2,
    failFast: false,
  },
);

console.log("Success:", results.successCount);
console.log("Spanish:", results.results[0]?.state.content);
```

### Options

```typescript
interface ParallelOptions {
  /**
   * Maximum number of concurrent operations (default: 5)
   */
  concurrency?: number;

  /**
   * Whether to fail fast on first error (default: false)
   */
  failFast?: boolean;

  /**
   * Shared retry configuration for all operations
   */
  sharedRetry?: L0Options["retry"];

  /**
   * Shared monitoring configuration for all operations
   */
  sharedMonitoring?: L0Options["monitoring"];

  /**
   * Callback for progress updates
   */
  onProgress?: (completed: number, total: number) => void;

  /**
   * Callback when an operation completes
   */
  onComplete?: (result: L0Result, index: number) => void;

  /**
   * Callback when an operation fails
   */
  onError?: (error: Error, index: number) => void;
}
```

### Result

```typescript
interface ParallelResult<TOutput = unknown> {
  /**
   * Results from all operations (null for failed operations if failFast: false)
   */
  results: Array<L0Result<TOutput> | null>;

  /**
   * Errors encountered (null for successful operations)
   */
  errors: Array<Error | null>;

  /**
   * Number of successful operations
   */
  successCount: number;

  /**
   * Number of failed operations
   */
  failureCount: number;

  /**
   * Total duration in milliseconds
   */
  duration: number;

  /**
   * Whether all operations succeeded
   */
  allSucceeded: boolean;

  /**
   * Aggregated telemetry from all operations
   */
  aggregatedTelemetry?: AggregatedTelemetry;
}

interface AggregatedTelemetry {
  totalTokens: number;
  totalDuration: number;
  totalRetries: number;
  totalNetworkErrors: number;
  totalViolations: number;
  avgTokensPerSecond: number;
  avgTimeToFirstToken: number;
}
```

### Helper Functions

```typescript
import {
  parallel,
  parallelAll,
  sequential,
  batched,
  race,
  createPool,
  OperationPool,
} from "reliable-ai-streams";

// Limited concurrency (default: 5)
await parallel(operations, { concurrency: 3 });

// Unlimited concurrency (concurrency = operations.length)
await parallelAll(operations);

// One at a time (concurrency: 1)
await sequential(operations);

// Process in batches (runs each batch in parallel, then next batch)
await batched(operations, 5); // batchSize as second argument

// First to succeed wins (uses Promise.any internally)
await race(operations);
```

### Race - Multi-Provider

```typescript
import { race } from "reliable-ai-streams";

const result = await race([
  { stream: () => streamText({ model: openai("gpt-4"), prompt }) },
  { stream: () => streamText({ model: anthropic("claude-3"), prompt }) },
  { stream: () => streamText({ model: google("gemini-pro"), prompt }) },
]);

// Uses first successful response
// Other operations are aborted via AbortController
console.log("Winner index:", result.winnerIndex);
```

### Race Result

```typescript
interface RaceResult<TOutput = unknown> extends L0Result<TOutput> {
  /**
   * Index of the winning operation (0-based)
   */
  winnerIndex: number;
}
```

### Pool - Reusable Workers

```typescript
import { createPool, OperationPool } from "reliable-ai-streams";

const pool = createPool(3, {
  sharedRetry: recommendedRetry,
  sharedMonitoring: { enabled: true },
});

const results = await Promise.all([
  pool.execute({ stream: () => streamText({ model, prompt: "Task 1" }) }),
  pool.execute({ stream: () => streamText({ model, prompt: "Task 2" }) }),
  pool.execute({ stream: () => streamText({ model, prompt: "Task 3" }) }),
]);

// Wait for all queued operations to complete
await pool.drain();

// Get current status
console.log("Queue length:", pool.getQueueLength());
console.log("Active workers:", pool.getActiveWorkers());
```

### OperationPool Methods

| Method               | Description                            |
| -------------------- | -------------------------------------- |
| `execute(options)`   | Add operation to pool, returns Promise |
| `drain()`            | Wait for all operations to complete    |
| `getQueueLength()`   | Get number of queued operations        |
| `getActiveWorkers()` | Get number of currently active workers |

---

## Fall-Through vs Race

### Fall-Through (Sequential Fallback)

Try models one at a time, moving to next only if current exhausts retries:

```typescript
const result = await l0({
  stream: () => streamText({ model: openai("gpt-4o"), prompt }),
  fallbackStreams: [
    () => streamText({ model: openai("gpt-5-mini"), prompt }),
    () => streamText({ model: anthropic("claude-3-haiku"), prompt }),
  ],
  retry: recommendedRetry,
});
// 1. GPT-4o (2 retries) → 2. gpt-5-mini (2 retries) → 3. Claude Haiku (2 retries)
```

**Use when:** Cost matters, latency acceptable, high availability required.

### Race (Parallel)

Call all models simultaneously, use fastest response:

```typescript
const result = await race([
  { stream: () => streamText({ model: openai("gpt-4o"), prompt }) },
  { stream: () => streamText({ model: anthropic("claude-3-opus"), prompt }) },
  { stream: () => streamText({ model: google("gemini-pro"), prompt }) },
]);
// All called at once, first to complete wins
// Others are automatically aborted
```

**Use when:** Latency critical, cost not a constraint.

### Comparison

| Aspect    | Fall-Through      | Race               |
| --------- | ----------------- | ------------------ |
| Execution | Sequential        | Parallel           |
| Latency   | Higher            | Lower              |
| Cost      | Low               | High (pay for all) |
| Best For  | High availability | Low latency        |

### Hybrid Pattern

```typescript
const result = await l0({
  stream: async () =>
    race([
      { stream: () => streamText({ model: openai("gpt-5-mini"), prompt }) },
      {
        stream: () =>
          streamText({ model: anthropic("claude-3-haiku"), prompt }),
      },
    ]),
  fallbackStreams: [
    () => streamText({ model: openai("gpt-5-mini"), prompt }),
    () => streamText({ model: anthropic("claude-3-opus"), prompt }),
  ],
});
// Fast models race first, fallback to quality if both fail
```

---

## Batched Operations

Process operations in batches with control over batch size:

```typescript
import { batched } from "reliable-ai-streams";

const result = await batched(
  operations,
  5, // batchSize - operations per batch
  {
    failFast: false,
    onProgress: (completed, total) => {
      console.log(`Progress: ${completed}/${total}`);
    },
  },
);

// Runs 5 operations in parallel, waits for all to complete
// Then runs next 5 operations, and so on
```

The `batched` function differs from `parallel` in that it waits for each batch to fully complete before starting the next batch, rather than maintaining a rolling window of concurrent operations.
