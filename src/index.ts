// L0 - The Missing Reliability Layer for AI
// Main entry point
//
// This is the "full" entry point that re-exports everything.
// For reduced bundle size, use subpath imports:
//   - "reliable-ai-streams/core" - Minimal runtime (~15KB)
//   - "reliable-ai-streams/guardrails" - Guardrail rules and engine
//   - "reliable-ai-streams/drift" - Drift detection
//   - "reliable-ai-streams/monitoring" - OTel, Sentry
//   - "reliable-ai-streams/openai" - OpenAI adapter
//   - "reliable-ai-streams/anthropic" - Anthropic adapter
//   - "reliable-ai-streams/mastra" - Mastra adapter
//
// Optional features must be explicitly enabled:
//   import { enableDriftDetection } from "reliable-ai-streams";
//   import { DriftDetector } from "reliable-ai-streams/drift";
//   enableDriftDetection(() => new DriftDetector());

// Core runtime
export {
  l0,
  getText,
  consumeStream,
  StateMachine,
  RuntimeStates,
  Metrics,
  // Feature enablers - call these to opt-in to optional features
  enableDriftDetection,
  enableMonitoring,
  enableInterceptors,
  enableAdapterRegistry,
} from "./runtime/l0";
export type { RuntimeState } from "./runtime/state-machine";
export type { MetricsSnapshot } from "./runtime/metrics";

// Pipeline (simple array of functions)
export { runStages, createPipelineContext } from "./runtime/pipeline";
export type { Stage, PipelineContext } from "./runtime/pipeline";

// Async checks (non-blocking guardrails/drift)
export {
  runAsyncGuardrailCheck,
  runGuardrailCheckAsync,
} from "./guardrails/async";
export type { GuardrailCheckResult } from "./guardrails/async";
export { runAsyncDriftCheck, runDriftCheckAsync } from "./runtime/async-drift";
export type { DriftCheckResult } from "./runtime/async-drift";

// Structured output
export {
  structured,
  structuredObject,
  structuredArray,
  structuredStream,
} from "./structured";

export type {
  StructuredOptions,
  StructuredResult,
  StructuredState,
  StructuredTelemetry,
  CorrectionInfo,
  CorrectionType,
  AutoCorrectOptions,
  AutoCorrectResult,
} from "./types/structured";

export {
  minimalStructured,
  recommendedStructured,
  strictStructured,
} from "./types/structured";

// Auto-correction utilities
export {
  autoCorrectJSON,
  extractJSON,
  isValidJSON,
  describeJSONError,
  repairJSON,
  safeJSONParse,
} from "./utils/autoCorrect";

// Document Windows
export {
  createWindow,
  processWithWindow,
  l0WithWindow,
  mergeResults,
  getProcessingStats,
  DocumentWindowImpl,
} from "./window";

export type {
  WindowOptions,
  DocumentWindow,
  DocumentChunk,
  WindowStats,
  WindowProcessResult,
  L0WindowOptions,
  ChunkStrategy,
  ContextRestorationOptions,
  ContextRestorationStrategy,
  WindowPreset,
} from "./types/window";

export {
  smallWindow,
  mediumWindow,
  largeWindow,
  paragraphWindow,
  sentenceWindow,
} from "./types/window";

// Chunking utilities
export {
  chunkDocument,
  chunkByTokens,
  chunkByChars,
  chunkByParagraphs,
  chunkBySentences,
  splitIntoSentences,
  estimateTokenCount,
  getChunkOverlap,
  mergeChunks,
} from "./utils/chunking";

// Types
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
  // Multimodal types
  L0ContentType,
  L0DataPayload,
  L0Progress,
} from "./types";

// Observability Event System
export {
  EventDispatcher,
  createEventDispatcher,
} from "./runtime/event-dispatcher";

export {
  EventType,
  EventCategory,
  EventTypesByCategory,
  // Event category consts
  SessionEvents,
  StreamEvents,
  AdapterEvents,
  TimeoutEvents,
  NetworkEvents,
  AbortEvents,
  GuardrailEvents,
  DriftEvents,
  CheckpointEvents,
  ResumeEvents,
  RetryEvents,
  FallbackEvents,
  StructuredEvents,
  ContinuationEvents,
  ToolEvents,
  CompletionEvents,
  // Serialization
  serializeEvent,
  deserializeEvent,
} from "./types/observability";

export type {
  // Failure & Recovery types
  FailureType,
  RecoveryStrategy,
  RecoveryPolicy,
  // Base event types
  L0ObservabilityEvent,
  L0EventHandler,
  L0Event as L0ObservabilityEventUnion,
  // Session events
  SessionStartEvent,
  SessionEndEvent,
  SessionSummaryEvent,
  // Stream events
  StreamInitEvent,
  StreamReadyEvent,
  // Adapter events
  AdapterDetectedEvent,
  AdapterWrapStartEvent,
  AdapterWrapEndEvent,
  // Timeout events
  TimeoutStartEvent,
  TimeoutResetEvent,
  TimeoutTriggeredEvent,
  // Network events
  NetworkErrorEvent,
  NetworkRecoveryEvent,
  ConnectionDroppedEvent,
  ConnectionRestoredEvent,
  // Abort events
  AbortRequestedEvent,
  AbortCompletedEvent,
  // Guardrail events
  GuardrailPhaseStartEvent,
  GuardrailRuleStartEvent,
  GuardrailRuleResultEvent,
  GuardrailRuleEndEvent,
  GuardrailPhaseEndEvent,
  GuardrailCallbackStartEvent,
  GuardrailCallbackEndEvent,
  // Drift events
  DriftCheckStartEvent,
  DriftCheckResultEvent,
  DriftCheckEndEvent,
  DriftCheckSkippedEvent,
  // Checkpoint events
  CheckpointSavedEvent,
  // Resume events
  ResumeStartEvent,
  // Retry events
  RetryStartEvent,
  RetryAttemptEvent,
  RetryEndEvent,
  RetryGiveUpEvent,
  // Fallback events
  FallbackStartEvent,
  FallbackModelSelectedEvent,
  FallbackEndEvent,
  // Structured events
  StructuredParseStartEvent,
  StructuredParseEndEvent,
  StructuredParseErrorEvent,
  StructuredValidationStartEvent,
  StructuredValidationEndEvent,
  StructuredValidationErrorEvent,
  StructuredAutoCorrectStartEvent,
  StructuredAutoCorrectEndEvent,
  // Continuation events
  ContinuationStartEvent,
  // Tool events
  ToolRequestedEvent,
  ToolStartEvent,
  ToolResultEvent,
  ToolErrorEvent,
  ToolCompletedEvent,
  ToolErrorType,
  // Completion events
  CompleteEvent,
  ErrorEvent,
} from "./types/observability";

// Guardrails
export {
  GuardrailEngine,
  createGuardrailEngine,
  checkGuardrails,
  jsonRule,
  strictJsonRule,
  markdownRule,
  latexRule,
  patternRule,
  customPatternRule,
  zeroOutputRule,
  minimalGuardrails,
  recommendedGuardrails,
  strictGuardrails,
  jsonOnlyGuardrails,
  markdownOnlyGuardrails,
  latexOnlyGuardrails,
} from "./guardrails";

// Retry presets
export {
  minimalRetry,
  recommendedRetry,
  strictRetry,
  exponentialRetry,
} from "./types/l0";

// Retry utilities
export {
  RetryManager,
  createRetryManager,
  isRetryableError,
  getErrorCategory,
} from "./runtime/retry";

// Drift detection
export {
  DriftDetector,
  createDriftDetector,
  checkDrift,
} from "./runtime/drift";

// Zero token detection
export {
  detectZeroToken,
  detectZeroTokenBeforeFirstMeaningful,
  detectInstantFinish,
  analyzeZeroToken,
} from "./runtime/zeroToken";

// Event normalization
export {
  normalizeStreamEvent,
  normalizeStreamEvents,
  createTokenEvent,
  createMessageEvent,
  createCompleteEvent,
  createErrorEvent,
  filterEventsByType,
  extractTokens,
  reconstructText,
} from "./runtime/events";

// Monitoring and telemetry
export {
  L0Monitor,
  createMonitor,
  TelemetryExporter,
} from "./runtime/monitoring";

export type { MonitoringConfig } from "./runtime/monitoring";

// Event handler utilities
export {
  combineEvents,
  filterEvents,
  excludeEvents,
  debounceEvents,
  batchEvents,
} from "./runtime/event-handlers";

export type { EventHandler } from "./runtime/event-handlers";

// Sentry integration
export {
  L0Sentry,
  createSentryIntegration,
  createSentryHandler,
  withSentry,
} from "./runtime/sentry";

export type { SentryClient, SentryConfig } from "./runtime/sentry";

// OpenTelemetry integration
export {
  L0OpenTelemetry,
  createOpenTelemetry,
  createOpenTelemetryHandler,
  SemanticAttributes,
  SpanStatusCode,
  SpanKind,
} from "./runtime/opentelemetry";

export type { OpenTelemetryConfig } from "./runtime/opentelemetry";

// Interceptors
export {
  InterceptorManager,
  createInterceptorManager,
  loggingInterceptor,
  metadataInterceptor,
  authInterceptor,
  timingInterceptor,
  validationInterceptor,
  rateLimitInterceptor,
  cachingInterceptor,
  transformInterceptor,
  analyticsInterceptor,
} from "./runtime/interceptors";

export type { InterceptorContext } from "./runtime/interceptors";

// Parallel operations
export {
  parallel,
  parallelAll,
  sequential,
  batched,
  race,
  OperationPool,
  createPool,
} from "./runtime/parallel";

export type {
  ParallelOptions,
  ParallelResult,
  RaceResult,
  AggregatedTelemetry,
} from "./runtime/parallel";

// Consensus
export {
  consensus,
  quickConsensus,
  getConsensusValue,
  validateConsensus,
} from "./consensus";

export type {
  ConsensusOptions,
  ConsensusResult,
  ConsensusOutput,
  ConsensusAnalysis,
  ConsensusStrategy,
  ConflictResolution,
  Agreement,
  Disagreement,
  FieldConsensus,
  FieldAgreement,
} from "./types/consensus";

export {
  strictConsensus,
  standardConsensus,
  lenientConsensus,
  bestConsensus,
} from "./types/consensus";

// Pipeline
export {
  pipe,
  createPipeline,
  createStep,
  chainPipelines,
  parallelPipelines,
  createBranchStep,
} from "./pipeline";

export type {
  PipelineStep,
  PipelineOptions,
  PipelineResult,
  StepContext,
  StepResult,
  Pipeline,
} from "./types/pipeline";

export {
  fastPipeline,
  reliablePipeline,
  productionPipeline,
} from "./types/pipeline";

// Format helpers
export {
  formatContext,
  formatMultipleContexts,
  formatDocument,
  formatInstructions,
  escapeDelimiters,
  unescapeDelimiters,
} from "./format/context";

export {
  formatMemory,
  createMemoryEntry,
  mergeMemory,
  filterMemoryByRole,
  getLastNEntries,
  calculateMemorySize,
  truncateMemory,
} from "./format/memory";

export {
  formatJsonOutput,
  formatStructuredOutput,
  formatOutputConstraints,
  createOutputFormatSection,
  extractJsonFromOutput,
  cleanOutput,
} from "./format/output";

export {
  formatTool,
  formatTools,
  createTool,
  createParameter,
  validateTool,
  formatFunctionArguments,
  parseFunctionCall,
} from "./format/tools";

export {
  trim,
  escape,
  unescape,
  escapeHtml,
  unescapeHtml,
  escapeRegex,
  sanitize,
  truncate,
  truncateWords,
  wrap,
  pad,
  removeAnsi,
} from "./format/utils";

export type {
  FormatContextOptions,
  FormatMemoryOptions,
  MemoryEntry,
  FormatJsonOutputOptions,
  ToolDefinition,
  ToolParameter,
  FormatToolOptions,
} from "./format";

// Utility helpers
export {
  normalizeNewlines,
  normalizeWhitespace,
  normalizeIndentation,
  normalizeForModel,
  dedent,
  indent,
  trimText,
  normalizeText,
} from "./utils/normalize";

export {
  repairJson,
  balanceBraces,
  balanceBrackets,
  removeTrailingCommas,
  repairMarkdownFences,
  repairLatexEnvironments,
  repairToolCallArguments,
  isValidJson,
  parseOrRepairJson,
  extractJson,
  ensureJson,
} from "./utils/repair";

export {
  isMeaningfulToken,
  hasMeaningfulContent,
  countMeaningfulTokens,
  extractMeaningfulTokens,
  detectRepeatedTokens,
  endsAbruptly,
  detectOverlap,
  deduplicateContinuation,
} from "./utils/tokens";

export type { OverlapDetectionResult } from "./utils/tokens";

export {
  exponentialBackoff,
  linearBackoff,
  fixedBackoff,
  fixedJitterBackoff,
  fullJitterBackoff,
  calculateBackoff,
  sleep,
  timeout,
  withTimeout,
  Timer,
} from "./utils/timers";

// Re-export commonly used types
export type {
  RetryReason,
  BackoffStrategy,
  CategorizedError,
  ErrorTypeDelays,
} from "./types/retry";
export {
  ErrorCategory,
  RETRY_DEFAULTS,
  ERROR_TYPE_DELAY_DEFAULTS,
} from "./types/retry";
export type { DriftResult, DriftType, DriftConfig } from "./runtime/drift";

// Network error detection utilities
export {
  NetworkErrorType,
  isNetworkError,
  analyzeNetworkError,
  isConnectionDropped,
  isFetchTypeError,
  isECONNRESET,
  isECONNREFUSED,
  isSSEAborted,
  isNoBytes,
  isPartialChunks,
  isRuntimeKilled,
  isBackgroundThrottle,
  isDNSError,
  isSSLError,
  isTimeoutError,
  isStreamInterrupted,
  describeNetworkError,
  suggestRetryDelay,
  L0Error,
  isL0Error,
  L0ErrorCodes,
} from "./utils/errors";

export type {
  NetworkErrorAnalysis,
  L0ErrorCode,
  L0ErrorContext,
} from "./utils/errors";

// SDK Adapters - Registry (BYOA - Bring Your Own Adapter)
export {
  registerAdapter,
  unregisterAdapter,
  unregisterAllExcept,
  getAdapter,
  getRegisteredStreamAdapters,
  clearAdapters,
  detectAdapter,
  hasMatchingAdapter,
} from "./adapters/registry";

// SDK Adapters - Core helpers for building custom adapters
export {
  toL0Events,
  toL0EventsWithMessages,
  toMultimodalL0Events,
  createAdapterTokenEvent,
  createAdapterDoneEvent,
  createAdapterErrorEvent,
  createAdapterMessageEvent,
  createAdapterDataEvent,
  createAdapterProgressEvent,
  createImageEvent,
  createAudioEvent,
  createJsonDataEvent,
} from "./adapters/helpers";

// SDK Adapters - OpenAI, Anthropic, Mastra
// Also available via subpath imports for reduced bundle size:
//   import { openaiAdapter } from "reliable-ai-streams/openai"
//   import { anthropicAdapter } from "reliable-ai-streams/anthropic"
//   import { mastraAdapter } from "reliable-ai-streams/mastra"

// OpenAI adapter
export {
  openaiAdapter,
  openaiStream,
  openaiText,
  openaiJSON,
  openaiWithTools,
  wrapOpenAIStream,
  isOpenAIChunk,
  isOpenAIStream,
  extractOpenAIText,
} from "./adapters/openai";
export type { OpenAIAdapterOptions, OpenAIStream } from "./adapters/openai";

// Anthropic adapter
export {
  anthropicAdapter,
  anthropicStream,
  anthropicText,
  wrapAnthropicStream,
  isAnthropicStream,
  isAnthropicStreamEvent,
} from "./adapters/anthropic";
export type {
  AnthropicStream,
  AnthropicAdapterOptions,
  RawMessageStreamEvent,
  RawMessageStartEvent,
  RawMessageDeltaEvent,
  RawContentBlockStartEvent,
  RawContentBlockDeltaEvent,
  RawContentBlockStopEvent,
  MessageCreateParamsBase,
} from "./adapters/anthropic";

// Mastra adapter
export {
  mastraAdapter,
  mastraStream,
  mastraText,
  mastraStructured,
  wrapMastraStream,
  wrapMastraFullStream,
  isMastraStream,
  extractMastraText,
  extractMastraObject,
} from "./adapters/mastra";
export type {
  MastraAdapterOptions,
  MastraMessageInput,
} from "./adapters/mastra";

// Event Sourcing - Atomic, Replayable Operations
export {
  InMemoryEventStore,
  L0EventRecorder,
  L0EventReplayer,
  createInMemoryEventStore,
  createEventRecorder,
  createEventReplayer,
} from "./runtime/eventStore";

export type { ReplayedState } from "./runtime/eventStore";

export { replay, compareReplays, getStreamMetadata } from "./runtime/replay";

export type {
  L0ReplayResult,
  ReplayCallbacks,
  ReplayComparison,
  StreamMetadata,
} from "./runtime/replay";

export type {
  L0RecordedEvent,
  L0StartEvent,
  L0TokenEvent,
  L0CheckpointEvent,
  L0GuardrailEvent,
  L0DriftEvent,
  L0RetryEvent,
  L0FallbackEvent,
  L0ContinuationEvent,
  L0CompleteEvent,
  L0ErrorEvent,
  L0EventEnvelope,
  L0EventStore,
  L0EventStoreWithSnapshots,
  L0Snapshot,
  L0ExecutionMode,
  L0ReplayOptions,
  L0RecordOptions,
  SerializedOptions,
  SerializedError,
  GuardrailEventResult,
  DriftEventResult,
  L0RecordedEventType,
} from "./types/events";

export {
  serializeError,
  deserializeError,
  generateStreamId,
  L0RecordedEventTypes,
} from "./types/events";

// Storage Adapters
export {
  registerStorageAdapter,
  unregisterStorageAdapter,
  getRegisteredAdapters,
  createEventStore,
  BaseEventStore,
  BaseEventStoreWithSnapshots,
  FileEventStore,
  LocalStorageEventStore,
  CompositeEventStore,
  TTLEventStore,
  createCompositeStore,
  withTTL,
} from "./runtime/storageAdapters";

export type {
  StorageAdapterConfig,
  StorageAdapterFactory,
} from "./runtime/storageAdapters";

// Schema Compatibility - Zod v3/v4
export {
  isZodSchema,
  isZodError,
  safeParse,
  getZodErrorMessages,
  flattenZodError,
} from "./utils/zodCompat";

export type {
  AnyZodSchema,
  ZodObjectSchema,
  ZodArraySchema,
  ZodValidationError,
  InferSchema,
} from "./utils/zodCompat";

// Schema Compatibility - Effect Schema
export {
  isEffectSchema,
  isEffectParseError,
  isEffectRight,
  isEffectLeft,
  registerEffectSchemaAdapter,
  unregisterEffectSchemaAdapter,
  hasEffectSchemaAdapter,
  getEffectSchemaAdapter,
  safeDecodeEffectSchema,
  getEffectErrorMessage,
  wrapEffectSchema,
} from "./utils/effectSchemaCompat";

export type {
  EffectSchema,
  EffectParseError,
  EffectParseResult,
  EffectSchemaAdapter,
  EffectDecodeOptions,
  InferEffectSchema,
  InferEffectSchemaEncoded,
  UnifiedSchema,
} from "./utils/effectSchemaCompat";

// Schema Compatibility - JSON Schema
export {
  isJSONSchema,
  registerJSONSchemaAdapter,
  unregisterJSONSchemaAdapter,
  hasJSONSchemaAdapter,
  getJSONSchemaAdapter,
  validateJSONSchema,
  wrapJSONSchema,
  createSimpleJSONSchemaAdapter,
} from "./utils/jsonSchemaCompat";

export type {
  JSONSchemaDefinition,
  JSONSchemaValidationError,
  JSONSchemaValidationResult,
  JSONSchemaAdapter,
} from "./utils/jsonSchemaCompat";

// String Comparison Utilities
export {
  compareStrings,
  levenshteinSimilarity,
  levenshteinDistance,
  jaroWinklerSimilarity,
  cosineSimilarity,
  compareNumbers,
  compareArrays,
  compareObjects,
  compareValues,
  getType,
  deepEqual,
  calculateSimilarityScore,
  countFields,
} from "./utils/comparison";

// Consensus Utilities
export {
  calculateSimilarityMatrix,
  calculateOutputSimilarity,
  calculateStructuralSimilarity,
  findAgreements,
  findDisagreements,
  calculateFieldConsensus,
  resolveMajority,
  resolveBest,
  resolveMerge,
  meetsMinimumAgreement,
} from "./utils/consensusUtils";

// Shallow Copy Utilities
export { shallowClone, shallowCopy } from "./utils/shallow";
