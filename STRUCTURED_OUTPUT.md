# Structured Output Guide

Guaranteed valid JSON matching your schema. Supports Zod, Effect Schema, and JSON Schema.

> **Bundle size tip:** For smaller bundles, use subpath imports:
>
> ```typescript
> import { structured, structuredStream } from "reliable-ai-streams/structured";
> ```

## Quick Start

```typescript
import { structured } from "reliable-ai-streams";
import { z } from "zod";

const schema = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string().email(),
});

const result = await structured({
  schema,
  stream: () =>
    streamText({
      model: openai("gpt-4o"),
      prompt: "Generate a user profile as JSON",
    }),
});

// Type-safe access
console.log(result.data.name); // string
console.log(result.data.age); // number
```

---

## Features

| Feature           | Description                                               |
| ----------------- | --------------------------------------------------------- |
| Schema validation | Zod, Effect Schema, and JSON Schema support               |
| Auto-correction   | Fixes trailing commas, missing braces, markdown fences    |
| Retry on failure  | Automatic retry when validation fails                     |
| Fallback models   | Try cheaper models if primary fails                       |
| Type safety       | Full TypeScript inference from schema                     |
| Helper functions  | `structuredObject`, `structuredArray` for common patterns |

---

## API

### structured(options)

```typescript
const result = await structured({
  // Required
  schema: z.object({ ... }),       // Zod, Effect, or wrapped JSON Schema
  stream: () => streamText({ model, prompt }),

  // Optional
  fallbackStreams: [...],          // Fallback model streams
  autoCorrect: true,               // Fix common JSON issues (default: true)
  strictMode: false,               // Reject unknown fields (default: false)
  retry: { attempts: 2 },          // Retry on validation failure (default: 2)
  detectZeroTokens: false,         // Detect zero-token outputs (default: false)

  // Timeout
  timeout: {
    initialToken: 6000,            // Max wait for first token (default: 6000ms)
    interToken: 5000,              // Max gap between tokens (default: 5000ms)
  },

  // Monitoring
  monitoring: {
    enabled: false,                // Enable telemetry (default: false)
    sampleRate: 1.0,               // Sample rate (default: 1.0)
    metadata: {},                  // Custom metadata
  },

  // Callbacks
  onValidationError: (error, attempt) => {},
  onAutoCorrect: (info) => {},
  onRetry: (attempt, reason) => {},
});

// Result
result.data          // Validated data (typed)
result.raw           // Raw JSON string
result.corrected     // boolean - was auto-corrected
result.corrections   // string[] - corrections applied
result.state         // StructuredState with validation metrics
result.telemetry     // StructuredTelemetry (if monitoring enabled)
result.errors        // Error[] - errors during retries
result.abort         // () => void - abort function
```

### structuredStream(options)

Stream tokens with validation at the end:

```typescript
const { stream, result, abort } = await structuredStream({
  schema,
  stream: () => streamText({ model, prompt }),
});

for await (const event of stream) {
  if (event.type === "token") process.stdout.write(event.value);
}

const validated = await result;
console.log(validated.data);
```

### structuredObject(shape, options)

Helper for creating object schemas inline:

```typescript
const result = await structuredObject(
  {
    amount: z.number(),
    approved: z.boolean(),
  },
  {
    stream: () => streamText({ model, prompt }),
  },
);
```

### structuredArray(itemSchema, options)

Helper for creating array schemas:

```typescript
const result = await structuredArray(z.object({ name: z.string() }), {
  stream: () => streamText({ model, prompt }),
});
```

---

## Auto-Correction

Automatically fixes common LLM JSON issues:

| Issue              | Example                  | Fixed               |
| ------------------ | ------------------------ | ------------------- |
| Missing brace      | `{"name": "Alice"`       | `{"name": "Alice"}` |
| Missing bracket    | `[1, 2, 3`               | `[1, 2, 3]`         |
| Trailing comma     | `{"a": 1,}`              | `{"a": 1}`          |
| Markdown fence     | ` ```json {...} ``` `    | `{...}`             |
| Text prefix        | `Sure! {"a": 1}`         | `{"a": 1}`          |
| Single quotes      | `{'a': 1}`               | `{"a": 1}`          |
| Comments           | `{"a": 1 /* comment */}` | `{"a": 1}`          |
| Control characters | Unescaped newlines       | Escaped properly    |

### Correction Types

All correction types that can be applied:

- `close_brace` - Added missing closing brace
- `close_bracket` - Added missing closing bracket
- `remove_trailing_comma` - Removed trailing comma
- `strip_markdown_fence` - Removed markdown code fence
- `strip_json_prefix` - Removed "json" prefix
- `remove_prefix_text` - Removed text before JSON
- `remove_suffix_text` - Removed text after JSON
- `fix_quotes` - Fixed quote issues
- `remove_comments` - Removed JSON comments
- `escape_control_chars` - Escaped control characters
- `fill_missing_fields` - Added missing required fields
- `remove_unknown_fields` - Removed unknown fields (strict mode)
- `coerce_types` - Coerced types to match schema
- `extract_json` - Extracted JSON from surrounding text

```typescript
const result = await structured({
  schema,
  stream,
  autoCorrect: true,
  onAutoCorrect: (info) => {
    console.log("Original:", info.original);
    console.log("Corrected:", info.corrected);
    console.log("Corrections:", info.corrections);
    console.log("Success:", info.success);
  },
});

if (result.corrected) {
  console.log("Fixes applied:", result.corrections);
}
```

---

## Schema Support

### Zod (Default)

```typescript
import { z } from "zod";
import { structured } from "reliable-ai-streams";

const schema = z.object({
  name: z.string(),
  age: z.number(),
});

const result = await structured({ schema, stream });
```

### Effect Schema

L0 supports Effect Schema (v3.10+) via an adapter:

```typescript
import { Schema } from "effect";
import {
  structured,
  registerEffectSchemaAdapter,
  wrapEffectSchema,
} from "reliable-ai-streams";

// Register the adapter once at app startup
registerEffectSchemaAdapter({
  decodeUnknownSync: (schema, data) => Schema.decodeUnknownSync(schema)(data),
  decodeUnknownEither: (schema, data) =>
    Schema.decodeUnknownEither(schema)(data),
  formatError: (error) => error.message,
});

// Define your schema
const UserSchema = Schema.Struct({
  name: Schema.String,
  age: Schema.Number,
});

// Use with structured()
const result = await structured({
  schema: wrapEffectSchema(UserSchema),
  stream: () => streamText({ model, prompt }),
});
```

### JSON Schema

L0 supports JSON Schema via an adapter:

```typescript
import Ajv from "ajv";
import {
  structured,
  registerJSONSchemaAdapter,
  wrapJSONSchema,
} from "reliable-ai-streams";

// Register the adapter once at app startup
const ajv = new Ajv({ allErrors: true });

registerJSONSchemaAdapter({
  validate: (schema, data) => {
    const validate = ajv.compile(schema);
    const valid = validate(data);
    if (valid) {
      return { valid: true, data };
    }
    return {
      valid: false,
      errors: (validate.errors || []).map((e) => ({
        path: e.instancePath || "/",
        message: e.message || "Validation failed",
        keyword: e.keyword,
        params: e.params,
      })),
    };
  },
  formatErrors: (errors) =>
    errors.map((e) => `${e.path}: ${e.message}`).join(", "),
});

// Define your schema
const userSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    age: { type: "number" },
  },
  required: ["name", "age"],
};

// Use with structured()
const result = await structured({
  schema: wrapJSONSchema<{ name: string; age: number }>(userSchema),
  stream: () => streamText({ model, prompt }),
});
```

### Simple JSON Schema Adapter

For basic validation without Ajv, L0 provides a built-in simple adapter:

```typescript
import {
  registerJSONSchemaAdapter,
  createSimpleJSONSchemaAdapter,
  wrapJSONSchema,
} from "reliable-ai-streams";

// Use the built-in simple adapter
registerJSONSchemaAdapter(createSimpleJSONSchemaAdapter());

const result = await structured({
  schema: wrapJSONSchema<{ name: string }>(schema),
  stream,
});
```

---

## Zod Schema Examples

### Basic Types

```typescript
z.object({
  name: z.string(),
  age: z.number(),
  active: z.boolean(),
  status: z.enum(["pending", "approved", "rejected"]),
});
```

### Optional & Nullable

```typescript
z.object({
  name: z.string(),
  nickname: z.string().optional(),
  middleName: z.string().nullable(),
});
```

### Nested Objects

```typescript
z.object({
  user: z.object({
    name: z.string(),
    email: z.string().email(),
  }),
  metadata: z.record(z.string()),
});
```

### Arrays

```typescript
z.object({
  tags: z.array(z.string()),
  items: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
    }),
  ),
});
```

### Validation Constraints

```typescript
z.object({
  amount: z.number().positive().max(10000),
  email: z.string().email(),
  url: z.string().url(),
  score: z.number().min(0).max(100),
});
```

---

## Fallback Models

```typescript
const result = await structured({
  schema,
  stream: () => streamText({ model: openai("gpt-5-mini"), prompt }),
  fallbackStreams: [
    () => streamText({ model: openai("gpt-4o"), prompt }),
    () => streamText({ model: anthropic("claude-3-haiku"), prompt }),
  ],
});

if (result.state.fallbackIndex > 0) {
  console.log("Used fallback model");
}
```

---

## Error Handling

```typescript
try {
  const result = await structured({
    schema,
    stream,
    retry: { attempts: 3 },
    onValidationError: (error, attempt) => {
      console.log(`Attempt ${attempt} failed:`, error.errors);
    },
  });
} catch (error) {
  // All retries exhausted
  console.error("Validation failed:", error.message);
}
```

---

## State and Telemetry

### StructuredState

Extended L0 state with validation metrics:

```typescript
interface StructuredState extends L0State {
  validationFailures: number; // Number of validation failures
  autoCorrections: number; // Number of auto-corrections applied
  validationErrors: z.ZodError[]; // Schema validation errors encountered
}
```

### StructuredTelemetry

Extended telemetry with structured-specific metrics:

```typescript
interface StructuredTelemetry extends L0Telemetry {
  structured: {
    schemaName?: string; // Schema name or description
    validationAttempts: number; // Number of validation attempts
    validationFailures: number; // Number of validation failures
    autoCorrections: number; // Number of auto-corrections applied
    correctionTypes: string[]; // Types of corrections applied
    validationSuccess: boolean; // Final validation success
    validationTime?: number; // Time spent on validation (ms)
  };
}
```

---

## Presets

L0 provides configuration presets:

```typescript
import {
  minimalStructured,
  recommendedStructured,
  strictStructured,
} from "reliable-ai-streams";

// Minimal - fast failure, no corrections
const result = await structured({
  schema,
  stream,
  ...minimalStructured,
});

// Recommended - balanced reliability and performance (default-like)
const result = await structured({
  schema,
  stream,
  ...recommendedStructured,
});

// Strict - maximum validation, auto-correction, retries
const result = await structured({
  schema,
  stream,
  ...strictStructured,
});
```

### Preset Details

| Preset      | autoCorrect | strictMode | attempts | backoff      |
| ----------- | ----------- | ---------- | -------- | ------------ |
| minimal     | false       | false      | 1        | fixed        |
| recommended | true        | false      | 2        | fixed-jitter |
| strict      | true        | true       | 3        | fixed-jitter |

---

## Best Practices

1. **Enable auto-correction** - Handles common LLM quirks
2. **Add fallback models** - Increases reliability
3. **Keep schemas focused** - Simpler schemas validate more reliably
4. **Monitor corrections** - Track what gets auto-corrected
5. **Use retry** - Transient failures are common
6. **Set `detectZeroTokens: false`** - Default for structured output since valid JSON like `[]` or `{}` is acceptable

```typescript
// Recommended configuration
const result = await structured({
  schema,
  stream: () => streamText({ model, prompt }),
  autoCorrect: true,
  retry: { attempts: 2 },
  fallbackStreams: [() => streamText({ model: fallbackModel, prompt })],
  onValidationError: (error, attempt) => {
    logger.warn("Validation failed", { attempt, errors: error.errors });
  },
});
```

---

## See Also

- [API.md](./API.md) - Complete API reference
- [QUICKSTART.md](./QUICKSTART.md) - Getting started
- [ERROR_HANDLING.md](./ERROR_HANDLING.md) - Error handling guide
