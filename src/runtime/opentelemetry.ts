// OpenTelemetry integration for L0 tracing and metrics

import type { L0Telemetry } from "../types/l0";
import type { GuardrailViolation } from "../types/guardrails";
import type { L0Monitor } from "./monitoring";
import type { Tracer, Span, SpanOptions, Attributes } from "@opentelemetry/api";
import type {
  Meter,
  Counter,
  Histogram,
  UpDownCounter,
  ObservableGauge,
  MetricOptions,
} from "@opentelemetry/api";
import { SpanStatusCode, SpanKind } from "@opentelemetry/api";
import { EventType } from "../types/observability";
import type {
  L0Event,
  SessionStartEvent,
  CompleteEvent,
  ErrorEvent,
  RetryAttemptEvent,
  GuardrailRuleResultEvent,
  DriftCheckResultEvent,
} from "../types/observability";
import type { EventHandler } from "./event-handlers";

// Re-export useful types and enums
export { SpanStatusCode, SpanKind };
export type {
  Tracer as OTelTracer,
  Span as OTelSpan,
  SpanOptions,
  Attributes,
  Meter as OTelMeter,
  Counter as OTelCounter,
  Histogram as OTelHistogram,
  UpDownCounter as OTelUpDownCounter,
  ObservableGauge as OTelObservableGauge,
  MetricOptions,
};

/**
 * OpenTelemetry configuration for L0
 */
export interface OpenTelemetryConfig {
  /**
   * OpenTelemetry tracer instance
   * Get from: `trace.getTracer('l0')`
   */
  tracer?: Tracer;

  /**
   * OpenTelemetry meter instance
   * Get from: `metrics.getMeter('l0')`
   */
  meter?: Meter;

  /**
   * Service name for spans
   * @default 'l0'
   */
  serviceName?: string;

  /**
   * Whether to create spans for individual tokens
   * @default false (can be very noisy)
   */
  traceTokens?: boolean;

  /**
   * Whether to record token content in spans
   * @default false (privacy consideration)
   */
  recordTokenContent?: boolean;

  /**
   * Whether to record guardrail violations as span events
   * @default true
   */
  recordGuardrailViolations?: boolean;

  /**
   * Custom attributes to add to all spans
   */
  defaultAttributes?: Attributes;
}

/**
 * Semantic convention attribute names for LLM operations
 * Following OpenTelemetry semantic conventions for GenAI
 */
export const SemanticAttributes = {
  // General LLM attributes
  LLM_SYSTEM: "gen_ai.system",
  LLM_REQUEST_MODEL: "gen_ai.request.model",
  LLM_RESPONSE_MODEL: "gen_ai.response.model",
  LLM_REQUEST_MAX_TOKENS: "gen_ai.request.max_tokens",
  LLM_REQUEST_TEMPERATURE: "gen_ai.request.temperature",
  LLM_REQUEST_TOP_P: "gen_ai.request.top_p",
  LLM_RESPONSE_FINISH_REASON: "gen_ai.response.finish_reasons",
  LLM_USAGE_INPUT_TOKENS: "gen_ai.usage.input_tokens",
  LLM_USAGE_OUTPUT_TOKENS: "gen_ai.usage.output_tokens",

  // L0-specific attributes
  L0_SESSION_ID: "l0.session_id",
  L0_STREAM_COMPLETED: "l0.stream.completed",
  L0_FALLBACK_INDEX: "l0.fallback.index",
  L0_RETRY_COUNT: "l0.retry.count",
  L0_NETWORK_ERROR_COUNT: "l0.network.error_count",
  L0_GUARDRAIL_VIOLATION_COUNT: "l0.guardrail.violation_count",
  L0_DRIFT_DETECTED: "l0.drift.detected",
  L0_TIME_TO_FIRST_TOKEN: "l0.time_to_first_token_ms",
  L0_TOKENS_PER_SECOND: "l0.tokens_per_second",
} as const;

/**
 * L0 OpenTelemetry integration for distributed tracing and metrics
 *
 * @example
 * ```typescript
 * import { trace, metrics } from '@opentelemetry/api';
 * import { L0OpenTelemetry } from 'l0';
 *
 * const otel = new L0OpenTelemetry({
 *   tracer: trace.getTracer('l0'),
 *   meter: metrics.getMeter('l0'),
 * });
 *
 * // Create a traced stream
 * const result = await otel.traceStream('chat-completion', async (span) => {
 *   return l0({
 *     stream: () => streamText({ model, prompt }),
 *   });
 * });
 * ```
 */
export class L0OpenTelemetry {
  private tracer?: Tracer;
  private meter?: Meter;
  private config: Required<
    Omit<OpenTelemetryConfig, "tracer" | "meter" | "defaultAttributes">
  > & {
    defaultAttributes?: Attributes;
  };

  // Metrics
  private requestCounter?: Counter;
  private tokenCounter?: Counter;
  private retryCounter?: Counter;
  private errorCounter?: Counter;
  private durationHistogram?: Histogram;
  private ttftHistogram?: Histogram;
  private activeStreamsGauge?: UpDownCounter;

  private activeStreams = 0;

  constructor(config: OpenTelemetryConfig) {
    this.tracer = config.tracer;
    this.meter = config.meter;
    this.config = {
      serviceName: config.serviceName ?? "l0",
      traceTokens: config.traceTokens ?? false,
      recordTokenContent: config.recordTokenContent ?? false,
      recordGuardrailViolations: config.recordGuardrailViolations ?? true,
      defaultAttributes: config.defaultAttributes,
    };

    if (this.meter) {
      this.initializeMetrics();
    }
  }

  /**
   * Initialize OpenTelemetry metrics
   */
  private initializeMetrics(): void {
    if (!this.meter) return;

    this.requestCounter = this.meter.createCounter("l0.requests", {
      description: "Total number of L0 stream requests",
      unit: "1",
    });

    this.tokenCounter = this.meter.createCounter("l0.tokens", {
      description: "Total number of tokens processed",
      unit: "1",
    });

    this.retryCounter = this.meter.createCounter("l0.retries", {
      description: "Total number of retry attempts",
      unit: "1",
    });

    this.errorCounter = this.meter.createCounter("l0.errors", {
      description: "Total number of errors",
      unit: "1",
    });

    this.durationHistogram = this.meter.createHistogram("l0.duration", {
      description: "Stream duration in milliseconds",
      unit: "ms",
    });

    this.ttftHistogram = this.meter.createHistogram("l0.time_to_first_token", {
      description: "Time to first token in milliseconds",
      unit: "ms",
    });

    this.activeStreamsGauge = this.meter.createUpDownCounter(
      "l0.active_streams",
      {
        description: "Number of currently active streams",
        unit: "1",
      },
    );
  }

  /**
   * Trace an L0 stream operation
   *
   * @param name - Span name
   * @param fn - Function that returns an L0 result
   * @param attributes - Additional span attributes
   */
  async traceStream<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    attributes?: Attributes,
  ): Promise<T> {
    if (!this.tracer) {
      // No tracer configured, just run the function
      return fn(createNoOpSpan());
    }

    const spanAttributes: Attributes = {
      ...this.config.defaultAttributes,
      ...attributes,
    };

    const span = this.tracer.startSpan(`${this.config.serviceName}.${name}`, {
      kind: SpanKind.CLIENT,
      attributes: spanAttributes,
    });

    this.activeStreams++;
    this.activeStreamsGauge?.add(1);

    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof Error) {
        span.recordException(error);
      }
      this.errorCounter?.add(1, { type: "stream_error" });
      throw error;
    } finally {
      this.activeStreams--;
      this.activeStreamsGauge?.add(-1);
      span.end();
    }
  }

  /**
   * Record telemetry from a completed L0 operation
   *
   * This is the primary method for recording metrics. All metric counters
   * are updated here using the aggregated data from L0Monitor to ensure
   * accurate counting without duplication.
   */
  recordTelemetry(telemetry: L0Telemetry, span?: Span): void {
    const attributes: Attributes = {
      [SemanticAttributes.L0_SESSION_ID]: telemetry.sessionId,
    };

    // Record metrics from aggregated telemetry (single source of truth)
    this.requestCounter?.add(1, { status: "completed" });

    if (telemetry.metrics.totalTokens > 0) {
      this.tokenCounter?.add(telemetry.metrics.totalTokens, attributes);
    }

    if (telemetry.metrics.totalRetries > 0) {
      this.retryCounter?.add(telemetry.metrics.totalRetries, {
        ...attributes,
        type: "total",
      });
    }

    // Record network retries separately for granularity
    if (telemetry.metrics.networkRetryCount > 0) {
      this.retryCounter?.add(telemetry.metrics.networkRetryCount, {
        ...attributes,
        type: "network",
      });
    }

    // Record model retries separately for granularity
    if (telemetry.metrics.modelRetryCount > 0) {
      this.retryCounter?.add(telemetry.metrics.modelRetryCount, {
        ...attributes,
        type: "model",
      });
    }

    // Record network errors with type breakdown
    if (telemetry.network.errorCount > 0) {
      // Record individual error types from errorsByType
      const errorsByType = telemetry.network.errorsByType;
      if (errorsByType && Object.keys(errorsByType).length > 0) {
        for (const [errorType, count] of Object.entries(errorsByType)) {
          if (count > 0) {
            this.errorCounter?.add(count, {
              ...attributes,
              type: "network",
              error_type: errorType,
            });
          }
        }
      } else {
        // Fallback to aggregate count if no breakdown available
        this.errorCounter?.add(telemetry.network.errorCount, {
          ...attributes,
          type: "network",
        });
      }
    }

    // Record guardrail violations with rule/severity breakdown
    if (
      telemetry.guardrails?.violationCount &&
      telemetry.guardrails.violationCount > 0
    ) {
      const byRuleAndSeverity =
        telemetry.guardrails.violationsByRuleAndSeverity;
      if (byRuleAndSeverity && Object.keys(byRuleAndSeverity).length > 0) {
        // Record violations by rule and severity
        for (const [rule, severities] of Object.entries(byRuleAndSeverity)) {
          for (const [severity, count] of Object.entries(severities)) {
            if (count > 0) {
              this.errorCounter?.add(count, {
                ...attributes,
                type: "guardrail_violation",
                rule,
                severity,
              });
            }
          }
        }
      } else {
        // Fallback to aggregate count if no breakdown available
        this.errorCounter?.add(telemetry.guardrails.violationCount, {
          ...attributes,
          type: "guardrail_violation",
        });
      }
    }

    // Record drift detection
    if (telemetry.drift?.detected) {
      this.errorCounter?.add(1, {
        ...attributes,
        type: "drift",
      });
    }

    if (telemetry.duration) {
      this.durationHistogram?.record(telemetry.duration, attributes);
    }

    if (telemetry.metrics.timeToFirstToken) {
      this.ttftHistogram?.record(
        telemetry.metrics.timeToFirstToken,
        attributes,
      );
    }

    // Add span attributes
    if (span?.isRecording()) {
      span.setAttributes({
        [SemanticAttributes.L0_SESSION_ID]: telemetry.sessionId,
        [SemanticAttributes.LLM_USAGE_OUTPUT_TOKENS]:
          telemetry.metrics.totalTokens,
        [SemanticAttributes.L0_RETRY_COUNT]: telemetry.metrics.totalRetries,
        [SemanticAttributes.L0_NETWORK_ERROR_COUNT]:
          telemetry.network.errorCount,
      });

      if (telemetry.guardrails?.violationCount) {
        span.setAttribute(
          SemanticAttributes.L0_GUARDRAIL_VIOLATION_COUNT,
          telemetry.guardrails.violationCount,
        );
      }

      if (telemetry.drift?.detected) {
        span.setAttribute(SemanticAttributes.L0_DRIFT_DETECTED, true);
      }

      if (telemetry.metrics.timeToFirstToken) {
        span.setAttribute(
          SemanticAttributes.L0_TIME_TO_FIRST_TOKEN,
          telemetry.metrics.timeToFirstToken,
        );
      }

      if (telemetry.metrics.tokensPerSecond) {
        span.setAttribute(
          SemanticAttributes.L0_TOKENS_PER_SECOND,
          telemetry.metrics.tokensPerSecond,
        );
      }

      if (telemetry.duration) {
        span.setAttribute("duration_ms", telemetry.duration);
      }
    }
  }

  /**
   * Record a token event (span event only, metrics come from recordTelemetry)
   *
   * Note: This method only adds span events for tracing. Metric counters are
   * updated via recordTelemetry() using aggregated data from L0Monitor to
   * avoid double-counting.
   */
  recordToken(span?: Span, content?: string): void {
    // Don't increment tokenCounter here - it's recorded in recordTelemetry()
    // from the aggregated L0Telemetry to avoid double-counting

    if (this.config.traceTokens && span?.isRecording()) {
      const eventAttributes: Attributes = {};
      if (this.config.recordTokenContent && content) {
        eventAttributes["token.content"] = content;
      }
      span.addEvent("token", eventAttributes);
    }
  }

  /**
   * Record a retry attempt (span event only, metrics come from recordTelemetry)
   *
   * Note: This method only adds span events for tracing. Metric counters are
   * updated via recordTelemetry() using aggregated data from L0Monitor to
   * avoid double-counting.
   */
  recordRetry(reason: string, attempt: number, span?: Span): void {
    // Don't increment retryCounter here - it's recorded in recordTelemetry()
    // from the aggregated L0Telemetry to avoid double-counting

    if (span?.isRecording()) {
      span.addEvent("retry", {
        "retry.reason": reason,
        "retry.attempt": attempt,
      });
    }
  }

  /**
   * Record a network error (span event only, metrics come from recordTelemetry)
   *
   * Note: This method only adds span events for tracing. Metric counters are
   * updated via recordTelemetry() using aggregated data from L0Monitor to
   * avoid double-counting.
   */
  recordNetworkError(error: Error, errorType: string, span?: Span): void {
    // Don't increment errorCounter here - network errors are tracked in
    // L0Telemetry.network.errorCount and recorded via recordTelemetry()

    if (span?.isRecording()) {
      span.addEvent("network_error", {
        "error.type": errorType,
        "error.message": error.message,
      });
    }
  }

  /**
   * Record a guardrail violation (span event only, metrics come from recordTelemetry)
   *
   * Note: This method only adds span events for tracing. Metric counters are
   * updated via recordTelemetry() using aggregated data from L0Monitor to
   * avoid double-counting.
   */
  recordGuardrailViolation(violation: GuardrailViolation, span?: Span): void {
    if (!this.config.recordGuardrailViolations) return;

    // Don't increment errorCounter here - violations are tracked in
    // L0Telemetry.guardrails and recorded via recordTelemetry()

    if (span?.isRecording()) {
      span.addEvent("guardrail_violation", {
        "guardrail.rule": violation.rule,
        "guardrail.severity": violation.severity,
        "guardrail.message": violation.message,
      });
    }
  }

  /**
   * Record drift detection (span event only, metrics come from recordTelemetry)
   *
   * Note: This method only adds span events for tracing. Metric counters are
   * updated via recordTelemetry() using aggregated data from L0Monitor to
   * avoid double-counting.
   */
  recordDrift(driftType: string, confidence: number, span?: Span): void {
    // Don't increment errorCounter here - drift is tracked in
    // L0Telemetry.drift and recorded via recordTelemetry()

    if (span?.isRecording()) {
      span.setAttribute(SemanticAttributes.L0_DRIFT_DETECTED, true);
      span.addEvent("drift_detected", {
        "drift.type": driftType,
        "drift.confidence": confidence,
      });
    }
  }

  /**
   * Create a child span for a sub-operation
   */
  createSpan(name: string, attributes?: Attributes): Span {
    if (!this.tracer) {
      return createNoOpSpan();
    }

    return this.tracer.startSpan(`${this.config.serviceName}.${name}`, {
      kind: SpanKind.INTERNAL,
      attributes: {
        ...this.config.defaultAttributes,
        ...attributes,
      },
    });
  }

  /**
   * Connect to an L0Monitor for automatic telemetry recording
   */
  connectMonitor(monitor: L0Monitor): void {
    // This allows the OpenTelemetry integration to receive
    // telemetry updates from the L0Monitor
    const originalComplete = monitor.complete.bind(monitor);
    monitor.complete = () => {
      originalComplete();
      const telemetry = monitor.getTelemetry();
      if (telemetry) {
        this.recordTelemetry(telemetry);
      }
    };
  }

  /**
   * Get current active stream count
   */
  getActiveStreams(): number {
    return this.activeStreams;
  }
}

/**
 * Create an L0OpenTelemetry instance
 */
export function createOpenTelemetry(
  config: OpenTelemetryConfig,
): L0OpenTelemetry {
  return new L0OpenTelemetry(config);
}

/**
 * Create a no-op span for when tracing is disabled
 */
function createNoOpSpan(): Span {
  return {
    spanContext: () => ({
      traceId: "",
      spanId: "",
      traceFlags: 0,
    }),
    setAttribute: function () {
      return this;
    },
    setAttributes: function () {
      return this;
    },
    addEvent: function () {
      return this;
    },
    addLink: function () {
      return this;
    },
    addLinks: function () {
      return this;
    },
    setStatus: function () {
      return this;
    },
    updateName: function () {
      return this;
    },
    recordException: function () {},
    end: function () {},
    isRecording: function () {
      return false;
    },
  };
}

/**
 * Create an OpenTelemetry event handler for L0 observability.
 *
 * This is the recommended way to integrate OpenTelemetry with L0.
 * The handler subscribes to L0 events and records traces/metrics.
 *
 * @example
 * ```typescript
 * import { trace, metrics } from '@opentelemetry/api';
 * import { l0, createOpenTelemetryHandler, combineEvents } from 'reliable-ai-streams';
 *
 * const result = await l0({
 *   stream: () => streamText({ model, prompt }),
 *   onEvent: createOpenTelemetryHandler({
 *     tracer: trace.getTracer('my-app'),
 *     meter: metrics.getMeter('my-app'),
 *   }),
 * });
 *
 * // Or combine with other handlers:
 * const result = await l0({
 *   stream: () => streamText({ model, prompt }),
 *   onEvent: combineEvents(
 *     createOpenTelemetryHandler({ tracer, meter }),
 *     createSentryHandler({ sentry }),
 *   ),
 * });
 * ```
 */
export function createOpenTelemetryHandler(
  config: OpenTelemetryConfig,
): EventHandler {
  const otel = new L0OpenTelemetry(config);
  let currentSpan: Span | undefined;

  return (event: L0Event) => {
    switch (event.type) {
      case EventType.SESSION_START: {
        // Start a new span for the session
        currentSpan = otel.createSpan("stream");
        const e = event as SessionStartEvent;
        currentSpan.setAttribute("l0.attempt", e.attempt);
        currentSpan.setAttribute("l0.is_retry", e.isRetry);
        currentSpan.setAttribute("l0.is_fallback", e.isFallback);
        break;
      }

      case EventType.RETRY_ATTEMPT: {
        const e = event as RetryAttemptEvent;
        otel.recordRetry(e.reason, e.attempt, currentSpan);
        break;
      }

      case EventType.ERROR: {
        const e = event as ErrorEvent;
        otel.recordNetworkError(
          new Error(e.error),
          e.failureType || "unknown",
          currentSpan,
        );
        break;
      }

      case EventType.GUARDRAIL_RULE_RESULT: {
        const e = event as GuardrailRuleResultEvent;
        if (e.violation) {
          otel.recordGuardrailViolation(e.violation, currentSpan);
        }
        break;
      }

      case EventType.DRIFT_CHECK_RESULT: {
        const e = event as DriftCheckResultEvent;
        if (e.detected && e.types.length > 0) {
          otel.recordDrift(e.types.join(","), e.confidence ?? 0, currentSpan);
        }
        break;
      }

      case EventType.COMPLETE: {
        const e = event as CompleteEvent;
        // Record basic metrics from CompleteEvent
        if (currentSpan) {
          currentSpan.setAttribute("l0.token_count", e.tokenCount);
          currentSpan.setAttribute("l0.content_length", e.contentLength);
          currentSpan.setAttribute("l0.duration_ms", e.durationMs);
          currentSpan.setStatus({ code: SpanStatusCode.OK });
          currentSpan.end();
          currentSpan = undefined;
        }
        break;
      }

      // Token events are handled if traceTokens is enabled
      // The L0OpenTelemetry class handles the config check internally
      default:
        // Other events are not specifically handled but could be extended
        break;
    }
  };
}
