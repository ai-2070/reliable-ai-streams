// Token validation helpers for L0

/**
 * Check if a token is meaningful (not just whitespace)
 * @param token - Token to check
 * @returns True if token contains meaningful content
 */
export function isMeaningfulToken(token: string): boolean {
  if (!token || token.length === 0) {
    return false;
  }

  // Check if token is only whitespace
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    return false;
  }

  // Check if token is only newlines or similar
  if (/^[\r\n\t\s]+$/.test(token)) {
    return false;
  }

  return true;
}

/**
 * Check if content contains any meaningful tokens
 * @param content - Content to check
 * @returns True if content has meaningful tokens
 */
export function hasMeaningfulContent(content: string): boolean {
  if (!content || content.length === 0) {
    return false;
  }

  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return false;
  }

  // Check if content is only whitespace characters
  if (/^[\r\n\t\s]+$/.test(content)) {
    return false;
  }

  return true;
}

/**
 * Count meaningful tokens in content
 * Simple word-based tokenization
 * @param content - Content to count tokens in
 * @returns Number of meaningful tokens
 */
export function countMeaningfulTokens(content: string): number {
  if (!content || !hasMeaningfulContent(content)) {
    return 0;
  }

  const trimmed = content.trim();
  // Split on whitespace and filter out empty strings
  const tokens = trimmed.split(/\s+/).filter((t) => t.length > 0);
  return tokens.length;
}

/**
 * Extract meaningful tokens from content
 * @param content - Content to extract tokens from
 * @returns Array of meaningful tokens
 */
export function extractMeaningfulTokens(content: string): string[] {
  if (!content || !hasMeaningfulContent(content)) {
    return [];
  }

  const trimmed = content.trim();
  // Split on whitespace and filter out empty strings
  return trimmed.split(/\s+/).filter((t) => t.length > 0);
}

/**
 * Check if a token is only punctuation
 * @param token - Token to check
 * @returns True if token is only punctuation
 */
export function isPunctuationOnly(token: string): boolean {
  if (!token || token.length === 0) {
    return false;
  }

  return /^[^\w\s]+$/.test(token);
}

/**
 * Check if a token is alphanumeric
 * @param token - Token to check
 * @returns True if token contains alphanumeric characters
 */
export function isAlphanumeric(token: string): boolean {
  if (!token || token.length === 0) {
    return false;
  }

  return /[a-zA-Z0-9]/.test(token);
}

/**
 * Normalize token for comparison (lowercase, trim)
 * @param token - Token to normalize
 * @returns Normalized token
 */
export function normalizeToken(token: string): string {
  return token.trim().toLowerCase();
}

/**
 * Check if two tokens are equivalent (normalized comparison)
 * @param token1 - First token
 * @param token2 - Second token
 * @returns True if tokens are equivalent
 */
export function tokensEqual(token1: string, token2: string): boolean {
  return normalizeToken(token1) === normalizeToken(token2);
}

/**
 * Detect repeated tokens in content
 * @param content - Content to analyze
 * @param threshold - Maximum allowed repetitions (default: 3)
 * @returns Array of repeated token sequences
 */
export function detectRepeatedTokens(
  content: string,
  threshold: number = 3,
): string[] {
  if (!content || !hasMeaningfulContent(content)) {
    return [];
  }

  const tokens = extractMeaningfulTokens(content);
  const repeated: string[] = [];
  const counts = new Map<string, number>();

  for (const token of tokens) {
    const normalized = normalizeToken(token);
    const count = (counts.get(normalized) || 0) + 1;
    counts.set(normalized, count);

    if (count === threshold) {
      repeated.push(token);
    }
  }

  return repeated;
}

/**
 * Calculate token density (tokens per character)
 * @param content - Content to analyze
 * @returns Token density
 */
export function calculateTokenDensity(content: string): number {
  if (!content || content.length === 0) {
    return 0;
  }

  const tokenCount = countMeaningfulTokens(content);
  return tokenCount / content.length;
}

/**
 * Estimate token count using simple heuristic
 * Rough approximation: ~4 characters per token on average
 * @param content - Content to estimate
 * @returns Estimated token count
 */
export function estimateTokenCount(content: string): number {
  if (!content || content.length === 0) {
    return 0;
  }

  // Simple heuristic: average of word count and char count / 4
  const wordCount = countMeaningfulTokens(content);
  const charEstimate = Math.ceil(content.length / 4);
  return Math.ceil((wordCount + charEstimate) / 2);
}

/**
 * Check if content starts with meaningful token
 * @param content - Content to check
 * @returns True if starts with meaningful token
 */
export function startsWithMeaningfulToken(content: string): boolean {
  if (!content || content.length === 0) {
    return false;
  }

  // Find first non-whitespace character
  const firstChar = content.trimStart()[0];
  if (!firstChar) {
    return false;
  }

  return isMeaningfulToken(firstChar);
}

/**
 * Get first meaningful token from content
 * @param content - Content to extract from
 * @returns First meaningful token or null
 */
export function getFirstMeaningfulToken(content: string): string | null {
  const tokens = extractMeaningfulTokens(content);
  return tokens.length > 0 ? (tokens[0] ?? null) : null;
}

/**
 * Get last meaningful token from content
 * @param content - Content to extract from
 * @returns Last meaningful token or null
 */
export function getLastMeaningfulToken(content: string): string | null {
  const tokens = extractMeaningfulTokens(content);
  return tokens.length > 0 ? (tokens[tokens.length - 1] ?? null) : null;
}

/**
 * Check if content ends abruptly (incomplete sentence)
 * Simple heuristic based on punctuation
 * @param content - Content to check
 * @returns True if content appears to end abruptly
 */
export function endsAbruptly(content: string): boolean {
  if (!content || !hasMeaningfulContent(content)) {
    return false;
  }

  const trimmed = content.trim();

  // Check if ends with sentence-ending punctuation
  const endsWithPunctuation = /[.!?;:]$/.test(trimmed);

  // Check if ends with closing bracket/brace (could be complete)
  const endsWithClosure = /[)\]}]$/.test(trimmed);

  // If doesn't end with punctuation or closure, likely abrupt
  return !endsWithPunctuation && !endsWithClosure;
}

/**
 * Split content into token chunks of approximately equal size
 * @param content - Content to split
 * @param chunkSize - Target chunk size in tokens
 * @returns Array of content chunks
 */
export function chunkByTokens(content: string, chunkSize: number): string[] {
  if (!content || !hasMeaningfulContent(content)) {
    return [];
  }

  const tokens = extractMeaningfulTokens(content);
  const chunks: string[] = [];

  for (let i = 0; i < tokens.length; i += chunkSize) {
    const chunk = tokens.slice(i, i + chunkSize).join(" ");
    chunks.push(chunk);
  }

  return chunks;
}

/**
 * Result of overlap detection between checkpoint and continuation
 */
export interface OverlapDetectionResult {
  /** The length of the detected overlap in characters */
  overlapLength: number;
  /** The overlapping text that was found */
  overlapText: string;
  /** The deduplicated continuation (with overlap removed) */
  deduplicatedContinuation: string;
  /** Whether any overlap was detected */
  hasOverlap: boolean;
}

/**
 * Detect and remove overlapping text between checkpoint and continuation.
 *
 * When LLMs continue from a checkpoint, they often repeat some words from the end
 * of the checkpoint at the beginning of their continuation. This function detects
 * the longest suffix of the checkpoint that matches a prefix of the continuation
 * and returns the deduplicated continuation.
 *
 * Uses an optimized algorithm that checks from longest possible overlap down to
 * minimum, with early termination when a match is found.
 *
 * @param checkpoint - The checkpoint content (what we already have)
 * @param continuation - The continuation content (new content from LLM)
 * @param options - Optional configuration
 * @param options.minOverlap - Minimum overlap length to consider (default: 2)
 * @param options.maxOverlap - Maximum overlap length to check (default: min(500, continuation.length))
 * @param options.caseSensitive - Whether to use case-sensitive matching (default: true)
 * @param options.normalizeWhitespace - Whether to normalize whitespace for matching (default: false)
 * @returns OverlapDetectionResult with overlap info and deduplicated continuation
 *
 * @example
 * ```typescript
 * const result = detectOverlap("Hello world", "world is great");
 * // result.overlapLength === 5
 * // result.overlapText === "world"
 * // result.deduplicatedContinuation === " is great"
 * // result.hasOverlap === true
 * ```
 *
 * @example
 * ```typescript
 * // With whitespace normalization
 * const result = detectOverlap("Hello  world", "world   is great", {
 *   normalizeWhitespace: true
 * });
 * // Matches despite different whitespace
 * ```
 */
export function detectOverlap(
  checkpoint: string,
  continuation: string,
  options: {
    minOverlap?: number;
    maxOverlap?: number;
    caseSensitive?: boolean;
    normalizeWhitespace?: boolean;
  } = {},
): OverlapDetectionResult {
  // Handle edge cases first (before accessing properties)
  if (
    !checkpoint ||
    !continuation ||
    checkpoint.length === 0 ||
    continuation.length === 0
  ) {
    return {
      overlapLength: 0,
      overlapText: "",
      deduplicatedContinuation: continuation || "",
      hasOverlap: false,
    };
  }

  const {
    minOverlap = 2,
    maxOverlap = Math.min(500, continuation.length),
    caseSensitive = true,
    normalizeWhitespace = false,
  } = options;

  // Prepare strings for comparison
  let checkpointForMatch = checkpoint;
  let continuationForMatch = continuation;

  if (!caseSensitive) {
    checkpointForMatch = checkpoint.toLowerCase();
    continuationForMatch = continuation.toLowerCase();
  }

  if (normalizeWhitespace) {
    // Normalize multiple whitespace to single space for matching
    checkpointForMatch = checkpointForMatch.replace(/\s+/g, " ");
    continuationForMatch = continuationForMatch.replace(/\s+/g, " ");
  }

  // Calculate the maximum possible overlap
  const maxPossibleOverlap = Math.min(
    checkpointForMatch.length,
    continuationForMatch.length,
    maxOverlap,
  );

  // If max possible is less than minimum, no overlap possible
  if (maxPossibleOverlap < minOverlap) {
    return {
      overlapLength: 0,
      overlapText: "",
      deduplicatedContinuation: continuation,
      hasOverlap: false,
    };
  }

  // Find longest suffix of checkpoint that matches a prefix of continuation.
  // Instead of O(n*m) loop with string slices, scan once from the end of
  // checkpoint to find candidate start positions, then verify.
  // We only need to check suffixes of checkpoint that start with the same
  // character as continuation[0].
  const firstChar = continuationForMatch[0]!;
  const searchStart = Math.max(
    0,
    checkpointForMatch.length - maxPossibleOverlap,
  );
  let bestOverlapLen = 0;

  // Scan checkpoint for positions where continuation could align
  for (let i = searchStart; i <= checkpointForMatch.length - minOverlap; i++) {
    if (checkpointForMatch[i] !== firstChar) continue;

    // Candidate: suffix starting at i
    const suffixLen = checkpointForMatch.length - i;
    if (suffixLen < minOverlap || suffixLen <= bestOverlapLen) continue;
    if (suffixLen > continuationForMatch.length) continue;

    // Verify full match
    let match = true;
    for (let j = 1; j < suffixLen; j++) {
      if (checkpointForMatch[i + j] !== continuationForMatch[j]) {
        match = false;
        break;
      }
    }

    if (match) {
      bestOverlapLen = suffixLen;
    }
  }

  if (bestOverlapLen >= minOverlap) {
    let actualOverlapLength = bestOverlapLen;

    if (normalizeWhitespace) {
      // Map normalized overlap length back to original continuation positions
      let normalizedPos = 0;
      let originalPos = 0;

      while (
        normalizedPos < bestOverlapLen &&
        originalPos < continuation.length
      ) {
        if (/\s/.test(continuation[originalPos]!)) {
          if (
            normalizedPos < bestOverlapLen &&
            continuationForMatch[normalizedPos] === " "
          ) {
            normalizedPos++;
            originalPos++;
            while (
              originalPos < continuation.length &&
              /\s/.test(continuation[originalPos]!)
            ) {
              originalPos++;
            }
          } else {
            originalPos++;
          }
        } else {
          normalizedPos++;
          originalPos++;
        }
      }
      actualOverlapLength = originalPos;
    }

    return {
      overlapLength: actualOverlapLength,
      overlapText: continuation.slice(0, actualOverlapLength),
      deduplicatedContinuation: continuation.slice(actualOverlapLength),
      hasOverlap: true,
    };
  }

  // No overlap found
  return {
    overlapLength: 0,
    overlapText: "",
    deduplicatedContinuation: continuation,
    hasOverlap: false,
  };
}

/**
 * Remove overlapping content from continuation based on checkpoint.
 * Convenience wrapper around detectOverlap that just returns the deduplicated string.
 *
 * @param checkpoint - The checkpoint content
 * @param continuation - The continuation content
 * @param options - Same options as detectOverlap
 * @returns The continuation with any overlapping prefix removed
 */
export function deduplicateContinuation(
  checkpoint: string,
  continuation: string,
  options: {
    minOverlap?: number;
    maxOverlap?: number;
    caseSensitive?: boolean;
    normalizeWhitespace?: boolean;
  } = {},
): string {
  return detectOverlap(checkpoint, continuation, options)
    .deduplicatedContinuation;
}
