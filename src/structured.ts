// L0 Structured Output API - Deterministic JSON with schema validation and auto-correction

import { z } from "zod";
import type {
  StructuredOptions,
  StructuredResult,
  StructuredState,
  StructuredTelemetry,
  CorrectionInfo,
} from "./types/structured";
import type { L0Options, L0Event } from "./types/l0";
import type { GuardrailViolation } from "./types/guardrails";
import { l0 } from "./runtime/l0";
import { autoCorrectJSON, isValidJSON, extractJSON } from "./utils/autoCorrect";

/**
 * L0 Structured Output - Guaranteed valid JSON matching your schema
 *
 * Provides:
 * - Automatic schema validation with Zod
 * - Auto-correction of common JSON issues
 * - Retry on validation failure (via L0's retry mechanism)
 * - Fallback model support
 * - Full L0 reliability (guardrails, network errors, etc.)
 *
 * @param options - Structured output configuration
 * @returns Validated and typed data matching schema
 *
 * @example
 * ```typescript
 * import { structured } from 'l0';
 * import { z } from 'zod';
 *
 * const schema = z.object({
 *   amount: z.number(),
 *   approved: z.boolean()
 * });
 *
 * const result = await structured({
 *   schema,
 *   stream: () => streamText({ model, prompt })
 * });
 *
 * console.log(result.data.amount); // Typed!
 * ```
 */
export async function structured<T extends z.ZodTypeAny>(
  options: StructuredOptions<T>,
): Promise<StructuredResult<z.infer<T>>> {
  const {
    schema,
    stream: streamFactory,
    fallbackStreams = [],
    retry = {},
    autoCorrect = true,
    strictMode = false,
    timeout,
    signal,
    monitoring,
    detectZeroTokens,
    onValidationError,
    onAutoCorrect,
    onRetry,
  } = options;

  // Track structured-specific state
  let validationAttempts = 0;
  let validationFailures = 0;
  let autoCorrections = 0;
  const correctionTypes: string[] = [];
  const validationErrors: z.ZodError[] = [];
  let rawOutput = "";
  let appliedCorrections: string[] = [];
  let wasAutoCorrected = false;
  const errors: Error[] = [];

  // Timing
  let validationStartTime = 0;
  let validationEndTime = 0;

  // Create abort controller
  const abortController = new AbortController();

  // Schema validation state (for guardrail to access)
  let parsedData: unknown = null;

  // Helper to attempt JSON parsing and schema validation
  const tryParseAndValidate = (
    content: string,
  ): { success: boolean; data?: unknown; error?: string } => {
    validationAttempts++;
    validationStartTime = Date.now();

    // Step 1: Auto-correct if enabled
    let processed = content;
    appliedCorrections = [];

    if (autoCorrect) {
      const correctionResult = autoCorrectJSON(processed, {
        structural: true,
        stripFormatting: true,
        schemaBased: false,
        strict: strictMode,
      });

      if (correctionResult.corrections.length > 0) {
        wasAutoCorrected = true;
        processed = correctionResult.corrected;
        appliedCorrections = correctionResult.corrections;
        autoCorrections++;
        correctionTypes.push(...correctionResult.corrections);

        if (onAutoCorrect) {
          const correctionInfo: CorrectionInfo = {
            original: content,
            corrected: processed,
            corrections: correctionResult.corrections,
            success: correctionResult.success,
          };
          onAutoCorrect(correctionInfo);
        }
      }
    }

    // Step 2: Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(processed);
    } catch (parseError) {
      const err =
        parseError instanceof Error
          ? parseError
          : new Error(String(parseError));

      // Try extractJSON to find JSON within surrounding text
      const extracted = extractJSON(processed);
      if (extracted !== processed) {
        try {
          parsed = JSON.parse(extracted);
          wasAutoCorrected = true;
          if (!appliedCorrections.includes("extract_json")) {
            appliedCorrections.push("extract_json");
            correctionTypes.push("extract_json");
          }
          autoCorrections++;
        } catch {
          // Try auto-correction on extracted content
          const rescueResult = autoCorrectJSON(extracted, {
            structural: true,
            stripFormatting: true,
          });

          if (rescueResult.success) {
            try {
              parsed = JSON.parse(rescueResult.corrected);
              wasAutoCorrected = true;
              appliedCorrections.push(...rescueResult.corrections);
              autoCorrections++;
              correctionTypes.push(...rescueResult.corrections);
            } catch (innerErr) {
              const innerError =
                innerErr instanceof Error
                  ? innerErr
                  : new Error(String(innerErr));
              return {
                success: false,
                error: `Invalid JSON after auto-correction: ${innerError.message}`,
              };
            }
          } else {
            return {
              success: false,
              error: `Invalid JSON after auto-correction: ${err.message}`,
            };
          }
        }
      } else {
        // Try raw extraction as last resort
        const rawExtracted = extractJSON(content);
        if (rawExtracted !== content) {
          const rescueResult = autoCorrectJSON(rawExtracted, {
            structural: true,
            stripFormatting: true,
          });

          if (rescueResult.success) {
            try {
              parsed = JSON.parse(rescueResult.corrected);
              wasAutoCorrected = true;
              appliedCorrections.push(
                "extract_json",
                ...rescueResult.corrections,
              );
              autoCorrections++;
              correctionTypes.push("extract_json", ...rescueResult.corrections);
            } catch (innerErr) {
              const innerError =
                innerErr instanceof Error
                  ? innerErr
                  : new Error(String(innerErr));
              return {
                success: false,
                error: `Invalid JSON: ${innerError.message}`,
              };
            }
          } else {
            return { success: false, error: `Invalid JSON: ${err.message}` };
          }
        } else {
          return { success: false, error: `Invalid JSON: ${err.message}` };
        }
      }
    }

    // Step 3: Validate against schema
    const validationResult = schema.safeParse(parsed);

    if (!validationResult.success) {
      validationFailures++;
      validationErrors.push(validationResult.error);

      if (onValidationError) {
        onValidationError(validationResult.error, validationAttempts);
      }

      return {
        success: false,
        error: `Schema validation failed: ${validationResult.error.errors[0]?.message}`,
      };
    }

    validationEndTime = Date.now();
    parsedData = validationResult.data;

    return { success: true, data: validationResult.data };
  };

  // Build L0 options - let L0 handle all retries
  const l0Options: L0Options = {
    stream: streamFactory,
    fallbackStreams,
    retry: {
      attempts: retry.attempts ?? 2,
      backoff: retry.backoff ?? "fixed-jitter",
      baseDelay: retry.baseDelay ?? 1000,
      maxDelay: retry.maxDelay ?? 5000,
      retryOn: [...(retry.retryOn || []), "guardrail_violation", "incomplete"],
      errorTypeDelays: retry.errorTypeDelays,
    },
    timeout,
    signal: signal || abortController.signal,
    // Default to disabled for structured output since short valid JSON
    // (like "[]" or "{}") should not be rejected
    detectZeroTokens: detectZeroTokens ?? false,
    monitoring: {
      enabled: monitoring?.enabled ?? false,
      sampleRate: monitoring?.sampleRate ?? 1.0,
      metadata: {
        ...(monitoring?.metadata || {}),
        structured: true,
        schemaName: schema.description || "unknown",
      },
    },
    guardrails: [
      // JSON + Schema validation guardrail (runs on completion)
      {
        name: "json-schema-validation",
        check: (context): GuardrailViolation[] => {
          if (!context.completed) {
            return [];
          }

          // Try to parse and validate against schema
          // (tryParseAndValidate handles auto-correction of invalid JSON)
          const result = tryParseAndValidate(context.content);
          if (!result.success) {
            return [
              {
                rule: "json-schema-validation",
                message: result.error || "Validation failed",
                severity: "error",
                recoverable: true,
              },
            ];
          }

          return [];
        },
      },
    ],
    onRetry: (attempt, reason) => {
      if (onRetry) {
        onRetry(attempt, reason);
      }
    },
  };

  // Execute L0 stream - L0 handles all retries via guardrails
  const result = await l0(l0Options);

  // Accumulate output
  rawOutput = "";
  for await (const event of result.stream) {
    if (event.type === "token" && event.value) {
      rawOutput += event.value;
    } else if (event.type === "error") {
      errors.push(event.error || new Error("Unknown error"));
    }
  }

  // Check if we got output
  if (!rawOutput || rawOutput.trim().length === 0) {
    throw new Error("No output received from model");
  }

  // If guardrail passed, parsedData should be set
  // But run validation one more time to be safe (in case guardrails weren't run)
  if (parsedData === null) {
    const finalResult = tryParseAndValidate(rawOutput);
    if (!finalResult.success) {
      throw new Error(`Structured output failed: ${finalResult.error}`);
    }
  }

  // Build structured state
  const structuredState: StructuredState = {
    ...result.state,
    validationFailures,
    autoCorrections,
    validationErrors,
  };

  // Build structured telemetry
  let structuredTelemetry: StructuredTelemetry | undefined;
  if (result.telemetry) {
    structuredTelemetry = {
      ...result.telemetry,
      structured: {
        schemaName: schema.description || "unknown",
        validationAttempts,
        validationFailures,
        autoCorrections,
        correctionTypes: Array.from(new Set(correctionTypes)),
        validationSuccess: true,
        validationTime: validationEndTime - validationStartTime,
      },
    };
  }

  // Return successful result
  return {
    data: parsedData as z.infer<T>,
    raw: rawOutput,
    corrected: wasAutoCorrected,
    corrections: appliedCorrections,
    state: structuredState,
    telemetry: structuredTelemetry,
    errors,
    abort: () => abortController.abort(),
  };
}

/**
 * Helper: Create a structured output with a simple schema
 *
 * @example
 * ```typescript
 * const result = await structuredObject({
 *   amount: z.number(),
 *   approved: z.boolean()
 * }, {
 *   stream: () => streamText({ model, prompt })
 * });
 * ```
 */
export async function structuredObject<T extends z.ZodRawShape>(
  shape: T,
  options: Omit<StructuredOptions<z.ZodObject<T>>, "schema">,
): Promise<StructuredResult<z.infer<z.ZodObject<T>>>> {
  const schema = z.object(shape);
  return structured({ ...options, schema });
}

/**
 * Helper: Create a structured output with an array schema
 *
 * @example
 * ```typescript
 * const result = await structuredArray(
 *   z.object({ name: z.string() }),
 *   { stream: () => streamText({ model, prompt }) }
 * );
 * ```
 */
export async function structuredArray<T extends z.ZodTypeAny>(
  itemSchema: T,
  options: Omit<StructuredOptions<z.ZodArray<T>>, "schema">,
): Promise<StructuredResult<z.infer<z.ZodArray<T>>>> {
  const schema = z.array(itemSchema);
  return structured({ ...options, schema });
}

/**
 * Create a streaming structured output (yields tokens as they arrive, validates at end)
 *
 * This function allows you to stream tokens in real-time while also getting
 * validated structured data when the stream completes.
 *
 * @example
 * ```typescript
 * const { stream, result, abort } = await structuredStream({
 *   schema: z.object({ name: z.string() }),
 *   stream: () => streamText({ model, prompt })
 * });
 *
 * // Stream tokens as they arrive
 * for await (const event of stream) {
 *   if (event.type === 'token') {
 *     process.stdout.write(event.value);
 *   }
 * }
 *
 * // Get validated result after stream completes
 * const validated = await result;
 * console.log(validated.data.name);
 * ```
 */
export async function structuredStream<T extends z.ZodTypeAny>(
  options: StructuredOptions<T>,
): Promise<{
  stream: AsyncIterable<L0Event>;
  result: Promise<StructuredResult<z.infer<T>>>;
  abort: () => void;
}> {
  const {
    schema,
    stream: streamFactory,
    fallbackStreams = [],
    retry = {},
    autoCorrect = true,
    strictMode = false,
    detectZeroTokens,
    timeout,
    signal,
    monitoring,
    onValidationError,
    onAutoCorrect,
    onRetry,
  } = options;

  const abortController = new AbortController();
  const combinedSignal = signal || abortController.signal;

  // Shared state for validation
  let rawOutput = "";
  let validationAttempts = 0;
  let validationFailures = 0;
  let autoCorrections = 0;
  const correctionTypes: string[] = [];
  const validationErrors: z.ZodError[] = [];
  let appliedCorrections: string[] = [];
  let wasAutoCorrected = false;
  const errors: Error[] = [];

  // Create L0 result for streaming
  const l0Result = await l0({
    stream: streamFactory,
    fallbackStreams,
    retry: {
      attempts: retry.attempts ?? 2,
      backoff: retry.backoff ?? "fixed-jitter",
      baseDelay: retry.baseDelay ?? 1000,
      maxDelay: retry.maxDelay ?? 5000,
      retryOn: [...(retry.retryOn || []), "guardrail_violation", "incomplete"],
      errorTypeDelays: retry.errorTypeDelays,
    },
    detectZeroTokens: detectZeroTokens ?? false,
    timeout,
    signal: combinedSignal,
    monitoring: {
      enabled: monitoring?.enabled ?? false,
      sampleRate: monitoring?.sampleRate ?? 1.0,
      metadata: {
        ...(monitoring?.metadata || {}),
        structured: true,
        schemaName: schema.description || "unknown",
      },
    },
    onRetry,
  });

  // Shared state for stream tee-ing
  let streamResolve: () => void;
  const streamDone = new Promise<void>((resolve) => {
    streamResolve = resolve;
  });

  // Create a tee'd stream that collects output while yielding events
  const teedStream = async function* (): AsyncGenerator<L0Event> {
    for await (const event of l0Result.stream) {
      // Collect tokens for validation
      if (event.type === "token" && event.value) {
        rawOutput += event.value;
      } else if (event.type === "error") {
        errors.push(event.error || new Error("Unknown error"));
      }
      // Yield the event to the consumer
      yield event;
    }
    streamResolve();
  };

  // Create the stream generator once
  const sharedStream = teedStream();

  // Create validation promise that resolves after stream is consumed
  const resultPromise = (async (): Promise<StructuredResult<z.infer<T>>> => {
    // Wait for stream to be fully consumed
    await streamDone;

    // Validate the collected output
    if (!rawOutput || rawOutput.trim().length === 0) {
      throw new Error("No output received from model");
    }

    // Auto-correct and parse
    let processed = rawOutput;
    appliedCorrections = [];

    if (autoCorrect) {
      const correctionResult = autoCorrectJSON(processed, {
        structural: true,
        stripFormatting: true,
        schemaBased: false,
        strict: strictMode,
      });

      if (correctionResult.corrections.length > 0) {
        wasAutoCorrected = true;
        processed = correctionResult.corrected;
        appliedCorrections = correctionResult.corrections;
        autoCorrections++;
        correctionTypes.push(...correctionResult.corrections);

        if (onAutoCorrect) {
          onAutoCorrect({
            original: rawOutput,
            corrected: processed,
            corrections: correctionResult.corrections,
            success: correctionResult.success,
          });
        }
      }
    }

    // Parse JSON
    let parsedData: unknown;
    try {
      parsedData = JSON.parse(processed);
    } catch (parseError) {
      // Try extraction
      const extracted = extractJSON(processed);
      if (extracted !== processed) {
        try {
          parsedData = JSON.parse(extracted);
          wasAutoCorrected = true;
          appliedCorrections.push("extract_json");
        } catch {
          throw new Error(`Invalid JSON: ${parseError}`);
        }
      } else {
        throw new Error(`Invalid JSON: ${parseError}`);
      }
    }

    // Validate against schema
    validationAttempts++;
    const validationResult = schema.safeParse(parsedData);

    if (!validationResult.success) {
      validationFailures++;
      validationErrors.push(validationResult.error);

      if (onValidationError) {
        onValidationError(validationResult.error, validationAttempts);
      }

      throw new Error(
        `Schema validation failed: ${validationResult.error.errors[0]?.message}`,
      );
    }

    // Build result
    const structuredState: StructuredState = {
      ...l0Result.state,
      validationFailures,
      autoCorrections,
      validationErrors,
    };

    return {
      data: validationResult.data,
      raw: rawOutput,
      corrected: wasAutoCorrected,
      corrections: appliedCorrections,
      state: structuredState,
      telemetry: l0Result.telemetry
        ? {
            ...l0Result.telemetry,
            structured: {
              schemaName: schema.description || "unknown",
              validationAttempts,
              validationFailures,
              autoCorrections,
              correctionTypes: Array.from(new Set(correctionTypes)),
              validationSuccess: true,
            },
          }
        : undefined,
      errors,
      abort: () => abortController.abort(),
    };
  })();

  return {
    stream: sharedStream,
    result: resultPromise,
    abort: () => abortController.abort(),
  };
}
