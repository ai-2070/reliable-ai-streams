# Event Sourcing - Atomic, Replayable Operations

L0 includes a built-in event sourcing system that makes every stream operation atomic and replayable. This enables deterministic testing, time-travel debugging, production failure reproduction, and complete audit trails.

## The Key Insight

**Replayability MUST ignore external sources of non-determinism.**

In replay mode:

- No network calls
- No retries
- No timeouts
- No fallbacks
- No guardrail evaluations
- No drift detection

Replay becomes **pure stream rehydration** - exactly like Kafka's read-your-own-history.

Derived computations (guardrails, drift, retries) are stored **AS events**, not recomputed on replay. This is critical for deterministic behavior.

## Quick Start

### Recording a Stream

```typescript
import { createInMemoryEventStore, createEventRecorder } from "reliable-ai-streams";

const store = createInMemoryEventStore();
const recorder = createEventRecorder(store, "my-stream-id");

// Record events as they happen
await recorder.recordStart({
  prompt: "Explain quantum computing",
  model: "gpt-5-micro",
});
await recorder.recordToken("Quantum", 0);
await recorder.recordToken(" ", 1);
await recorder.recordToken("computing", 2);
await recorder.recordCheckpoint(2, "Quantum computing");
await recorder.recordToken(" ", 3);
await recorder.recordToken("is...", 4);
await recorder.recordComplete("Quantum computing is...", 5);
```

### Replaying a Stream

```typescript
import { replay } from "reliable-ai-streams";

const result = await replay({
  streamId: "my-stream-id",
  eventStore: store,
  fireCallbacks: true, // Replay callbacks (onToken, onViolation, etc.) fire
  speed: 0, // 0 = instant, 1 = real-time
});

// Exact same events as original
for await (const event of result.stream) {
  if (event.type === "token") {
    console.log(event.value);
  }
}

// State is reconstructed identically
console.log(result.state.content); // "Quantum computing is..."
console.log(result.state.tokenCount); // 5
console.log(result.state.completed); // true
```

## Event Types

L0 uses a lean, composable event schema. Import `L0RecordedEventTypes` for type-safe event type constants:

```typescript
import { L0RecordedEventTypes } from "reliable-ai-streams";

type L0RecordedEvent =
  | { type: "START"; ts: number; options: SerializedOptions }
  | { type: "TOKEN"; ts: number; value: string; index: number }
  | { type: "CHECKPOINT"; ts: number; at: number; content: string }
  | { type: "GUARDRAIL"; ts: number; at: number; result: GuardrailEventResult }
  | { type: "DRIFT"; ts: number; at: number; result: DriftEventResult }
  | {
      type: "RETRY";
      ts: number;
      reason: string;
      attempt: number;
      countsTowardLimit: boolean;
    }
  | { type: "FALLBACK"; ts: number; to: number }
  | { type: "CONTINUATION"; ts: number; checkpoint: string; at: number }
  | { type: "COMPLETE"; ts: number; content: string; tokenCount: number }
  | {
      type: "ERROR";
      ts: number;
      error: SerializedError;
      failureType: FailureType;
      recoveryStrategy: RecoveryStrategy;
      policy: RecoveryPolicy;
    };
```

### Event Descriptions

| Event          | Description                                          |
| -------------- | ---------------------------------------------------- |
| `START`        | Stream execution started with serialized options     |
| `TOKEN`        | Token received from LLM stream                       |
| `CHECKPOINT`   | Checkpoint saved for continuation support            |
| `GUARDRAIL`    | Guardrail evaluation result (stored, not recomputed) |
| `DRIFT`        | Drift detection result (stored, not recomputed)      |
| `RETRY`        | Retry triggered with reason and attempt count        |
| `FALLBACK`     | Fallback to next stream in chain                     |
| `CONTINUATION` | Resumed from checkpoint after failure                |
| `COMPLETE`     | Stream completed successfully                        |
| `ERROR`        | Stream failed with error, failure type, and recovery |

### Serialized Options

```typescript
interface SerializedOptions {
  prompt?: string;
  model?: string;
  retry?: {
    attempts?: number;
    maxRetries?: number;
    baseDelay?: number;
    maxDelay?: number;
    backoff?: BackoffStrategy;
  };
  timeout?: {
    initialToken?: number;
    interToken?: number;
  };
  checkIntervals?: {
    guardrails?: number;
    drift?: number;
    checkpoint?: number;
  };
  continueFromLastKnownGoodToken?: boolean;
  detectDrift?: boolean;
  detectZeroTokens?: boolean;
  fallbackCount?: number;
  guardrailCount?: number;
  metadata?: Record<string, unknown>;
}
```

### Guardrail and Drift Event Results

```typescript
interface GuardrailEventResult {
  violations: GuardrailViolation[];
  shouldRetry: boolean;
  shouldHalt: boolean;
}

interface DriftEventResult {
  detected: boolean;
  types: string[];
  confidence: number;
}
```

## Event Store Interface

```typescript
interface L0EventStore {
  append(streamId: string, event: L0RecordedEvent): Promise<void>;
  getEvents(streamId: string): Promise<L0EventEnvelope[]>;
  exists(streamId: string): Promise<boolean>;
  getLastEvent(streamId: string): Promise<L0EventEnvelope | null>;
  getEventsAfter(
    streamId: string,
    afterSeq: number,
  ): Promise<L0EventEnvelope[]>;
  delete(streamId: string): Promise<void>;
  listStreams(): Promise<string[]>;
}
```

### In-Memory Store

For testing and short-lived sessions:

```typescript
import { createInMemoryEventStore } from "reliable-ai-streams";

const store = createInMemoryEventStore();

// Use it
await store.append("stream-1", {
  type: "TOKEN",
  ts: Date.now(),
  value: "hello",
  index: 0,
});

// Check stats
console.log(store.getStreamCount()); // 1
console.log(store.getTotalEventCount()); // 1

// Clear all data
store.clear();
```

## Recording Patterns

### Using L0EventRecorder

The recorder provides convenient methods for each event type:

```typescript
import { createEventRecorder, createInMemoryEventStore } from "reliable-ai-streams";

const store = createInMemoryEventStore();
const recorder = createEventRecorder(store);

// Auto-generates stream ID
console.log(recorder.getStreamId()); // "l0_abc123..."

// Get current sequence number
console.log(recorder.getSeq()); // 0

// Record events
await recorder.recordStart({ prompt: "test", model: "gpt-5-micro" });
await recorder.recordToken("Hello", 0);
await recorder.recordToken(" World", 1);
await recorder.recordCheckpoint(1, "Hello World");

// Record guardrail evaluation (stored, not recomputed on replay)
await recorder.recordGuardrail(1, {
  violations: [],
  shouldRetry: false,
  shouldHalt: false,
});

// Record drift detection
await recorder.recordDrift(1, {
  detected: false,
  types: [],
  confidence: 0,
});

// Record retry
await recorder.recordRetry("rate_limit", 1, true);

// Record fallback
await recorder.recordFallback(1);

// Record continuation
await recorder.recordContinuation("Hello World", 1);

// Complete or error
await recorder.recordComplete("Hello World", 2);
// OR
await recorder.recordError(
  { name: "Error", message: "Failed" },
  "network_error", // failureType
  "retry", // recoveryStrategy
  "default", // policy
);
```

### Recording a Complex Stream

```typescript
const recorder = createEventRecorder(store);

await recorder.recordStart({ prompt: "Analyze data", model: "gpt-5-micro" });

// Stream tokens
await recorder.recordToken("The", 0);
await recorder.recordToken(" data", 1);
await recorder.recordToken(" shows", 2);

// Guardrail check (result is stored)
await recorder.recordGuardrail(2, {
  violations: [
    {
      rule: "json",
      message: "Not valid JSON yet",
      severity: "warning",
      recoverable: true,
    },
  ],
  shouldRetry: false,
  shouldHalt: false,
});

// More tokens
await recorder.recordToken("...", 3);

// Checkpoint for continuation
await recorder.recordCheckpoint(3, "The data shows...");

// Network error triggers retry
await recorder.recordRetry("network_error", 1, false);

// Continuation from checkpoint
await recorder.recordContinuation("The data shows...", 3);

// Stream continues
await recorder.recordToken(" growth", 4);
await recorder.recordComplete("The data shows... growth", 5);
```

## Replay Patterns

### Basic Replay

```typescript
import { replay } from "reliable-ai-streams";

const result = await replay({
  streamId: "my-stream",
  eventStore: store,
});

for await (const event of result.stream) {
  console.log(event);
}
```

### Replay with Callbacks

Monitoring callbacks **still fire during replay**:

```typescript
const result = await replay({
  streamId: "my-stream",
  eventStore: store,
  fireCallbacks: true,
});

// Set callbacks before iterating
result.setCallbacks({
  onToken: (token) => console.log("Token:", token),
  onViolation: (v) => console.log("Violation:", v),
  onRetry: (attempt, reason) => console.log(`Retry ${attempt}: ${reason}`),
  onEvent: (event) => console.log("Event:", event.type),
});

for await (const event of result.stream) {
  // Process events
}
```

### Replay with Timing

Simulate original timing for debugging:

```typescript
// Real-time replay (1x speed)
const result = await replay({
  streamId: "my-stream",
  eventStore: store,
  speed: 1, // 1 = real-time
});

// 10x speed replay
const fast = await replay({
  streamId: "my-stream",
  eventStore: store,
  speed: 10,
});

// Instant replay (default)
const instant = await replay({
  streamId: "my-stream",
  eventStore: store,
  speed: 0,
});
```

### Partial Replay

Replay a specific range of events:

```typescript
const result = await replay({
  streamId: "my-stream",
  eventStore: store,
  fromSeq: 5, // Start from event 5
  toSeq: 15, // Stop at event 15
});
```

### Replay to State

Get final state without iterating:

```typescript
import { createEventReplayer } from "reliable-ai-streams";

const replayer = createEventReplayer(store);
const state = await replayer.replayToState("my-stream");

console.log(state.content); // Final content
console.log(state.tokenCount); // Token count
console.log(state.checkpoint); // Last checkpoint content
console.log(state.completed); // true/false
console.log(state.violations); // Guardrail violations
console.log(state.retryAttempts); // Model retry count
console.log(state.networkRetryCount); // Network retry count
console.log(state.fallbackIndex); // Which fallback was used
console.log(state.driftDetected); // Whether drift was detected
console.log(state.error); // Error if failed (SerializedError | null)
console.log(state.startTs); // Start timestamp
console.log(state.endTs); // End timestamp
```

### Replay Tokens Only

```typescript
const replayer = createEventReplayer(store);

for await (const token of replayer.replayTokens("my-stream")) {
  process.stdout.write(token);
}

// With timing simulation
for await (const token of replayer.replayTokens("my-stream", { speed: 1 })) {
  process.stdout.write(token);
}
```

### Replay with Generator

Use the replayer's generator for more control:

```typescript
const replayer = createEventReplayer(store);

for await (const envelope of replayer.replay("my-stream", {
  speed: 0,
  fromSeq: 0,
  toSeq: Infinity,
})) {
  console.log(`Event ${envelope.seq}: ${envelope.event.type}`);
}
```

## Replayed State Interface

```typescript
interface ReplayedState {
  content: string;
  tokenCount: number;
  checkpoint: string;
  violations: GuardrailViolation[];
  driftDetected: boolean;
  retryAttempts: number;
  networkRetryCount: number;
  fallbackIndex: number;
  completed: boolean;
  error: SerializedError | null;
  startTs: number;
  endTs: number;
}
```

## Stream Metadata

Get metadata without full replay:

```typescript
import { getStreamMetadata } from "reliable-ai-streams";

const metadata = await getStreamMetadata(store, "my-stream");

console.log(metadata);
// {
//   streamId: "my-stream",
//   eventCount: 25,
//   tokenCount: 20,
//   startTs: 1699000000000,
//   endTs: 1699000005000,
//   completed: true,
//   hasError: false,
//   options: { prompt: "...", model: "gpt-5-micro" }
// }
```

## Comparing Replays

Verify determinism by comparing two replay results:

```typescript
import { compareReplays, createEventReplayer } from "reliable-ai-streams";

const replayer = createEventReplayer(store);

const state1 = await replayer.replayToState("stream-1");
const state2 = await replayer.replayToState("stream-2");

const comparison = compareReplays(state1, state2);

if (comparison.identical) {
  console.log("Replays are identical!");
} else {
  console.log("Differences:", comparison.differences);
  // ["content: 'Hello...' vs 'Hi...'", "tokenCount: 10 vs 12"]
}
```

## Use Cases

### 1. Deterministic Testing

Record production streams, replay in tests:

```typescript
// In production
const store = createPersistentEventStore(); // Your implementation
const recorder = createEventRecorder(store);
// ... record events during real API calls

// In tests
const store = loadRecordedEvents("fixtures/stream-123.json");
const result = await replay({ streamId: "stream-123", eventStore: store });

// Assertions are deterministic
expect(result.state.content).toBe("expected output");
expect(result.state.violations).toHaveLength(0);
```

### 2. Production Failure Reproduction

```typescript
// When a bug is reported, get the stream ID from logs
const streamId = "l0_abc123_xyz789";

// Replay locally
const result = await replay({
  streamId,
  eventStore: productionStore,
  speed: 1, // Watch it happen in real-time
});

result.setCallbacks({
  onToken: console.log,
  onViolation: (v) => console.error("Violation!", v),
  onRetry: (a, r) => console.warn(`Retry ${a}: ${r}`),
});

for await (const event of result.stream) {
  // Step through and debug
}
```

### 3. Audit Trail

```typescript
// Every LLM interaction is recorded
const recorder = createEventRecorder(
  auditStore,
  `user_${userId}_${Date.now()}`,
);

// ... record all events

// Later, for compliance
const streams = await auditStore.listStreams();
for (const streamId of streams) {
  const metadata = await getStreamMetadata(auditStore, streamId);
  console.log(
    `Stream ${streamId}: ${metadata.tokenCount} tokens, completed: ${metadata.completed}`,
  );
}
```

### 4. Time-Travel Debugging

```typescript
// Replay to a specific point
const result = await replay({
  streamId: "my-stream",
  eventStore: store,
  toSeq: 50, // Stop at event 50
});

// Inspect state at that moment
console.log("State at event 50:", result.state);
```

### 5. Caching / Deduplication

```typescript
async function getOrReplay(prompt: string): Promise<string> {
  const cacheKey = hash(prompt);

  if (await store.exists(cacheKey)) {
    // Replay from cache
    const result = await replay({ streamId: cacheKey, eventStore: store });
    for await (const _ of result.stream) {
      /* consume */
    }
    return result.state.content;
  }

  // Make real API call and record
  const recorder = createEventRecorder(store, cacheKey);
  // ... record events
  return content;
}
```

## Snapshots

For long streams, snapshots enable faster replay:

```typescript
interface L0Snapshot {
  streamId: string;
  seq: number; // Event sequence at snapshot
  ts: number;
  content: string;
  tokenCount: number;
  checkpoint: string;
  violations: GuardrailViolation[];
  driftDetected: boolean;
  retryAttempts: number;
  networkRetryCount: number;
  fallbackIndex: number;
}
```

Save snapshots periodically:

```typescript
// InMemoryEventStore supports snapshots
await store.saveSnapshot({
  streamId: "my-stream",
  seq: 100,
  ts: Date.now(),
  content: "...",
  tokenCount: 100,
  checkpoint: "...",
  violations: [],
  driftDetected: false,
  retryAttempts: 0,
  networkRetryCount: 0,
  fallbackIndex: 0,
});

// Get latest snapshot
const snapshot = await store.getSnapshot("my-stream");

// Get snapshot before a specific sequence
const snapshotBefore = await store.getSnapshotBefore("my-stream", 150);
```

## Storage Adapters

L0 provides a pluggable storage adapter system. Register custom adapters or use built-in ones.

### Built-in Adapters

| Adapter        | Type                   | Use Case                      |
| -------------- | ---------------------- | ----------------------------- |
| `memory`       | InMemoryEventStore     | Testing, short-lived sessions |
| `file`         | FileEventStore         | Local persistence (Node.js)   |
| `localStorage` | LocalStorageEventStore | Browser persistence           |

### Using Built-in Adapters

```typescript
import { createEventStore } from "reliable-ai-streams";

// In-memory (default)
const memStore = await createEventStore({ type: "memory" });

// File-based persistence
const fileStore = await createEventStore({
  type: "file",
  connection: "./my-events", // Base path
  prefix: "l0",
  ttl: 7 * 24 * 60 * 60 * 1000, // 7 days
});

// Browser localStorage
const browserStore = await createEventStore({
  type: "localStorage",
  prefix: "myapp_l0",
});
```

### Registering Custom Adapters

```typescript
import {
  registerStorageAdapter,
  BaseEventStore,
  createEventStore,
} from "reliable-ai-streams";

// Register a Redis adapter
registerStorageAdapter("redis", async (config) => {
  const client = createRedisClient(config.connection);
  return new RedisEventStore(client, config);
});

// Use it
const store = await createEventStore({
  type: "redis",
  connection: "redis://localhost:6379",
  prefix: "l0_events",
  ttl: 86400000, // 24 hours
});
```

### Storage Adapter Configuration

```typescript
interface StorageAdapterConfig {
  type: string; // Adapter type identifier
  connection?: string; // Connection string or configuration
  prefix?: string; // Table/collection/key prefix
  ttl?: number; // TTL for events in milliseconds (0 = no expiry)
  options?: Record<string, unknown>; // Custom options
}
```

### Adapter Registry Functions

```typescript
import {
  registerStorageAdapter,
  unregisterStorageAdapter,
  getRegisteredAdapters,
} from "reliable-ai-streams";

// Register
registerStorageAdapter("redis", factory);

// Unregister
unregisterStorageAdapter("redis");

// List registered adapters
const adapters = getRegisteredAdapters(); // ["memory", "file", "localStorage", ...]
```

### Extending BaseEventStore

Use `BaseEventStore` for easier implementation:

```typescript
import { BaseEventStore } from "reliable-ai-streams";
import type {
  L0RecordedEvent,
  L0EventEnvelope,
  StorageAdapterConfig,
} from "reliable-ai-streams";

class RedisEventStore extends BaseEventStore {
  private client: RedisClient;

  constructor(client: RedisClient, config: StorageAdapterConfig) {
    super(config);
    this.client = client;
  }

  async append(streamId: string, event: L0RecordedEvent): Promise<void> {
    const key = this.getStreamKey(streamId); // Uses prefix automatically
    const seq = await this.client.llen(key);
    const envelope = { streamId, seq, event };
    await this.client.rpush(key, JSON.stringify(envelope));

    if (this.ttl > 0) {
      await this.client.expire(key, this.ttl / 1000);
    }
  }

  async getEvents(streamId: string): Promise<L0EventEnvelope[]> {
    const key = this.getStreamKey(streamId);
    const items = await this.client.lrange(key, 0, -1);
    return items.map((item) => JSON.parse(item));
  }

  async exists(streamId: string): Promise<boolean> {
    const key = this.getStreamKey(streamId);
    return (await this.client.exists(key)) > 0;
  }

  async delete(streamId: string): Promise<void> {
    await this.client.del(this.getStreamKey(streamId));
  }

  async listStreams(): Promise<string[]> {
    const pattern = `${this.prefix}:stream:*`;
    const keys = await this.client.keys(pattern);
    return keys.map((k) => k.replace(`${this.prefix}:stream:`, ""));
  }
}
```

### BaseEventStore Helper Methods

The `BaseEventStore` class provides:

```typescript
// Get storage key for a stream
protected getStreamKey(streamId: string): string; // `${prefix}:stream:${streamId}`

// Get storage key for metadata
protected getMetaKey(streamId: string): string; // `${prefix}:meta:${streamId}`

// Check if event is expired based on TTL
protected isExpired(timestamp: number): boolean;

// Default implementations (can be overridden)
async getLastEvent(streamId: string): Promise<L0EventEnvelope | null>;
async getEventsAfter(streamId: string, afterSeq: number): Promise<L0EventEnvelope[]>;
```

### Extending BaseEventStoreWithSnapshots

For stores with snapshot support:

```typescript
import { BaseEventStoreWithSnapshots } from "reliable-ai-streams";

class MyEventStore extends BaseEventStoreWithSnapshots {
  // Inherits from BaseEventStore plus:

  // Get storage key for snapshots
  protected getSnapshotKey(streamId: string): string; // `${prefix}:snapshot:${streamId}`

  // Must implement
  async saveSnapshot(snapshot: L0Snapshot): Promise<void>;
  async getSnapshot(streamId: string): Promise<L0Snapshot | null>;

  // Default implementation provided
  async getSnapshotBefore(
    streamId: string,
    seq: number,
  ): Promise<L0Snapshot | null>;
}
```

### Composite Stores

Write to multiple backends simultaneously (write-through cache, redundancy):

```typescript
import {
  createCompositeStore,
  createInMemoryEventStore,
  FileEventStore,
} from "reliable-ai-streams";

// Write-through: memory cache + file persistence
const store = createCompositeStore([
  createInMemoryEventStore(), // Primary (reads come from here)
  new FileEventStore({ type: "file", connection: "./events" }),
]);

// Writes go to both stores
await store.append("stream-1", event);

// Reads come from primary (memory - fast!)
const events = await store.getEvents("stream-1");

// Specify different primary index
const store2 = createCompositeStore(
  [memStore, fileStore, redisStore],
  1, // Use fileStore as primary for reads
);
```

### TTL Wrapper

Add expiration to any store:

```typescript
import { withTTL, createInMemoryEventStore } from "reliable-ai-streams";

// Events expire after 24 hours
const store = withTTL(createInMemoryEventStore(), 24 * 60 * 60 * 1000);

// Old events are filtered out on read
const events = await store.getEvents("stream-1"); // Only non-expired events
```

### Full PostgreSQL Example

```typescript
import {
  BaseEventStoreWithSnapshots,
  registerStorageAdapter,
} from "reliable-ai-streams";
import type {
  L0RecordedEvent,
  L0EventEnvelope,
  L0Snapshot,
  StorageAdapterConfig,
} from "reliable-ai-streams";

class PostgresEventStore extends BaseEventStoreWithSnapshots {
  private pool: Pool;

  constructor(config: StorageAdapterConfig) {
    super(config);
    this.pool = new Pool({ connectionString: config.connection });
  }

  async append(streamId: string, event: L0RecordedEvent): Promise<void> {
    const seq = await this.getNextSeq(streamId);
    await this.pool.query(
      `INSERT INTO ${this.prefix}_events (stream_id, seq, event, created_at) 
       VALUES ($1, $2, $3, NOW())`,
      [streamId, seq, JSON.stringify(event)],
    );
  }

  async getEvents(streamId: string): Promise<L0EventEnvelope[]> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.prefix}_events 
       WHERE stream_id = $1 
       ${this.ttl > 0 ? `AND created_at > NOW() - INTERVAL '${this.ttl}ms'` : ""}
       ORDER BY seq`,
      [streamId],
    );
    return result.rows.map((r) => ({
      streamId: r.stream_id,
      seq: r.seq,
      event: r.event,
    }));
  }

  async exists(streamId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM ${this.prefix}_events WHERE stream_id = $1 LIMIT 1`,
      [streamId],
    );
    return result.rows.length > 0;
  }

  async delete(streamId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM ${this.prefix}_events WHERE stream_id = $1`,
      [streamId],
    );
    await this.pool.query(
      `DELETE FROM ${this.prefix}_snapshots WHERE stream_id = $1`,
      [streamId],
    );
  }

  async listStreams(): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT DISTINCT stream_id FROM ${this.prefix}_events`,
    );
    return result.rows.map((r) => r.stream_id);
  }

  async saveSnapshot(snapshot: L0Snapshot): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.prefix}_snapshots (stream_id, seq, data) 
       VALUES ($1, $2, $3)
       ON CONFLICT (stream_id) DO UPDATE SET seq = $2, data = $3`,
      [snapshot.streamId, snapshot.seq, JSON.stringify(snapshot)],
    );
  }

  async getSnapshot(streamId: string): Promise<L0Snapshot | null> {
    const result = await this.pool.query(
      `SELECT data FROM ${this.prefix}_snapshots WHERE stream_id = $1`,
      [streamId],
    );
    return result.rows[0]?.data ?? null;
  }

  private async getNextSeq(streamId: string): Promise<number> {
    const result = await this.pool.query(
      `SELECT COALESCE(MAX(seq), -1) + 1 as next_seq 
       FROM ${this.prefix}_events WHERE stream_id = $1`,
      [streamId],
    );
    return result.rows[0].next_seq;
  }
}

// Register the adapter
registerStorageAdapter("postgres", (config) => new PostgresEventStore(config));

// Use it
const store = await createEventStore({
  type: "postgres",
  connection: "postgresql://user:pass@localhost/mydb",
  prefix: "l0",
  ttl: 30 * 24 * 60 * 60 * 1000, // 30 days
});
```

### Store Comparison

| Store          | Use Case             | Tradeoffs                |
| -------------- | -------------------- | ------------------------ |
| `memory`       | Testing, short-lived | Fast, no persistence     |
| `file`         | Local apps, dev      | Simple, single-node      |
| `localStorage` | Browser apps         | Limited size (~5MB)      |
| Redis          | Distributed cache    | Fast, TTL, volatile      |
| PostgreSQL     | Production           | ACID, queryable, durable |
| SQLite         | Embedded apps        | Simple, single-file      |
| Kafka          | High-scale           | Durable, partitioned     |
| S3/GCS         | Archive              | Cheap, slow reads        |

## API Reference

### Factory Functions

```typescript
// Create in-memory store
createInMemoryEventStore(): InMemoryEventStore

// Create store from config
createEventStore(config: StorageAdapterConfig): Promise<L0EventStore>

// Create recorder
createEventRecorder(store: L0EventStore, streamId?: string): L0EventRecorder

// Create replayer
createEventReplayer(store: L0EventStore): L0EventReplayer
```

### Replay Function

```typescript
replay(options: L0ReplayOptions): Promise<L0ReplayResult>

interface L0ReplayOptions {
  streamId: string;
  eventStore: L0EventStore;
  speed?: number;        // 0 = instant, 1 = real-time
  fireCallbacks?: boolean;
  fromSeq?: number;
  toSeq?: number;
}

interface L0ReplayResult extends L0Result {
  streamId: string;
  isReplay: true;
  originalOptions: SerializedOptions;
  setCallbacks(callbacks: ReplayCallbacks): void;
}

interface ReplayCallbacks {
  onToken?: (token: string) => void;
  onViolation?: (violation: any) => void;
  onRetry?: (attempt: number, reason: string) => void;
  onEvent?: (event: L0Event) => void;
}
```

### Utilities

```typescript
// Generate unique stream ID
generateStreamId(): string  // "l0_abc123_xyz789"

// Serialize/deserialize errors
serializeError(error: Error): SerializedError
deserializeError(stored: SerializedError): Error

// Get stream metadata
getStreamMetadata(store: L0EventStore, streamId: string): Promise<StreamMetadata | null>

// Compare replay results
compareReplays(a: L0State, b: L0State): ReplayComparison

interface StreamMetadata {
  streamId: string;
  eventCount: number;
  tokenCount: number;
  startTs: number;
  endTs: number;
  completed: boolean;
  hasError: boolean;
  options: SerializedOptions;
}

interface ReplayComparison {
  identical: boolean;
  differences: string[];
}
```

## Best Practices

### 1. Use Meaningful Stream IDs

```typescript
// Good - includes context
const streamId = `user_${userId}_chat_${sessionId}_${Date.now()}`;

// Bad - opaque
const streamId = generateStreamId(); // Only for anonymous streams
```

### 2. Record All Derived Computations

```typescript
// Always record guardrail results
await recorder.recordGuardrail(tokenIndex, guardrailResult);

// Always record drift detection
await recorder.recordDrift(tokenIndex, driftResult);
```

### 3. Clean Up Old Streams

```typescript
// Implement retention policy
const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days
for (const streamId of await store.listStreams()) {
  const metadata = await getStreamMetadata(store, streamId);
  if (metadata && metadata.endTs < cutoff) {
    await store.delete(streamId);
  }
}
```

### 4. Use Snapshots for Long Streams

```typescript
// Save snapshot every 100 events
if (recorder.getSeq() % 100 === 0) {
  await store.saveSnapshot({
    streamId: recorder.getStreamId(),
    seq: recorder.getSeq(),
    // ... current state
  });
}
```

## Summary

L0's event sourcing provides:

- **Atomic operations** - Every event is recorded
- **Deterministic replay** - Exact same output every time
- **Time-travel** - Reconstruct state at any point
- **Audit trails** - Complete history of LLM interactions
- **Testing** - Record once, replay in tests forever
- **Debugging** - Reproduce production issues locally

The key insight: **Replay mode is pure stream rehydration.** No network, no computation - just stored events flowing through callbacks.
