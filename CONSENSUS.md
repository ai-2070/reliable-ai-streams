# Consensus

Multi-generation consensus for high-confidence results. Run multiple generations, compare outputs, and resolve disagreements.

> **Bundle size tip:** For smaller bundles, use subpath imports:
>
> ```typescript
> import { consensus } from "reliable-ai-streams/consensus";
> ```

## Quick Start

```typescript
import { consensus } from "reliable-ai-streams";

const result = await consensus({
  streams: [
    () => streamText({ model, prompt }),
    () => streamText({ model, prompt }),
    () => streamText({ model, prompt }),
  ],
});

console.log(result.consensus); // Agreed output
console.log(result.confidence); // 0-1 confidence score
console.log(result.agreements); // What they agreed on
console.log(result.disagreements); // Where they differed
```

## Strategies

```typescript
await consensus({
  streams,
  strategy: "majority", // Default
});
```

| Strategy    | Behavior                         |
| ----------- | -------------------------------- |
| `majority`  | Take what most outputs agree on  |
| `unanimous` | All must agree (fails otherwise) |
| `weighted`  | Weight by model/confidence       |
| `best`      | Choose highest quality output    |

## Conflict Resolution

```typescript
await consensus({
  streams,
  resolveConflicts: "vote", // Default
});
```

| Resolution | Behavior                    |
| ---------- | --------------------------- |
| `vote`     | Take majority vote          |
| `merge`    | Combine all information     |
| `best`     | Choose highest confidence   |
| `fail`     | Throw error on disagreement |

---

## Structured Consensus

With Zod schema, consensus compares field-by-field:

```typescript
import { consensus } from "reliable-ai-streams";
import { z } from "zod";

const schema = z.object({
  answer: z.string(),
  confidence: z.number(),
  sources: z.array(z.string()),
});

const result = await consensus({
  streams: [
    () => streamText({ model, prompt }),
    () => streamText({ model, prompt }),
    () => streamText({ model, prompt }),
  ],
  schema,
  strategy: "majority",
});

// Type-safe access
console.log(result.consensus.answer);
console.log(result.fieldConsensus.fields.answer.agreement); // 0-1
console.log(result.fieldConsensus.fields.answer.unanimous); // true/false
```

---

## Options

```typescript
interface ConsensusOptions {
  streams: Array<() => Promise<any>>; // Required, min 2
  schema?: ZodSchema; // For structured consensus
  strategy?: ConsensusStrategy; // Default: "majority"
  threshold?: number; // Similarity threshold, default: 0.8
  resolveConflicts?: ConflictResolution; // Default: "vote"
  weights?: number[]; // For weighted strategy
  minimumAgreement?: number; // Min agreement ratio, default: 0.6
  timeout?: number; // Timeout in ms
  signal?: AbortSignal;
  detectZeroTokens?: boolean; // Detect zero-token outputs, default: true
  monitoring?: { enabled?: boolean; metadata?: Record<string, any> };
  metadata?: Record<string, any>;
  onComplete?: (outputs: ConsensusOutput[]) => void | Promise<void>;
  onConsensus?: (result: ConsensusResult) => void | Promise<void>;
}
```

---

## Result Structure

```typescript
interface ConsensusResult<T> {
  consensus: T; // Final agreed output
  confidence: number; // 0-1 overall confidence
  outputs: ConsensusOutput[]; // Individual outputs
  agreements: Agreement[]; // What matched
  disagreements: Disagreement[]; // What differed
  analysis: ConsensusAnalysis; // Detailed stats
  type: "text" | "structured";
  fieldConsensus?: FieldConsensus; // For structured
  status: "success" | "partial" | "failed";
  error?: Error; // Error if consensus failed
  metadata?: Record<string, any>;
}
```

### ConsensusOutput

```typescript
interface ConsensusOutput {
  index: number; // Output index
  text: string; // Raw text output
  data?: any; // Parsed data (if structured)
  l0Result?: L0Result; // L0 result (if text-based)
  structuredResult?: StructuredResult; // Structured result (if schema)
  status: "success" | "error";
  error?: Error;
  duration: number; // Execution duration (ms)
  weight: number; // Weight assigned
  similarities?: number[]; // Similarity scores with other outputs
}
```

### Agreements

```typescript
interface Agreement {
  content: string | any; // Agreed content
  path?: string; // Field path (structured)
  count: number; // How many agreed
  ratio: number; // Agreement ratio
  indices: number[]; // Which outputs
  type: AgreementType;
}

type AgreementType =
  | "exact" // Exact match
  | "similar" // Fuzzy match (high similarity)
  | "structural" // Same structure (for objects)
  | "semantic"; // Same meaning (estimated)
```

### Disagreements

```typescript
interface Disagreement {
  path?: string;
  values: Array<{
    value: any;
    count: number;
    indices: number[];
  }>;
  severity: DisagreementSeverity;
  resolution?: string;
  resolutionConfidence?: number;
}

type DisagreementSeverity =
  | "minor" // Strong majority (>=80%)
  | "moderate" // Weak majority (>=60%)
  | "major" // No clear majority (>=40%)
  | "critical"; // Complete split (<40%)
```

### Analysis

```typescript
interface ConsensusAnalysis {
  totalOutputs: number;
  successfulOutputs: number;
  failedOutputs: number;
  identicalOutputs: number;
  similarityMatrix: number[][];
  averageSimilarity: number;
  minSimilarity: number;
  maxSimilarity: number;
  totalAgreements: number;
  totalDisagreements: number;
  strategy: ConsensusStrategy;
  conflictResolution: ConflictResolution;
  duration: number;
}
```

### FieldConsensus

```typescript
interface FieldConsensus {
  fields: Record<string, FieldAgreement>;
  overallAgreement: number; // 0-1
  agreedFields: string[]; // Fields with full agreement
  disagreedFields: string[]; // Fields with disagreement
}

interface FieldAgreement {
  path: string;
  value: any; // Consensus value
  agreement: number; // 0-1
  votes: Record<string, number>; // Vote counts
  values: any[]; // All values seen
  unanimous: boolean; // Full agreement?
  confidence: number; // 0-1
}
```

---

## Presets

```typescript
import {
  strictConsensus,
  standardConsensus,
  lenientConsensus,
  bestConsensus,
} from "reliable-ai-streams";

// Strict: all must agree
await consensus({ streams, ...strictConsensus });
// strategy: "unanimous", threshold: 1.0, resolveConflicts: "fail", minimumAgreement: 1.0

// Standard: majority rules (default)
await consensus({ streams, ...standardConsensus });
// strategy: "majority", threshold: 0.8, resolveConflicts: "vote", minimumAgreement: 0.6

// Lenient: flexible
await consensus({ streams, ...lenientConsensus });
// strategy: "majority", threshold: 0.7, resolveConflicts: "merge", minimumAgreement: 0.5

// Best: choose highest quality
await consensus({ streams, ...bestConsensus });
// strategy: "best", threshold: 0.8, resolveConflicts: "best", minimumAgreement: 0.5
```

---

## Helper Functions

### Quick Consensus Check

```typescript
import { quickConsensus } from "reliable-ai-streams";

const outputs = ["answer A", "answer A", "answer B"];
quickConsensus(outputs); // false (not 80% agreement)
quickConsensus(outputs, 0.6); // true (66% >= 60%)
```

### Get Consensus Value

```typescript
import { getConsensusValue } from "reliable-ai-streams";

getConsensusValue(["A", "A", "B"]); // "A"
getConsensusValue([1, 2, 1, 1]); // 1
```

### Validate Consensus

```typescript
import { validateConsensus } from "reliable-ai-streams";

validateConsensus(result, 0.8, 0); // minConfidence, maxDisagreements
// Returns true if confidence >= 0.8 and no major/critical disagreements
```

---

## Multi-Model Consensus

Use different models for diverse perspectives:

```typescript
const result = await consensus({
  streams: [
    () => streamText({ model: openai("gpt-4o"), prompt }),
    () => streamText({ model: anthropic("claude-3-opus"), prompt }),
    () => streamText({ model: google("gemini-pro"), prompt }),
  ],
  strategy: "majority",
});
```

## Weighted Consensus

Weight models differently:

```typescript
const result = await consensus({
  streams: [
    () => streamText({ model: openai("gpt-4o"), prompt }), // Expert
    () => streamText({ model: openai("gpt-4o-mini"), prompt }), // Fast
    () => streamText({ model: openai("gpt-4o-mini"), prompt }), // Fast
  ],
  strategy: "weighted",
  weights: [2.0, 1.0, 1.0], // GPT-4o counts double
});
```

---

## Use Cases

### Factual Accuracy

```typescript
// Ask same question 3 times, take majority
const result = await consensus({
  streams: Array(3).fill(() =>
    streamText({ model, prompt: "What year was X founded?" }),
  ),
  strategy: "unanimous",
  resolveConflicts: "fail", // Fail if any disagree
});
```

### Code Generation

```typescript
// Generate code 3 times, pick best
const result = await consensus({
  streams: Array(3).fill(() =>
    streamText({ model, prompt: "Write function X" }),
  ),
  strategy: "best", // Pick highest quality
});
```

### Data Extraction

```typescript
// Extract data with schema, field-by-field consensus
const result = await consensus({
  streams: Array(3).fill(() => streamText({ model, prompt })),
  schema: extractionSchema,
  minimumAgreement: 0.8, // 80% must agree on each field
});

// Check per-field agreement
for (const [field, info] of Object.entries(result.fieldConsensus.fields)) {
  console.log(`${field}: ${info.agreement * 100}% agreement`);
  if (info.unanimous) {
    console.log(`  Unanimous: ${info.value}`);
  }
}
```

---

## Similarity Utilities

Low-level comparison utilities used by consensus:

```typescript
import {
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
} from "reliable-ai-streams";

// Calculate pairwise similarity between outputs
const matrix = calculateSimilarityMatrix(outputs);

// Compare two structured objects
const similarity = calculateStructuralSimilarity(obj1, obj2); // 0-1

// Find all agreements above threshold
const agreements = findAgreements(outputs, 0.8);

// Find all disagreements
const disagreements = findDisagreements(outputs, 0.8);

// Resolve using different strategies
const majority = resolveMajority(outputs, weights);
const best = resolveBest(outputs, weights);
const merged = resolveMerge(outputs);
```
