// Network error detection utilities for L0

import {
  RETRY_DEFAULTS,
  ERROR_TYPE_DELAY_DEFAULTS,
  ErrorCategory,
} from "../types/retry";

// Re-export ErrorCategory for convenience
export { ErrorCategory };

/**
 * Error codes for L0 errors
 */
export const L0ErrorCodes = {
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
} as const;

export type L0ErrorCode = (typeof L0ErrorCodes)[keyof typeof L0ErrorCodes];

/**
 * Map error codes to categories
 */
export function getErrorCategory(code: L0ErrorCode): ErrorCategory {
  switch (code) {
    case L0ErrorCodes.NETWORK_ERROR:
      return ErrorCategory.NETWORK;
    case L0ErrorCodes.INITIAL_TOKEN_TIMEOUT:
    case L0ErrorCodes.INTER_TOKEN_TIMEOUT:
      return ErrorCategory.TRANSIENT;
    case L0ErrorCodes.GUARDRAIL_VIOLATION:
    case L0ErrorCodes.FATAL_GUARDRAIL_VIOLATION:
    case L0ErrorCodes.DRIFT_DETECTED:
    case L0ErrorCodes.ZERO_OUTPUT:
      return ErrorCategory.CONTENT;
    case L0ErrorCodes.INVALID_STREAM:
    case L0ErrorCodes.ADAPTER_NOT_FOUND:
    case L0ErrorCodes.FEATURE_NOT_ENABLED:
      return ErrorCategory.INTERNAL;
    case L0ErrorCodes.STREAM_ABORTED:
    case L0ErrorCodes.ALL_STREAMS_EXHAUSTED:
    default:
      return ErrorCategory.PROVIDER;
  }
}

/**
 * Context information for L0 errors
 */
export interface L0ErrorContext {
  /**
   * Error code for programmatic handling
   */
  code: L0ErrorCode;

  /**
   * Current checkpoint content (for recovery)
   */
  checkpoint?: string;

  /**
   * Number of tokens processed before error
   */
  tokenCount?: number;

  /**
   * Current accumulated content length
   */
  contentLength?: number;

  /**
   * Number of retry attempts made
   */
  modelRetryCount?: number;

  /**
   * Number of network retries (don't count toward limit)
   */
  networkRetryCount?: number;

  /**
   * Index of fallback stream being used (0 = primary)
   */
  fallbackIndex?: number;

  /**
   * Additional context data
   */
  metadata?: Record<string, unknown>;

  /**
   * User-provided context (from L0Options.context)
   */
  context?: Record<string, unknown>;
}

/**
 * Enhanced error class for L0 with recovery context
 */
export class L0Error extends Error {
  /**
   * Error code for programmatic handling
   */
  readonly code: L0ErrorCode;

  /**
   * Error context with recovery information
   */
  readonly context: L0ErrorContext;

  /**
   * Timestamp when error occurred
   */
  readonly timestamp: number;

  constructor(message: string, context: L0ErrorContext) {
    super(message);
    this.name = "L0Error";
    this.code = context.code;
    this.context = context;
    this.timestamp = Date.now();

    // Maintain proper prototype chain
    Object.setPrototypeOf(this, L0Error.prototype);
  }

  /**
   * Get error category for routing decisions
   */
  get category(): ErrorCategory {
    return getErrorCategory(this.code);
  }

  /**
   * Check if error has a checkpoint that can be used for continuation.
   * This indicates whether there's valid checkpoint content to resume from.
   */
  get hasCheckpoint(): boolean {
    return (
      this.context.checkpoint !== undefined &&
      this.context.checkpoint.length > 0
    );
  }

  /**
   * @deprecated Use hasCheckpoint instead. Will be removed in v2.0.
   */
  get isRecoverable(): boolean {
    return this.hasCheckpoint;
  }

  /**
   * Get checkpoint content for recovery
   */
  getCheckpoint(): string | undefined {
    return this.context.checkpoint;
  }

  /**
   * Create a descriptive string with context
   */
  toDetailedString(): string {
    const parts = [this.message];

    if (this.context.tokenCount !== undefined) {
      parts.push(`Tokens: ${this.context.tokenCount}`);
    }
    if (this.context.modelRetryCount !== undefined) {
      parts.push(`Retries: ${this.context.modelRetryCount}`);
    }
    if (
      this.context.fallbackIndex !== undefined &&
      this.context.fallbackIndex > 0
    ) {
      parts.push(`Fallback: ${this.context.fallbackIndex}`);
    }
    if (this.context.checkpoint) {
      parts.push(`Checkpoint: ${this.context.checkpoint.length} chars`);
    }

    return parts.join(" | ");
  }

  /**
   * Serialize error for logging/transport
   */
  toJSON(): {
    name: string;
    code: L0ErrorCode;
    category: ErrorCategory;
    message: string;
    timestamp: number;
    hasCheckpoint: boolean;
    checkpoint: string | undefined;
    tokenCount: number | undefined;
    modelRetryCount: number | undefined;
    networkRetryCount: number | undefined;
    fallbackIndex: number | undefined;
    metadata: Record<string, unknown> | undefined;
    context: Record<string, unknown> | undefined;
  } {
    return {
      name: this.name,
      code: this.code,
      category: this.category,
      message: this.message,
      timestamp: this.timestamp,
      hasCheckpoint: this.hasCheckpoint,
      checkpoint: this.context.checkpoint,
      tokenCount: this.context.tokenCount,
      modelRetryCount: this.context.modelRetryCount,
      networkRetryCount: this.context.networkRetryCount,
      fallbackIndex: this.context.fallbackIndex,
      metadata: this.context.metadata,
      context: this.context.context,
    };
  }
}

/**
 * Type guard for L0Error
 */
export function isL0Error(error: unknown): error is L0Error {
  return error instanceof L0Error;
}

/**
 * Node.js style error with optional code property
 */
interface NodeError extends Error {
  code?: string;
}

/**
 * Type guard to check if error has a code property
 */
function hasErrorCode(error: Error): error is NodeError {
  return "code" in error && typeof (error as NodeError).code === "string";
}

/**
 * Get error code if present
 */
function getErrorCode(error: Error): string | undefined {
  return hasErrorCode(error) ? error.code : undefined;
}

/**
 * Network error types that L0 can detect
 */
export enum NetworkErrorType {
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

/**
 * Detailed network error analysis
 */
export interface NetworkErrorAnalysis {
  /**
   * The specific type of network error
   */
  type: NetworkErrorType;

  /**
   * Whether this error is retryable
   */
  retryable: boolean;

  /**
   * Whether this error should count toward retry limit
   */
  countsTowardLimit: boolean;

  /**
   * Suggested action to take
   */
  suggestion: string;

  /**
   * Additional context about the error
   */
  context?: Record<string, any>;
}

/**
 * Detect if error is a connection drop
 */
export function isConnectionDropped(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("connection dropped") ||
    message.includes("connection closed") ||
    message.includes("connection lost") ||
    message.includes("connection reset") ||
    message.includes("econnreset") ||
    message.includes("pipe broken") ||
    message.includes("broken pipe")
  );
}

/**
 * Detect if error is a fetch() TypeError
 */
export function isFetchTypeError(error: Error): boolean {
  return (
    error.name === "TypeError" &&
    (error.message.toLowerCase().includes("fetch") ||
      error.message.toLowerCase().includes("failed to fetch") ||
      error.message.toLowerCase().includes("network request failed"))
  );
}

/**
 * Detect if error is ECONNRESET
 */
export function isECONNRESET(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("econnreset") ||
    message.includes("connection reset by peer") ||
    getErrorCode(error) === "ECONNRESET"
  );
}

/**
 * Detect if error is ECONNREFUSED
 */
export function isECONNREFUSED(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("econnrefused") ||
    message.includes("connection refused") ||
    getErrorCode(error) === "ECONNREFUSED"
  );
}

/**
 * Detect if error is SSE abortion
 */
export function isSSEAborted(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("sse") ||
    message.includes("server-sent events") ||
    (message.includes("stream") && message.includes("abort")) ||
    message.includes("stream aborted") ||
    message.includes("eventstream") ||
    error.name === "AbortError"
  );
}

/**
 * Detect if error is due to no bytes arriving
 */
export function isNoBytes(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("no bytes") ||
    message.includes("empty response") ||
    message.includes("zero bytes") ||
    message.includes("no data received") ||
    message.includes("content-length: 0")
  );
}

/**
 * Detect if error is due to partial chunks
 */
export function isPartialChunks(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("partial chunk") ||
    message.includes("incomplete chunk") ||
    message.includes("truncated") ||
    message.includes("premature close") ||
    message.includes("unexpected end of data") ||
    message.includes("incomplete data")
  );
}

/**
 * Detect if error is due to Node/Edge runtime being killed
 */
export function isRuntimeKilled(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    (message.includes("worker") && message.includes("terminated")) ||
    (message.includes("runtime") && message.includes("killed")) ||
    message.includes("edge runtime") ||
    message.includes("lambda timeout") ||
    message.includes("function timeout") ||
    message.includes("execution timeout") ||
    message.includes("worker died") ||
    message.includes("process exited") ||
    message.includes("sigterm") ||
    message.includes("sigkill")
  );
}

/**
 * Detect if error is due to mobile background throttling
 */
export function isBackgroundThrottle(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    (message.includes("background") && message.includes("suspend")) ||
    message.includes("background throttle") ||
    message.includes("tab suspended") ||
    message.includes("page hidden") ||
    message.includes("visibility hidden") ||
    message.includes("inactive tab") ||
    message.includes("background tab")
  );
}

/**
 * Detect DNS errors
 */
export function isDNSError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("dns") ||
    message.includes("enotfound") ||
    message.includes("name resolution") ||
    message.includes("host not found") ||
    message.includes("getaddrinfo") ||
    getErrorCode(error) === "ENOTFOUND"
  );
}

/**
 * Detect SSL/TLS errors
 */
export function isSSLError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("ssl") ||
    message.includes("tls") ||
    message.includes("certificate") ||
    message.includes("cert") ||
    message.includes("handshake") ||
    message.includes("self signed") ||
    message.includes("unable to verify")
  );
}

/**
 * Detect timeout errors
 */
export function isTimeoutError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    error.name === "TimeoutError" ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("time out") ||
    message.includes("deadline exceeded") ||
    message.includes("etimedout") ||
    getErrorCode(error) === "ETIMEDOUT"
  );
}

/**
 * Analyze network error and provide detailed information
 */
export function analyzeNetworkError(error: Error): NetworkErrorAnalysis {
  // Check each specific error type
  if (isConnectionDropped(error)) {
    return {
      type: NetworkErrorType.CONNECTION_DROPPED,
      retryable: true,
      countsTowardLimit: false,
      suggestion: "Retry with exponential backoff - connection was interrupted",
    };
  }

  if (isFetchTypeError(error)) {
    return {
      type: NetworkErrorType.FETCH_ERROR,
      retryable: true,
      countsTowardLimit: false,
      suggestion: "Retry immediately - fetch() failed to initiate",
    };
  }

  if (isECONNRESET(error)) {
    return {
      type: NetworkErrorType.ECONNRESET,
      retryable: true,
      countsTowardLimit: false,
      suggestion: "Retry with backoff - connection was reset by peer",
    };
  }

  if (isECONNREFUSED(error)) {
    return {
      type: NetworkErrorType.ECONNREFUSED,
      retryable: true,
      countsTowardLimit: false,
      suggestion: "Retry with longer delay - server refused connection",
      context: {
        possibleCause: "Server may be down or not accepting connections",
      },
    };
  }

  if (isSSEAborted(error)) {
    return {
      type: NetworkErrorType.SSE_ABORTED,
      retryable: true,
      countsTowardLimit: false,
      suggestion: "Retry immediately - SSE stream was aborted",
    };
  }

  if (isNoBytes(error)) {
    return {
      type: NetworkErrorType.NO_BYTES,
      retryable: true,
      countsTowardLimit: false,
      suggestion: "Retry immediately - server sent no data",
      context: {
        possibleCause: "Empty response or connection closed before data sent",
      },
    };
  }

  if (isPartialChunks(error)) {
    return {
      type: NetworkErrorType.PARTIAL_CHUNKS,
      retryable: true,
      countsTowardLimit: false,
      suggestion: "Retry immediately - received incomplete data",
      context: {
        possibleCause: "Connection closed mid-stream",
      },
    };
  }

  if (isRuntimeKilled(error)) {
    return {
      type: NetworkErrorType.RUNTIME_KILLED,
      retryable: true,
      countsTowardLimit: false,
      suggestion:
        "Retry with shorter timeout - runtime was terminated (likely timeout)",
      context: {
        possibleCause:
          "Edge runtime timeout or Lambda timeout - consider breaking into smaller requests",
      },
    };
  }

  if (isBackgroundThrottle(error)) {
    return {
      type: NetworkErrorType.BACKGROUND_THROTTLE,
      retryable: true,
      countsTowardLimit: false,
      suggestion: "Retry when page becomes visible - mobile/browser throttling",
      context: {
        possibleCause: "Browser suspended network activity for background tab",
        resolution: "Wait for visibilitychange event",
      },
    };
  }

  if (isDNSError(error)) {
    return {
      type: NetworkErrorType.DNS_ERROR,
      retryable: true,
      countsTowardLimit: false,
      suggestion: "Retry with longer delay - DNS lookup failed",
      context: {
        possibleCause: "Network connectivity issue or invalid hostname",
      },
    };
  }

  if (isSSLError(error)) {
    return {
      type: NetworkErrorType.SSL_ERROR,
      retryable: false,
      countsTowardLimit: false,
      suggestion: "Don't retry - SSL/TLS error (configuration issue)",
      context: {
        possibleCause: "Certificate validation failed or SSL handshake error",
        resolution: "Check server certificate or SSL configuration",
      },
    };
  }

  if (isTimeoutError(error)) {
    return {
      type: NetworkErrorType.TIMEOUT,
      retryable: true,
      countsTowardLimit: false,
      suggestion: "Retry with longer timeout - request timed out",
    };
  }

  // Unknown network error
  return {
    type: NetworkErrorType.UNKNOWN,
    retryable: true,
    countsTowardLimit: false,
    suggestion: "Retry with caution - unknown network error",
  };
}

/**
 * Check if error is any type of network error
 */
export function isNetworkError(error: Error): boolean {
  return (
    isConnectionDropped(error) ||
    isFetchTypeError(error) ||
    isECONNRESET(error) ||
    isECONNREFUSED(error) ||
    isSSEAborted(error) ||
    isNoBytes(error) ||
    isPartialChunks(error) ||
    isRuntimeKilled(error) ||
    isBackgroundThrottle(error) ||
    isDNSError(error) ||
    isSSLError(error) ||
    isTimeoutError(error)
  );
}

/**
 * Get human-readable description of network error
 */
export function describeNetworkError(error: Error): string {
  const analysis = analyzeNetworkError(error);

  let description = `Network error: ${analysis.type}`;

  if (analysis.context?.possibleCause) {
    description += ` (${analysis.context.possibleCause})`;
  }

  return description;
}

/**
 * Create enhanced network error with analysis
 */
export function createNetworkError(
  originalError: Error,
  analysis: NetworkErrorAnalysis,
): Error & { analysis: NetworkErrorAnalysis } {
  const error = new Error(
    `${originalError.message} [${analysis.type}]`,
  ) as Error & { analysis: NetworkErrorAnalysis };
  error.name = originalError.name;
  error.stack = originalError.stack;
  error.analysis = analysis;
  return error;
}

/**
 * Check if error indicates stream was interrupted mid-flight
 */
export function isStreamInterrupted(error: Error, tokenCount: number): boolean {
  // If we received some tokens but then got a network error, stream was interrupted
  if (tokenCount > 0 && isNetworkError(error)) {
    return true;
  }

  // Check for specific interrupted stream indicators
  const message = error.message.toLowerCase();
  return (
    message.includes("stream interrupted") ||
    message.includes("stream closed unexpectedly") ||
    message.includes("connection lost mid-stream") ||
    (isPartialChunks(error) && tokenCount > 0)
  );
}

/**
 * Suggest retry delay based on network error type
 * @param error - Error to analyze
 * @param attempt - Retry attempt number (0-based)
 * @param customDelays - Optional custom delays per error type
 * @param maxDelay - Optional maximum delay cap (default: 30000ms)
 */
export function suggestRetryDelay(
  error: Error,
  attempt: number,
  customDelays?: Partial<Record<NetworkErrorType, number>>,
  maxDelay: number = RETRY_DEFAULTS.networkMaxDelay,
): number {
  const analysis = analyzeNetworkError(error);

  // Default base delays for different error types (from centralized config)
  const defaultDelays: Record<NetworkErrorType, number> = {
    [NetworkErrorType.CONNECTION_DROPPED]:
      ERROR_TYPE_DELAY_DEFAULTS.connectionDropped,
    [NetworkErrorType.FETCH_ERROR]: ERROR_TYPE_DELAY_DEFAULTS.fetchError,
    [NetworkErrorType.ECONNRESET]: ERROR_TYPE_DELAY_DEFAULTS.econnreset,
    [NetworkErrorType.ECONNREFUSED]: ERROR_TYPE_DELAY_DEFAULTS.econnrefused,
    [NetworkErrorType.SSE_ABORTED]: ERROR_TYPE_DELAY_DEFAULTS.sseAborted,
    [NetworkErrorType.NO_BYTES]: ERROR_TYPE_DELAY_DEFAULTS.noBytes,
    [NetworkErrorType.PARTIAL_CHUNKS]: ERROR_TYPE_DELAY_DEFAULTS.partialChunks,
    [NetworkErrorType.RUNTIME_KILLED]: ERROR_TYPE_DELAY_DEFAULTS.runtimeKilled,
    [NetworkErrorType.BACKGROUND_THROTTLE]:
      ERROR_TYPE_DELAY_DEFAULTS.backgroundThrottle,
    [NetworkErrorType.DNS_ERROR]: ERROR_TYPE_DELAY_DEFAULTS.dnsError,
    [NetworkErrorType.SSL_ERROR]: 0, // Don't retry SSL errors
    [NetworkErrorType.TIMEOUT]: ERROR_TYPE_DELAY_DEFAULTS.timeout,
    [NetworkErrorType.UNKNOWN]: ERROR_TYPE_DELAY_DEFAULTS.unknown,
  };

  // Use custom delay if provided, otherwise use default
  const baseDelay =
    customDelays?.[analysis.type] ?? defaultDelays[analysis.type];
  if (baseDelay === 0) return 0;

  // Exponential backoff
  return Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
}
