/**
 * L0 Core - Minimal entry point for reduced bundle size
 *
 * Import from "reliable-ai-streams/core" instead of "reliable-ai-streams" to get only
 * the essential streaming runtime without optional features like
 * monitoring, adapters, consensus, document windows, etc.
 *
 * @example
 * ```typescript
 * import { l0, recommendedGuardrails, recommendedRetry } from "reliable-ai-streams/core";
 *
 * const result = await l0({
 *   stream: () => streamText({ model, prompt }),
 *   guardrails: recommendedGuardrails,
 *   retry: recommendedRetry,
 * });
 * ```
 */

// Core runtime
export {
  l0,
  getText,
  consumeStream,
  StateMachine,
  RuntimeStates,
  Metrics,
} from "./runtime/l0.js";

export type { RuntimeState } from "./runtime/state-machine.js";
export type { MetricsSnapshot } from "./runtime/metrics.js";

// Core types
export type {
  L0Options,
  L0Result,
  L0State,
  L0Event,
  L0Telemetry,
  L0Adapter,
  CategorizedNetworkError,
  L0Interceptor,
  RetryOptions,
  CheckpointValidationResult,
  GuardrailRule,
  GuardrailViolation,
  GuardrailContext,
  GuardrailResult,
  L0ContentType,
  L0DataPayload,
  L0Progress,
} from "./types/index.js";

// Guardrails - core rules only
export {
  GuardrailEngine,
  createGuardrailEngine,
  checkGuardrails,
  jsonRule,
  strictJsonRule,
  markdownRule,
  zeroOutputRule,
  minimalGuardrails,
  recommendedGuardrails,
  strictGuardrails,
  jsonOnlyGuardrails,
} from "./guardrails/index.js";

// Retry presets
export {
  minimalRetry,
  recommendedRetry,
  strictRetry,
  exponentialRetry,
} from "./types/l0.js";

// Retry utilities
export {
  RetryManager,
  createRetryManager,
  isRetryableError,
  getErrorCategory,
} from "./runtime/retry.js";

// Error handling
export {
  L0Error,
  isL0Error,
  isNetworkError,
  analyzeNetworkError,
  NetworkErrorType,
} from "./utils/errors.js";

export type {
  NetworkErrorAnalysis,
  L0ErrorCode,
  L0ErrorContext,
} from "./utils/errors.js";

// Retry types
export type {
  RetryReason,
  BackoffStrategy,
  CategorizedError,
  ErrorTypeDelays,
} from "./types/retry.js";

export { ErrorCategory, RETRY_DEFAULTS } from "./types/retry.js";

// Event normalization
export {
  normalizeStreamEvent,
  createTokenEvent,
  createCompleteEvent,
  createErrorEvent,
} from "./runtime/events.js";

// Essential utilities
export { sleep, withTimeout } from "./utils/timers.js";
