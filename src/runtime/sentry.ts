// Sentry integration for L0 error tracking and performance monitoring

import type { L0Telemetry } from "../types/l0";
import type { GuardrailViolation } from "../types/guardrails";
import type { L0Monitor } from "./monitoring";
import type * as Sentry from "@sentry/node";
import type { SeverityLevel, Breadcrumb, Scope } from "@sentry/types";
import { EventType } from "../types/observability";
import type {
  L0Event,
  SessionStartEvent,
  CompleteEvent,
  ErrorEvent,
  RetryAttemptEvent,
  GuardrailRuleResultEvent,
  DriftCheckResultEvent,
  NetworkErrorEvent,
} from "../types/observability";
import type { EventHandler } from "./event-handlers";

/**
 * Sentry client interface (compatible with @sentry/node)
 */
export interface SentryClient {
  captureException: typeof Sentry.captureException;
  captureMessage: typeof Sentry.captureMessage;
  addBreadcrumb: typeof Sentry.addBreadcrumb;
  setTag: typeof Sentry.setTag;
  setExtra: typeof Sentry.setExtra;
  setContext: typeof Sentry.setContext;
  startSpan?: typeof Sentry.startSpan;
  withScope?: typeof Sentry.withScope;
}

/**
 * Sentry integration configuration
 */
export interface SentryConfig {
  /**
   * Sentry client instance (from @sentry/node)
   * Pass the Sentry namespace: `import * as Sentry from '@sentry/node'`
   */
  sentry: SentryClient;

  /**
   * Whether to capture network errors
   * @default true
   */
  captureNetworkErrors?: boolean;

  /**
   * Whether to capture guardrail violations
   * @default true
   */
  captureGuardrailViolations?: boolean;

  /**
   * Minimum severity to capture for guardrails
   * @default 'error'
   */
  minGuardrailSeverity?: "warning" | "error" | "fatal";

  /**
   * Whether to add breadcrumbs for tokens
   * @default false (can be noisy)
   */
  breadcrumbsForTokens?: boolean;

  /**
   * Whether to enable performance monitoring (spans)
   * @default true
   */
  enableTracing?: boolean;

  /**
   * Custom tags to add to all events
   */
  tags?: Record<string, string>;

  /**
   * Environment name
   */
  environment?: string;
}

/**
 * L0 Sentry integration for error tracking and performance monitoring
 */
export class L0Sentry {
  private sentry: SentryClient;
  private config: Required<
    Omit<SentryConfig, "sentry" | "tags" | "environment">
  > & {
    tags?: Record<string, string>;
    environment?: string;
  };

  constructor(config: SentryConfig) {
    this.sentry = config.sentry;
    this.config = {
      captureNetworkErrors: config.captureNetworkErrors ?? true,
      captureGuardrailViolations: config.captureGuardrailViolations ?? true,
      minGuardrailSeverity: config.minGuardrailSeverity ?? "error",
      breadcrumbsForTokens: config.breadcrumbsForTokens ?? false,
      enableTracing: config.enableTracing ?? true,
      tags: config.tags,
      environment: config.environment,
    };

    // Set default tags
    if (this.config.tags) {
      for (const [key, value] of Object.entries(this.config.tags)) {
        this.sentry.setTag(key, value);
      }
    }

    if (this.config.environment) {
      this.sentry.setTag("environment", this.config.environment);
    }
  }

  /**
   * Start tracking an L0 execution
   * Returns a span finish function if tracing is enabled
   */
  startExecution(
    name: string = "l0.execution",
    metadata?: Record<string, any>,
  ): (() => void) | undefined {
    // Add breadcrumb
    this.sentry.addBreadcrumb({
      type: "info",
      category: "l0",
      message: "L0 execution started",
      data: metadata,
      level: "info",
      timestamp: Date.now() / 1000,
    });

    // Start span if tracing is enabled
    if (this.config.enableTracing && this.sentry.startSpan) {
      let finishSpan: (() => void) | undefined;

      this.sentry.startSpan(
        {
          name,
          op: "l0.execution",
          attributes: metadata,
        },
        (span) => {
          finishSpan = () => span?.end();
        },
      );

      return finishSpan;
    }

    return undefined;
  }

  /**
   * Start tracking stream consumption
   */
  startStream(): void {
    this.sentry.addBreadcrumb({
      type: "info",
      category: "l0.stream",
      message: "Stream started",
      level: "info",
      timestamp: Date.now() / 1000,
    });
  }

  /**
   * Record a token received
   */
  recordToken(token?: string): void {
    if (this.config.breadcrumbsForTokens) {
      this.sentry.addBreadcrumb({
        type: "debug",
        category: "l0.token",
        message: token ? `Token: ${token.slice(0, 50)}` : "Token received",
        level: "debug",
        timestamp: Date.now() / 1000,
      });
    }
  }

  /**
   * Record first token (TTFT)
   */
  recordFirstToken(ttft: number): void {
    this.sentry.addBreadcrumb({
      type: "info",
      category: "l0.stream",
      message: `First token received`,
      data: { ttft_ms: ttft },
      level: "info",
      timestamp: Date.now() / 1000,
    });
  }

  /**
   * Record a network error
   */
  recordNetworkError(error: Error, errorType: string, retried: boolean): void {
    this.sentry.addBreadcrumb({
      type: "error",
      category: "l0.network",
      message: `Network error: ${errorType}`,
      data: {
        error_type: errorType,
        message: error.message,
        retried,
      },
      level: "error",
      timestamp: Date.now() / 1000,
    });

    if (this.config.captureNetworkErrors && !retried) {
      // Only capture if not retried (final failure)
      this.sentry.captureException(error, {
        tags: {
          error_type: errorType,
          component: "l0.network",
        },
        extra: {
          retried,
        },
      });
    }
  }

  /**
   * Record a retry attempt
   */
  recordRetry(attempt: number, reason: string, isNetworkError: boolean): void {
    this.sentry.addBreadcrumb({
      type: "info",
      category: "l0.retry",
      message: `Retry attempt ${attempt}`,
      data: {
        attempt,
        reason,
        is_network_error: isNetworkError,
      },
      level: "warning",
      timestamp: Date.now() / 1000,
    });
  }

  /**
   * Record guardrail violations
   */
  recordGuardrailViolations(violations: GuardrailViolation[]): void {
    for (const violation of violations) {
      // Add breadcrumb for all violations
      this.sentry.addBreadcrumb({
        type: "error",
        category: "l0.guardrail",
        message: `Guardrail violation: ${violation.rule}`,
        data: {
          rule: violation.rule,
          severity: violation.severity,
          message: violation.message,
          recoverable: violation.recoverable,
        },
        level: this.mapSeverity(violation.severity),
        timestamp: Date.now() / 1000,
      });

      // Capture as error if meets threshold
      if (
        this.config.captureGuardrailViolations &&
        this.shouldCapture(violation.severity)
      ) {
        this.sentry.captureMessage(
          `Guardrail violation: ${violation.message}`,
          this.mapSeverity(violation.severity),
        );
      }
    }
  }

  /**
   * Record drift detection
   */
  recordDrift(detected: boolean, types: string[]): void {
    if (detected) {
      this.sentry.addBreadcrumb({
        type: "error",
        category: "l0.drift",
        message: `Drift detected: ${types.join(", ")}`,
        data: { types },
        level: "warning",
        timestamp: Date.now() / 1000,
      });
    }
  }

  /**
   * Complete stream tracking
   */
  completeStream(tokenCount: number): void {
    this.sentry.addBreadcrumb({
      type: "info",
      category: "l0.stream",
      message: "Stream completed",
      data: { token_count: tokenCount },
      level: "info",
      timestamp: Date.now() / 1000,
    });
  }

  /**
   * Complete execution tracking
   */
  completeExecution(telemetry: L0Telemetry): void {
    // Set context with telemetry data
    this.sentry.setContext("l0_telemetry", {
      session_id: telemetry.sessionId,
      duration_ms: telemetry.duration,
      tokens: telemetry.metrics.totalTokens,
      tokens_per_second: telemetry.metrics.tokensPerSecond,
      ttft_ms: telemetry.metrics.timeToFirstToken,
      retries: telemetry.metrics.totalRetries,
      network_errors: telemetry.network.errorCount,
      guardrail_violations: telemetry.guardrails?.violationCount ?? 0,
    });

    // Add final breadcrumb
    this.sentry.addBreadcrumb({
      type: "info",
      category: "l0",
      message: "L0 execution completed",
      data: {
        duration_ms: telemetry.duration,
        tokens: telemetry.metrics.totalTokens,
        retries: telemetry.metrics.totalRetries,
      },
      level: "info",
      timestamp: Date.now() / 1000,
    });
  }

  /**
   * Record execution failure
   */
  recordFailure(error: Error, telemetry?: L0Telemetry): void {
    // Set context if telemetry available
    if (telemetry) {
      this.sentry.setContext("l0_telemetry", {
        session_id: telemetry.sessionId,
        duration_ms: telemetry.duration,
        tokens: telemetry.metrics.totalTokens,
        retries: telemetry.metrics.totalRetries,
        network_errors: telemetry.network.errorCount,
      });
    }

    // Capture exception
    this.sentry.captureException(error, {
      tags: {
        component: "l0",
      },
      extra: {
        telemetry: telemetry
          ? {
              session_id: telemetry.sessionId,
              duration_ms: telemetry.duration,
              tokens: telemetry.metrics.totalTokens,
            }
          : undefined,
      },
    });
  }

  /**
   * Record from L0Monitor
   */
  recordFromMonitor(monitor: L0Monitor): void {
    const telemetry = monitor.getTelemetry();
    if (telemetry) {
      this.completeExecution(telemetry);
    }
  }

  /**
   * Map guardrail severity to Sentry severity
   */
  private mapSeverity(severity: "warning" | "error" | "fatal"): SeverityLevel {
    switch (severity) {
      case "fatal":
        return "fatal";
      case "error":
        return "error";
      case "warning":
        return "warning";
      default:
        return "info";
    }
  }

  /**
   * Check if severity meets capture threshold
   */
  private shouldCapture(severity: "warning" | "error" | "fatal"): boolean {
    const levels = ["warning", "error", "fatal"];
    const minIndex = levels.indexOf(this.config.minGuardrailSeverity);
    const currentIndex = levels.indexOf(severity);
    return currentIndex >= minIndex;
  }
}

/**
 * Create Sentry integration
 */
export function createSentryIntegration(config: SentryConfig): L0Sentry {
  return new L0Sentry(config);
}

/**
 * Create a Sentry event handler for L0 observability.
 *
 * This is the recommended way to integrate Sentry with L0.
 * The handler subscribes to L0 events and records errors, breadcrumbs, and traces.
 *
 * @example
 * ```typescript
 * import * as Sentry from '@sentry/node';
 * import { l0, createSentryHandler, combineEvents } from 'reliable-ai-streams';
 *
 * const result = await l0({
 *   stream: () => streamText({ model, prompt }),
 *   onEvent: createSentryHandler({ sentry: Sentry }),
 * });
 *
 * // Or combine with other handlers:
 * const result = await l0({
 *   stream: () => streamText({ model, prompt }),
 *   onEvent: combineEvents(
 *     createOpenTelemetryHandler({ tracer, meter }),
 *     createSentryHandler({ sentry: Sentry }),
 *   ),
 * });
 * ```
 */
export function createSentryHandler(config: SentryConfig): EventHandler {
  const integration = createSentryIntegration(config);
  let finishSpan: (() => void) | undefined;

  return (event: L0Event) => {
    switch (event.type) {
      case EventType.SESSION_START: {
        const e = event as SessionStartEvent;
        finishSpan = integration.startExecution("l0.execution", {
          attempt: e.attempt,
          isRetry: e.isRetry,
          isFallback: e.isFallback,
        });
        integration.startStream();
        break;
      }

      case EventType.RETRY_ATTEMPT: {
        const e = event as RetryAttemptEvent;
        integration.recordRetry(e.attempt, e.reason, e.isNetwork ?? false);
        break;
      }

      case EventType.NETWORK_ERROR: {
        const e = event as NetworkErrorEvent;
        integration.recordNetworkError(
          new Error(e.error),
          e.category || "unknown",
          e.retryable ?? false,
        );
        break;
      }

      case EventType.ERROR: {
        const e = event as ErrorEvent;
        // Record as network error if it's network-related
        integration.recordNetworkError(
          new Error(e.error),
          e.failureType || "unknown",
          e.recoveryStrategy === "retry",
        );
        break;
      }

      case EventType.GUARDRAIL_RULE_RESULT: {
        const e = event as GuardrailRuleResultEvent;
        if (e.violation) {
          integration.recordGuardrailViolations([e.violation]);
        }
        break;
      }

      case EventType.DRIFT_CHECK_RESULT: {
        const e = event as DriftCheckResultEvent;
        if (e.detected) {
          integration.recordDrift(true, e.types);
        }
        break;
      }

      case EventType.COMPLETE: {
        const e = event as CompleteEvent;
        integration.completeStream(e.tokenCount);
        // Note: Full telemetry is available via L0Monitor, not in CompleteEvent
        finishSpan?.();
        finishSpan = undefined;
        break;
      }

      default:
        // Other events are not specifically handled
        break;
    }
  };
}

/**
 * Wrap L0 execution with Sentry tracking
 *
 * @example
 * ```typescript
 * import * as Sentry from '@sentry/node';
 * import { l0, withSentry } from 'l0';
 *
 * const result = await withSentry(
 *   { sentry: Sentry },
 *   () => l0({
 *     stream: () => streamText({ model, prompt }),
 *     monitoring: { enabled: true }
 *   })
 * );
 * ```
 */
export async function withSentry<T>(
  config: SentryConfig,
  fn: () => Promise<T & { telemetry?: L0Telemetry }>,
): Promise<T> {
  const integration = createSentryIntegration(config);
  integration.startExecution();

  try {
    const result = await fn();

    if (result.telemetry) {
      integration.completeExecution(result.telemetry);
    }

    return result;
  } catch (error) {
    integration.recordFailure(
      error instanceof Error ? error : new Error(String(error)),
    );
    throw error;
  }
}

// Re-export useful Sentry types for convenience
export type { SeverityLevel, Breadcrumb, Scope };
