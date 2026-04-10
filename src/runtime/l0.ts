// Main L0 runtime wrapper - streaming, guardrails, retry, and reliability layer

import type {
  L0Options,
  L0Result,
  L0State,
  L0Event,
  L0Adapter,
} from "../types/l0";
import { GuardrailEngine } from "../guardrails/engine";
import type { GuardrailContext } from "../types/guardrails";
import { RetryManager } from "./retry";
import { detectZeroToken } from "./zeroToken";
import { normalizeStreamEvent } from "./events";
import { detectOverlap } from "../utils/tokens";
import {
  isNetworkError,
  analyzeNetworkError,
  L0Error,
  ErrorCategory,
  L0ErrorCodes,
} from "../utils/errors";
import { EventDispatcher } from "./event-dispatcher";
import { registerCallbackWrappers } from "./callback-wrappers";
import {
  EventType,
  type FailureType,
  type RecoveryStrategy,
  type RecoveryPolicy,
} from "../types/observability";

// Type-only imports for optional modules (injected at runtime)
import type { DriftDetector as DriftDetectorType } from "./drift";
import type { L0Monitor as L0MonitorType } from "./monitoring";
import type { InterceptorManager as InterceptorManagerType } from "./interceptors";

// Optional feature loaders - these are set by calling enableXxx() functions
// This allows the features to be tree-shaken when not used
let _driftDetectorFactory: (() => DriftDetectorType) | null = null;
let _monitorFactory: ((config: unknown) => L0MonitorType) | null = null;
let _interceptorManagerFactory:
  | ((interceptors: unknown[]) => InterceptorManagerType)
  | null = null;
let _adapterRegistry: {
  getAdapter: (name: string) => L0Adapter | undefined;
  hasMatchingAdapter: (stream: unknown) => boolean;
  detectAdapter: (stream: unknown) => L0Adapter;
} | null = null;

/**
 * Enable drift detection feature. Call this once before using detectDrift option.
 * @example
 * ```typescript
 * import { enableDriftDetection } from "@ai2070/l0";
 * enableDriftDetection();
 * ```
 */
export function enableDriftDetection(factory: () => DriftDetectorType): void {
  _driftDetectorFactory = factory;
}

/**
 * Enable monitoring feature. Call this once before using monitoring option.
 * @example
 * ```typescript
 * import { enableMonitoring } from "@ai2070/l0";
 * enableMonitoring();
 * ```
 */
export function enableMonitoring(
  factory: (config: unknown) => L0MonitorType,
): void {
  _monitorFactory = factory;
}

/**
 * Enable interceptors feature. Call this once before using interceptors option.
 * @example
 * ```typescript
 * import { enableInterceptors } from "@ai2070/l0";
 * enableInterceptors();
 * ```
 */
export function enableInterceptors(
  factory: (interceptors: unknown[]) => InterceptorManagerType,
): void {
  _interceptorManagerFactory = factory;
}

/**
 * Enable adapter registry for auto-detection of SDK streams.
 * @example
 * ```typescript
 * import { enableAdapterRegistry } from "@ai2070/l0";
 * enableAdapterRegistry();
 * ```
 */
export function enableAdapterRegistry(registry: {
  getAdapter: (name: string) => L0Adapter | undefined;
  hasMatchingAdapter: (stream: unknown) => boolean;
  detectAdapter: (stream: unknown) => L0Adapter;
}): void {
  _adapterRegistry = registry;
}

// Import from extracted modules
import { createInitialState, resetStateForRetry } from "./state";
import { validateCheckpointForContinuation } from "./checkpoint";
import { safeInvokeCallback } from "./callbacks";
import { StateMachine, RuntimeStates } from "./state-machine";
import { Metrics } from "./metrics";

// Re-export helpers for backward compatibility
export { getText, consumeStream } from "./helpers";

// Re-export new modules for advanced usage
export { StateMachine, RuntimeStates } from "./state-machine";
export type { RuntimeState } from "./state-machine";
export { Metrics } from "./metrics";

/**
 * Determine the failure type from an error.
 * Maps errors to their root cause category.
 */
function getFailureType(error: Error, signal?: AbortSignal): FailureType {
  // Check for abort first
  if (signal?.aborted || error.name === "AbortError") {
    return "abort";
  }

  // Check for L0-specific error codes
  if (error instanceof L0Error) {
    switch (error.code) {
      case L0ErrorCodes.INITIAL_TOKEN_TIMEOUT:
      case L0ErrorCodes.INTER_TOKEN_TIMEOUT:
        return "timeout";
      case L0ErrorCodes.ZERO_OUTPUT:
        return "zero_output";
      case L0ErrorCodes.NETWORK_ERROR:
        return "network";
      case L0ErrorCodes.GUARDRAIL_VIOLATION:
      case L0ErrorCodes.FATAL_GUARDRAIL_VIOLATION:
      case L0ErrorCodes.DRIFT_DETECTED:
        return "model"; // Content issues are model-side
      default:
        break;
    }
  }

  // Check for network errors
  if (isNetworkError(error)) {
    return "network";
  }

  // Check error message patterns for timeouts
  const message = error.message.toLowerCase();
  if (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("deadline exceeded")
  ) {
    return "timeout";
  }

  // Check for tool errors
  if (
    message.includes("tool") ||
    message.includes("function call") ||
    (error as any).toolCallId
  ) {
    return "tool";
  }

  return "unknown";
}

/**
 * Determine recovery strategy based on retry decision and fallback availability.
 */
function getRecoveryStrategy(
  willRetry: boolean,
  willFallback: boolean,
): RecoveryStrategy {
  if (willRetry) return "retry";
  if (willFallback) return "fallback";
  return "halt";
}

/**
 * Main L0 wrapper function
 * Provides streaming runtime with guardrails, drift detection, retry logic,
 * and network protections
 *
 * @param options - L0 configuration options
 * @returns L0 result with streaming interface
 *
 * @example
 * ```typescript
 * const result = await l0({
 *   stream: () => streamText({ model, prompt }),
 *   guardrails: [jsonRule(), markdownRule()],
 *   retry: { attempts: 3, backoff: "fixed-jitter" }
 * });
 *
 * for await (const event of result.stream) {
 *   console.log(event);
 * }
 * ```
 */
export async function l0<TOutput = unknown>(
  options: L0Options<TOutput>,
): Promise<L0Result<TOutput>> {
  const { signal: externalSignal, interceptors = [] } = options;

  // Use interceptor manager if interceptors provided AND feature is enabled
  let interceptorManager: InterceptorManagerType | null = null;
  let processedOptions: L0Options<TOutput> = options;

  if (interceptors.length > 0) {
    if (!_interceptorManagerFactory) {
      throw new L0Error(
        "Interceptors require enableInterceptors() to be called first. " +
          'Import and call: import { enableInterceptors } from "@ai2070/l0"; enableInterceptors();',
        { code: L0ErrorCodes.FEATURE_NOT_ENABLED, context: options.context },
      );
    }
    interceptorManager = _interceptorManagerFactory(interceptors);

    // Execute "before" interceptors
    try {
      processedOptions = (await interceptorManager.executeBefore(
        options,
      )) as L0Options<TOutput>;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await interceptorManager.executeError(err, options);
      throw err;
    }
  }

  // Use processed options for the rest of execution
  const {
    stream: processedStream,
    fallbackStreams: processedFallbackStreams = [],
    guardrails: processedGuardrails = [],
    retry: processedRetry = {},
    timeout: processedTimeout = {},
    signal: processedSignal,
    monitoring: processedMonitoring,
    detectDrift: processedDetectDrift = false,
    detectZeroTokens: processedDetectZeroTokens = true,
    checkIntervals: processedCheckIntervals = {},
    // Note: onComplete is handled by registerCallbackWrappers via COMPLETE event
    // Note: onError is handled by registerCallbackWrappers via ERROR event
    // Note: onViolation is handled by registerCallbackWrappers via GUARDRAIL_RULE_RESULT event
    onEvent: processedOnEvent,
    continueFromLastKnownGoodToken: processedContinueFromCheckpoint = false,
    buildContinuationPrompt: processedBuildContinuationPrompt,
    deduplicateContinuation: processedDeduplicateContinuation,
    deduplicationOptions: processedDeduplicationOptions = {},
    context: processedContext = {},
  } = processedOptions;

  // Initialize event dispatcher for observability
  const dispatcher = new EventDispatcher(processedContext);

  // Register onEvent handler with dispatcher for lifecycle events
  if (processedOnEvent) {
    dispatcher.onEvent(processedOnEvent);
  }

  // Register legacy callback wrappers
  registerCallbackWrappers(dispatcher, processedOptions);

  // Deduplication is enabled by default when continuation is enabled
  const shouldDeduplicateContinuation =
    processedDeduplicateContinuation ?? processedContinueFromCheckpoint;

  // Configure check intervals with defaults
  const guardrailCheckInterval = processedCheckIntervals.guardrails ?? 15;
  const driftCheckInterval = processedCheckIntervals.drift ?? 25;
  const checkpointInterval = processedCheckIntervals.checkpoint ?? 20;

  // Initialize state
  const state: L0State = createInitialState();
  const errors: Error[] = [];

  // Initialize built-in abort controller
  const abortController = new AbortController();
  const signal = processedSignal || externalSignal || abortController.signal;

  // Use monitoring if enabled AND feature is loaded
  let monitor: L0MonitorType | null = null;
  if (processedMonitoring?.enabled) {
    if (!_monitorFactory) {
      throw new L0Error(
        "Monitoring requires enableMonitoring() to be called first. " +
          'Import and call: import { enableMonitoring } from "@ai2070/l0"; enableMonitoring();',
        {
          code: L0ErrorCodes.FEATURE_NOT_ENABLED,
          context: processedContext,
        },
      );
    }
    monitor = _monitorFactory({
      enabled: true,
      sampleRate: processedMonitoring?.sampleRate ?? 1.0,
      includeNetworkDetails: processedMonitoring?.includeNetworkDetails ?? true,
      includeTimings: processedMonitoring?.includeTimings ?? true,
      metadata: processedMonitoring?.metadata,
    });
    monitor.start();
    monitor.recordContinuation(processedContinueFromCheckpoint, false);
  }

  // Initialize engines
  const guardrailEngine =
    processedGuardrails.length > 0
      ? new GuardrailEngine({
          rules: processedGuardrails,
          stopOnFatal: true,
          enableStreaming: true,
          onPhaseStart: (phase, ruleCount, tokenCount) => {
            dispatcher.emit(EventType.GUARDRAIL_PHASE_START, {
              phase,
              ruleCount,
              tokenCount,
            });
          },
          onPhaseEnd: (phase, passed, violations, durationMs) => {
            dispatcher.emit(EventType.GUARDRAIL_PHASE_END, {
              phase,
              passed,
              violations,
              durationMs,
            });
          },
          onRuleStart: (index, ruleId, callbackId) => {
            dispatcher.emit(EventType.GUARDRAIL_RULE_START, {
              index,
              ruleId,
              callbackId,
            });
          },
          onRuleEnd: (index, ruleId, passed, callbackId, durationMs) => {
            dispatcher.emit(EventType.GUARDRAIL_RULE_END, {
              index,
              ruleId,
              passed,
              callbackId,
              durationMs,
            });
          },
        })
      : null;

  const retryManager = new RetryManager({
    attempts: processedRetry.attempts ?? 2,
    maxRetries: processedRetry.maxRetries,
    baseDelay: processedRetry.baseDelay ?? 1000,
    maxDelay: processedRetry.maxDelay ?? 10000,
    backoff: processedRetry.backoff ?? "fixed-jitter",
    retryOn: processedRetry.retryOn ?? [
      "zero_output",
      "guardrail_violation",
      "drift",
      "incomplete",
      "network_error",
      "timeout",
      "rate_limit",
      "server_error",
    ],
  });

  // Use drift detector if enabled AND feature is loaded
  let driftDetector: DriftDetectorType | null = null;
  if (processedDetectDrift) {
    if (!_driftDetectorFactory) {
      throw new L0Error(
        "Drift detection requires enableDriftDetection() to be called first. " +
          'Import and call: import { enableDriftDetection } from "@ai2070/l0"; enableDriftDetection();',
        {
          code: L0ErrorCodes.FEATURE_NOT_ENABLED,
          context: processedContext,
        },
      );
    }
    driftDetector = _driftDetectorFactory();
  }

  // Initialize state machine and metrics
  const stateMachine = new StateMachine();
  const metrics = new Metrics();
  metrics.requests++;

  // Create async generator for streaming
  const streamGenerator = async function* (): AsyncGenerator<L0Event> {
    let fallbackIndex = 0;
    const allStreams = [processedStream, ...processedFallbackStreams];

    // Token buffer for O(n) accumulation instead of O(n²) string concatenation
    let tokenBuffer: string[] = [];

    // Track checkpoint for continuation
    let checkpointForContinuation = "";

    // Overlap matching state for continuation
    // LLMs often repeat content when continuing, so we buffer and match overlaps
    let overlapBuffer = "";
    let overlapResolved = false;

    // Emit SESSION_START once at the beginning of the session (anchor for entire session)
    dispatcher.emit(EventType.SESSION_START, {
      attempt: 1,
      isRetry: false,
      isFallback: false,
    });

    // Try primary stream first, then fallbacks if exhausted
    while (fallbackIndex < allStreams.length) {
      const currentStreamFactory = allStreams[fallbackIndex]!;
      let retryAttempt = 0;
      // Track if this is a retry (network errors don't increment retryAttempt but still need state reset)
      let isRetryAttempt = false;
      // Model failure retry limit (network errors don't count toward this)
      const modelRetryLimit = processedRetry.attempts ?? 2;

      // Update state with current fallback index
      state.fallbackIndex = fallbackIndex;

      while (retryAttempt <= modelRetryLimit) {
        // Transition to init state at start of each attempt
        stateMachine.transition(RuntimeStates.INIT);

        try {
          // Reset state for retry (but preserve checkpoint if continuation enabled)
          // retryAttempt > 0: guardrail/drift retries increment this directly
          // isRetryAttempt: network retries set this flag (don't count toward limit)
          if (retryAttempt > 0 || isRetryAttempt) {
            // Check if we should continue from checkpoint
            if (
              processedContinueFromCheckpoint &&
              state.checkpoint.length > 0
            ) {
              checkpointForContinuation = state.checkpoint;
              stateMachine.transition(RuntimeStates.CHECKPOINT_VERIFYING);

              // Validate checkpoint content before continuation
              const validation = validateCheckpointForContinuation(
                checkpointForContinuation,
                guardrailEngine,
                driftDetector,
              );

              // Record any violations found
              if (validation.violations.length > 0) {
                state.violations.push(...validation.violations);
                monitor?.recordGuardrailViolations(validation.violations);
              }

              // Record drift if detected
              if (validation.driftDetected) {
                state.driftDetected = true;
                monitor?.recordDrift(true, validation.driftTypes);
                dispatcher.emit(EventType.GUARDRAIL_RULE_RESULT, {
                  index: 0,
                  ruleId: "drift",
                  passed: false,
                  violation: {
                    rule: "drift",
                    severity: "warning",
                    message: `Drift detected in checkpoint: ${validation.driftTypes.join(", ")}`,
                  },
                });
              }

              if (validation.skipContinuation) {
                // Fatal violation in checkpoint, start fresh
                tokenBuffer = [];
                resetStateForRetry(state);
                continue;
              }

              state.resumed = true;
              state.resumePoint = checkpointForContinuation;
              state.resumeFrom = checkpointForContinuation.length;

              // Reset overlap matching state for the new continuation
              overlapBuffer = "";
              overlapResolved = false;

              // Emit CONTINUATION_START event
              dispatcher.emit(EventType.CONTINUATION_START, {
                checkpoint: checkpointForContinuation,
                tokenCount: state.tokenCount,
              });

              // Emit RESUME_START event (callback wrappers handle legacy onResume)
              dispatcher.emit(EventType.RESUME_START, {
                checkpoint: checkpointForContinuation,
                tokenCount: state.tokenCount,
              });

              // Call buildContinuationPrompt if provided (allows user to update prompt for retry)
              if (processedBuildContinuationPrompt) {
                processedBuildContinuationPrompt(checkpointForContinuation);
              }

              // Record continuation in monitoring
              monitor?.recordContinuation(
                true,
                true,
                checkpointForContinuation,
              );

              // Emit the checkpoint content as tokens first
              // This ensures consumers see the full accumulated content
              const checkpointEvent: L0Event = {
                type: "token",
                value: checkpointForContinuation,
                timestamp: Date.now(),
              };
              safeInvokeCallback(
                processedOnEvent,
                checkpointEvent,
                monitor,
                "onEvent",
              );
              yield checkpointEvent;

              // Initialize token buffer with checkpoint
              tokenBuffer = [checkpointForContinuation];
              state.content = checkpointForContinuation;
              state.tokenCount = 1; // Count checkpoint as one token
              // Reset other state fields
              resetStateForRetry(state, {
                checkpoint: state.checkpoint,
                resumed: true,
                resumePoint: checkpointForContinuation,
                resumeFrom: checkpointForContinuation.length,
              });
              // Restore values that resetStateForRetry cleared
              state.content = checkpointForContinuation;
              state.tokenCount = 1;
            } else {
              tokenBuffer = [];
              resetStateForRetry(state);
            }
          }

          // Get stream from factory
          dispatcher.emit(EventType.STREAM_INIT, {});
          const streamResult = await currentStreamFactory();

          // Handle different stream result types
          let sourceStream: AsyncIterable<any>;
          let detectedAdapterName: string | undefined;

          dispatcher.emit(EventType.ADAPTER_WRAP_START, {
            streamType: typeof streamResult,
          });

          // 1. Explicit adapter (highest priority)
          if (processedOptions.adapter) {
            let adapter: L0Adapter | undefined;

            if (typeof processedOptions.adapter === "string") {
              // Lookup by name from adapter registry
              if (!_adapterRegistry) {
                throw new L0Error(
                  "String adapter names require enableAdapterRegistry() to be called first. " +
                    'Import and call: import { enableAdapterRegistry } from "@ai2070/l0"; enableAdapterRegistry();',
                  {
                    code: L0ErrorCodes.FEATURE_NOT_ENABLED,
                    context: processedContext,
                  },
                );
              }
              adapter = _adapterRegistry.getAdapter(processedOptions.adapter);
              if (!adapter) {
                throw new L0Error(
                  `Adapter "${processedOptions.adapter}" not found. ` +
                    `Use registerAdapter() to register it first.`,
                  {
                    code: L0ErrorCodes.ADAPTER_NOT_FOUND,
                    modelRetryCount: state.modelRetryCount,
                    networkRetryCount: state.networkRetryCount,
                    fallbackIndex,
                    context: processedContext,
                  },
                );
              }
            } else {
              // Direct adapter object
              adapter = processedOptions.adapter;
            }

            detectedAdapterName = adapter.name;
            sourceStream = adapter.wrap(
              streamResult,
              processedOptions.adapterOptions,
            );
          }
          // 2. Auto-detection via registered adapters (if registry enabled)
          // MUST come before textStream/fullStream fallback to allow adapters
          // to provide enhanced handling (e.g., tool calls via fullStream)
          else if (_adapterRegistry?.hasMatchingAdapter(streamResult)) {
            const adapter = _adapterRegistry.detectAdapter(streamResult);
            detectedAdapterName = adapter.name;
            sourceStream = adapter.wrap(
              streamResult,
              processedOptions.adapterOptions,
            );
          }
          // 3. Native L0-compatible streams (Vercel AI SDK pattern)
          // For streamObject results (detected by partialObjectStream + no teeStream),
          // we need to tee the baseStream before consuming to avoid "ReadableStream is locked" errors.
          // This allows L0 to consume the stream while AI SDK internals also work.
          // Note: streamText has teeStream method, streamObject does not.
          else if (
            streamResult.baseStream &&
            typeof streamResult.baseStream.tee === "function" &&
            "partialObjectStream" in streamResult &&
            !("teeStream" in streamResult)
          ) {
            // streamObject result - tee the baseStream to avoid locking issues
            const [stream1, stream2] = streamResult.baseStream.tee();
            streamResult.baseStream = stream2; // Keep one for AI SDK internals
            detectedAdapterName = "streamObject";
            // Create an async iterable from the teed stream
            sourceStream = {
              async *[Symbol.asyncIterator]() {
                const reader = stream1.getReader();
                try {
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    // Normalize streamObject chunks to L0 events
                    if (value && typeof value === "object") {
                      if (value.type === "text-delta" && value.textDelta) {
                        yield { type: "token", value: value.textDelta };
                      } else if (value.type === "error") {
                        yield { type: "error", error: value.error };
                      } else if (value.type === "finish") {
                        yield { type: "complete" };
                      }
                      // Note: 'object' chunks are for partial object updates,
                      // but L0 structured() handles JSON parsing from text tokens
                    }
                  }
                } finally {
                  reader.releaseLock();
                }
              },
            };
          } else if (streamResult.textStream) {
            detectedAdapterName = "textStream";
            sourceStream = streamResult.textStream;
          } else if (streamResult.fullStream) {
            detectedAdapterName = "fullStream";
            sourceStream = streamResult.fullStream;
          }
          // 4. Generic async iterable (already L0Events or compatible)
          else if (Symbol.asyncIterator in streamResult) {
            detectedAdapterName = "asyncIterable";
            sourceStream = streamResult;
          }
          // 5. No valid stream found
          else {
            throw new L0Error(
              "Invalid stream result - no iterable stream found and no adapter matched. " +
                "Use explicit `adapter: myAdapter` or register an adapter with detect().",
              {
                code: L0ErrorCodes.INVALID_STREAM,
                modelRetryCount: state.modelRetryCount,
                networkRetryCount: state.networkRetryCount,
                fallbackIndex,
                context: processedContext,
              },
            );
          }

          dispatcher.emit(EventType.ADAPTER_DETECTED, {
            adapterId: detectedAdapterName,
          });
          dispatcher.emit(EventType.ADAPTER_WRAP_END, {
            adapterId: detectedAdapterName,
          });
          dispatcher.emit(EventType.STREAM_READY, {});

          // Track timing
          const startTime = Date.now();
          state.firstTokenAt = undefined;
          state.lastTokenAt = undefined;

          let firstTokenReceived = false;
          stateMachine.transition(RuntimeStates.WAITING_FOR_TOKEN);

          // Track time of last token emission for inter-token timeout
          // This is set BEFORE reading each chunk, so the timeout check
          // measures time waiting for the next token, not time since processing
          let lastTokenEmissionTime = startTime;

          const defaultInitialTokenTimeout = 5000;

          // Initial token timeout
          const initialTimeout =
            processedTimeout.initialToken ?? defaultInitialTokenTimeout;
          let initialTimeoutId: NodeJS.Timeout | null = null;
          let initialTimeoutReached = false;

          if (!signal?.aborted) {
            dispatcher.emit(EventType.TIMEOUT_START, {
              timeoutType: "initial",
              configuredMs: initialTimeout,
            });
            initialTimeoutId = setTimeout(() => {
              initialTimeoutReached = true;
            }, initialTimeout);
          }

          // Stream processing
          for await (const chunk of sourceStream) {
            // Check abort signal
            if (signal?.aborted) {
              dispatcher.emit(EventType.ABORT_COMPLETED, {
                tokenCount: state.tokenCount,
                contentLength: state.content.length,
              });
              throw new L0Error("Stream aborted by signal", {
                code: L0ErrorCodes.STREAM_ABORTED,
                checkpoint: state.checkpoint,
                tokenCount: state.tokenCount,
                contentLength: state.content.length,
                modelRetryCount: state.modelRetryCount,
                networkRetryCount: state.networkRetryCount,
                fallbackIndex,
                context: processedContext,
              });
            }

            // Check inter-token timeout BEFORE processing this chunk
            // This measures how long we waited for this token
            if (firstTokenReceived) {
              const interTimeout = processedTimeout.interToken ?? 10000;
              const timeSinceLastToken = Date.now() - lastTokenEmissionTime;
              if (timeSinceLastToken > interTimeout) {
                metrics.timeouts++;
                dispatcher.emit(EventType.TIMEOUT_TRIGGERED, {
                  timeoutType: "inter",
                  elapsedMs: timeSinceLastToken,
                });
                throw new L0Error("Inter-token timeout reached", {
                  code: L0ErrorCodes.INTER_TOKEN_TIMEOUT,
                  checkpoint: state.checkpoint,
                  tokenCount: state.tokenCount,
                  contentLength: state.content.length,
                  modelRetryCount: state.modelRetryCount,
                  networkRetryCount: state.networkRetryCount,
                  fallbackIndex,
                  context: processedContext,
                  metadata: { timeout: interTimeout, timeSinceLastToken },
                });
              }
            }

            // Clear initial timeout on first chunk
            if (initialTimeoutId && !firstTokenReceived) {
              clearTimeout(initialTimeoutId);
              initialTimeoutId = null;
              initialTimeoutReached = false;
            }

            // Check initial timeout
            if (initialTimeoutReached && !firstTokenReceived) {
              metrics.timeouts++;
              const elapsedMs =
                processedTimeout.initialToken ?? defaultInitialTokenTimeout;
              dispatcher.emit(EventType.TIMEOUT_TRIGGERED, {
                timeoutType: "initial",
                elapsedMs,
              });
              throw new L0Error("Initial token timeout reached", {
                code: L0ErrorCodes.INITIAL_TOKEN_TIMEOUT,
                checkpoint: state.checkpoint,
                tokenCount: 0,
                contentLength: 0,
                modelRetryCount: state.modelRetryCount,
                networkRetryCount: state.networkRetryCount,
                fallbackIndex,
                context: processedContext,
                metadata: {
                  timeout:
                    processedTimeout.initialToken ?? defaultInitialTokenTimeout,
                },
              });
            }

            // Normalize event with safety wrapper
            let event: L0Event;
            try {
              event = normalizeStreamEvent(chunk);
            } catch (normalizeError) {
              // Malformed input from stream - log and skip this chunk
              const errMsg =
                normalizeError instanceof Error
                  ? normalizeError.message
                  : String(normalizeError);
              monitor?.logEvent({
                type: "warning",
                message: `Failed to normalize stream chunk: ${errMsg}`,
                chunk:
                  typeof chunk === "object" ? JSON.stringify(chunk) : chunk,
              });
              continue;
            }

            if (event.type === "token" && event.value) {
              let token = event.value;

              // Track first token
              if (!firstTokenReceived) {
                firstTokenReceived = true;
                state.firstTokenAt = Date.now();
                stateMachine.transition(RuntimeStates.STREAMING);
                // Switch from initial to inter-token timeout
                const interTimeout = processedTimeout.interToken ?? 10000;
                dispatcher.emit(EventType.TIMEOUT_RESET, {
                  timeoutType: "inter",
                  configuredMs: interTimeout,
                  tokenIndex: state.tokenCount,
                });
              }

              metrics.tokens++;

              // Handle deduplication for continuation
              // LLMs stream tokens one at a time, so we need to accumulate tokens
              // until we can detect where the overlap ends
              if (
                state.resumed &&
                shouldDeduplicateContinuation &&
                checkpointForContinuation.length > 0 &&
                !overlapResolved
              ) {
                // Transition to deduplicating state on first buffer
                if (overlapBuffer.length === 0) {
                  stateMachine.transition(RuntimeStates.CONTINUATION_MATCHING);
                }

                // Accumulate tokens in the deduplication buffer
                overlapBuffer += token;

                // Check if we've accumulated enough to detect overlap
                // We check after each token to find the overlap boundary
                const overlapResult = detectOverlap(
                  checkpointForContinuation,
                  overlapBuffer,
                  {
                    minOverlap: processedDeduplicationOptions.minOverlap ?? 2,
                    maxOverlap: processedDeduplicationOptions.maxOverlap ?? 500,
                    caseSensitive:
                      processedDeduplicationOptions.caseSensitive ?? true,
                    normalizeWhitespace:
                      processedDeduplicationOptions.normalizeWhitespace ??
                      false,
                  },
                );

                // Check if we should finalize deduplication:
                // 1. We found overlap and have content beyond it
                // 2. Buffer exceeds max possible overlap (no overlap found)
                // 3. Buffer has grown large enough that we're confident there's no more overlap
                const maxOverlapLen =
                  processedDeduplicationOptions.maxOverlap ?? 500;
                const shouldFinalize =
                  (overlapResult.hasOverlap &&
                    overlapResult.deduplicatedContinuation.length > 0) ||
                  overlapBuffer.length > maxOverlapLen;

                if (shouldFinalize) {
                  overlapResolved = true;
                  stateMachine.transition(RuntimeStates.STREAMING);

                  if (overlapResult.hasOverlap) {
                    // Emit only the non-overlapping portion
                    token = overlapResult.deduplicatedContinuation;
                    if (token.length === 0) {
                      // Entire buffer was overlap, wait for next token
                      continue;
                    }
                  } else {
                    // No overlap found, emit the entire buffer
                    token = overlapBuffer;
                  }
                } else {
                  // Still accumulating, don't emit yet
                  continue;
                }
              }

              // Update state - use buffer for O(n) accumulation
              const tokenNow = Date.now();
              tokenBuffer.push(token);
              state.tokenCount++;
              state.lastTokenAt = tokenNow;

              // Build content string only when needed (for guardrails/drift checks/checkpoints)
              // This is O(n) total instead of O(n²) from repeated concatenation
              const needsCheckpoint =
                processedContinueFromCheckpoint &&
                state.tokenCount % checkpointInterval === 0;
              const needsContent =
                (guardrailEngine &&
                  state.tokenCount % guardrailCheckInterval === 0) ||
                (driftDetector &&
                  state.tokenCount % driftCheckInterval === 0) ||
                needsCheckpoint;

              if (needsContent) {
                state.content = tokenBuffer.join("");
              }

              // Record token in monitoring
              monitor?.recordToken(state.lastTokenAt);

              // Update checkpoint periodically (only when continuation is enabled)
              if (needsCheckpoint) {
                state.checkpoint = state.content;
                dispatcher.emit(EventType.CHECKPOINT_SAVED, {
                  checkpoint: state.checkpoint,
                  tokenCount: state.tokenCount,
                });
              }

              // Run streaming guardrails
              if (
                guardrailEngine &&
                state.tokenCount % guardrailCheckInterval === 0
              ) {
                const context: GuardrailContext = {
                  content: state.content,
                  checkpoint: state.checkpoint,
                  delta: token,
                  tokenCount: state.tokenCount,
                  completed: false,
                };

                const result = guardrailEngine.check(context);
                if (result.violations.length > 0) {
                  state.violations.push(...result.violations);
                  monitor?.recordGuardrailViolations(result.violations);

                  // Emit GUARDRAIL_RULE_RESULT events for each violation
                  for (let i = 0; i < result.violations.length; i++) {
                    const violation = result.violations[i];
                    dispatcher.emit(EventType.GUARDRAIL_RULE_RESULT, {
                      index: i,
                      ruleId: violation!.rule,
                      passed: false,
                      violation,
                    });
                  }
                }

                // Check for fatal violations
                if (result.shouldHalt) {
                  throw new L0Error(
                    `Fatal guardrail violation: ${result.violations[0]?.message}`,
                    {
                      code: L0ErrorCodes.FATAL_GUARDRAIL_VIOLATION,
                      checkpoint: state.checkpoint,
                      tokenCount: state.tokenCount,
                      contentLength: state.content.length,
                      modelRetryCount: state.modelRetryCount,
                      networkRetryCount: state.networkRetryCount,
                      fallbackIndex,
                      context: processedContext,
                      metadata: { violation: result.violations[0] },
                    },
                  );
                }
              }

              // Check drift
              if (
                driftDetector &&
                state.tokenCount % driftCheckInterval === 0
              ) {
                const drift = driftDetector.check(state.content, token);
                if (drift.detected) {
                  state.driftDetected = true;
                  monitor?.recordDrift(true, drift.types);
                  dispatcher.emit(EventType.DRIFT_CHECK_RESULT, {
                    detected: true,
                    types: drift.types,
                    confidence: drift.confidence,
                  });
                }
              }

              // Emit event
              const l0Event: L0Event = {
                type: "token",
                value: token,
                timestamp: tokenNow,
              };

              safeInvokeCallback(processedOnEvent, l0Event, monitor, "onEvent");
              yield l0Event;

              // Update emission time AFTER yielding for accurate inter-token timeout measurement
              lastTokenEmissionTime = Date.now();
            } else if (event.type === "message") {
              // Pass through message events (e.g., tool calls, function calls)
              // Preserve all original event properties including role
              const messageEvent: L0Event = {
                type: "message",
                value: event.value,
                role: event.role,
                timestamp: Date.now(),
              };

              // Detect tool calls/results and emit observability events
              if (event.value) {
                try {
                  const parsed = JSON.parse(event.value);

                  // Helper to emit tool call events
                  const emitToolCall = (
                    toolCallId: string,
                    toolName: string,
                    args: Record<string, unknown>,
                  ) => {
                    stateMachine.transition(RuntimeStates.TOOL_CALL_DETECTED);
                    state.toolCallStartTimes =
                      state.toolCallStartTimes || new Map();
                    state.toolCallStartTimes.set(toolCallId, Date.now());
                    state.toolCallNames = state.toolCallNames || new Map();
                    state.toolCallNames.set(toolCallId, toolName);

                    dispatcher.emit(EventType.TOOL_REQUESTED, {
                      toolName,
                      toolCallId,
                      arguments: args,
                    });
                    dispatcher.emit(EventType.TOOL_START, {
                      toolCallId,
                      toolName,
                    });
                  };

                  // Helper to parse arguments (may be string or object)
                  const parseArgs = (
                    args: unknown,
                  ): Record<string, unknown> => {
                    if (typeof args === "string") {
                      try {
                        return JSON.parse(args);
                      } catch {
                        return {};
                      }
                    }
                    return (args as Record<string, unknown>) || {};
                  };

                  // Helper to emit tool result events
                  const emitToolResult = (
                    toolCallId: string,
                    result: unknown,
                    error?: string,
                  ) => {
                    const startTime = state.toolCallStartTimes?.get(toolCallId);
                    const durationMs = startTime ? Date.now() - startTime : 0;

                    if (error) {
                      dispatcher.emit(EventType.TOOL_ERROR, {
                        toolCallId,
                        error,
                        errorType: "EXECUTION_ERROR",
                        durationMs,
                      });
                      dispatcher.emit(EventType.TOOL_COMPLETED, {
                        toolCallId,
                        status: "error",
                      });
                    } else {
                      dispatcher.emit(EventType.TOOL_RESULT, {
                        toolCallId,
                        result,
                        durationMs,
                      });
                      dispatcher.emit(EventType.TOOL_COMPLETED, {
                        toolCallId,
                        status: "success",
                      });
                    }

                    // Clean up tracking
                    state.toolCallStartTimes?.delete(toolCallId);
                    state.toolCallNames?.delete(toolCallId);

                    // Transition back to streaming if no more pending tool calls
                    if (!state.toolCallStartTimes?.size) {
                      stateMachine.transition(RuntimeStates.STREAMING);
                    }
                  };

                  // === TOOL CALL FORMATS ===

                  // L0 standard flat format (recommended for custom adapters)
                  // { type: "tool_call", id, name, arguments }
                  if (parsed.type === "tool_call" && parsed.id && parsed.name) {
                    emitToolCall(
                      parsed.id,
                      parsed.name,
                      parseArgs(parsed.arguments),
                    );
                  }
                  // OpenAI format: { type: "tool_calls", tool_calls: [...] }
                  else if (
                    parsed.type === "tool_calls" &&
                    Array.isArray(parsed.tool_calls)
                  ) {
                    for (const tc of parsed.tool_calls) {
                      emitToolCall(tc.id, tc.name, parseArgs(tc.arguments));
                    }
                  }
                  // Legacy OpenAI function_call format
                  else if (
                    parsed.type === "function_call" &&
                    parsed.function_call
                  ) {
                    emitToolCall(
                      `fn_${Date.now()}`,
                      parsed.function_call.name,
                      parseArgs(parsed.function_call.arguments),
                    );
                  }
                  // Anthropic tool_use format
                  else if (parsed.type === "tool_use" && parsed.tool_use) {
                    emitToolCall(
                      parsed.tool_use.id,
                      parsed.tool_use.name,
                      parseArgs(parsed.tool_use.input),
                    );
                  }
                  // Nested tool_call format (Mastra/legacy)
                  else if (parsed.type === "tool_call" && parsed.tool_call) {
                    emitToolCall(
                      parsed.tool_call.id,
                      parsed.tool_call.name,
                      parseArgs(parsed.tool_call.arguments),
                    );
                  }

                  // === TOOL RESULT FORMATS ===

                  // L0 standard flat format (recommended for custom adapters)
                  // { type: "tool_result", id, result, error? }
                  else if (parsed.type === "tool_result" && parsed.id) {
                    emitToolResult(parsed.id, parsed.result, parsed.error);
                  }
                  // Nested tool_result format (Mastra/legacy)
                  else if (
                    parsed.type === "tool_result" &&
                    parsed.tool_result
                  ) {
                    emitToolResult(
                      parsed.tool_result.id,
                      parsed.tool_result.result,
                      parsed.tool_result.error,
                    );
                  }
                } catch {
                  // Not JSON or parsing failed - that's fine, not all messages are tool calls
                }
              }

              safeInvokeCallback(
                processedOnEvent,
                messageEvent,
                monitor,
                "onEvent",
              );
              yield messageEvent;
            } else if (event.type === "data") {
              // Handle multimodal data events (images, audio, etc.)
              if (event.data) {
                state.dataOutputs.push(event.data);
              }
              const dataEvent: L0Event = {
                type: "data",
                data: event.data,
                timestamp: Date.now(),
              };
              safeInvokeCallback(
                processedOnEvent,
                dataEvent,
                monitor,
                "onEvent",
              );
              yield dataEvent;
            } else if (event.type === "progress") {
              // Handle progress events for long-running operations
              state.lastProgress = event.progress;
              const progressEvent: L0Event = {
                type: "progress",
                progress: event.progress,
                timestamp: Date.now(),
              };
              safeInvokeCallback(
                processedOnEvent,
                progressEvent,
                monitor,
                "onEvent",
              );
              yield progressEvent;
            } else if (event.type === "error") {
              throw event.error || new Error("Stream error");
            } else if (event.type === "complete") {
              break;
            }
          }

          // Clear any remaining timeout
          if (initialTimeoutId) {
            clearTimeout(initialTimeoutId);
          }

          // Flush any remaining deduplication buffer content
          // This handles the case where the stream ends before we could finalize deduplication
          if (
            state.resumed &&
            shouldDeduplicateContinuation &&
            !overlapResolved &&
            overlapBuffer.length > 0
          ) {
            // Stream ended, finalize deduplication with whatever we have
            const overlapResult = detectOverlap(
              checkpointForContinuation,
              overlapBuffer,
              {
                minOverlap: processedDeduplicationOptions.minOverlap ?? 2,
                maxOverlap: processedDeduplicationOptions.maxOverlap ?? 500,
                caseSensitive:
                  processedDeduplicationOptions.caseSensitive ?? true,
                normalizeWhitespace:
                  processedDeduplicationOptions.normalizeWhitespace ?? false,
              },
            );

            let flushedToken: string;
            if (overlapResult.hasOverlap) {
              // Add only the non-overlapping portion
              flushedToken = overlapResult.deduplicatedContinuation;
            } else {
              // No overlap found, add the entire buffer
              flushedToken = overlapBuffer;
            }

            // Only emit and add to buffer if there's content
            if (flushedToken.length > 0) {
              tokenBuffer.push(flushedToken);
              state.tokenCount++;

              // Update content for guardrail/drift checks
              state.content = tokenBuffer.join("");

              // Run guardrails on the flushed content
              if (guardrailEngine) {
                const context: GuardrailContext = {
                  content: state.content,
                  checkpoint: state.checkpoint,
                  delta: flushedToken,
                  tokenCount: state.tokenCount,
                  completed: false,
                };

                const result = guardrailEngine.check(context);
                if (result.violations.length > 0) {
                  state.violations.push(...result.violations);
                  monitor?.recordGuardrailViolations(result.violations);

                  // Emit GUARDRAIL_RULE_RESULT events for each violation
                  for (let i = 0; i < result.violations.length; i++) {
                    const violation = result.violations[i];
                    dispatcher.emit(EventType.GUARDRAIL_RULE_RESULT, {
                      index: i,
                      ruleId: violation!.rule,
                      passed: false,
                      violation,
                    });
                  }
                }

                // Check for fatal violations
                if (result.shouldHalt) {
                  throw new L0Error(
                    `Fatal guardrail violation: ${result.violations[0]?.message}`,
                    {
                      code: L0ErrorCodes.FATAL_GUARDRAIL_VIOLATION,
                      checkpoint: state.checkpoint,
                      tokenCount: state.tokenCount,
                      contentLength: state.content.length,
                      modelRetryCount: state.modelRetryCount,
                      networkRetryCount: state.networkRetryCount,
                      fallbackIndex,
                      context: processedContext,
                      metadata: { violation: result.violations[0] },
                    },
                  );
                }
              }

              // Run drift detection on flushed content
              if (driftDetector) {
                const drift = driftDetector.check(state.content, flushedToken);
                if (drift.detected) {
                  state.driftDetected = true;
                  monitor?.recordDrift(true, drift.types);
                  dispatcher.emit(EventType.DRIFT_CHECK_RESULT, {
                    detected: true,
                    types: drift.types,
                    confidence: drift.confidence,
                  });
                }
              }

              // Emit the flushed token to the stream
              const flushedEvent: L0Event = {
                type: "token",
                value: flushedToken,
                timestamp: Date.now(),
              };
              safeInvokeCallback(
                processedOnEvent,
                flushedEvent,
                monitor,
                "onEvent",
              );
              yield flushedEvent;
            }

            overlapResolved = true;
          }

          // Finalize content from buffer
          state.content = tokenBuffer.join("");

          // Check for zero output
          if (processedDetectZeroTokens && detectZeroToken(state.content)) {
            throw new L0Error("Zero output detected - no meaningful content", {
              code: L0ErrorCodes.ZERO_OUTPUT,
              checkpoint: state.checkpoint,
              tokenCount: state.tokenCount,
              contentLength: state.content.length,
              modelRetryCount: state.modelRetryCount,
              networkRetryCount: state.networkRetryCount,
              fallbackIndex,
              context: processedContext,
            });
          }

          // Run final guardrails
          if (guardrailEngine) {
            const context: GuardrailContext = {
              content: state.content,
              checkpoint: state.checkpoint,
              tokenCount: state.tokenCount,
              completed: true,
            };

            const result = guardrailEngine.check(context);
            if (result.violations.length > 0) {
              state.violations.push(...result.violations);
              monitor?.recordGuardrailViolations(result.violations);

              // Emit GUARDRAIL_RULE_RESULT events for each violation
              for (let i = 0; i < result.violations.length; i++) {
                const violation = result.violations[i];
                dispatcher.emit(EventType.GUARDRAIL_RULE_RESULT, {
                  index: i,
                  ruleId: violation!.rule,
                  passed: false,
                  violation,
                });
              }
            }

            // Check if should retry
            if (result.shouldRetry && retryAttempt < modelRetryLimit) {
              const violation = result.violations[0];
              const reason = `Guardrail violation: ${violation?.message}`;
              dispatcher.emit(EventType.RETRY_ATTEMPT, {
                attempt: retryAttempt + 1,
                maxAttempts: modelRetryLimit,
                reason,
                delayMs: 0,
                countsTowardLimit: true,
                isNetwork: false,
                isModelIssue: true,
              });
              retryAttempt++;
              state.modelRetryCount++;
              // Emit ATTEMPT_START for onStart callback (retry attempt)
              dispatcher.emit(EventType.ATTEMPT_START, {
                attempt: retryAttempt + 1,
                isRetry: true,
                isFallback: fallbackIndex > 0,
              });
              continue;
            }

            // Fatal violations
            if (result.shouldHalt) {
              throw new L0Error(
                `Fatal guardrail violation: ${result.violations[0]?.message}`,
                {
                  code: L0ErrorCodes.FATAL_GUARDRAIL_VIOLATION,
                  checkpoint: state.checkpoint,
                  tokenCount: state.tokenCount,
                  contentLength: state.content.length,
                  modelRetryCount: state.modelRetryCount,
                  networkRetryCount: state.networkRetryCount,
                  fallbackIndex,
                  context: processedContext,
                  metadata: { violation: result.violations[0] },
                },
              );
            }
          }

          // Check drift
          if (driftDetector) {
            const finalDrift = driftDetector.check(state.content);
            if (finalDrift.detected && retryAttempt < modelRetryLimit) {
              state.driftDetected = true;
              monitor?.recordDrift(true, finalDrift.types);
              dispatcher.emit(EventType.DRIFT_CHECK_RESULT, {
                detected: true,
                types: finalDrift.types,
                confidence: finalDrift.confidence,
              });
              dispatcher.emit(EventType.RETRY_ATTEMPT, {
                attempt: retryAttempt + 1,
                maxAttempts: modelRetryLimit,
                reason: "Drift detected",
                delayMs: 0,
                countsTowardLimit: true,
                isNetwork: false,
                isModelIssue: true,
              });
              monitor?.recordRetry(false);
              retryAttempt++;
              state.modelRetryCount++;
              // Emit ATTEMPT_START for onStart callback (retry attempt)
              dispatcher.emit(EventType.ATTEMPT_START, {
                attempt: retryAttempt + 1,
                isRetry: true,
                isFallback: fallbackIndex > 0,
              });
              continue;
            }
          }

          // Success - mark as completed
          stateMachine.transition(RuntimeStates.FINALIZING);
          state.completed = true;
          monitor?.complete();
          metrics.completions++;

          // Calculate duration
          if (state.firstTokenAt) {
            state.duration = Date.now() - state.firstTokenAt;
          }

          // Emit complete event
          const completeEvent: L0Event = {
            type: "complete",
            timestamp: Date.now(),
          };
          safeInvokeCallback(
            processedOnEvent,
            completeEvent,
            monitor,
            "onEvent",
          );
          yield completeEvent;

          stateMachine.transition(RuntimeStates.COMPLETE);

          // Emit COMPLETE event (includes full state for onComplete callback)
          dispatcher.emit(EventType.COMPLETE, {
            tokenCount: state.tokenCount,
            contentLength: state.content.length,
            durationMs: state.duration ?? 0,
            state,
          });

          // Emit RETRY_END if we had retries and succeeded
          if (retryAttempt > 0 || state.networkRetryCount > 0) {
            dispatcher.emit(EventType.RETRY_END, {
              attempt: retryAttempt + state.networkRetryCount,
              success: true,
            });
          }

          // Emit FALLBACK_END if we used a fallback
          if (fallbackIndex > 0) {
            dispatcher.emit(EventType.FALLBACK_END, {
              index: fallbackIndex,
              success: true,
            });
          }

          break; // Exit retry loop on success
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          errors.push(err);

          // Run final guardrails on partial stream content before retry/fallback
          // This validates the accumulated content and updates checkpoint if valid
          if (guardrailEngine && state.tokenCount > 0) {
            // Ensure content is up to date
            if (tokenBuffer.length > 0) {
              state.content = tokenBuffer.join("");
            }

            const partialContext: GuardrailContext = {
              content: state.content,
              checkpoint: state.checkpoint,
              delta: "",
              tokenCount: state.tokenCount,
              completed: false, // Stream didn't complete normally
            };

            const partialResult = guardrailEngine.check(partialContext);
            if (partialResult.violations.length > 0) {
              state.violations.push(...partialResult.violations);
              monitor?.recordGuardrailViolations(partialResult.violations);

              // Notify about violations via GUARDRAIL_RULE_RESULT events
              for (let i = 0; i < partialResult.violations.length; i++) {
                const violation = partialResult.violations[i];
                dispatcher.emit(EventType.GUARDRAIL_RULE_RESULT, {
                  index: i,
                  ruleId: violation!.rule,
                  passed: false,
                  violation,
                });
              }

              // If fatal violation in partial content, clear checkpoint to prevent
              // corrupted content from being used in continuation
              const hasFatal = partialResult.violations.some(
                (v) => v.severity === "fatal",
              );
              if (hasFatal) {
                state.checkpoint = "";
              }
            }

            // If no fatal violations and we have content, update checkpoint
            // so continuation can use the validated partial content
            // (only when continuation is enabled)
            if (
              processedContinueFromCheckpoint &&
              !partialResult.violations.some((v) => v.severity === "fatal") &&
              state.content.length > 0
            ) {
              state.checkpoint = state.content;
              dispatcher.emit(EventType.CHECKPOINT_SAVED, {
                checkpoint: state.checkpoint,
                tokenCount: state.tokenCount,
              });
            }
          }

          // Run drift detection on partial content
          if (driftDetector && state.tokenCount > 0) {
            if (tokenBuffer.length > 0) {
              state.content = tokenBuffer.join("");
            }
            const partialDrift = driftDetector.check(state.content);
            if (partialDrift.detected) {
              state.driftDetected = true;
              monitor?.recordDrift(true, partialDrift.types);
              dispatcher.emit(EventType.DRIFT_CHECK_RESULT, {
                detected: true,
                types: partialDrift.types,
                confidence: partialDrift.confidence,
              });
              dispatcher.emit(EventType.GUARDRAIL_RULE_RESULT, {
                index: 0,
                ruleId: "drift",
                passed: false,
                violation: {
                  rule: "drift",
                  severity: "warning",
                  message: `Drift detected in partial stream: ${partialDrift.types.join(", ")}`,
                },
              });
            }
          }

          // Categorize error
          const categorized = retryManager.categorizeError(err);
          let decision = retryManager.shouldRetry(err);

          // Check async shouldRetry callback if provided (can only veto/narrow, never widen)
          // Fatal errors always override - never retry fatal errors regardless of user fn
          if (
            processedRetry.shouldRetry &&
            categorized.category !== ErrorCategory.FATAL
          ) {
            const defaultShouldRetry = decision.shouldRetry;

            // Emit RETRY_FN_START event
            dispatcher.emit(EventType.RETRY_FN_START, {
              attempt: retryAttempt,
              category: categorized.category,
              defaultShouldRetry,
            });

            const fnStartTime = Date.now();
            try {
              const userResult = await processedRetry.shouldRetry(
                err,
                state,
                retryAttempt,
                categorized.category,
              );

              const durationMs = Date.now() - fnStartTime;
              // Final decision: defaultDecision AND userResult
              // userFn can only veto (narrow), not force (widen)
              const finalShouldRetry = defaultShouldRetry && userResult;

              // Emit RETRY_FN_RESULT event
              dispatcher.emit(EventType.RETRY_FN_RESULT, {
                attempt: retryAttempt,
                category: categorized.category,
                userResult,
                finalShouldRetry,
                durationMs,
              });

              decision = { ...decision, shouldRetry: finalShouldRetry };
            } catch (fnError) {
              const durationMs = Date.now() - fnStartTime;
              const fnErrMsg =
                fnError instanceof Error ? fnError.message : String(fnError);

              // Emit RETRY_FN_ERROR event
              // Exception treated as veto (false)
              dispatcher.emit(EventType.RETRY_FN_ERROR, {
                attempt: retryAttempt,
                category: categorized.category,
                error: fnErrMsg,
                finalShouldRetry: false,
                durationMs,
              });

              // Exception in shouldRetry is treated as veto
              decision = { ...decision, shouldRetry: false };
            }
          }

          // Check custom calculateDelay function if provided
          if (processedRetry.calculateDelay && decision.shouldRetry) {
            const customDelay = processedRetry.calculateDelay({
              attempt: retryAttempt,
              totalAttempts: retryAttempt + state.networkRetryCount,
              category: categorized.category,
              reason: categorized.reason,
              error: err,
              defaultDelay: decision.delay,
            });
            // If custom function returns a number, override default delay
            if (typeof customDelay === "number") {
              decision = { ...decision, delay: customDelay };
            }
          }

          // Record network error in monitoring and emit NETWORK_ERROR event
          const isNetError = isNetworkError(err);
          if (isNetError) {
            const networkAnalysis = analyzeNetworkError(err);
            dispatcher.emit(EventType.NETWORK_ERROR, {
              error: err.message,
              code: networkAnalysis.type,
              retryable: networkAnalysis.retryable,
            });
            monitor?.recordNetworkError(
              err,
              decision.shouldRetry,
              decision.delay,
            );
          }

          // Emit ERROR event before retry/fallback decision is acted upon
          const willRetry = decision.shouldRetry;
          const willFallback =
            !decision.shouldRetry && fallbackIndex < allStreams.length - 1;

          // Build recovery policy
          const policy: RecoveryPolicy = {
            retryEnabled: modelRetryLimit > 0,
            fallbackEnabled: allStreams.length > 1,
            maxRetries: modelRetryLimit,
            maxFallbacks: allStreams.length - 1,
            attempt: retryAttempt + 1, // 1-based
            fallbackIndex,
          };

          dispatcher.emit(EventType.ERROR, {
            error: err.message,
            errorCode: (err as any).code,
            failureType: getFailureType(err, signal),
            recoveryStrategy: getRecoveryStrategy(willRetry, willFallback),
            policy,
          });

          // Note: onError callback is handled by registerCallbackWrappers via ERROR event

          // Check if should retry (but not if aborted)
          if (decision.shouldRetry && !signal?.aborted) {
            dispatcher.emit(EventType.RETRY_START, {
              attempt: retryAttempt + 1,
              maxAttempts: modelRetryLimit,
              reason: decision.reason,
            });

            if (decision.countsTowardLimit) {
              retryAttempt++;
              state.modelRetryCount++;
            } else {
              state.networkRetryCount++;
            }
            // Mark that next iteration is a retry (for state reset)
            isRetryAttempt = true;
            stateMachine.transition(RuntimeStates.RETRYING);
            metrics.retries++;
            if (isNetError) {
              metrics.networkRetryCount++;
            }

            // Record in monitoring
            monitor?.recordRetry(isNetError);

            // Emit RETRY_ATTEMPT event
            dispatcher.emit(EventType.RETRY_ATTEMPT, {
              attempt: retryAttempt,
              maxAttempts: modelRetryLimit,
              reason: decision.reason,
              delayMs: decision.delay ?? 0,
              countsTowardLimit: decision.countsTowardLimit,
              isNetwork: isNetError,
              isModelIssue: !isNetError,
            });

            // Emit ATTEMPT_START for onStart callback (retry attempt)
            dispatcher.emit(EventType.ATTEMPT_START, {
              attempt: retryAttempt + 1,
              isRetry: true,
              isFallback: fallbackIndex > 0,
            });

            // Record retry and wait (delay)
            await retryManager.recordRetry(categorized, decision);
            // Note: RETRY_END is NOT emitted here because the retry hasn't completed yet.
            // Success/failure will be determined after the retry attempt runs.
            continue;
          }

          // Not retryable - emit RETRY_GIVE_UP if we had retries
          if (retryAttempt > 0) {
            dispatcher.emit(EventType.RETRY_GIVE_UP, {
              attempt: retryAttempt,
              maxAttempts: modelRetryLimit,
              reason: decision.reason,
              lastError: err.message,
            });
          }

          // Not retryable - check if we have fallbacks available
          if (fallbackIndex < allStreams.length - 1) {
            // Break out of retry loop to try fallback
            break;
          }

          // No fallbacks available - emit error and throw
          const errorCategory =
            err instanceof L0Error ? err.category : ErrorCategory.INTERNAL;
          const errorEvent: L0Event = {
            type: "error",
            error: err,
            reason: errorCategory,
            timestamp: Date.now(),
          };
          safeInvokeCallback(processedOnEvent, errorEvent, monitor, "onEvent");
          yield errorEvent;

          // Execute error interceptors
          await interceptorManager?.executeError(err, processedOptions);

          stateMachine.transition(RuntimeStates.ERROR);
          metrics.errors++;
          throw err;
        }
      }

      // If we exhausted retries for this stream (or error not retryable), try fallback
      if (!state.completed) {
        if (fallbackIndex < allStreams.length - 1) {
          // Move to next fallback
          fallbackIndex++;
          stateMachine.transition(RuntimeStates.FALLBACK);
          metrics.fallbacks++;
          const fallbackMessage = `Retries exhausted for stream ${fallbackIndex}, falling back to stream ${fallbackIndex + 1}`;

          monitor?.logEvent({
            type: "fallback",
            message: fallbackMessage,
            fromIndex: fallbackIndex - 1,
            toIndex: fallbackIndex,
          });

          // Emit FALLBACK_START event
          // Note: onStart callback is triggered by FALLBACK_START via callback-wrappers
          dispatcher.emit(EventType.FALLBACK_START, {
            fromIndex: fallbackIndex - 1,
            toIndex: fallbackIndex,
            reason: fallbackMessage,
          });
          dispatcher.emit(EventType.FALLBACK_MODEL_SELECTED, {
            index: fallbackIndex,
          });

          // Reset state for fallback attempt (but preserve checkpoint if continuation enabled)
          if (processedContinueFromCheckpoint && state.checkpoint.length > 0) {
            checkpointForContinuation = state.checkpoint;
            stateMachine.transition(RuntimeStates.CHECKPOINT_VERIFYING);

            // Validate checkpoint content before continuation
            const validation = validateCheckpointForContinuation(
              checkpointForContinuation,
              guardrailEngine,
              driftDetector,
            );

            // Record any violations found
            if (validation.violations.length > 0) {
              state.violations.push(...validation.violations);
              monitor?.recordGuardrailViolations(validation.violations);
            }

            // Record drift if detected
            if (validation.driftDetected) {
              state.driftDetected = true;
              monitor?.recordDrift(true, validation.driftTypes);
              dispatcher.emit(EventType.GUARDRAIL_RULE_RESULT, {
                index: 0,
                ruleId: "drift",
                passed: false,
                violation: {
                  rule: "drift",
                  severity: "warning",
                  message: `Drift detected in checkpoint: ${validation.driftTypes.join(", ")}`,
                },
              });
            }

            if (!validation.skipContinuation) {
              state.resumed = true;
              state.resumePoint = checkpointForContinuation;
              state.resumeFrom = checkpointForContinuation.length;

              // Reset overlap matching state for the new continuation
              overlapBuffer = "";
              overlapResolved = false;

              // Emit CONTINUATION_START event
              dispatcher.emit(EventType.CONTINUATION_START, {
                checkpoint: checkpointForContinuation,
                tokenCount: state.tokenCount,
              });

              // Emit RESUME_START event (callback wrappers handle legacy onResume)
              dispatcher.emit(EventType.RESUME_START, {
                checkpoint: checkpointForContinuation,
                tokenCount: state.tokenCount,
              });

              // Call buildContinuationPrompt if provided (allows user to update prompt for fallback)
              if (processedBuildContinuationPrompt) {
                processedBuildContinuationPrompt(checkpointForContinuation);
              }

              // Record continuation in monitoring
              monitor?.recordContinuation(
                true,
                true,
                checkpointForContinuation,
              );

              // Emit the checkpoint content as tokens first
              const checkpointEvent: L0Event = {
                type: "token",
                value: checkpointForContinuation,
                timestamp: Date.now(),
              };
              safeInvokeCallback(
                processedOnEvent,
                checkpointEvent,
                monitor,
                "onEvent",
              );
              yield checkpointEvent;

              // Initialize with checkpoint
              tokenBuffer = [checkpointForContinuation];
              resetStateForRetry(state, {
                checkpoint: state.checkpoint,
                resumed: true,
                resumePoint: checkpointForContinuation,
                resumeFrom: checkpointForContinuation.length,
                fallbackIndex,
              });
              state.content = checkpointForContinuation;
              state.tokenCount = 1;
            } else {
              // Fatal violation in checkpoint, start fresh
              tokenBuffer = [];
              resetStateForRetry(state, { fallbackIndex });
            }
          } else {
            tokenBuffer = [];
            resetStateForRetry(state, { fallbackIndex });
          }

          // Continue to next fallback
          continue;
        } else {
          // All streams exhausted
          const exhaustedError = new Error(
            `All streams exhausted (primary + ${processedFallbackStreams.length} fallbacks)`,
          );
          errors.push(exhaustedError);

          const errorEvent: L0Event = {
            type: "error",
            error: exhaustedError,
            reason: ErrorCategory.INTERNAL,
            timestamp: Date.now(),
          };
          safeInvokeCallback(processedOnEvent, errorEvent, monitor, "onEvent");
          yield errorEvent;

          // Execute error interceptors
          await interceptorManager?.executeError(
            exhaustedError,
            processedOptions,
          );

          stateMachine.transition(RuntimeStates.ERROR);
          metrics.errors++;
          throw exhaustedError;
        }
      }

      // Success - break out of fallback loop
      break;
    }
  };

  // Create abort function that emits events
  const abort = () => {
    dispatcher.emit(EventType.ABORT_REQUESTED, { source: "user" });
    abortController.abort();
  };

  // Create initial result
  let result: L0Result<TOutput> = {
    stream: streamGenerator(),
    state,
    errors,
    telemetry: monitor?.export(),
    abort,
  };

  // Execute "after" interceptors
  if (interceptorManager) {
    try {
      result = (await interceptorManager.executeAfter(
        result,
      )) as L0Result<TOutput>;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await interceptorManager.executeError(err, processedOptions);
      throw err;
    }
  }

  // Return processed result
  return result;
}
