// reliable-ai-streams/zod - Zod schemas for all L0 types
// Use with `import { ... } from "reliable-ai-streams/zod"`

// Re-export all schemas from each module

// Retry schemas
export {
  ErrorTypeDelaysSchema,
  RetryReasonSchema,
  BackoffStrategySchema,
  ErrorCategorySchema,
  RetryConfigSchema,
  CategorizedErrorSchema,
  RetryStateSchema,
  BackoffResultSchema,
  RetryDecisionSchema,
  ErrorClassificationSchema,
  RetryContextSchema,
} from "./retry";

// Guardrail schemas
export {
  GuardrailViolationSchema,
  GuardrailContextSchema,
  GuardrailRuleSchema,
  GuardrailStateSchema,
  GuardrailConfigSchema,
  GuardrailResultSchema,
  JsonStructureSchema,
  MarkdownStructureSchema,
  LatexStructureSchema,
  PatternConfigSchema,
  DriftConfigSchema,
  FunctionCallStructureSchema,
  SchemaValidationSchema,
} from "./guardrails";

// Core L0 schemas
export {
  L0ContentTypeSchema,
  L0DataPayloadSchema,
  L0ProgressSchema,
  L0EventSchema,
  CategorizedNetworkErrorSchema,
  L0StateSchema,
  L0TelemetrySchema,
  CheckpointValidationResultSchema,
  RetryOptionsSchema,
  L0AdapterSchema,
  L0InterceptorSchema,
  L0OptionsSchema,
  L0ResultSchema,
} from "./l0";

// Structured output schemas
export {
  CorrectionTypeSchema,
  CorrectionInfoSchema,
  AutoCorrectOptionsSchema,
  AutoCorrectResultSchema,
  StructuredStateSchema,
  StructuredTelemetrySchema,
  StructuredOptionsSchema,
  StructuredResultSchema,
  StructuredPresetSchema,
} from "./structured";

// Pipeline schemas
export {
  StepContextSchema,
  StepResultSchema,
  StructuredStepResultSchema,
  PipelineStepSchema,
  StructuredPipelineStepSchema,
  PipelineOptionsSchema,
  PipelineResultSchema,
  PipelineSchema,
  PipelineBranchSchema,
  StepBuilderOptionsSchema,
  PipelinePresetSchema,
} from "./pipeline";

// Consensus schemas
export {
  ConsensusStrategySchema,
  ConflictResolutionSchema,
  AgreementTypeSchema,
  DisagreementSeveritySchema,
  AgreementSchema,
  DisagreementSchema,
  ConsensusAnalysisSchema,
  FieldAgreementSchema,
  FieldConsensusSchema,
  ConsensusOutputSchema,
  ConsensusResultSchema,
  ConsensusOptionsSchema,
  TextConsensusOptionsSchema,
  StructuredConsensusOptionsSchema,
  ConsensusPresetSchema,
} from "./consensus";

// Observability schemas
export {
  FailureTypeSchema,
  RecoveryStrategySchema,
  RecoveryPolicySchema,
  EventCategorySchema,
  EventTypeSchema,
  ToolErrorTypeSchema,
  L0ObservabilityEventSchema,
  SessionStartEventSchema,
  SessionEndEventSchema,
  SessionSummaryEventSchema,
  AttemptStartEventSchema,
  StreamInitEventSchema,
  StreamReadyEventSchema,
  AdapterDetectedEventSchema,
  AdapterWrapStartEventSchema,
  AdapterWrapEndEventSchema,
  TimeoutStartEventSchema,
  TimeoutResetEventSchema,
  TimeoutTriggeredEventSchema,
  NetworkErrorEventSchema,
  NetworkRecoveryEventSchema,
  ConnectionDroppedEventSchema,
  ConnectionRestoredEventSchema,
  AbortRequestedEventSchema,
  AbortCompletedEventSchema,
  GuardrailPhaseStartEventSchema,
  GuardrailRuleStartEventSchema,
  GuardrailRuleResultEventSchema,
  GuardrailRuleEndEventSchema,
  GuardrailPhaseEndEventSchema,
  GuardrailCallbackStartEventSchema,
  GuardrailCallbackEndEventSchema,
  DriftCheckStartEventSchema,
  DriftCheckResultEventSchema,
  DriftCheckEndEventSchema,
  DriftCheckSkippedEventSchema,
  CheckpointSavedEventSchema,
  ResumeStartEventSchema,
  RetryStartEventSchema,
  RetryAttemptEventSchema,
  RetryEndEventSchema,
  RetryGiveUpEventSchema,
  RetryFnStartEventSchema,
  RetryFnResultEventSchema,
  RetryFnErrorEventSchema,
  FallbackStartEventSchema,
  FallbackModelSelectedEventSchema,
  FallbackEndEventSchema,
  StructuredParseStartEventSchema,
  StructuredParseEndEventSchema,
  StructuredParseErrorEventSchema,
  StructuredValidationStartEventSchema,
  StructuredValidationEndEventSchema,
  StructuredValidationErrorEventSchema,
  StructuredAutoCorrectStartEventSchema,
  StructuredAutoCorrectEndEventSchema,
  ContinuationStartEventSchema,
  ToolRequestedEventSchema,
  ToolStartEventSchema,
  ToolResultEventSchema,
  ToolErrorEventSchema,
  ToolCompletedEventSchema,
  CompleteEventSchema,
  ErrorEventSchema,
  L0EventUnionSchema,
} from "./observability";

// Event sourcing schemas
export {
  L0RecordedEventTypeSchema,
  SerializedOptionsSchema,
  SerializedErrorSchema,
  GuardrailEventResultSchema,
  DriftEventResultSchema,
  L0StartEventSchema,
  L0TokenEventSchema,
  L0CheckpointEventSchema,
  L0GuardrailEventSchema,
  L0DriftEventSchema,
  L0RetryEventSchema,
  L0FallbackEventSchema,
  L0ContinuationEventSchema,
  L0CompleteEventSchema,
  L0ErrorEventSchema,
  L0RecordedEventSchema,
  L0EventEnvelopeSchema,
  L0SnapshotSchema,
  L0ExecutionModeSchema,
  L0ReplayOptionsSchema,
  L0RecordOptionsSchema,
} from "./events";

// Window schemas
export {
  ChunkStrategySchema,
  ContextRestorationStrategySchema,
  WindowOptionsSchema,
  DocumentChunkSchema,
  WindowProcessResultSchema,
  WindowStatsSchema,
  DocumentWindowSchema,
  ContextRestorationOptionsSchema,
  L0WindowOptionsSchema,
  WindowPresetSchema,
} from "./window";

// Stream schemas
export {
  StreamEventSchema,
  StreamNormalizerOptionsSchema,
  StreamWrapperSchema,
  StreamStateSchema,
  StreamChunkSchema,
  StreamHandlerSchema,
  StreamErrorTypeSchema,
  StreamErrorSchema,
  StreamResumptionStateSchema,
} from "./stream";

// Evaluate schemas
export {
  ComparisonStyleSchema,
  ComparisonTypeSchema,
  DifferenceTypeSchema,
  DifferenceSeveritySchema,
  ComparisonFunctionSchema,
  DifferenceSchema,
  EvaluationDetailsSchema,
  EvaluationResultSchema,
  EvaluationOptionsSchema,
  EvaluationTestSchema,
  EvaluationTestResultSchema,
  BatchEvaluationResultSchema,
  StringComparisonOptionsSchema,
  ObjectComparisonOptionsSchema,
  SchemaValidationResultSchema,
  EvaluationPresetSchema,
} from "./evaluate";
