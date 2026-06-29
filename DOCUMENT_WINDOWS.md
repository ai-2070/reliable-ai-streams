# Document Windows Guide

Automatic chunking and navigation for long documents.

> **Bundle size tip:** For smaller bundles, use subpath imports:
>
> ```typescript
> import { createWindow } from "reliable-ai-streams/window";
> import { chunkDocument } from "reliable-ai-streams/utils/chunking";
> ```

## Quick Start

```typescript
import { createWindow } from "reliable-ai-streams";

const window = createWindow(longDocument, {
  size: 2000, // Tokens per chunk
  overlap: 200, // Overlap between chunks
  strategy: "paragraph", // "token" | "char" | "paragraph" | "sentence"
});

// Process all chunks
const results = await window.processAll((chunk) => ({
  stream: () =>
    streamText({
      model: openai("gpt-4o"),
      prompt: `Summarize: ${chunk.content}`,
    }),
}));

// Merge results
const summary = results
  .filter((r) => r.status === "success")
  .map((r) => r.result.state.content)
  .join("\n\n");
```

---

## Chunking Strategies

| Strategy    | Best For        | Behavior                        |
| ----------- | --------------- | ------------------------------- |
| `token`     | General purpose | Chunks by estimated token count |
| `char`      | Fixed-length    | Chunks by character count       |
| `paragraph` | Structured docs | Preserves paragraph boundaries  |
| `sentence`  | Precision       | Never splits sentences          |

```typescript
// Token-based (default)
createWindow(doc, { size: 2000, strategy: "token" });

// Paragraph-based
createWindow(doc, { size: 2000, strategy: "paragraph" });

// Sentence-based
createWindow(doc, { size: 1500, strategy: "sentence" });
```

---

## Window Options

```typescript
interface WindowOptions {
  /**
   * Size of each chunk (in tokens or characters)
   * @default 2000
   */
  size?: number;

  /**
   * Overlap between chunks (in tokens or characters)
   * @default 200
   */
  overlap?: number;

  /**
   * Chunking strategy
   * @default 'token'
   */
  strategy?: "token" | "char" | "paragraph" | "sentence";

  /**
   * Custom token estimator function
   * If not provided, uses rough estimate (1 token ≈ 4 chars)
   */
  estimateTokens?: (text: string) => number;

  /**
   * Preserve paragraph boundaries when chunking
   * @default true
   */
  preserveParagraphs?: boolean;

  /**
   * Preserve sentence boundaries when chunking
   * @default false
   */
  preserveSentences?: boolean;

  /**
   * Custom metadata to attach to each chunk
   */
  metadata?: Record<string, any>;
}
```

---

## Navigation

```typescript
const window = createWindow(document, { size: 2000 });

// Get chunks
window.current(); // Current chunk
window.get(0); // Specific chunk
window.getAllChunks(); // All chunks
window.getRange(0, 5); // Range of chunks

// Navigate
window.next(); // Move to next
window.prev(); // Move to previous
window.jump(5); // Jump to chunk 5
window.reset(); // Back to first

// Check bounds
window.hasNext(); // Has more chunks?
window.hasPrev(); // Has previous?
window.totalChunks; // Total count
window.currentIndex; // Current position

// Search and context
window.findChunks("search term"); // Find chunks containing text
window.findChunks("term", true); // Case-sensitive search
window.getContext(3, { before: 1, after: 1 }); // Get surrounding context
window.getChunksInRange(0, 500); // Get chunks within character range

// Statistics
window.getStats(); // Get window statistics
```

---

## Processing

### Parallel (Default)

```typescript
const results = await window.processAll((chunk) => ({
  stream: () => streamText({ model, prompt: chunk.content }),
}));
```

### Parallel with Concurrency

```typescript
const results = await window.processParallel(
  (chunk) => ({
    stream: () => streamText({ model, prompt: chunk.content }),
  }),
  { concurrency: 5 },
);
```

### Sequential

```typescript
const results = await window.processSequential((chunk) => ({
  stream: () => streamText({ model, prompt: chunk.content }),
}));
```

### With Retry & Fallbacks

```typescript
const results = await window.processAll((chunk) => ({
  stream: () => streamText({ model: openai("gpt-4o"), prompt: chunk.content }),
  retry: { attempts: 3 },
  fallbackStreams: [
    () => streamText({ model: openai("gpt-4o-mini"), prompt: chunk.content }),
  ],
}));
```

---

## Chunk Structure

```typescript
interface DocumentChunk {
  index: number; // Position (0-based)
  content: string; // Chunk text
  startPos: number; // Start in original document
  endPos: number; // End in original document
  tokenCount: number; // Estimated tokens
  charCount: number; // Character count
  isFirst: boolean;
  isLast: boolean;
  totalChunks: number;
  metadata?: Record<string, any>; // Custom metadata
}
```

---

## Window Statistics

```typescript
interface WindowStats {
  totalChunks: number; // Total chunks
  totalChars: number; // Total document length (characters)
  totalTokens: number; // Estimated total tokens
  avgChunkSize: number; // Average chunk size (characters)
  avgChunkTokens: number; // Average chunk tokens
  overlapSize: number; // Overlap size (characters)
  strategy: ChunkStrategy; // Chunking strategy used
}

// Get statistics
const stats = window.getStats();
console.log(`Total chunks: ${stats.totalChunks}`);
console.log(`Total tokens: ${stats.totalTokens}`);
console.log(`Avg chunk size: ${stats.avgChunkSize} chars`);
```

---

## Overlap

Overlap maintains context between chunks:

```typescript
const window = createWindow(document, {
  size: 2000,
  overlap: 200, // 10% overlap
});

// Chunk 0: tokens 0-2000
// Chunk 1: tokens 1800-3800 (200 overlap with chunk 0)
// Chunk 2: tokens 3600-5600 (200 overlap with chunk 1)
```

**Recommendation:** Use 10% overlap (e.g., 200 for 2000-token chunks)

---

## Context Restoration

Auto-retry with adjacent chunks if drift detected:

```typescript
import { l0WithWindow } from "reliable-ai-streams";

const result = await l0WithWindow({
  window,
  chunkIndex: 0,
  stream: () => streamText({ model, prompt: window.get(0)?.content }),
  contextRestoration: {
    enabled: true,
    strategy: "adjacent", // "adjacent" | "overlap" | "full"
    maxAttempts: 2,
    onRestore: (from, to) =>
      console.log(`Restored from chunk ${from} to ${to}`),
  },
});
```

---

## Helper Functions

### processWithWindow

Process a document directly without creating a window instance:

```typescript
import { processWithWindow } from "reliable-ai-streams";

const results = await processWithWindow(
  document,
  (chunk) => ({
    stream: () =>
      streamText({
        model,
        prompt: `Summarize: ${chunk.content}`,
      }),
  }),
  { size: 2000, overlap: 200 },
);
```

### mergeResults

Merge results from multiple chunk processing into a single text:

```typescript
import { mergeResults } from "reliable-ai-streams";

const results = await window.processAll((chunk) => ({
  stream: () => streamText({ model, prompt: chunk.content }),
}));

const merged = mergeResults(results); // Default separator: "\n\n"
const customMerged = mergeResults(results, "\n---\n"); // Custom separator
```

### getProcessingStats

Get processing statistics from results:

```typescript
import { getProcessingStats } from "reliable-ai-streams";

const results = await window.processAll((chunk) => ({
  stream: () => streamText({ model, prompt: chunk.content }),
}));

const stats = getProcessingStats(results);
// {
//   total: 10,
//   successful: 9,
//   failed: 1,
//   successRate: 90,
//   avgDuration: 1500,
//   totalDuration: 15000
// }
```

---

## Chunking Utilities

Low-level chunking functions available from `reliable-ai-streams/utils/chunking`:

```typescript
import {
  chunkDocument,
  chunkByTokens,
  chunkByChars,
  chunkByParagraphs,
  chunkBySentences,
  splitIntoSentences,
  estimateTokenCount,
  getChunkOverlap,
  mergeChunks,
} from "reliable-ai-streams/utils/chunking";

// Chunk document with options
const chunks = chunkDocument(document, {
  size: 2000,
  overlap: 200,
  strategy: "token",
  estimateTokens: (text) => Math.ceil(text.length / 4),
  preserveParagraphs: true,
  preserveSentences: false,
  metadata: {},
});

// Individual chunking strategies
const tokenChunks = chunkByTokens(document, options);
const charChunks = chunkByChars(document, options);
const paragraphChunks = chunkByParagraphs(document, options);
const sentenceChunks = chunkBySentences(document, options);

// Sentence splitting
const sentences = splitIntoSentences(text);

// Token estimation (1 token ≈ 4 chars, averaged with word count)
const tokens = estimateTokenCount(text);

// Get overlap between chunks
const overlap = getChunkOverlap(chunk1, chunk2);

// Merge chunks back together
const merged = mergeChunks(chunks); // Removes overlap
const withOverlap = mergeChunks(chunks, true); // Preserves overlap
```

---

## Examples

### Legal Document Analysis

```typescript
const window = createWindow(contract, {
  size: 2000,
  strategy: "paragraph",
});

const results = await window.processAll((chunk) => ({
  stream: () =>
    streamText({
      model,
      prompt: `Extract legal clauses from: ${chunk.content}`,
    }),
}));
```

### Transcript Summarization

```typescript
const window = createWindow(transcript, {
  size: 3000,
  strategy: "sentence",
});

const summaries = await window.processSequential((chunk) => ({
  stream: () =>
    streamText({
      model,
      prompt: `Summarize this section: ${chunk.content}`,
    }),
}));
```

### Code Documentation

```typescript
const window = createWindow(sourceCode, {
  size: 1500,
  strategy: "paragraph",
});

const docs = await window.processAll((chunk) => ({
  stream: () =>
    streamText({
      model,
      prompt: `Generate documentation for: ${chunk.content}`,
    }),
}));
```

### Custom Token Estimation

```typescript
import { encoding_for_model } from "tiktoken";

const enc = encoding_for_model("gpt-4");

const window = createWindow(document, {
  size: 2000,
  overlap: 200,
  estimateTokens: (text) => enc.encode(text).length,
});
```

### Searching and Context

```typescript
const window = createWindow(document, { size: 2000 });

// Find all chunks containing a term
const relevantChunks = window.findChunks("important keyword");

// Get context around a specific chunk
const context = window.getContext(5, { before: 2, after: 2 });

// Get chunks within a specific position range
const rangeChunks = window.getChunksInRange(1000, 5000);
```

---

## Presets

```typescript
import {
  smallWindow, // 1000 tokens, 100 overlap, token strategy
  mediumWindow, // 2000 tokens, 200 overlap, token strategy
  largeWindow, // 4000 tokens, 400 overlap, token strategy
  paragraphWindow, // 2000 tokens, 200 overlap, paragraph strategy
  sentenceWindow, // 1500 tokens, 150 overlap, sentence strategy
} from "reliable-ai-streams";

const window = createWindow(document, largeWindow);
```

---

## Best Practices

1. **Chunk size** - Leave room for prompt + response (e.g., 2000 for 8k context)
2. **Overlap** - Use 10% for context continuity
3. **Strategy** - Match to content type (paragraph for docs, sentence for transcripts)
4. **Concurrency** - Limit for rate-limited APIs
5. **Error handling** - Check `result.status === "error"` for failures
6. **Custom token estimation** - Use tiktoken for accurate counts with OpenAI models

```typescript
// Recommended setup
const window = createWindow(document, {
  size: 2000,
  overlap: 200,
  strategy: "paragraph",
});

const results = await window.processAll((chunk) => ({
  stream: () => streamText({ model, prompt: chunk.content }),
  retry: { attempts: 3 },
}));

// Handle failures
const stats = getProcessingStats(results);
if (stats.failed > 0) {
  console.warn(
    `${stats.failed} chunks failed (${stats.successRate}% success rate)`,
  );
}

// Get merged output
const output = mergeResults(results);
```

---

## See Also

- [API.md](./API.md) - Complete API reference
- [STRUCTURED_OUTPUT.md](./STRUCTURED_OUTPUT.md) - Structured output
- [PERFORMANCE.md](./PERFORMANCE.md) - Performance tuning
