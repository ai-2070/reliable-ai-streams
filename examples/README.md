# L0 Examples

Run any example with:

```bash
OPENAI_API_KEY=sk-... npx tsx examples/<filename>.ts
```

## Examples

| File                                                             | Description                             |
| ---------------------------------------------------------------- | --------------------------------------- |
| [01-basic-streaming.ts](./01-basic-streaming.ts)                 | Core streaming with guardrails          |
| [02-structured-output.ts](./02-structured-output.ts)             | Type-safe JSON with Zod schemas         |
| [03-fallback-models.ts](./03-fallback-models.ts)                 | Sequential model fallback               |
| [04-openai-sdk.ts](./04-openai-sdk.ts)                           | Direct OpenAI SDK usage                 |
| [05-guardrails.ts](./05-guardrails.ts)                           | Built-in and custom guardrails          |
| [06-parallel-and-race.ts](./06-parallel-and-race.ts)             | Concurrent LLM operations               |
| [07-consensus.ts](./07-consensus.ts)                             | Multi-generation agreement              |
| [08-monitoring.ts](./08-monitoring.ts)                           | OpenTelemetry and Sentry integration    |
| [09-document-windows.ts](./09-document-windows.ts)               | Chunking long documents                 |
| [10-retry-and-errors.ts](./10-retry-and-errors.ts)               | Retry logic and error handling          |
| [11-continuation-resumption.ts](./11-continuation-resumption.ts) | Checkpoint resumption and deduplication |
| [12-lifecycle-callbacks.ts](./12-lifecycle-callbacks.ts)         | Lifecycle callbacks for monitoring      |

## Requirements

```bash
npm install reliable-ai-streams ai @ai-sdk/openai zod
```

Set your API key:

```bash
export OPENAI_API_KEY=sk-...
```

## Bundle Size Optimization

Most applications should simply use:

```typescript
import { l0 } from "reliable-ai-streams";
```

Only optimize imports if you're targeting edge runtimes or strict bundle constraints:

```typescript
import { l0 } from "reliable-ai-streams/core"; // 20KB gzipped
import { structured } from "reliable-ai-streams/structured";
import { consensus } from "reliable-ai-streams/consensus";
import { parallel, race } from "reliable-ai-streams/parallel";
import { createWindow } from "reliable-ai-streams/window";
import { recommendedGuardrails } from "reliable-ai-streams/guardrails";
import { createSentryHandler } from "reliable-ai-streams/monitoring";
import { DriftDetector } from "reliable-ai-streams/drift";
import { openaiAdapter } from "reliable-ai-streams/openai";
import { anthropicAdapter } from "reliable-ai-streams/anthropic";
import { mastraAdapter } from "reliable-ai-streams/mastra";
```
