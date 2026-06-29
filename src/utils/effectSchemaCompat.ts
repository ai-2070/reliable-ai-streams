// Effect Schema Compatibility Layer
//
// L0 supports Effect Schema (from the `effect` package, v3.10+).
// This module provides type-safe abstractions for working with Effect schemas.
//
// Effect Schema key differences from Zod:
// - Schema<Type, Encoded, Context> - three type parameters
// - Uses S.decodeUnknownSync/S.decodeUnknownEither for parsing
// - Schema.Type extracts the decoded type
// - Errors are ParseError instances
//
// L0 uses Effect Schema for:
// 1. Type inference (Schema.Type)
// 2. Schema validation (decodeUnknownSync/decodeUnknownEither)
// 3. ParseError handling

/**
 * Minimal type representing an Effect Schema.
 * This allows L0 to work with Effect schemas without requiring effect as a dependency.
 */
export interface EffectSchema<A = unknown, I = unknown, R = never> {
  readonly Type: A;
  readonly Encoded: I;
  readonly Context: R;
  readonly ast: unknown;
  readonly annotations: unknown;
}

/**
 * Minimal type for Effect ParseError
 */
export interface EffectParseError {
  readonly _tag: "ParseError";
  readonly issue: unknown;
  message: string;
}

/**
 * Result type for Effect Schema parsing
 */
export type EffectParseResult<A> =
  | { readonly _tag: "Right"; readonly right: A }
  | { readonly _tag: "Left"; readonly left: EffectParseError };

/**
 * Check if a value is an Effect Schema.
 * Works with Effect v3.10+ where Schema is part of the core package.
 */
export function isEffectSchema(value: unknown): value is EffectSchema {
  if (!value) return false;

  // Effect schemas can be functions or objects
  if (typeof value !== "object" && typeof value !== "function") return false;

  const schema = value as Record<string, unknown>;

  // Effect schemas have ast property and pipe method
  // The ast property contains the schema's AST representation
  return (
    "ast" in schema &&
    schema.ast !== undefined &&
    typeof schema.pipe === "function"
  );
}

/**
 * Check if an error is an Effect ParseError.
 */
export function isEffectParseError(error: unknown): error is EffectParseError {
  if (!error || typeof error !== "object") return false;

  const err = error as Record<string, unknown>;
  return err._tag === "ParseError" && "issue" in err;
}

/**
 * Check if a result is an Effect Either Right (success).
 */
export function isEffectRight<A>(
  result: EffectParseResult<A>,
): result is { readonly _tag: "Right"; readonly right: A } {
  return result._tag === "Right";
}

/**
 * Check if a result is an Effect Either Left (failure).
 */
export function isEffectLeft<A>(
  result: EffectParseResult<A>,
): result is { readonly _tag: "Left"; readonly left: EffectParseError } {
  return result._tag === "Left";
}

/**
 * Type helper to extract the decoded type from an Effect Schema.
 */
export type InferEffectSchema<S extends EffectSchema> = S["Type"];

/**
 * Type helper to extract the encoded type from an Effect Schema.
 */
export type InferEffectSchemaEncoded<S extends EffectSchema> = S["Encoded"];

/**
 * Options for Effect Schema decoding
 */
export interface EffectDecodeOptions {
  /** Called when a decoding error occurs */
  onError?: (error: EffectParseError) => void;
}

/**
 * Adapter interface for Effect Schema operations.
 * Users provide this to enable Effect Schema support in L0.
 */
export interface EffectSchemaAdapter {
  /**
   * Decode unknown data with the schema, throwing on error.
   */
  decodeUnknownSync: <A, I, R>(
    schema: EffectSchema<A, I, R>,
    data: unknown,
  ) => A;

  /**
   * Decode unknown data with the schema, returning Either.
   */
  decodeUnknownEither: <A, I, R>(
    schema: EffectSchema<A, I, R>,
    data: unknown,
  ) => EffectParseResult<A>;

  /**
   * Format a ParseError into a human-readable message.
   */
  formatError: (error: EffectParseError) => string;
}

// Global adapter storage
let effectAdapter: EffectSchemaAdapter | null = null;

/**
 * Register an Effect Schema adapter.
 * Call this once at app startup to enable Effect Schema support.
 *
 * @example
 * ```typescript
 * import { Schema } from "effect";
 * import { registerEffectSchemaAdapter } from "reliable-ai-streams";
 *
 * registerEffectSchemaAdapter({
 *   decodeUnknownSync: (schema, data) => Schema.decodeUnknownSync(schema)(data),
 *   decodeUnknownEither: (schema, data) => Schema.decodeUnknownEither(schema)(data),
 *   formatError: (error) => error.message,
 * });
 * ```
 */
export function registerEffectSchemaAdapter(
  adapter: EffectSchemaAdapter,
): void {
  effectAdapter = adapter;
}

/**
 * Unregister the Effect Schema adapter.
 */
export function unregisterEffectSchemaAdapter(): void {
  effectAdapter = null;
}

/**
 * Check if an Effect Schema adapter is registered.
 */
export function hasEffectSchemaAdapter(): boolean {
  return effectAdapter !== null;
}

/**
 * Get the registered Effect Schema adapter.
 * Throws if no adapter is registered.
 */
export function getEffectSchemaAdapter(): EffectSchemaAdapter {
  if (!effectAdapter) {
    throw new Error(
      "Effect Schema adapter not registered. Call registerEffectSchemaAdapter() first.",
    );
  }
  return effectAdapter;
}

/**
 * Safely decode data with an Effect Schema.
 * Returns a normalized result compatible with L0's error handling.
 */
export function safeDecodeEffectSchema<A, I, R>(
  schema: EffectSchema<A, I, R>,
  data: unknown,
): { success: true; data: A } | { success: false; error: EffectParseError } {
  const adapter = getEffectSchemaAdapter();
  const result = adapter.decodeUnknownEither(schema, data);

  if (isEffectRight(result)) {
    return { success: true, data: result.right };
  } else {
    return { success: false, error: result.left };
  }
}

/**
 * Get formatted error messages from an Effect ParseError.
 */
export function getEffectErrorMessage(error: EffectParseError): string {
  if (effectAdapter) {
    return effectAdapter.formatError(error);
  }
  return error.message || "Schema validation failed";
}

/**
 * Create a unified schema wrapper that works with both Zod and Effect schemas.
 * This allows L0's structured() function to accept either schema type.
 */
export interface UnifiedSchema<T = unknown> {
  readonly _tag: "zod" | "effect";
  parse(data: unknown): T;
  safeParse(
    data: unknown,
  ): { success: true; data: T } | { success: false; error: Error };
}

/**
 * Wrap an Effect Schema in a unified interface.
 */
export function wrapEffectSchema<A, I, R>(
  schema: EffectSchema<A, I, R>,
): UnifiedSchema<A> {
  return {
    _tag: "effect",
    parse(data: unknown): A {
      const adapter = getEffectSchemaAdapter();
      return adapter.decodeUnknownSync(schema, data);
    },
    safeParse(
      data: unknown,
    ): { success: true; data: A } | { success: false; error: Error } {
      const result = safeDecodeEffectSchema(schema, data);
      if (result.success) {
        return { success: true, data: result.data };
      } else {
        return {
          success: false,
          error: new Error(getEffectErrorMessage(result.error)),
        };
      }
    },
  };
}
