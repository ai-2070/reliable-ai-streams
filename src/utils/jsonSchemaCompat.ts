// JSON Schema Compatibility Layer
//
// L0 supports JSON Schema validation via user-provided validators.
// This module provides type-safe abstractions for working with JSON Schema.
//
// JSON Schema is a standard for describing JSON data structures.
// Popular validators: Ajv, json-schema-to-ts, typebox, etc.
//
// L0 uses JSON Schema for:
// 1. Schema validation (via user-provided validate function)
// 2. Error handling (via user-provided error formatting)

/**
 * JSON Schema definition type.
 * Follows the JSON Schema specification.
 */
export interface JSONSchemaDefinition {
  $schema?: string;
  $id?: string;
  $ref?: string;
  type?: string | string[];
  properties?: Record<string, JSONSchemaDefinition>;
  required?: string[];
  items?: JSONSchemaDefinition | JSONSchemaDefinition[];
  additionalProperties?: boolean | JSONSchemaDefinition;
  enum?: unknown[];
  const?: unknown;
  allOf?: JSONSchemaDefinition[];
  anyOf?: JSONSchemaDefinition[];
  oneOf?: JSONSchemaDefinition[];
  not?: JSONSchemaDefinition;
  if?: JSONSchemaDefinition;
  then?: JSONSchemaDefinition;
  else?: JSONSchemaDefinition;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  default?: unknown;
  description?: string;
  title?: string;
  [key: string]: unknown;
}

/**
 * Validation error from JSON Schema validation
 */
export interface JSONSchemaValidationError {
  path: string;
  message: string;
  keyword?: string;
  params?: Record<string, unknown>;
}

/**
 * Result type for JSON Schema validation
 */
export type JSONSchemaValidationResult<T = unknown> =
  | { valid: true; data: T }
  | { valid: false; errors: JSONSchemaValidationError[] };

/**
 * Adapter interface for JSON Schema validation.
 * Users provide this to enable JSON Schema support in L0.
 */
export interface JSONSchemaAdapter {
  /**
   * Validate data against a JSON Schema.
   * @param schema - The JSON Schema definition
   * @param data - The data to validate
   * @returns Validation result with typed data or errors
   */
  validate: <T = unknown>(
    schema: JSONSchemaDefinition,
    data: unknown,
  ) => JSONSchemaValidationResult<T>;

  /**
   * Format validation errors into human-readable messages.
   * @param errors - Array of validation errors
   * @returns Formatted error message
   */
  formatErrors: (errors: JSONSchemaValidationError[]) => string;
}

// Global adapter storage
let jsonSchemaAdapter: JSONSchemaAdapter | null = null;

/**
 * Register a JSON Schema adapter.
 * Call this once at app startup to enable JSON Schema support.
 *
 * @example
 * ```typescript
 * import Ajv from "ajv";
 * import { registerJSONSchemaAdapter } from "reliable-ai-streams";
 *
 * const ajv = new Ajv({ allErrors: true });
 *
 * registerJSONSchemaAdapter({
 *   validate: (schema, data) => {
 *     const validate = ajv.compile(schema);
 *     const valid = validate(data);
 *     if (valid) {
 *       return { valid: true, data };
 *     }
 *     return {
 *       valid: false,
 *       errors: (validate.errors || []).map(e => ({
 *         path: e.instancePath || "/",
 *         message: e.message || "Validation failed",
 *         keyword: e.keyword,
 *         params: e.params,
 *       })),
 *     };
 *   },
 *   formatErrors: (errors) => errors.map(e => `${e.path}: ${e.message}`).join(", "),
 * });
 * ```
 */
export function registerJSONSchemaAdapter(adapter: JSONSchemaAdapter): void {
  jsonSchemaAdapter = adapter;
}

/**
 * Unregister the JSON Schema adapter.
 */
export function unregisterJSONSchemaAdapter(): void {
  jsonSchemaAdapter = null;
}

/**
 * Check if a JSON Schema adapter is registered.
 */
export function hasJSONSchemaAdapter(): boolean {
  return jsonSchemaAdapter !== null;
}

/**
 * Get the registered JSON Schema adapter.
 * Throws if no adapter is registered.
 */
export function getJSONSchemaAdapter(): JSONSchemaAdapter {
  if (!jsonSchemaAdapter) {
    throw new Error(
      "JSON Schema adapter not registered. Call registerJSONSchemaAdapter() first.",
    );
  }
  return jsonSchemaAdapter;
}

/**
 * Check if a value looks like a JSON Schema definition.
 */
export function isJSONSchema(value: unknown): value is JSONSchemaDefinition {
  if (!value || typeof value !== "object") return false;

  const schema = value as Record<string, unknown>;

  // JSON Schema typically has type, properties, or $schema
  return (
    "$schema" in schema ||
    "type" in schema ||
    "properties" in schema ||
    "$ref" in schema ||
    "allOf" in schema ||
    "anyOf" in schema ||
    "oneOf" in schema
  );
}

/**
 * Validate data against a JSON Schema.
 * Returns a normalized result compatible with L0's error handling.
 */
export function validateJSONSchema<T = unknown>(
  schema: JSONSchemaDefinition,
  data: unknown,
): { success: true; data: T } | { success: false; error: Error } {
  const adapter = getJSONSchemaAdapter();
  const result = adapter.validate<T>(schema, data);

  if (result.valid) {
    return { success: true, data: result.data };
  } else {
    const message = adapter.formatErrors(result.errors);
    return { success: false, error: new Error(message) };
  }
}

/**
 * Unified schema wrapper that works with Zod, Effect, and JSON Schema.
 */
export interface UnifiedSchema<T = unknown> {
  readonly _tag: "zod" | "effect" | "jsonschema";
  parse(data: unknown): T;
  safeParse(
    data: unknown,
  ): { success: true; data: T } | { success: false; error: Error };
}

/**
 * Wrap a JSON Schema in a unified interface for use with structured().
 *
 * @example
 * ```typescript
 * const schema = {
 *   type: "object",
 *   properties: {
 *     name: { type: "string" },
 *     age: { type: "number" },
 *   },
 *   required: ["name", "age"],
 * };
 *
 * const result = await structured({
 *   schema: wrapJSONSchema<{ name: string; age: number }>(schema),
 *   stream: () => streamText({ model, prompt }),
 * });
 * ```
 */
export function wrapJSONSchema<T = unknown>(
  schema: JSONSchemaDefinition,
): UnifiedSchema<T> {
  return {
    _tag: "jsonschema",
    parse(data: unknown): T {
      const result = validateJSONSchema<T>(schema, data);
      if (result.success) {
        return result.data;
      }
      throw result.error;
    },
    safeParse(
      data: unknown,
    ): { success: true; data: T } | { success: false; error: Error } {
      return validateJSONSchema<T>(schema, data);
    },
  };
}

/**
 * Create a simple in-memory JSON Schema adapter for basic validation.
 * This is a minimal implementation for simple schemas without external dependencies.
 * For production use, prefer Ajv or another full-featured validator.
 */
export function createSimpleJSONSchemaAdapter(): JSONSchemaAdapter {
  return {
    validate: <T>(
      schema: JSONSchemaDefinition,
      data: unknown,
    ): JSONSchemaValidationResult<T> => {
      const errors: JSONSchemaValidationError[] = [];

      function validateValue(
        s: JSONSchemaDefinition,
        value: unknown,
        path: string,
      ): void {
        // Type validation
        if (s.type) {
          const types = Array.isArray(s.type) ? s.type : [s.type];
          const actualType = getJSONType(value);
          // JSON Schema "integer" is a subtype of "number" - check if value is an integer
          const typeMatches = types.some((t) => {
            if (t === actualType) return true;
            if (t === "integer" && actualType === "number") {
              return Number.isInteger(value);
            }
            return false;
          });
          if (!typeMatches) {
            errors.push({
              path,
              message: `Expected ${types.join(" or ")}, got ${actualType}`,
              keyword: "type",
            });
            return;
          }
        }

        // Enum validation
        if (s.enum && !s.enum.includes(value)) {
          errors.push({
            path,
            message: `Value must be one of: ${s.enum.join(", ")}`,
            keyword: "enum",
          });
        }

        // Const validation
        if (s.const !== undefined && value !== s.const) {
          errors.push({
            path,
            message: `Value must be ${JSON.stringify(s.const)}`,
            keyword: "const",
          });
        }

        // Object validation
        if (
          s.type === "object" &&
          typeof value === "object" &&
          value !== null
        ) {
          const obj = value as Record<string, unknown>;

          // Required properties
          if (s.required) {
            for (const prop of s.required) {
              if (!(prop in obj)) {
                errors.push({
                  path: `${path}/${prop}`,
                  message: `Missing required property: ${prop}`,
                  keyword: "required",
                });
              }
            }
          }

          // Property validation
          if (s.properties) {
            for (const [key, propSchema] of Object.entries(s.properties)) {
              if (key in obj) {
                validateValue(propSchema, obj[key], `${path}/${key}`);
              }
            }
          }
        }

        // Array validation
        if (s.type === "array" && Array.isArray(value)) {
          if (s.items && !Array.isArray(s.items)) {
            value.forEach((item, index) => {
              validateValue(
                s.items as JSONSchemaDefinition,
                item,
                `${path}/${index}`,
              );
            });
          }
        }

        // String validation
        if (s.type === "string" && typeof value === "string") {
          if (s.minLength !== undefined && value.length < s.minLength) {
            errors.push({
              path,
              message: `String must be at least ${s.minLength} characters`,
              keyword: "minLength",
            });
          }
          if (s.maxLength !== undefined && value.length > s.maxLength) {
            errors.push({
              path,
              message: `String must be at most ${s.maxLength} characters`,
              keyword: "maxLength",
            });
          }
          if (s.pattern) {
            const regex = new RegExp(s.pattern);
            if (!regex.test(value)) {
              errors.push({
                path,
                message: `String must match pattern: ${s.pattern}`,
                keyword: "pattern",
              });
            }
          }
        }

        // Number validation
        if (s.type === "number" && typeof value === "number") {
          if (s.minimum !== undefined && value < s.minimum) {
            errors.push({
              path,
              message: `Number must be >= ${s.minimum}`,
              keyword: "minimum",
            });
          }
          if (s.maximum !== undefined && value > s.maximum) {
            errors.push({
              path,
              message: `Number must be <= ${s.maximum}`,
              keyword: "maximum",
            });
          }
        }
      }

      validateValue(schema, data, "");

      if (errors.length === 0) {
        return { valid: true, data: data as T };
      }
      return { valid: false, errors };
    },

    formatErrors: (errors: JSONSchemaValidationError[]): string => {
      return errors.map((e) => `${e.path || "/"}: ${e.message}`).join("; ");
    },
  };
}

/**
 * Get the JSON type of a value.
 */
function getJSONType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
