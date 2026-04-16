// Retry manager with error categorization and backoff logic for L0

import type {
  RetryConfig,
  RetryState,
  RetryReason,
  CategorizedError,
  RetryDecision,
  BackoffResult,
  ErrorClassification,
  RetryContext,
  ErrorTypeDelays,
} from "../types/retry";
import { ErrorCategory, RETRY_DEFAULTS } from "../types/retry";
import { calculateBackoff, sleep } from "../utils/timers";
import {
  isNetworkError,
  analyzeNetworkError,
  isTimeoutError,
  suggestRetryDelay,
  NetworkErrorType,
} from "../utils/errors";

/**
 * Retry manager for handling retry logic with smart error categorization
 */
export class RetryManager {
  private config: RetryConfig;
  private state: RetryState;

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = {
      attempts: config.attempts ?? RETRY_DEFAULTS.attempts,
      maxRetries: config.maxRetries ?? RETRY_DEFAULTS.maxRetries,
      baseDelay: config.baseDelay ?? RETRY_DEFAULTS.baseDelay,
      maxDelay: config.maxDelay ?? RETRY_DEFAULTS.maxDelay,
      backoff: config.backoff ?? RETRY_DEFAULTS.backoff,
      retryOn: config.retryOn ?? [...RETRY_DEFAULTS.retryOn],
      maxErrorHistory: config.maxErrorHistory,
    };

    this.state = this.createInitialState();
  }

  /**
   * Create initial retry state
   */
  private createInitialState(): RetryState {
    return {
      attempt: 0,
      networkRetryCount: 0,
      transientRetries: 0,
      errorHistory: [],
      totalDelay: 0,
      limitReached: false,
    };
  }

  /**
   * Categorize an error for retry decision making
   */
  categorizeError(error: Error, reason?: RetryReason): CategorizedError {
    const classification = this.classifyError(error);
    const category = this.determineCategory(classification);
    const countsTowardLimit = category === ErrorCategory.MODEL;
    const retryable = category !== ErrorCategory.FATAL;

    return {
      error,
      category,
      reason: reason ?? this.inferReason(classification, error),
      countsTowardLimit,
      retryable,
      timestamp: Date.now(),
      statusCode: classification.statusCode,
    };
  }

  /**
   * Classify error type using enhanced network error detection
   */
  private classifyError(error: Error): ErrorClassification {
    const message = error.message?.toLowerCase() || "";

    // Use enhanced network error detection from utils/errors
    const isNetwork = isNetworkError(error);

    // Check for timeout errors
    const isTimeout = isTimeoutError(error);

    // Try to extract status code
    let statusCode: number | undefined;
    const statusMatch = message.match(/status\s*(?:code)?\s*:?\s*(\d{3})/i);
    if (statusMatch && statusMatch[1]) {
      statusCode = parseInt(statusMatch[1], 10);
    }

    // Check for rate limit (429)
    const isRateLimit = statusCode === 429 || message.includes("rate limit");

    // Check for server errors (5xx)
    const isServerError =
      statusCode !== undefined && statusCode >= 500 && statusCode < 600;

    // Check for auth errors (401, 403)
    const isAuthError =
      statusCode === 401 ||
      statusCode === 403 ||
      message.includes("unauthorized") ||
      message.includes("forbidden");

    // Check for client errors (4xx, excluding 429)
    const isClientError =
      statusCode !== undefined &&
      statusCode >= 400 &&
      statusCode < 500 &&
      statusCode !== 429;

    return {
      isNetwork,
      isRateLimit,
      isServerError,
      isTimeout,
      isAuthError,
      isClientError,
      statusCode,
    };
  }

  /**
   * Determine error category from classification
   */
  private determineCategory(
    classification: ErrorClassification,
  ): ErrorCategory {
    // Network errors - retry forever
    if (classification.isNetwork) {
      return ErrorCategory.NETWORK;
    }

    // Transient errors - retry forever
    if (
      classification.isRateLimit ||
      classification.isServerError ||
      classification.isTimeout
    ) {
      return ErrorCategory.TRANSIENT;
    }

    // Fatal errors - don't retry (except SSL errors which are fatal)
    if (
      classification.isAuthError ||
      (classification.isClientError && !classification.isRateLimit)
    ) {
      return ErrorCategory.FATAL;
    }

    // Everything else is a model error
    return ErrorCategory.MODEL;
  }

  /**
   * Infer retry reason from error classification and detailed network analysis
   */
  private inferReason(
    classification: ErrorClassification,
    error?: Error,
  ): RetryReason {
    if (classification.isNetwork) {
      // For network errors, try to get more specific reason
      if (error) {
        const analysis = analyzeNetworkError(error);
        // Map specific network error types to retry reasons
        switch (analysis.type) {
          case "connection_dropped":
          case "econnreset":
          case "econnrefused":
          case "sse_aborted":
          case "partial_chunks":
          case "no_bytes":
            return "network_error";
          case "runtime_killed":
          case "timeout":
            return "timeout";
          default:
            return "network_error";
        }
      }
      return "network_error";
    }
    if (classification.isTimeout) return "timeout";
    if (classification.isRateLimit) return "rate_limit";
    if (classification.isServerError) return "server_error";
    // Unclassified errors default to unknown (not retried by default)
    return "unknown";
  }

  /**
   * Decide whether to retry and calculate delay
   * Enhanced with network error analysis
   */
  shouldRetry(error: Error, reason?: RetryReason): RetryDecision {
    const categorized = this.categorizeError(error, reason);

    // For network errors, provide detailed analysis
    if (
      categorized.category === ErrorCategory.NETWORK &&
      isNetworkError(error)
    ) {
      const analysis = analyzeNetworkError(error);

      // SSL errors are actually fatal, not retryable
      if (!analysis.retryable) {
        return {
          shouldRetry: false,
          delay: 0,
          reason: `Fatal network error: ${analysis.suggestion}`,
          category: ErrorCategory.FATAL,
          countsTowardLimit: false,
        };
      }
    }

    // Don't retry fatal errors
    if (categorized.category === ErrorCategory.FATAL) {
      return {
        shouldRetry: false,
        delay: 0,
        reason: "Fatal error - not retryable",
        category: categorized.category,
        countsTowardLimit: false,
      };
    }

    // Check if reason is in retryOn list
    if (
      categorized.reason &&
      !this.config.retryOn.includes(categorized.reason)
    ) {
      return {
        shouldRetry: false,
        delay: 0,
        reason: `Retry reason '${categorized.reason}' not in retryOn list`,
        category: categorized.category,
        countsTowardLimit: false,
      };
    }

    // Check absolute maxRetries cap (applies to ALL error types including network)
    if (
      this.config.maxRetries !== undefined &&
      this.getTotalRetries() >= this.config.maxRetries
    ) {
      this.state.limitReached = true;
      return {
        shouldRetry: false,
        delay: 0,
        reason: `Absolute maximum retries (${this.config.maxRetries}) reached`,
        category: categorized.category,
        countsTowardLimit: false,
      };
    }

    // Check if we've hit the retry limit (only for model errors)
    if (
      categorized.countsTowardLimit &&
      this.state.attempt >= this.config.attempts
    ) {
      this.state.limitReached = true;
      return {
        shouldRetry: false,
        delay: 0,
        reason: "Maximum retry attempts reached",
        category: categorized.category,
        countsTowardLimit: true,
      };
    }

    // Calculate backoff delay
    const attemptCount = categorized.countsTowardLimit
      ? this.state.attempt
      : categorized.category === ErrorCategory.NETWORK
        ? this.state.networkRetryCount
        : this.state.transientRetries;

    // For network errors, check if custom delay is configured
    let backoff: BackoffResult;
    if (
      categorized.category === ErrorCategory.NETWORK &&
      this.config.errorTypeDelays &&
      isNetworkError(error)
    ) {
      // Network error analysis available if needed
      const customDelayMap = this.mapErrorTypeDelays(
        this.config.errorTypeDelays,
      );
      const customDelay = suggestRetryDelay(
        error,
        attemptCount,
        customDelayMap,
        this.config.maxDelay,
      );
      backoff = {
        delay: customDelay,
        cappedAtMax: customDelay >= (this.config.maxDelay ?? 10000),
        rawDelay: customDelay,
      };
    } else {
      backoff = calculateBackoff(
        this.config.backoff,
        attemptCount,
        this.config.baseDelay,
        this.config.maxDelay,
      );
    }

    return {
      shouldRetry: true,
      delay: backoff.delay,
      reason: `Retrying after ${categorized.category} error`,
      category: categorized.category,
      countsTowardLimit: categorized.countsTowardLimit,
    };
  }

  /**
   * Record a retry attempt
   */
  async recordRetry(
    categorizedError: CategorizedError,
    decision: RetryDecision,
  ): Promise<void> {
    // Update state
    if (decision.countsTowardLimit) {
      this.state.attempt++;
    } else if (categorizedError.category === ErrorCategory.NETWORK) {
      this.state.networkRetryCount++;
    } else if (categorizedError.category === ErrorCategory.TRANSIENT) {
      this.state.transientRetries++;
    }

    this.state.lastError = categorizedError;
    this.state.errorHistory.push(categorizedError);

    // Enforce error history bound if configured (prevents memory leaks in long-running processes)
    const maxHistory = this.config.maxErrorHistory;
    if (
      maxHistory !== undefined &&
      this.state.errorHistory.length > maxHistory
    ) {
      this.state.errorHistory = this.state.errorHistory.slice(-maxHistory);
    }

    this.state.totalDelay += decision.delay;

    // Wait for backoff delay
    if (decision.delay > 0) {
      await sleep(decision.delay);
    }
  }

  /**
   * Execute a function with retry logic
   */
  async execute<T>(
    fn: () => Promise<T>,
    onRetry?: (context: RetryContext) => void,
  ): Promise<T> {
    while (true) {
      try {
        const result = await fn();
        return result;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const categorized = this.categorizeError(err);
        const decision = this.shouldRetry(err);

        if (!decision.shouldRetry) {
          throw err;
        }

        // Calculate backoff
        const attemptCount = decision.countsTowardLimit
          ? this.state.attempt
          : categorized.category === ErrorCategory.NETWORK
            ? this.state.networkRetryCount
            : this.state.transientRetries;

        // Calculate backoff with custom delays if network error
        let backoff: BackoffResult;
        if (
          categorized.category === ErrorCategory.NETWORK &&
          this.config.errorTypeDelays &&
          isNetworkError(err)
        ) {
          const customDelayMap = this.mapErrorTypeDelays(
            this.config.errorTypeDelays,
          );
          const customDelay = suggestRetryDelay(
            err,
            attemptCount,
            customDelayMap,
            this.config.maxDelay,
          );
          backoff = {
            delay: customDelay,
            cappedAtMax: customDelay >= (this.config.maxDelay ?? 10000),
            rawDelay: customDelay,
          };
        } else {
          backoff = calculateBackoff(
            this.config.backoff,
            attemptCount,
            this.config.baseDelay,
            this.config.maxDelay,
          );
        }
        // Notify callback
        if (onRetry) {
          onRetry({
            state: this.getState(),
            config: this.config,
            error: categorized,
            backoff,
          });
        }

        // Record retry and wait
        await this.recordRetry(categorized, decision);
      }
    }
  }

  /**
   * Get current state
   */
  getState(): RetryState {
    return { ...this.state };
  }

  /**
   * Reset state
   */
  reset(): void {
    this.state = this.createInitialState();
  }

  /**
   * Check if retry limit has been reached
   */
  hasReachedLimit(): boolean {
    return this.state.limitReached;
  }

  /**
   * Get total retry count (all types)
   */
  getTotalRetries(): number {
    return (
      this.state.attempt +
      this.state.networkRetryCount +
      this.state.transientRetries
    );
  }

  /**
   * Get model failure retry count
   */
  getmodelRetryCount(): number {
    return this.state.attempt;
  }

  /**
   * Map ErrorTypeDelays to NetworkErrorType record
   */
  private mapErrorTypeDelays(
    delays: ErrorTypeDelays,
  ): Partial<Record<NetworkErrorType, number>> {
    return {
      [NetworkErrorType.CONNECTION_DROPPED]: delays.connectionDropped,
      [NetworkErrorType.FETCH_ERROR]: delays.fetchError,
      [NetworkErrorType.ECONNRESET]: delays.econnreset,
      [NetworkErrorType.ECONNREFUSED]: delays.econnrefused,
      [NetworkErrorType.SSE_ABORTED]: delays.sseAborted,
      [NetworkErrorType.NO_BYTES]: delays.noBytes,
      [NetworkErrorType.PARTIAL_CHUNKS]: delays.partialChunks,
      [NetworkErrorType.RUNTIME_KILLED]: delays.runtimeKilled,
      [NetworkErrorType.BACKGROUND_THROTTLE]: delays.backgroundThrottle,
      [NetworkErrorType.DNS_ERROR]: delays.dnsError,
      [NetworkErrorType.TIMEOUT]: delays.timeout,
      [NetworkErrorType.UNKNOWN]: delays.unknown,
    };
  }
}

/**
 * Create a retry manager with configuration
 */
export function createRetryManager(
  config?: Partial<RetryConfig>,
): RetryManager {
  return new RetryManager(config);
}

/**
 * Helper to check if an error is retryable
 */
export function isRetryableError(error: Error): boolean {
  const manager = new RetryManager();
  const categorized = manager.categorizeError(error);
  return categorized.retryable;
}

/**
 * Helper to get error category
 */
export function getErrorCategory(error: Error): ErrorCategory {
  const manager = new RetryManager();
  const categorized = manager.categorizeError(error);
  return categorized.category;
}
