// L0 Consensus API - Multi-generation consensus for correctness

import type { z } from "zod";
import type {
  ConsensusOptions,
  ConsensusResult,
  ConsensusOutput,
  ConsensusAnalysis,
  Agreement,
  Disagreement,
} from "./types/consensus";
import { l0 } from "./runtime/l0";
import { structured } from "./structured";
import {
  calculateSimilarityMatrix,
  findAgreements,
  findDisagreements,
  calculateFieldConsensus,
  resolveMajority,
  resolveBest,
  resolveMerge,
  meetsMinimumAgreement,
} from "./utils/consensusUtils";

/**
 * Generate consensus from multiple LLM outputs
 *
 * Runs multiple generations and resolves disagreements to produce
 * a high-confidence consensus result.
 *
 * @param options - Consensus options
 * @returns Consensus result with agreements, disagreements, and confidence
 *
 * @example
 * ```typescript
 * // Text-based consensus
 * const result = await consensus({
 *   streams: [
 *     () => streamText({ model: openai('gpt-4o'), prompt }),
 *     () => streamText({ model: openai('gpt-4o'), prompt }),
 *     () => streamText({ model: openai('gpt-4o'), prompt })
 *   ]
 * });
 *
 * console.log('Consensus:', result.consensus);
 * console.log('Confidence:', result.confidence);
 *
 * // Structured consensus with schema
 * const result = await consensus({
 *   streams: [
 *     () => streamText({ model, prompt }),
 *     () => streamText({ model, prompt }),
 *     () => streamText({ model, prompt })
 *   ],
 *   schema: z.object({
 *     answer: z.string(),
 *     confidence: z.number()
 *   }),
 *   strategy: 'majority'
 * });
 * ```
 */
export async function consensus<T extends z.ZodTypeAny = z.ZodTypeAny>(
  options: ConsensusOptions<T>,
): Promise<ConsensusResult<z.infer<T>>> {
  const {
    streams,
    schema,
    strategy = "majority",
    threshold = 0.8,
    resolveConflicts = "vote",
    weights,
    minimumAgreement = 0.6,
    timeout,
    signal,
    detectZeroTokens = true,
    monitoring,
    onComplete,
    onConsensus,
    metadata,
  } = options;

  if (streams.length < 2) {
    throw new Error("Consensus requires at least 2 streams");
  }

  const startTime = Date.now();
  const outputs: ConsensusOutput[] = [];
  const defaultWeights = weights || streams.map(() => 1.0);

  // Execute all streams
  const promises = streams.map(async (streamFactory, index) => {
    const outputStartTime = Date.now();

    try {
      if (schema) {
        // Structured output with schema validation
        const result = await structured({
          schema,
          stream: streamFactory,
          monitoring,
          detectZeroTokens,
        });

        // Structured result already has parsed data
        const text = result.raw || JSON.stringify(result.data);

        return {
          index,
          text,
          data: result.data,
          l0Result: undefined,
          structuredResult: result,
          status: "success" as const,
          duration: Date.now() - outputStartTime,
          weight: defaultWeights[index] ?? 1.0,
        };
      } else {
        // Regular text output
        const result = await l0({
          stream: streamFactory,
          monitoring,
          signal,
          detectZeroTokens,
        });

        // Consume stream
        let text = "";
        for await (const event of result.stream) {
          if (event.type === "token" && event.value) {
            text += event.value;
          }
        }

        return {
          index,
          text: text || result.state.content,
          data: undefined,
          l0Result: result,
          status: "success" as const,
          duration: Date.now() - outputStartTime,
          weight: defaultWeights[index] ?? 1.0,
        };
      }
    } catch (error) {
      return {
        index,
        text: "",
        data: undefined,
        l0Result: undefined,
        status: "error" as const,
        error: error instanceof Error ? error : new Error(String(error)),
        duration: Date.now() - outputStartTime,
        weight: defaultWeights[index] ?? 1.0,
      };
    }
  });

  // Wait for all streams with timeout
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = timeout
    ? new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("Consensus timeout")),
          timeout,
        );
      })
    : null;

  let results: typeof outputs;
  try {
    results = timeoutPromise
      ? await Promise.race([Promise.all(promises), timeoutPromise])
      : await Promise.all(promises);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  outputs.push(...results);

  // Call onComplete callback
  if (onComplete) {
    await onComplete(outputs);
  }

  // Filter successful outputs
  const successfulOutputs = outputs.filter((o) => o.status === "success");

  if (successfulOutputs.length === 0) {
    throw new Error("All consensus streams failed");
  }

  // Calculate similarity matrix
  const similarityMatrix = calculateSimilarityMatrix(successfulOutputs);

  // Calculate average similarity
  let totalSimilarity = 0;
  let comparisons = 0;
  let minSimilarity = 1.0;
  let maxSimilarity = 0.0;

  for (let i = 0; i < similarityMatrix.length; i++) {
    for (let j = i + 1; j < similarityMatrix.length; j++) {
      const sim = similarityMatrix[i]?.[j] ?? 0;
      totalSimilarity += sim;
      comparisons++;
      minSimilarity = Math.min(minSimilarity, sim);
      maxSimilarity = Math.max(maxSimilarity, sim);
    }
  }

  const averageSimilarity =
    comparisons > 0 ? totalSimilarity / comparisons : 1.0;

  // Fix bounds when there are no comparisons (0 or 1 outputs)
  if (comparisons === 0) {
    minSimilarity = 1.0;
    maxSimilarity = 1.0;
  }

  // Find agreements and disagreements
  const agreements = findAgreements(successfulOutputs, threshold);
  const disagreements = findDisagreements(successfulOutputs, threshold);

  // Check minimum agreement
  if (
    !meetsMinimumAgreement(
      agreements,
      successfulOutputs.length,
      minimumAgreement,
    )
  ) {
    if (resolveConflicts === "fail") {
      // Mirror the ratio definition used by meetsMinimumAgreement so the
      // reported number actually corresponds to the failed check.
      const actualRatio =
        agreements.length === 0
          ? 0
          : Math.max(
              ...agreements.map((a) => a.count / successfulOutputs.length),
            );
      throw new Error(
        `Consensus failed: agreement ratio ${actualRatio} below minimum ${minimumAgreement}`,
      );
    }
  }

  // Map weights to match successfulOutputs (align by original stream index)
  const alignedWeights = successfulOutputs.map(
    (o) => defaultWeights[o.index] ?? 1.0,
  );

  // Resolve consensus based on strategy
  let consensusOutput: ConsensusOutput;

  switch (strategy) {
    case "majority":
      consensusOutput = resolveMajority(successfulOutputs, alignedWeights);
      break;

    case "unanimous":
      // Check if all outputs are similar
      if (averageSimilarity < 0.95) {
        if (resolveConflicts === "fail") {
          throw new Error("Unanimous consensus failed: outputs differ");
        }
        consensusOutput = resolveMajority(successfulOutputs, alignedWeights);
      } else {
        consensusOutput = successfulOutputs[0]!;
      }
      break;

    case "weighted":
      if (!weights) {
        throw new Error("Weighted strategy requires weights to be provided");
      }
      consensusOutput = resolveMajority(
        successfulOutputs,
        successfulOutputs.map((o) => weights[o.index] ?? 1.0),
      );
      break;

    case "best":
      consensusOutput = resolveBest(successfulOutputs, alignedWeights);
      break;

    default:
      consensusOutput = resolveMajority(successfulOutputs, alignedWeights);
  }

  // Apply conflict resolution if needed
  if (disagreements.length > 0 && resolveConflicts !== "vote") {
    switch (resolveConflicts) {
      case "merge":
        consensusOutput = resolveMerge(successfulOutputs);
        break;

      case "best":
        consensusOutput = resolveBest(successfulOutputs, alignedWeights);
        break;

      case "fail":
        throw new Error(
          `Consensus failed: ${disagreements.length} disagreements found`,
        );
    }
  }

  // Mark disagreements as resolved
  disagreements.forEach((d) => {
    d.resolution = resolveConflicts;
    d.resolutionConfidence = averageSimilarity;
  });

  // Calculate field-level consensus for structured outputs
  const fieldConsensus = schema
    ? calculateFieldConsensus(successfulOutputs)
    : undefined;

  // Calculate overall confidence
  const confidence = calculateConfidence(
    successfulOutputs,
    agreements,
    disagreements,
    averageSimilarity,
    strategy,
  );

  // Count identical outputs
  const identicalOutputs = countIdenticalOutputs(successfulOutputs);

  // Build analysis
  const analysis: ConsensusAnalysis = {
    totalOutputs: outputs.length,
    successfulOutputs: successfulOutputs.length,
    failedOutputs: outputs.length - successfulOutputs.length,
    identicalOutputs,
    similarityMatrix,
    averageSimilarity,
    minSimilarity,
    maxSimilarity,
    totalAgreements: agreements.length,
    totalDisagreements: disagreements.length,
    strategy,
    conflictResolution: resolveConflicts,
    duration: Date.now() - startTime,
  };

  // Determine status
  const status =
    successfulOutputs.length === outputs.length
      ? "success"
      : successfulOutputs.length > 0
        ? "partial"
        : "failed";

  // Build result
  const result: ConsensusResult<z.infer<T>> = {
    consensus: schema ? consensusOutput.data : consensusOutput.text,
    confidence,
    outputs,
    agreements,
    disagreements,
    analysis,
    type: schema ? "structured" : "text",
    fieldConsensus,
    status,
    metadata,
  };

  // Call onConsensus callback
  if (onConsensus) {
    await onConsensus(result);
  }

  return result;
}

/**
 * Calculate overall confidence score
 */
function calculateConfidence(
  outputs: ConsensusOutput[],
  agreements: Agreement[],
  disagreements: Disagreement[],
  averageSimilarity: number,
  strategy: string,
): number {
  if (outputs.length === 1) return 0.5;

  // Base confidence on similarity and agreements
  let confidence = averageSimilarity;

  // Boost for strong agreements
  if (agreements.length > 0) {
    const maxAgreementRatio = Math.max(...agreements.map((a) => a.ratio));
    confidence = (confidence + maxAgreementRatio) / 2;
  }

  // Penalize for disagreements
  if (disagreements.length > 0) {
    const majorDisagreements = disagreements.filter(
      (d) => d.severity === "major" || d.severity === "critical",
    ).length;
    const penalty = majorDisagreements * 0.1;
    confidence = Math.max(0, confidence - penalty);
  }

  // Boost for unanimous strategy with high similarity
  if (strategy === "unanimous" && averageSimilarity > 0.95) {
    confidence = Math.min(1.0, confidence + 0.1);
  }

  return Math.max(0, Math.min(1.0, confidence));
}

/**
 * Count identical outputs
 */
function countIdenticalOutputs(outputs: ConsensusOutput[]): number {
  if (outputs.length === 0) return 0;

  const counts = new Map<string, number>();
  for (const o of outputs) {
    counts.set(o.text, (counts.get(o.text) || 0) + 1);
  }
  return Math.max(...counts.values());
}

/**
 * Quick consensus check - returns true if outputs agree
 *
 * @param outputs - Array of text outputs
 * @param threshold - Similarity threshold
 * @returns Whether outputs have consensus
 *
 * @example
 * ```typescript
 * const outputs = ['answer A', 'answer A', 'answer B'];
 * const hasConsensus = quickConsensus(outputs); // false
 * ```
 */
export function quickConsensus(
  outputs: string[],
  threshold: number = 0.8,
): boolean {
  if (outputs.length < 2) return true;

  // Check if majority agree
  const counts = new Map<string, number>();
  outputs.forEach((output) => {
    counts.set(output, (counts.get(output) || 0) + 1);
  });

  const maxCount = Math.max(...Array.from(counts.values()));
  const ratio = maxCount / outputs.length;

  return ratio >= threshold;
}

/**
 * Get consensus value from array of outputs
 *
 * @param outputs - Array of outputs
 * @returns Most common output
 *
 * @example
 * ```typescript
 * const value = getConsensusValue(['A', 'A', 'B']); // 'A'
 * ```
 */
export function getConsensusValue<T = any>(outputs: T[]): T {
  if (outputs.length === 0) {
    throw new Error("No outputs to get consensus from");
  }

  const counts = new Map<string, { value: T; count: number }>();

  outputs.forEach((output) => {
    const key = JSON.stringify(output);
    const existing = counts.get(key);
    if (existing) {
      existing.count++;
    } else {
      counts.set(key, { value: output, count: 1 });
    }
  });

  let maxCount = 0;
  let consensusValue: T = outputs[0]!;

  for (const { value, count } of counts.values()) {
    if (count > maxCount) {
      maxCount = count;
      consensusValue = value;
    }
  }

  return consensusValue;
}

/**
 * Validate consensus result meets criteria
 *
 * @param result - Consensus result
 * @param minConfidence - Minimum confidence required
 * @param maxDisagreements - Maximum disagreements allowed
 * @returns Whether consensus is valid
 */
export function validateConsensus(
  result: ConsensusResult,
  minConfidence: number = 0.8,
  maxDisagreements: number = 0,
): boolean {
  if (result.confidence < minConfidence) {
    return false;
  }

  const criticalDisagreements = result.disagreements.filter(
    (d) => d.severity === "major" || d.severity === "critical",
  ).length;

  if (criticalDisagreements > maxDisagreements) {
    return false;
  }

  return true;
}
