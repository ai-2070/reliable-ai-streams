// JSON structure and balance rules for L0

import type {
  GuardrailRule,
  GuardrailContext,
  GuardrailViolation,
  JsonStructure,
} from "../types/guardrails";

/**
 * Incremental JSON structure tracker for O(1) per-token updates
 * Instead of re-scanning the entire content, we track state incrementally
 */
export interface IncrementalJsonState {
  openBraces: number;
  closeBraces: number;
  openBrackets: number;
  closeBrackets: number;
  inString: boolean;
  escapeNext: boolean;
  /** Content length when state was last computed */
  processedLength: number;
}

/**
 * Create initial incremental JSON state
 */
export function createIncrementalJsonState(): IncrementalJsonState {
  return {
    openBraces: 0,
    closeBraces: 0,
    openBrackets: 0,
    closeBrackets: 0,
    inString: false,
    escapeNext: false,
    processedLength: 0,
  };
}

/**
 * Update JSON state incrementally with new delta content
 * O(delta.length) instead of O(content.length)
 * @param state - Current incremental state (mutated in place)
 * @param delta - New content to process
 * @returns Updated state
 */
export function updateJsonStateIncremental(
  state: IncrementalJsonState,
  delta: string,
): IncrementalJsonState {
  for (let i = 0; i < delta.length; i++) {
    const char = delta[i];

    if (state.escapeNext) {
      state.escapeNext = false;
      continue;
    }

    if (char === "\\" && state.inString) {
      state.escapeNext = true;
      continue;
    }

    if (char === '"') {
      state.inString = !state.inString;
      continue;
    }

    if (!state.inString) {
      if (char === "{") state.openBraces++;
      if (char === "}") state.closeBraces++;
      if (char === "[") state.openBrackets++;
      if (char === "]") state.closeBrackets++;
    }
  }

  state.processedLength += delta.length;
  return state;
}

/**
 * Convert incremental state to JsonStructure for compatibility
 */
export function incrementalStateToStructure(
  state: IncrementalJsonState,
): JsonStructure {
  const issues: string[] = [];

  if (state.inString) {
    issues.push("Unclosed string detected");
  }

  if (state.openBraces !== state.closeBraces) {
    issues.push(
      `Unbalanced braces: ${state.openBraces} open, ${state.closeBraces} close`,
    );
  }

  if (state.openBrackets !== state.closeBrackets) {
    issues.push(
      `Unbalanced brackets: ${state.openBrackets} open, ${state.closeBrackets} close`,
    );
  }

  const isBalanced =
    state.openBraces === state.closeBraces &&
    state.openBrackets === state.closeBrackets &&
    !state.inString;

  return {
    openBraces: state.openBraces,
    closeBraces: state.closeBraces,
    openBrackets: state.openBrackets,
    closeBrackets: state.closeBrackets,
    inString: state.inString,
    isBalanced,
    issues,
  };
}

/**
 * Analyze JSON structure in content (full scan - use for completion checks)
 * @param content - Content to analyze
 * @returns JSON structure analysis
 */
export function analyzeJsonStructure(content: string): JsonStructure {
  const state = createIncrementalJsonState();
  updateJsonStateIncremental(state, content);
  return incrementalStateToStructure(state);
}

/**
 * Check if content looks like JSON (starts with { or [)
 * @param content - Content to check
 * @returns True if content appears to be JSON
 */
export function looksLikeJson(content: string): boolean {
  if (!content) return false;

  const trimmed = content.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

/**
 * Validate JSON structure - checks for balanced braces, brackets, and quotes
 * @param context - Guardrail context
 * @returns Array of violations
 */
export function validateJsonStructure(
  context: GuardrailContext,
): GuardrailViolation[] {
  const { content, completed } = context;
  const violations: GuardrailViolation[] = [];

  // Only check if content looks like JSON
  if (!looksLikeJson(content)) {
    return violations;
  }

  const structure = analyzeJsonStructure(content);

  // If streaming and not complete, only flag severe issues
  if (!completed) {
    // Check for premature closing (more closes than opens)
    if (structure.closeBraces > structure.openBraces) {
      violations.push({
        rule: "json-structure",
        message: `Too many closing braces: ${structure.closeBraces} close, ${structure.openBraces} open`,
        severity: "error",
        recoverable: true,
      });
    }

    if (structure.closeBrackets > structure.openBrackets) {
      violations.push({
        rule: "json-structure",
        message: `Too many closing brackets: ${structure.closeBrackets} close, ${structure.openBrackets} open`,
        severity: "error",
        recoverable: true,
      });
    }
  } else {
    // Stream is complete, check for full balance
    if (!structure.isBalanced) {
      for (const issue of structure.issues) {
        violations.push({
          rule: "json-structure",
          message: issue,
          severity: "error",
          recoverable: true,
          suggestion: "Retry generation to get properly balanced JSON",
        });
      }
    }
  }

  return violations;
}

/**
 * Check for malformed JSON chunks during streaming
 * @param context - Guardrail context
 * @returns Array of violations
 */
export function validateJsonChunks(
  context: GuardrailContext,
): GuardrailViolation[] {
  const { content, delta } = context;
  const violations: GuardrailViolation[] = [];

  if (!delta || !looksLikeJson(content)) {
    return violations;
  }

  // Check for common malformed patterns in the delta
  const malformedPatterns = [
    { pattern: /,,+/, message: "Multiple consecutive commas" },
    { pattern: /\{\s*,/, message: "Comma immediately after opening brace" },
    { pattern: /\[\s*,/, message: "Comma immediately after opening bracket" },
    { pattern: /:\s*,/, message: "Comma immediately after colon" },
  ];

  for (const { pattern, message } of malformedPatterns) {
    if (pattern.test(content)) {
      violations.push({
        rule: "json-chunks",
        message: `Malformed JSON: ${message}`,
        severity: "error",
        recoverable: true,
      });
    }
  }

  return violations;
}

/**
 * Attempt to parse JSON and report issues
 * @param context - Guardrail context
 * @returns Array of violations
 */
export function validateJsonParseable(
  context: GuardrailContext,
): GuardrailViolation[] {
  const { content, completed } = context;
  const violations: GuardrailViolation[] = [];

  // Only validate if complete and looks like JSON
  if (!completed || !looksLikeJson(content)) {
    return violations;
  }

  try {
    JSON.parse(content.trim());
  } catch (error) {
    violations.push({
      rule: "json-parseable",
      message: `JSON is not parseable: ${error instanceof Error ? error.message : "Unknown error"}`,
      severity: "error",
      recoverable: true,
      suggestion: "Retry generation to get valid JSON",
    });
  }

  return violations;
}

/**
 * Create JSON structure guardrail rule
 * Checks for balanced braces, brackets, proper structure
 *
 * Performance optimized:
 * - Uses incremental state tracking during streaming (O(delta) per check)
 * - Only does full content scan at completion
 */
export function jsonRule(): GuardrailRule {
  // Incremental state for O(1) streaming checks
  // Note: State is reset when content is empty or shorter than processed length
  // to handle new streams, aborted streams, or rule reuse
  let incrementalState: IncrementalJsonState | null = null;
  let lastProcessedLength = 0;

  return {
    name: "json-structure",
    description: "Validates JSON structure and balance",
    streaming: true,
    severity: "error",
    recoverable: true,
    check: (context: GuardrailContext) => {
      const violations: GuardrailViolation[] = [];
      const { content, delta, completed } = context;

      // Only check if content looks like JSON
      if (!looksLikeJson(content)) {
        // Reset state when content doesn't look like JSON (new stream starting)
        incrementalState = null;
        lastProcessedLength = 0;
        return violations;
      }

      // Reset state if content is shorter than what we've processed
      // (indicates a new stream or aborted stream being reused)
      if (content.length < lastProcessedLength) {
        incrementalState = null;
        lastProcessedLength = 0;
      }

      if (completed) {
        // Full validation at completion - reset incremental state
        incrementalState = null;
        lastProcessedLength = 0;

        // Check structure (full scan is fine at completion)
        violations.push(...validateJsonStructure(context));

        // Check for malformed chunks
        violations.push(...validateJsonChunks(context));

        // Check parseability
        violations.push(...validateJsonParseable(context));
      } else {
        // Streaming: use incremental state tracking
        if (!incrementalState) {
          incrementalState = createIncrementalJsonState();
          lastProcessedLength = 0;
        }

        // Only process new content (delta or content beyond what we've seen)
        if (delta) {
          // Prefer delta if available - most efficient
          updateJsonStateIncremental(incrementalState, delta);
        } else if (content.length > lastProcessedLength) {
          // Fall back to processing new portion of content
          const newContent = content.slice(lastProcessedLength);
          updateJsonStateIncremental(incrementalState, newContent);
        }
        lastProcessedLength = content.length;

        // Check for premature closing (more closes than opens) - O(1)
        if (incrementalState.closeBraces > incrementalState.openBraces) {
          violations.push({
            rule: "json-structure",
            message: `Too many closing braces: ${incrementalState.closeBraces} close, ${incrementalState.openBraces} open`,
            severity: "error",
            recoverable: true,
          });
        }

        if (incrementalState.closeBrackets > incrementalState.openBrackets) {
          violations.push({
            rule: "json-structure",
            message: `Too many closing brackets: ${incrementalState.closeBrackets} close, ${incrementalState.openBrackets} open`,
            severity: "error",
            recoverable: true,
          });
        }

        // Only check malformed patterns if we have a delta (avoid full content regex)
        if (delta) {
          // Quick delta-only checks for obvious issues
          if (delta.includes(",,")) {
            violations.push({
              rule: "json-chunks",
              message: "Malformed JSON: Multiple consecutive commas",
              severity: "error",
              recoverable: true,
            });
          }
        }
      }

      return violations;
    },
  };
}

/**
 * Create strict JSON guardrail that also validates content structure
 */
export function strictJsonRule(): GuardrailRule {
  return {
    name: "json-strict",
    description: "Strict JSON validation including structure and parseability",
    streaming: false,
    severity: "error",
    recoverable: true,
    check: (context: GuardrailContext) => {
      const violations: GuardrailViolation[] = [];

      // Only run on complete output
      if (!context.completed) {
        return violations;
      }

      const { content } = context;

      // Must look like JSON
      if (!looksLikeJson(content)) {
        violations.push({
          rule: "json-strict",
          message:
            "Content does not appear to be JSON (must start with { or [)",
          severity: "error",
          recoverable: true,
        });
        return violations;
      }

      // Must be parseable
      violations.push(...validateJsonParseable(context));

      // If parseable, validate it's an object or array at root
      if (violations.length === 0) {
        try {
          const parsed = JSON.parse(content.trim());
          if (typeof parsed !== "object" || parsed === null) {
            violations.push({
              rule: "json-strict",
              message: "JSON root must be an object or array",
              severity: "error",
              recoverable: true,
            });
          }
        } catch {
          // Already caught by validateJsonParseable
        }
      }

      return violations;
    },
  };
}

/**
 * JSON guardrail class for compatibility
 */
export class JsonGuardrail {
  private rule: GuardrailRule;

  constructor(strict: boolean = false) {
    this.rule = strict ? strictJsonRule() : jsonRule();
  }

  check(context: GuardrailContext): GuardrailViolation[] {
    return this.rule.check(context);
  }

  get name(): string {
    return this.rule.name;
  }
}
