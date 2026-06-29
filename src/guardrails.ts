/**
 * L0 Guardrails - Input/output validation rules
 *
 * Import from "reliable-ai-streams/guardrails" to get guardrail features
 * without bundling them in your main application when using core.
 *
 * @example
 * ```typescript
 * import { jsonRule, markdownRule, recommendedGuardrails } from "reliable-ai-streams/guardrails";
 * ```
 */

// Core guardrails engine
export {
  GuardrailEngine,
  createGuardrailEngine,
  checkGuardrails,
} from "./guardrails/engine.js";

// Individual rules
export { jsonRule, strictJsonRule } from "./guardrails/json.js";
export { markdownRule } from "./guardrails/markdown.js";
export { latexRule } from "./guardrails/latex.js";
export { patternRule, customPatternRule } from "./guardrails/patterns.js";
export { zeroOutputRule } from "./guardrails/zeroOutput.js";

// Presets
export {
  minimalGuardrails,
  recommendedGuardrails,
  strictGuardrails,
  jsonOnlyGuardrails,
  markdownOnlyGuardrails,
  latexOnlyGuardrails,
} from "./guardrails/index.js";

// Types
export type {
  GuardrailRule,
  GuardrailViolation,
  GuardrailContext,
  GuardrailResult,
} from "./types/guardrails.js";

// Async guardrail checks
export {
  runAsyncGuardrailCheck,
  runGuardrailCheckAsync,
} from "./guardrails/async.js";

export type { GuardrailCheckResult } from "./guardrails/async.js";
