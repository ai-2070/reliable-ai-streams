# Contributing to L0

Thank you for your interest in contributing to L0! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Scope Policy](#scope-policy)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Making Changes](#making-changes)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Coding Standards](#coding-standards)
- [Adding New Features](#adding-new-features)

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for all contributors.

## Scope Policy

L0 does not accept integrations, drivers, storage adapters, or external service bindings into the core repository. These must live in separate repositories, maintained by their authors.

All adapters must be maintained out-of-tree. The L0 core will remain small, dependency-free, and integration-agnostic.

**What belongs in core:**

- Runtime features (retry, fallback, continuation, drift detection)
- Guardrail rules and engine
- Format helpers
- Type definitions
- Core utilities

**What belongs in separate repos:**

- Database adapters (Redis, PostgreSQL, MongoDB, etc.)
- Cloud service integrations (AWS, GCP, Azure)
- Monitoring backends (Datadog, custom exporters, etc.)
- LLM provider-specific extensions

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/ai-2070/reliable-ai-streams.git
   cd reliable-ai-streams
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Create a branch** for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## Development Setup

### Prerequisites

- Node.js 18.0.0 or higher
- npm, yarn, or pnpm
- TypeScript 5.3+

### Build the project

```bash
npm run build
```

### Watch mode (for development)

```bash
npm run dev
```

### Run tests

```bash
npm test
```

## Project Structure

```
src/
├── index.ts           # Main entry point
├── types/             # TypeScript type definitions
├── runtime/           # Core runtime (l0, retry, drift, etc.)
├── guardrails/        # Guardrail rules and engine
├── format/            # Format helpers
└── utils/             # Utility functions
```

## Making Changes

### 1. Choose what to work on

- Check [GitHub Issues](https://github.com/ai-2070/reliable-ai-streams/issues)
- Look for issues labeled `good first issue` or `help wanted`
- Discuss major changes in an issue first

### 2. Write your code

- Follow the [Coding Standards](#coding-standards)
- Add TypeScript types for all public APIs
- Include JSDoc comments for functions
- Keep functions small and focused

### 3. Test your changes

- Add tests for new functionality
- Ensure existing tests pass
- Test with real LLM APIs if possible

## Testing

### Unit Tests

Place tests in `tests/` directory with `.test.ts` extension:

```typescript
// tests/guardrails/json.test.ts
import { jsonRule } from "../../src/guardrails/json";

describe("jsonRule", () => {
  it("should detect unbalanced braces", () => {
    const rule = jsonRule();
    const violations = rule.check({
      content: '{"name": "Alice"',
      isComplete: true,
      tokenCount: 10,
    });
    expect(violations.length).toBeGreaterThan(0);
  });
});
```

### Integration Tests

Test full L0 workflows:

```typescript
import { l0, recommendedGuardrails } from "../../src";

describe("l0 integration", () => {
  it("should handle streaming with guardrails", async () => {
    const result = await l0({
      stream: () => mockStream('{"test": true}'),
      guardrails: recommendedGuardrails,
    });

    // Consume stream and verify
  });
});
```

## Submitting Changes

### Before submitting

1. **Run tests**: `npm test`
2. **Build successfully**: `npm run build`
3. **Format code**: Follow TypeScript style guidelines
4. **Update documentation**: Update README.md or API.md if needed

### Pull Request Process

1. **Push your branch** to your fork:

   ```bash
   git push origin feature/your-feature-name
   ```

2. **Open a Pull Request** on GitHub:
   - Use a clear, descriptive title
   - Reference any related issues
   - Describe what changed and why
   - Include examples if applicable

3. **Respond to feedback**:
   - Address review comments
   - Push updates to your branch
   - Be open to suggestions

4. **Wait for approval**:
   - Maintainers will review your PR
   - CI checks must pass
   - At least one approval required

## Coding Standards

### TypeScript Style

```typescript
// Good: Clear types, JSDoc comments
/**
 * Check if content is meaningful
 * @param content - Content to check
 * @returns True if meaningful
 */
export function hasMeaningfulContent(content: string): boolean {
  if (!content) return false;
  return content.trim().length > 0;
}

// Bad: No types, no docs
export function check(c) {
  return c && c.trim().length > 0;
}
```

### Naming Conventions

- **Functions**: `camelCase` - `formatContext`, `detectDrift`
- **Classes**: `PascalCase` - `RetryManager`, `DriftDetector`
- **Constants**: `UPPER_SNAKE_CASE` - `BAD_PATTERNS`, `MAX_RETRIES`
- **Types/Interfaces**: `PascalCase` - `L0Options`, `GuardrailRule`
- **Files**: `camelCase.ts` - `retry.ts`, `zeroToken.ts`

### Code Organization

1. **Imports first**, in order:

   ```typescript
   // External imports
   import { something } from "external-package";

   // Type imports
   import type { MyType } from "./types";

   // Local imports
   import { helper } from "./utils";
   ```

2. **Types before implementation**:

   ```typescript
   export interface MyOptions {
     enabled: boolean;
   }

   export function myFunction(options: MyOptions) {
     // implementation
   }
   ```

3. **Export at declaration**:

   ```typescript
   // Good
   export function myFunction() {}

   // Avoid
   function myFunction() {}
   export { myFunction };
   ```

### Documentation

- All public functions need JSDoc comments
- Include `@param` and `@returns` tags
- Add `@example` for complex functions
- Keep descriptions concise but clear

Example:

````typescript
/**
 * Format tool/function definition in a model-friendly way
 *
 * @param tool - Tool definition
 * @param options - Formatting options
 * @returns Formatted tool definition string
 *
 * @example
 * ```typescript
 * const tool = createTool("get_weather", "Get weather", []);
 * const formatted = formatTool(tool, { style: "json-schema" });
 * ```
 */
export function formatTool(
  tool: ToolDefinition,
  options?: FormatToolOptions,
): string {
  // implementation
}
````

## Adding New Features

### Adding a Guardrail Rule

1. Create file in `src/guardrails/`:

   ```typescript
   // src/guardrails/myRule.ts
   import type {
     GuardrailRule,
     GuardrailContext,
     GuardrailViolation,
   } from "../types/guardrails";

   export function myRule(): GuardrailRule {
     return {
       name: "my-rule",
       description: "What this rule checks",
       check: (context: GuardrailContext) => {
         const violations: GuardrailViolation[] = [];
         // Your validation logic
         return violations;
       },
     };
   }
   ```

2. Add tests in `tests/guardrails/myRule.test.ts`

3. Export from `src/guardrails/index.ts`

4. Add to preset if appropriate

5. Document in API.md

### Adding a Format Helper

1. Create function in appropriate `src/format/` file

2. Add TypeScript types

3. Add JSDoc documentation

4. Export from `src/format/index.ts`

5. Add to main `src/index.ts` exports

6. Document in API.md with examples

### Adding a Utility Function

1. Add to appropriate `src/utils/` file

2. Keep functions pure (no side effects)

3. Add comprehensive tests

4. Export and document

## Types and Interfaces

- Always provide explicit types
- Avoid `any` - use `unknown` if needed
- Use `readonly` for immutable properties
- Use `Partial<T>` for optional config objects

```typescript
// Good
export interface MyConfig {
  readonly required: string;
  optional?: number;
}

export function process(config: MyConfig): string {
  // implementation
}

// Bad
export function process(config: any) {
  // implementation
}
```

## Error Handling

- Use specific Error subclasses when appropriate
- Provide clear error messages
- Include context in error messages

```typescript
if (!content || content.length === 0) {
  throw new Error("Content is required and cannot be empty");
}
```

## Performance Considerations

- Avoid unnecessary iterations
- Cache computed values when appropriate
- Use early returns to avoid deep nesting
- Consider memory usage for streaming operations

```typescript
// Good: Early return
export function check(content: string): boolean {
  if (!content) return false;
  if (content.length < 10) return false;
  return performExpensiveCheck(content);
}

// Bad: Nested conditions
export function check(content: string): boolean {
  if (content) {
    if (content.length >= 10) {
      return performExpensiveCheck(content);
    }
  }
  return false;
}
```

## Questions?

- Open a [GitHub Issue](https://github.com/ai-2070/reliable-ai-streams/issues)
- Start a [Discussion](https://github.com/ai-2070/reliable-ai-streams/discussions)
- Check existing issues and discussions

## Recognition

All contributors will be recognized in the project. Thank you for making L0 better!

---

Happy contributing! 🎉
