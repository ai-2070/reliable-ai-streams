# Guardrails

Guardrails are pure functions that validate streaming output without rewriting it. They detect issues and signal whether to retry.

## Quick Start

```typescript
import { l0 } from "reliable-ai-streams/core";
import { recommendedGuardrails } from "reliable-ai-streams/guardrails";

const result = await l0({
  stream: () => streamText({ model, prompt }),
  guardrails: recommendedGuardrails,
});
```

> **Note:** Guardrails are also available from the main `reliable-ai-streams` entry point for convenience. Use `reliable-ai-streams/guardrails` for smaller bundle sizes.

## Presets

```typescript
import {
  minimalGuardrails, // JSON + zero output
  recommendedGuardrails, // + Markdown, patterns
  strictGuardrails, // + LaTeX
  jsonOnlyGuardrails, // JSON + zero output
  markdownOnlyGuardrails, // Markdown + zero output
  latexOnlyGuardrails, // LaTeX + zero output
} from "reliable-ai-streams/guardrails";
```

---

## Built-in Rules

### JSON Rule

Validates JSON structure during streaming:

```typescript
import { jsonRule, strictJsonRule } from "reliable-ai-streams/guardrails";

jsonRule(); // Balanced braces/brackets, streaming-aware
strictJsonRule(); // + Must be parseable, root must be object/array
```

**Detects:**

- Unbalanced `{}` and `[]`
- Unclosed strings
- Multiple consecutive commas
- Malformed patterns like `{,` or `[,`

### Markdown Rule

Validates Markdown structure:

```typescript
import { markdownRule } from "reliable-ai-streams/guardrails";

markdownRule();
```

**Detects:**

- Unclosed code fences (```)
- Inconsistent table columns
- Mixed list types at same level
- Content ending mid-sentence

### LaTeX Rule

Validates LaTeX environments and math:

```typescript
import { latexRule } from "reliable-ai-streams/guardrails";

latexRule();
```

**Detects:**

- Unclosed `\begin{env}` environments
- Mismatched environment names
- Unbalanced `\[...\]` and `$$...$$`
- Unbalanced inline math `$...$`

### Zero Output Rule

Detects empty or meaningless output:

```typescript
import { zeroOutputRule } from "reliable-ai-streams/guardrails";

zeroOutputRule();
```

**Detects:**

- Empty output
- Whitespace-only output
- Punctuation-only output
- Repeated character noise
- Suspiciously instant completion

### Pattern Rule

Detects known bad patterns:

```typescript
import { patternRule, customPatternRule } from "reliable-ai-streams/guardrails";

patternRule(); // All built-in patterns

// Custom patterns
customPatternRule([/forbidden/i, /blocked/i], "Custom violation", "error");
```

**Built-in patterns:**

| Category             | Examples                                    |
| -------------------- | ------------------------------------------- |
| Meta commentary      | "As an AI...", "I'm an AI assistant"        |
| Hedging              | "Sure!", "Certainly!", "Of course!"         |
| Refusal              | "I cannot provide...", "I'm not able to..." |
| Instruction leak     | `[SYSTEM]`, `<\|im_start\|>`                |
| Placeholders         | `[INSERT ...]`, `{{placeholder}}`           |
| Format collapse      | "Here is the...", "Let me..."               |
| Repetition           | Same sentence repeated 3+ times             |
| First/last duplicate | First and last sentences identical          |

---

## Violation Severity

| Severity  | Behavior                     |
| --------- | ---------------------------- |
| `fatal`   | Halt immediately, no retry   |
| `error`   | Trigger retry if recoverable |
| `warning` | Log but continue             |

```typescript
interface GuardrailViolation {
  rule: string;
  message: string;
  severity: "fatal" | "error" | "warning";
  recoverable: boolean;
  position?: number;
  suggestion?: string;
  timestamp?: number;
  context?: Record<string, any>;
}
```

---

## Custom Rules

### Simple Rule

```typescript
import type { GuardrailRule } from "reliable-ai-streams/guardrails";

const noSwearing: GuardrailRule = {
  name: "no-swearing",
  description: "Blocks profanity",
  streaming: false, // Only check on complete
  severity: "error",
  recoverable: true,
  check: (context) => {
    const violations = [];
    if (/damn|hell/i.test(context.content)) {
      violations.push({
        rule: "no-swearing",
        message: "Profanity detected",
        severity: "error",
        recoverable: true,
      });
    }
    return violations;
  },
};

await l0({
  stream,
  guardrails: [...recommendedGuardrails, noSwearing],
});
```

### Streaming Rule

```typescript
const lengthLimit: GuardrailRule = {
  name: "length-limit",
  description: "Limits output length",
  streaming: true, // Check during streaming
  severity: "fatal",
  recoverable: false,
  check: (context) => {
    if (context.content.length > 10000) {
      return [
        {
          rule: "length-limit",
          message: "Output exceeds 10,000 characters",
          severity: "fatal",
          recoverable: false,
        },
      ];
    }
    return [];
  },
};
```

### Context Object

```typescript
interface GuardrailContext {
  content: string; // Full accumulated content
  checkpoint?: string; // Previous checkpoint content
  delta?: string; // Latest chunk (streaming)
  completed: boolean; // Stream finished?
  tokenCount: number; // Tokens received
  previousViolations?: GuardrailViolation[];
  metadata?: Record<string, any>;
}
```

---

## Guardrail Engine

For advanced use cases, use the engine directly:

```typescript
import {
  GuardrailEngine,
  createGuardrailEngine,
  checkGuardrails,
} from "reliable-ai-streams/guardrails";

// Create engine
const engine = createGuardrailEngine(recommendedGuardrails, {
  stopOnFatal: true,
  enableStreaming: true,
  checkInterval: 100,
  onViolation: (v) => console.log("Violation:", v.message),
});

// Check content
const result = engine.check({
  content: "...",
  completed: true,
  tokenCount: 100,
});

console.log(result.passed); // true/false
console.log(result.violations); // GuardrailViolation[]
console.log(result.shouldRetry); // true/false
console.log(result.shouldHalt); // true/false

// Or one-shot check
const result = checkGuardrails(context, rules);
```

### Engine Methods

```typescript
engine.check(context); // Run all rules
engine.addRule(rule); // Add rule
engine.removeRule("rule-name"); // Remove rule
engine.getState(); // Get current state
engine.reset(); // Reset state
engine.hasViolations(); // Any violations?
engine.hasFatalViolations(); // Any fatal?
engine.hasErrorViolations(); // Any errors?
engine.getViolationsByRule("json"); // Violations for rule
engine.getAllViolations(); // All violations
```

---

## Analysis Functions

Low-level analysis utilities available from the guardrails submodule:

````typescript
import { analyzeJsonStructure, looksLikeJson } from "reliable-ai-streams/guardrails";

import {
  analyzeMarkdownStructure,
  looksLikeMarkdown,
} from "reliable-ai-streams/guardrails";

import { analyzeLatexStructure, looksLikeLatex } from "reliable-ai-streams/guardrails";

import { isZeroOutput, isNoiseOnly } from "reliable-ai-streams/guardrails";

import { findBadPatterns, BAD_PATTERNS } from "reliable-ai-streams/guardrails";

// JSON analysis
const json = analyzeJsonStructure('{"a": 1');
console.log(json.isBalanced); // false
console.log(json.openBraces); // 1
console.log(json.closeBraces); // 0
console.log(json.issues); // ["Unbalanced braces..."]

// Markdown analysis
const md = analyzeMarkdownStructure("```js\ncode");
console.log(md.inFence); // true
console.log(md.openFences); // 1

// LaTeX analysis
const tex = analyzeLatexStructure("\\begin{equation}");
console.log(tex.openEnvironments); // ["equation"]
console.log(tex.isBalanced); // false

// Pattern detection
const matches = findBadPatterns(content, BAD_PATTERNS.META_COMMENTARY);
````

---

## Performance: Fast and Slow Paths

L0 uses a two-path strategy to avoid blocking the streaming loop:

### Fast Path (Synchronous)

Runs immediately on each chunk for quick checks:

- **Delta-only checks**: Only examines the latest chunk (`context.delta`)
- **Small content**: Full check if total content < 5KB
- **Instant violations**: Blocked words, obvious patterns

```typescript
// Fast path triggers for:
// - Delta < 1KB
// - Total content < 5KB
// - Any violation found in delta
```

### Slow Path (Asynchronous)

Deferred to `setImmediate()` to avoid blocking:

- **Large content**: Full content scan for content > 5KB
- **Complex rules**: Pattern matching, structure analysis
- **Non-blocking**: Results delivered via callback

```typescript
import {
  runAsyncGuardrailCheck,
  runGuardrailCheckAsync,
} from "reliable-ai-streams/guardrails";

// Fast/slow path with immediate result if possible
const result = runAsyncGuardrailCheck(engine, context, (asyncResult) => {
  // Called when slow path completes
  if (asyncResult.shouldHalt) {
    // Handle violation
  }
});

if (result) {
  // Fast path returned immediately
} else {
  // Deferred to async callback
}

// Always async version
runGuardrailCheckAsync(engine, context, (result) => {
  // Always called via setImmediate
});
```

### Rule Complexity

| Rule             | Complexity | When Checked                  |
| ---------------- | ---------- | ----------------------------- |
| `zeroOutputRule` | O(1)       | Fast path                     |
| `jsonRule`       | O(n)       | Scans full content            |
| `markdownRule`   | O(n)       | Scans full content            |
| `latexRule`      | O(n)       | Scans full content            |
| `patternRule`    | O(n × p)   | Scans full content × patterns |

For long outputs, increase `checkIntervals.guardrails` to reduce frequency:

```typescript
await l0({
  stream,
  guardrails: recommendedGuardrails,
  checkIntervals: {
    guardrails: 50, // Check every 50 tokens instead of default 5
  },
});
```

---

## Integration with Retry

Guardrail violations integrate with retry logic:

```typescript
await l0({
  stream,
  guardrails: recommendedGuardrails,
  retry: {
    attempts: 3,
    retryOn: ["guardrail_violation"], // Retry on recoverable violations
  },
});
```

| Violation Type       | Counts Toward Limit |
| -------------------- | ------------------- |
| `recoverable: true`  | Yes                 |
| `recoverable: false` | No                  |

Zero output violations are `recoverable: true` because retry may help recover from transport issues.
