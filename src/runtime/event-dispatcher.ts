/**
 * L0 Event Dispatcher
 *
 * Centralized event emission for all L0 lifecycle events.
 * - Adds ts, streamId, context automatically to all events
 * - Calls handlers via microtasks (fire-and-forget)
 * - Never throws from handler failures
 * - Supports high-performance mode with batching
 */

import { uuidv7 } from "../utils/uuid";
import type {
  L0ObservabilityEvent,
  L0Event,
  L0EventHandler,
  EventType,
} from "../types/observability";

/**
 * Configuration for EventDispatcher
 */
export interface EventDispatcherConfig {
  /**
   * User context to attach to all events
   */
  context?: Record<string, unknown>;

  /**
   * Enable high-performance mode
   * - Skips deep cloning of context
   * - Batches events for reduced overhead
   * - Use when you control the context and handlers
   * @default false
   */
  highPerformance?: boolean;

  /**
   * Batch size for high-performance mode
   * Events are queued and dispatched in batches
   * Set to 1 to disable batching but keep other optimizations
   * @default 10
   */
  batchSize?: number;

  /**
   * Maximum delay before flushing batch (ms)
   * @default 5
   */
  batchFlushMs?: number;
}

/**
 * Deep clone and freeze an object to ensure complete immutability.
 * Handles nested objects and arrays.
 */
function deepCloneAndFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    const cloned = obj.map((item) => deepCloneAndFreeze(item)) as T;
    return Object.freeze(cloned);
  }

  const cloned: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    cloned[key] = deepCloneAndFreeze((obj as Record<string, unknown>)[key]);
  }
  return Object.freeze(cloned) as T;
}

export class EventDispatcher {
  private handlers: L0EventHandler[] = [];
  private handlersSnapshot: L0EventHandler[] | null = null;
  private readonly streamId: string;
  private readonly _context: Record<string, unknown>;
  private readonly highPerformance: boolean;
  private readonly batchSize: number;
  private readonly batchFlushMs: number;
  private eventBatch: L0ObservabilityEvent[] = [];
  private batchTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    contextOrConfig: Record<string, unknown> | EventDispatcherConfig = {},
  ) {
    this.streamId = uuidv7();

    // Handle both old API (context object) and new API (config object)
    const isConfig =
      "highPerformance" in contextOrConfig ||
      "batchSize" in contextOrConfig ||
      "batchFlushMs" in contextOrConfig ||
      "context" in contextOrConfig;

    if (isConfig) {
      const config = contextOrConfig as EventDispatcherConfig;
      this.highPerformance = config.highPerformance ?? false;
      this.batchSize = config.batchSize ?? 10;
      this.batchFlushMs = config.batchFlushMs ?? 5;
      // In high-perf mode, skip deep clone (caller controls context)
      this._context = this.highPerformance
        ? Object.freeze(config.context ?? {})
        : deepCloneAndFreeze(config.context ?? {});
    } else {
      // Legacy API: just a context object
      this.highPerformance = false;
      this.batchSize = 10;
      this.batchFlushMs = 5;
      this._context = deepCloneAndFreeze(
        contextOrConfig as Record<string, unknown>,
      );
    }
  }

  /**
   * Register an event handler
   */
  onEvent(handler: L0EventHandler): void {
    this.handlers.push(handler);
    this.handlersSnapshot = null;
  }

  /**
   * Remove an event handler
   */
  offEvent(handler: L0EventHandler): void {
    const index = this.handlers.indexOf(handler);
    if (index !== -1) {
      this.handlers.splice(index, 1);
      this.handlersSnapshot = null;
    }
  }

  /**
   * Flush any pending batched events immediately
   */
  flush(): void {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }

    if (this.eventBatch.length === 0) return;

    const batch = this.eventBatch;
    this.eventBatch = [];

    // Dispatch all batched events
    for (const event of batch) {
      this.dispatchToHandlers(event);
    }
  }

  /**
   * Internal: dispatch a single event to all handlers
   */
  private dispatchToHandlers(event: L0ObservabilityEvent): void {
    // Cache snapshot — invalidated only on onEvent/offEvent
    if (!this.handlersSnapshot) {
      this.handlersSnapshot = [...this.handlers];
    }
    for (const handler of this.handlersSnapshot) {
      queueMicrotask(() => {
        try {
          // Cast to L0Event - the constructed event matches one of the union members
          const result = handler(event as L0Event) as unknown;
          // Handle async handlers that return promises
          if (result && typeof result === "object" && "catch" in result) {
            (result as Promise<void>).catch(() => {
              // Silently ignore async handler errors - fire and forget
            });
          }
        } catch {
          // Silently ignore sync handler errors - fire and forget
        }
      });
    }
  }

  /**
   * Emit an event to all handlers
   * - Adds ts, streamId, context automatically
   * - Calls handlers via microtasks (fire-and-forget)
   * - Never throws from handler failures
   * - In high-performance mode, batches events for reduced overhead
   */
  emit<T extends Record<string, unknown>>(
    type: EventType,
    payload?: Omit<T, "type" | "ts" | "streamId" | "context">,
  ): void {
    // Skip event creation if no handlers registered (zero overhead when observability unused)
    if (this.handlers.length === 0) return;

    const event: L0ObservabilityEvent = {
      type,
      ts: Date.now(),
      streamId: this.streamId,
      context: this._context,
      ...payload,
    };

    // High-performance mode: batch events
    if (this.highPerformance && this.batchSize > 1) {
      this.eventBatch.push(event);

      // Flush if batch is full
      if (this.eventBatch.length >= this.batchSize) {
        this.flush();
      } else if (!this.batchTimeout) {
        // Schedule flush after delay
        this.batchTimeout = setTimeout(() => {
          this.batchTimeout = null;
          this.flush();
        }, this.batchFlushMs);
      }
      return;
    }

    // Normal mode: dispatch immediately via microtasks
    this.dispatchToHandlers(event);
  }

  /**
   * Emit an event synchronously (for critical path events)
   * Use sparingly - prefer emit() for most cases
   */
  emitSync<T extends Record<string, unknown>>(
    type: EventType,
    payload?: Omit<T, "type" | "ts" | "streamId" | "context">,
  ): void {
    // Skip event creation if no handlers registered (zero overhead when observability unused)
    if (this.handlers.length === 0) return;

    const event: L0ObservabilityEvent = {
      type,
      ts: Date.now(),
      streamId: this.streamId,
      context: this._context,
      ...payload,
    };

    // Use cached snapshot — invalidated only on onEvent/offEvent
    if (!this.handlersSnapshot) {
      this.handlersSnapshot = [...this.handlers];
    }
    for (const handler of this.handlersSnapshot) {
      try {
        // Cast to L0Event - the constructed event matches one of the union members
        const result = handler(event as L0Event) as unknown;
        // Handle async handlers that return promises
        if (result && typeof result === "object" && "catch" in result) {
          (result as Promise<void>).catch(() => {
            // Silently ignore async handler errors - fire and forget
          });
        }
      } catch {
        // Silently ignore sync handler errors
      }
    }
  }

  /**
   * Get the stream ID for this session
   */
  getStreamId(): string {
    return this.streamId;
  }

  /**
   * Get the context for this session
   */
  getContext(): Record<string, unknown> {
    return this._context;
  }

  /**
   * Get the number of registered handlers
   */
  getHandlerCount(): number {
    return this.handlers.length;
  }
}

/**
 * Create an event dispatcher with the given context
 */
export function createEventDispatcher(
  context: Record<string, unknown> = {},
): EventDispatcher {
  return new EventDispatcher(context);
}
