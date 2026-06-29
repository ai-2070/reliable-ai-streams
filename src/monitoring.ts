/**
 * L0 Monitoring - OpenTelemetry and Sentry integrations
 *
 * Import from "reliable-ai-streams/monitoring" to get monitoring features
 * without bundling them in your main application.
 *
 * @example
 * ```typescript
 * import {
 *   createOpenTelemetryHandler,
 *   createSentryHandler,
 *   combineEvents,
 * } from "reliable-ai-streams/monitoring";
 *
 * const result = await l0({
 *   stream: () => streamText({ model, prompt }),
 *   onEvent: combineEvents(
 *     createOpenTelemetryHandler({ tracer, meter }),
 *     createSentryHandler({ sentry: Sentry }),
 *   ),
 * });
 * ```
 */

// Event handler utilities
export {
  combineEvents,
  filterEvents,
  excludeEvents,
  debounceEvents,
  batchEvents,
} from "./runtime/event-handlers.js";

export type { EventHandler } from "./runtime/event-handlers.js";

// Core monitoring
export {
  L0Monitor,
  createMonitor,
  TelemetryExporter,
} from "./runtime/monitoring.js";

export type { MonitoringConfig } from "./runtime/monitoring.js";

// Sentry integration
export {
  L0Sentry,
  createSentryIntegration,
  createSentryHandler,
  withSentry,
} from "./runtime/sentry.js";

export type { SentryClient, SentryConfig } from "./runtime/sentry.js";

// OpenTelemetry integration
export {
  L0OpenTelemetry,
  createOpenTelemetry,
  createOpenTelemetryHandler,
  SemanticAttributes,
  SpanStatusCode,
  SpanKind,
} from "./runtime/opentelemetry.js";

export type { OpenTelemetryConfig } from "./runtime/opentelemetry.js";
