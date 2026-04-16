// Chunking utilities for document window API

import type { DocumentChunk, WindowOptions } from "../types/window";

/**
 * Chunk a document into pieces based on strategy
 *
 * @param document - Full document text
 * @param options - Chunking options
 * @returns Array of document chunks
 */
export function chunkDocument(
  document: string,
  options: Required<WindowOptions>,
): DocumentChunk[] {
  const { strategy } = options;

  switch (strategy) {
    case "token":
      return chunkByTokens(document, options);
    case "char":
      return chunkByChars(document, options);
    case "paragraph":
      return chunkByParagraphs(document, options);
    case "sentence":
      return chunkBySentences(document, options);
    default:
      return chunkByTokens(document, options);
  }
}

/**
 * Chunk document by estimated token count
 */
export function chunkByTokens(
  document: string,
  options: Required<WindowOptions>,
): DocumentChunk[] {
  const { size, overlap, estimateTokens, preserveParagraphs } = options;

  const chunks: DocumentChunk[] = [];
  let startPos = 0;

  while (startPos < document.length) {
    // Find chunk end position
    let endPos = startPos;
    let currentTokens = 0;

    // Accumulate characters until we reach token limit
    while (endPos < document.length && currentTokens < size) {
      endPos++;

      // Rough estimate: 1 token ≈ 4 characters (relative to chunk start)
      if ((endPos - startPos) % 4 === 0) {
        currentTokens++;
      }
    }

    // Adjust to paragraph boundary if enabled
    if (preserveParagraphs && endPos < document.length) {
      const nextNewline = document.indexOf("\n\n", endPos);
      const prevNewline = document.lastIndexOf("\n\n", endPos);

      if (nextNewline !== -1 && nextNewline - endPos < 100) {
        endPos = nextNewline + 2;
      } else if (prevNewline > startPos && endPos - prevNewline < 100) {
        endPos = prevNewline + 2;
      }
    }

    // Extract chunk content
    const content = document.slice(startPos, endPos).trim();

    if (content.length > 0) {
      chunks.push({
        index: chunks.length,
        content,
        startPos,
        endPos,
        tokenCount: estimateTokens(content),
        charCount: content.length,
        isFirst: chunks.length === 0,
        isLast: endPos >= document.length,
        totalChunks: 0, // Will be updated after all chunks created
        metadata: options.metadata,
      });
    }

    // Move start position with overlap
    const overlapChars = Math.floor(overlap * 4); // Convert token overlap to chars
    startPos = endPos - overlapChars;

    const lastChunk = chunks[chunks.length - 1];
    if (lastChunk && startPos <= lastChunk.startPos) {
      startPos = endPos;
    }
  }

  // Update totalChunks for all chunks
  chunks.forEach((chunk) => {
    chunk.totalChunks = chunks.length;
    chunk.isLast = chunk.index === chunks.length - 1;
  });

  return chunks;
}

/**
 * Chunk document by character count
 */
export function chunkByChars(
  document: string,
  options: Required<WindowOptions>,
): DocumentChunk[] {
  const { size, overlap, estimateTokens, preserveParagraphs } = options;

  const chunks: DocumentChunk[] = [];
  let startPos = 0;

  while (startPos < document.length) {
    let endPos = Math.min(startPos + size, document.length);

    // Adjust to paragraph boundary if enabled
    if (preserveParagraphs && endPos < document.length) {
      const nextNewline = document.indexOf("\n\n", endPos);
      const prevNewline = document.lastIndexOf("\n\n", endPos);

      if (nextNewline !== -1 && nextNewline - endPos < 100) {
        endPos = nextNewline + 2;
      } else if (prevNewline > startPos && endPos - prevNewline < 100) {
        endPos = prevNewline + 2;
      }
    }

    // Extract chunk content
    const content = document.slice(startPos, endPos).trim();

    if (content.length > 0) {
      chunks.push({
        index: chunks.length,
        content,
        startPos,
        endPos,
        tokenCount: estimateTokens(content),
        charCount: content.length,
        isFirst: chunks.length === 0,
        isLast: endPos >= document.length,
        totalChunks: 0,
        metadata: options.metadata,
      });
    }

    // Move start position with overlap
    startPos = endPos - overlap;

    const lastChunk = chunks[chunks.length - 1];
    if (lastChunk && startPos <= lastChunk.startPos) {
      startPos = endPos;
    }
  }

  // Update totalChunks
  chunks.forEach((chunk) => {
    chunk.totalChunks = chunks.length;
    chunk.isLast = chunk.index === chunks.length - 1;
  });

  return chunks;
}

/**
 * Chunk document by paragraphs (with max size limit)
 */
export function chunkByParagraphs(
  document: string,
  options: Required<WindowOptions>,
): DocumentChunk[] {
  const { size, overlap, estimateTokens } = options;

  // Split into paragraphs
  const paragraphs = document.split(/\n\n+/).filter((p) => p.trim().length > 0);

  const chunks: DocumentChunk[] = [];
  let currentChunk: string[] = [];
  let currentSize = 0;
  let currentStartPos = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i]!.trim();
    const paraSize = estimateTokens(para);

    // If single paragraph exceeds size, split it
    if (paraSize > size) {
      // Flush current chunk if any
      if (currentChunk.length > 0) {
        const content = currentChunk.join("\n\n");
        chunks.push(
          createChunk(
            content,
            currentStartPos,
            document,
            chunks.length,
            estimateTokens,
            options.metadata,
          ),
        );
        currentChunk = [];
        currentSize = 0;
      }

      // Split large paragraph by characters
      const paraStart = document.indexOf(para, currentStartPos);
      const paraOffset = paraStart !== -1 ? paraStart : currentStartPos;

      const paraChunks = chunkByChars(para, {
        ...options,
        size,
        overlap: 0,
      });

      paraChunks.forEach((pc) => {
        chunks.push({
          ...pc,
          index: chunks.length,
          startPos: paraOffset + pc.startPos,
          endPos: paraOffset + pc.endPos,
        });
      });

      currentStartPos = paraOffset + para.length;
      continue;
    }

    // Check if adding this paragraph exceeds size
    if (currentSize + paraSize > size && currentChunk.length > 0) {
      // Flush current chunk
      const content = currentChunk.join("\n\n");
      chunks.push(
        createChunk(
          content,
          currentStartPos,
          document,
          chunks.length,
          estimateTokens,
          options.metadata,
        ),
      );

      // Keep last paragraph for overlap
      const overlapParas: string[] = [];
      let overlapSize = 0;
      for (let j = currentChunk.length - 1; j >= 0; j--) {
        const p = currentChunk[j]!;
        const pSize = estimateTokens(p);
        if (overlapSize + pSize <= overlap) {
          overlapParas.unshift(p);
          overlapSize += pSize;
        } else {
          break;
        }
      }

      currentChunk = overlapParas;
      currentSize = overlapSize;
      currentStartPos = document.indexOf(
        currentChunk[0] || para,
        currentStartPos,
      );
    }

    currentChunk.push(para);
    currentSize += paraSize;
  }

  // Flush remaining chunk
  if (currentChunk.length > 0) {
    const content = currentChunk.join("\n\n");
    chunks.push(
      createChunk(
        content,
        currentStartPos,
        document,
        chunks.length,
        estimateTokens,
        options.metadata,
      ),
    );
  }

  // Update totalChunks
  chunks.forEach((chunk) => {
    chunk.totalChunks = chunks.length;
    chunk.isFirst = chunk.index === 0;
    chunk.isLast = chunk.index === chunks.length - 1;
  });

  return chunks;
}

/**
 * Chunk document by sentences (with max size limit)
 */
export function chunkBySentences(
  document: string,
  options: Required<WindowOptions>,
): DocumentChunk[] {
  const { size, overlap, estimateTokens } = options;

  // Split into sentences (basic sentence boundary detection)
  const sentences = splitIntoSentences(document);

  const chunks: DocumentChunk[] = [];
  let currentChunk: string[] = [];
  let currentSize = 0;
  let currentStartPos = 0;

  for (const sentence of sentences) {
    const sentSize = estimateTokens(sentence);

    // If single sentence exceeds size, split it
    if (sentSize > size) {
      // Flush current chunk if any
      if (currentChunk.length > 0) {
        const content = currentChunk.join(" ");
        chunks.push(
          createChunk(
            content,
            currentStartPos,
            document,
            chunks.length,
            estimateTokens,
            options.metadata,
          ),
        );
        currentChunk = [];
        currentSize = 0;
      }

      // Split large sentence by characters
      const sentChunks = chunkByChars(sentence, {
        ...options,
        size,
        overlap: 0,
      });

      const sentStart = document.indexOf(sentence, currentStartPos);
      const sentOffset = sentStart !== -1 ? sentStart : currentStartPos;

      sentChunks.forEach((sc) => {
        chunks.push({
          ...sc,
          index: chunks.length,
          startPos: sentOffset + sc.startPos,
          endPos: sentOffset + sc.endPos,
        });
      });

      currentStartPos = sentOffset + sentence.length;
      continue;
    }

    // Check if adding this sentence exceeds size
    if (currentSize + sentSize > size && currentChunk.length > 0) {
      // Flush current chunk
      const content = currentChunk.join(" ");
      chunks.push(
        createChunk(
          content,
          currentStartPos,
          document,
          chunks.length,
          estimateTokens,
          options.metadata,
        ),
      );

      // Keep last sentences for overlap
      const overlapSents: string[] = [];
      let overlapSize = 0;
      for (let j = currentChunk.length - 1; j >= 0; j--) {
        const s = currentChunk[j]!;
        const sSize = estimateTokens(s);
        if (overlapSize + sSize <= overlap) {
          overlapSents.unshift(s);
          overlapSize += sSize;
        } else {
          break;
        }
      }

      currentChunk = overlapSents;
      currentSize = overlapSize;
      currentStartPos = document.indexOf(
        currentChunk[0] || sentence,
        currentStartPos,
      );
    }

    currentChunk.push(sentence);
    currentSize += sentSize;
  }

  // Flush remaining chunk
  if (currentChunk.length > 0) {
    const content = currentChunk.join(" ");
    chunks.push(
      createChunk(
        content,
        currentStartPos,
        document,
        chunks.length,
        estimateTokens,
        options.metadata,
      ),
    );
  }

  // Update totalChunks
  chunks.forEach((chunk) => {
    chunk.totalChunks = chunks.length;
    chunk.isFirst = chunk.index === 0;
    chunk.isLast = chunk.index === chunks.length - 1;
  });

  return chunks;
}

/**
 * Split text into sentences
 */
export function splitIntoSentences(text: string): string[] {
  // Simple sentence boundary detection
  // Splits on . ! ? followed by whitespace and capital letter
  const sentences: string[] = [];
  const regex = /[.!?]+[\s\n]+(?=[A-Z])|[.!?]+$/g;

  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const sentence = text
      .slice(lastIndex, match.index + match[0].length)
      .trim();
    if (sentence.length > 0) {
      sentences.push(sentence);
    }
    lastIndex = match.index + match[0].length;
  }

  // Add remaining text as last sentence
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex).trim();
    if (remaining.length > 0) {
      sentences.push(remaining);
    }
  }

  return sentences;
}

/**
 * Create a document chunk from content
 */
function createChunk(
  content: string,
  startPos: number,
  _fullDocument: string,
  index: number,
  estimateTokens: (text: string) => number,
  metadata?: Record<string, any>,
): DocumentChunk {
  return {
    index,
    content,
    startPos,
    endPos: startPos + content.length,
    tokenCount: estimateTokens(content),
    charCount: content.length,
    isFirst: index === 0,
    isLast: false, // Will be updated later
    totalChunks: 0, // Will be updated later
    metadata,
  };
}

/**
 * Default token estimator (rough approximation)
 * 1 token ≈ 4 characters for English text
 *
 * @param text - Text to estimate
 * @returns Estimated token count
 */
export function estimateTokenCount(text: string): number {
  // Simple estimation: 1 token ≈ 4 chars
  // This is a rough approximation; for accurate counts use tiktoken
  const charCount = text.length;
  const wordCount = text.split(/\s+/).length;

  // Use average of char-based and word-based estimates
  const charEstimate = Math.ceil(charCount / 4);
  const wordEstimate = Math.ceil(wordCount * 1.3); // 1 token ≈ 0.75 words

  return Math.ceil((charEstimate + wordEstimate) / 2);
}

/**
 * Get overlap content between two chunks
 *
 * @param chunk1 - First chunk
 * @param chunk2 - Second chunk
 * @returns Overlapping content or null if no overlap
 */
export function getChunkOverlap(
  chunk1: DocumentChunk,
  chunk2: DocumentChunk,
): string | null {
  if (chunk1.endPos <= chunk2.startPos || chunk2.endPos <= chunk1.startPos) {
    return null; // No overlap
  }

  const overlapStart = Math.max(chunk1.startPos, chunk2.startPos);
  const overlapEnd = Math.min(chunk1.endPos, chunk2.endPos);

  // Find overlap in content
  const chunk1End = chunk1.content.slice(-(chunk1.endPos - overlapStart));
  const chunk2Start = chunk2.content.slice(0, overlapEnd - chunk2.startPos);

  // Return the shorter one (they should be the same)
  return chunk1End.length <= chunk2Start.length ? chunk1End : chunk2Start;
}

/**
 * Merge chunks into a single text
 *
 * @param chunks - Chunks to merge
 * @param preserveOverlap - Whether to preserve overlap between chunks
 * @returns Merged text
 */
export function mergeChunks(
  chunks: DocumentChunk[],
  preserveOverlap: boolean = false,
): string {
  if (chunks.length === 0) return "";
  if (chunks.length === 1) return chunks[0]!.content;

  if (preserveOverlap) {
    return chunks.map((c) => c.content).join("\n\n");
  }

  // Remove overlap when merging
  const result: string[] = [chunks[0]!.content];

  for (let i = 1; i < chunks.length; i++) {
    const prevChunk = chunks[i - 1]!;
    const currentChunk = chunks[i]!;

    const overlap = getChunkOverlap(prevChunk, currentChunk);

    if (overlap) {
      // Remove overlap from current chunk
      const overlapIndex = currentChunk.content.indexOf(overlap);
      if (overlapIndex !== -1) {
        result.push(currentChunk.content.slice(overlapIndex + overlap.length));
      } else {
        result.push(currentChunk.content);
      }
    } else {
      result.push(currentChunk.content);
    }
  }

  return result.join("");
}
