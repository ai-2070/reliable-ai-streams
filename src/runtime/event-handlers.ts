/**
 * Event Handler Utilities
 *
 * Helpers for combining and composing event handlers for the L0 observability pipeline.
 */

import type { L0Event } from "../types/observability";

/**
 * Event handler function type
 */
export type EventHandler = (event: L0Event) => void;

/**
 * Combine multiple event handlers into a single handler.
 *
 * This is the recommended way to use multiple observability integrations
 * (OpenTelemetry, Sentry, custom loggers) together.
 *
 * @example
 * ```typescript
 * import { l0, combineEvents, createOpenTelemetryHandler, createSentryHandler } from "reliable-ai-streams";
 *
 * const result = await l0({
 *   stream: () => streamText({ model, prompt }),
 *   onEvent: combineEvents(
 *     createOpenTelemetryHandler({ tracer, meter }),
 *     createSentryHandler({ sentry: Sentry }),
 *     (event) => console.log(event.type), // custom handler
 *   ),
 * });
 * ```
 *
 * @param handlers - Event handlers to combine
 * @returns A single event handler that calls all provided handlers
 */
export function combineEvents(...handlers: EventHandler[]): EventHandler {
  // Filter out undefined/null handlers for convenience
  const validHandlers = handlers.filter(
    (h): h is EventHandler => typeof h === "function",
  );

  if (validHandlers.length === 0) {
    // Return no-op if no handlers
    return () => {};
  }

  if (validHandlers.length === 1) {
    // Optimization: return single handler directly
    return validHandlers[0]!;
  }

  // Return combined handler that calls all handlers
  return (event: L0Event) => {
    for (const handler of validHandlers) {
      try {
        handler(event);
      } catch (error) {
        // Log but don't throw - one handler failing shouldn't break others
        console.error(
          `Event handler error for ${event.type}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  };
}

/**
 * Create a filtered event handler that only receives specific event types.
 *
 * @example
 * ```typescript
 * import { filterEvents, EventType } from "reliable-ai-streams";
 *
 * const errorHandler = filterEvents(
 *   [EventType.ERROR, EventType.NETWORK_ERROR],
 *   (event) => {
 *     // Only receives ERROR and NETWORK_ERROR events
 *     sendToAlertSystem(event);
 *   }
 * );
 * ```
 *
 * @param types - Event types to include
 * @param handler - Handler to call for matching events
 * @returns Filtered event handler
 */
export function filterEvents(
  types: string[],
  handler: EventHandler,
): EventHandler {
  const typeSet = new Set(types);
  return (event: L0Event) => {
    if (typeSet.has(event.type)) {
      handler(event);
    }
  };
}

/**
 * Create an event handler that excludes specific event types.
 *
 * Useful for filtering out noisy events like individual tokens.
 *
 * @example
 * ```typescript
 * import { excludeEvents, EventType } from "reliable-ai-streams";
 *
 * const quietHandler = excludeEvents(
 *   [EventType.TOKEN], // Exclude token events
 *   (event) => console.log(event.type)
 * );
 * ```
 *
 * @param types - Event types to exclude
 * @param handler - Handler to call for non-excluded events
 * @returns Filtered event handler
 */
export function excludeEvents(
  types: string[],
  handler: EventHandler,
): EventHandler {
  const typeSet = new Set(types);
  return (event: L0Event) => {
    if (!typeSet.has(event.type)) {
      handler(event);
    }
  };
}

/**
 * Create a debounced event handler for high-frequency events.
 *
 * Useful for token events when you want periodic updates instead of every token.
 *
 * @example
 * ```typescript
 * import { debounceEvents } from "reliable-ai-streams";
 *
 * const throttledLogger = debounceEvents(
 *   100, // 100ms debounce
 *   (event) => console.log(`Latest: ${event.type}`)
 * );
 * ```
 *
 * @param ms - Debounce interval in milliseconds
 * @param handler - Handler to call with latest event
 * @returns Debounced event handler
 */
export function debounceEvents(
  ms: number,
  handler: EventHandler,
): EventHandler {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let latestEvent: L0Event | null = null;

  return (event: L0Event) => {
    latestEvent = event;

    if (timeout === null) {
      timeout = setTimeout(() => {
        if (latestEvent) {
          handler(latestEvent);
        }
        timeout = null;
        latestEvent = null;
      }, ms);
    }
  };
}

/**
 * Create a batched event handler that collects events and processes them in batches.
 *
 * @example
 * ```typescript
 * import { batchEvents } from "reliable-ai-streams";
 *
 * const batchedHandler = batchEvents(
 *   10, // Batch size
 *   1000, // Max wait time (ms)
 *   (events) => {
 *     // Process batch of events
 *     sendToAnalytics(events);
 *   }
 * );
 * ```
 *
 * @param size - Maximum batch size
 * @param maxWaitMs - Maximum time to wait before flushing partial batch
 * @param handler - Handler to call with batched events
 * @returns Batching event handler
 */
export function batchEvents(
  size: number,
  maxWaitMs: number,
  handler: (events: L0Event[]) => void,
): EventHandler {
  let batch: L0Event[] = [];
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (batch.length > 0) {
      handler([...batch]);
      batch = [];
    }
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  return (event: L0Event) => {
    batch.push(event);

    if (batch.length >= size) {
      flush();
    } else if (!timeout) {
      timeout = setTimeout(flush, maxWaitMs);
    }
  };
}
