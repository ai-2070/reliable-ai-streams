// Consensus utilities for agreement detection and conflict resolution

import type {
  ConsensusOutput,
  Agreement,
  Disagreement,
  AgreementType,
  DisagreementSeverity,
  FieldAgreement,
  FieldConsensus,
} from "../types/consensus";
import { compareStrings, deepEqual } from "./comparison";

/**
 * Calculate pairwise similarity matrix for all outputs
 *
 * @param outputs - Array of consensus outputs
 * @returns Similarity matrix (NxN)
 */
export function calculateSimilarityMatrix(
  outputs: ConsensusOutput[],
): number[][] {
  const n = outputs.length;
  const matrix: number[][] = Array(n)
    .fill(0)
    .map(() => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    matrix[i]![i] = 1.0; // Self-similarity

    for (let j = i + 1; j < n; j++) {
      const similarity = calculateOutputSimilarity(outputs[i]!, outputs[j]!);
      matrix[i]![j] = similarity;
      matrix[j]![i] = similarity;
    }
  }

  return matrix;
}

/**
 * Calculate similarity between two outputs
 *
 * @param a - First output
 * @param b - Second output
 * @returns Similarity score (0-1)
 */
export function calculateOutputSimilarity(
  a: ConsensusOutput,
  b: ConsensusOutput,
): number {
  // If both have structured data, compare structurally
  if (a.data && b.data) {
    return calculateStructuralSimilarity(a.data, b.data);
  }

  // Otherwise, compare text
  return compareStrings(a.text, b.text, {
    caseSensitive: false,
    normalizeWhitespace: true,
    algorithm: "levenshtein",
  });
}

/**
 * Calculate structural similarity between two objects
 * Optimized with early termination for identical values
 *
 * @param a - First object
 * @param b - Second object
 * @returns Similarity score (0-1)
 */
export function calculateStructuralSimilarity(a: any, b: any): number {
  // Fast path: reference equality
  if (a === b) return 1.0;

  // Fast path: null/undefined
  if (a === null || a === undefined)
    return b === null || b === undefined ? 1.0 : 0.0;
  if (b === null || b === undefined) return 0.0;

  const typeA = typeof a;
  const typeB = typeof b;

  // Type mismatch - early termination
  if (typeA !== typeB) return 0.0;

  // Primitives
  if (typeA !== "object") {
    if (typeA === "string") {
      // Fast path: identical strings
      if (a === b) return 1.0;
      return compareStrings(a, b, {
        caseSensitive: false,
        normalizeWhitespace: true,
      });
    }

    if (typeA === "number") {
      if (a === b) return 1.0;
      const maxDiff = Math.max(Math.abs(a), Math.abs(b));
      if (maxDiff === 0) return 1.0;
      return 1 - Math.abs(a - b) / maxDiff;
    }

    // boolean or other primitives
    return a === b ? 1.0 : 0.0;
  }

  // Array comparison
  const isArrayA = Array.isArray(a);
  const isArrayB = Array.isArray(b);

  if (isArrayA !== isArrayB) return 0.0;

  if (isArrayA) {
    const lengthA = a.length;
    const lengthB = b.length;
    const maxLength = Math.max(lengthA, lengthB);

    if (maxLength === 0) return 1.0;

    // Fast path: check if arrays are deeply equal first
    if (lengthA === lengthB && deepEqual(a, b)) return 1.0;

    let matches = 0;
    const minLength = Math.min(lengthA, lengthB);
    for (let i = 0; i < minLength; i++) {
      matches += calculateStructuralSimilarity(a[i], b[i]);
    }

    return matches / maxLength;
  }

  // Object comparison
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  // Fast path: check if objects are deeply equal first
  if (keysA.length === keysB.length && deepEqual(a, b)) return 1.0;

  const allKeys = new Set([...keysA, ...keysB]);
  const total = allKeys.size;

  if (total === 0) return 1.0;

  let matches = 0;
  for (const key of allKeys) {
    if (key in a && key in b) {
      matches += calculateStructuralSimilarity(a[key], b[key]);
    }
    // Keys only in one object contribute 0 to matches (implicitly)
  }

  return matches / total;
}

/**
 * Find agreements across outputs
 *
 * @param outputs - Array of consensus outputs
 * @param threshold - Similarity threshold for agreement
 * @returns Array of agreements
 */
export function findAgreements(
  outputs: ConsensusOutput[],
  threshold: number = 0.8,
): Agreement[] {
  const agreements: Agreement[] = [];

  // For text-based consensus
  if (!outputs[0]?.data) {
    const textAgreements = findTextAgreements(outputs, threshold);
    agreements.push(...textAgreements);
  } else {
    // For structured consensus
    const structuredAgreements = findStructuredAgreements(outputs, threshold);
    agreements.push(...structuredAgreements);
  }

  return agreements;
}

/**
 * Find text-based agreements
 */
function findTextAgreements(
  outputs: ConsensusOutput[],
  threshold: number,
): Agreement[] {
  const agreements: Agreement[] = [];

  // Group similar outputs
  const groups: number[][] = [];
  const used = new Set<number>();

  for (let i = 0; i < outputs.length; i++) {
    if (used.has(i)) continue;

    const group = [i];
    used.add(i);

    for (let j = i + 1; j < outputs.length; j++) {
      if (used.has(j)) continue;

      const similarity = calculateOutputSimilarity(outputs[i]!, outputs[j]!);
      if (similarity >= threshold) {
        group.push(j);
        used.add(j);
      }
    }

    if (group.length > 1) {
      groups.push(group);
    }
  }

  // Create agreements from groups
  for (const group of groups) {
    const content = outputs[group[0]!]!.text;
    const type: AgreementType =
      group.length === outputs.length ? "exact" : "similar";

    agreements.push({
      content,
      count: group.length,
      ratio: group.length / outputs.length,
      indices: group,
      type,
    });
  }

  return agreements;
}

/**
 * Find structured agreements (field-by-field)
 */
function findStructuredAgreements(
  outputs: ConsensusOutput[],
  threshold: number,
): Agreement[] {
  const agreements: Agreement[] = [];

  // Get all field paths
  const allPaths = new Set<string>();
  for (const output of outputs) {
    if (output.data) {
      getAllPaths(output.data).forEach((p) => allPaths.add(p));
    }
  }

  // Check agreement for each field
  for (const path of allPaths) {
    const values = outputs
      .map((o) => getValueAtPath(o.data, path))
      .filter((v) => v !== undefined);

    if (values.length === 0) continue;

    // Count identical values
    const valueCounts = new Map<string, number[]>();
    values.forEach((v, i) => {
      const key = JSON.stringify(v);
      if (!valueCounts.has(key)) {
        valueCounts.set(key, []);
      }
      valueCounts.get(key)!.push(i);
    });

    // Find majority
    let maxCount = 0;
    let majorityValue: any;
    let majorityIndices: number[] = [];

    for (const [key, indices] of valueCounts) {
      if (indices.length > maxCount) {
        maxCount = indices.length;
        majorityValue = JSON.parse(key);
        majorityIndices = indices;
      }
    }

    const ratio = maxCount / outputs.length;
    if (ratio >= threshold) {
      agreements.push({
        content: majorityValue,
        path,
        count: maxCount,
        ratio,
        indices: majorityIndices,
        type: ratio === 1.0 ? "exact" : "structural",
      });
    }
  }

  return agreements;
}

/**
 * Find disagreements across outputs
 *
 * @param outputs - Array of consensus outputs
 * @param threshold - Disagreement threshold
 * @returns Array of disagreements
 */
export function findDisagreements(
  outputs: ConsensusOutput[],
  threshold: number = 0.8,
): Disagreement[] {
  const disagreements: Disagreement[] = [];

  // For structured outputs
  if (outputs[0]?.data) {
    const structuredDisagreements = findStructuredDisagreements(
      outputs,
      threshold,
    );
    disagreements.push(...structuredDisagreements);
  } else {
    // For text outputs
    const textDisagreements = findTextDisagreements(outputs, threshold);
    disagreements.push(...textDisagreements);
  }

  return disagreements;
}

/**
 * Find text-based disagreements
 */
function findTextDisagreements(
  outputs: ConsensusOutput[],
  threshold: number,
): Disagreement[] {
  const disagreements: Disagreement[] = [];

  // Group outputs by similarity
  const valueCounts = new Map<string, number[]>();

  outputs.forEach((output, i) => {
    const text = output.text.trim();
    let grouped = false;

    // Try to group with existing
    for (const [key, indices] of valueCounts) {
      const similarity = compareStrings(text, key);
      if (similarity >= threshold) {
        indices.push(i);
        grouped = true;
        break;
      }
    }

    if (!grouped) {
      valueCounts.set(text, [i]);
    }
  });

  // If more than one group, it's a disagreement
  if (valueCounts.size > 1) {
    const values = Array.from(valueCounts.entries()).map(
      ([value, indices]) => ({
        value,
        count: indices.length,
        indices,
      }),
    );

    const severity = calculateDisagreementSeverity(values, outputs.length);

    disagreements.push({
      values,
      severity,
    });
  }

  return disagreements;
}

/**
 * Find structured disagreements (field-by-field)
 * @param outputs - Array of consensus outputs to compare
 * @param threshold - Agreement threshold; fields where majority agrees above this are not considered disagreements
 */
function findStructuredDisagreements(
  outputs: ConsensusOutput[],
  threshold: number,
): Disagreement[] {
  const disagreements: Disagreement[] = [];

  // Get all field paths
  const allPaths = new Set<string>();
  for (const output of outputs) {
    if (output.data) {
      getAllPaths(output.data).forEach((p) => allPaths.add(p));
    }
  }

  // Check each field for disagreement
  for (const path of allPaths) {
    const values = outputs.map((o, idx) => ({
      value: getValueAtPath(o.data, path),
      index: idx,
    }));

    // Group by value
    const valueCounts = new Map<string, number[]>();
    values.forEach(({ value, index }) => {
      if (value === undefined) return;
      const key = JSON.stringify(value);
      if (!valueCounts.has(key)) {
        valueCounts.set(key, []);
      }
      valueCounts.get(key)!.push(index);
    });

    // If more than one value, check if it's a significant disagreement
    if (valueCounts.size > 1) {
      const distinctValues = Array.from(valueCounts.entries()).map(
        ([value, indices]) => ({
          value: JSON.parse(value),
          count: indices.length,
          indices,
        }),
      );

      // Find the majority agreement ratio
      const maxCount = Math.max(...distinctValues.map((v) => v.count));
      const majorityRatio = maxCount / outputs.length;

      // Skip if majority agrees above threshold (not a significant disagreement)
      if (majorityRatio >= threshold) {
        continue;
      }

      const severity = calculateDisagreementSeverity(
        distinctValues,
        outputs.length,
      );

      disagreements.push({
        path,
        values: distinctValues,
        severity,
      });
    }
  }

  return disagreements;
}

/**
 * Calculate severity of disagreement
 */
function calculateDisagreementSeverity(
  values: Array<{ value: any; count: number; indices: number[] }>,
  total: number,
): DisagreementSeverity {
  // Find majority count
  const maxCount = Math.max(...values.map((v) => v.count));
  const ratio = maxCount / total;

  if (ratio >= 0.8) {
    return "minor"; // Strong majority
  } else if (ratio >= 0.6) {
    return "moderate"; // Weak majority
  } else if (ratio >= 0.4) {
    return "major"; // No clear majority
  } else {
    return "critical"; // Complete split
  }
}

/**
 * Calculate field-level consensus for structured outputs
 *
 * @param outputs - Array of consensus outputs
 * @returns Field consensus information
 */
export function calculateFieldConsensus(
  outputs: ConsensusOutput[],
): FieldConsensus {
  const fields: Record<string, FieldAgreement> = {};

  // Get all field paths
  const allPaths = new Set<string>();
  for (const output of outputs) {
    if (output.data) {
      getAllPaths(output.data).forEach((p) => allPaths.add(p));
    }
  }

  // Calculate consensus for each field
  for (const path of allPaths) {
    const values = outputs
      .map((o, i) => ({ value: getValueAtPath(o.data, path), index: i }))
      .filter((v) => v.value !== undefined);

    if (values.length === 0) continue;

    // Count votes
    const votes: Record<string, number> = {};
    const allValues: any[] = [];

    values.forEach(({ value }) => {
      const key = JSON.stringify(value);
      votes[key] = (votes[key] || 0) + 1;
      allValues.push(value);
    });

    // Find consensus value
    let maxVotes = 0;
    let consensusValue: any;
    for (const [key, count] of Object.entries(votes)) {
      if (count > maxVotes) {
        maxVotes = count;
        consensusValue = JSON.parse(key);
      }
    }

    const agreement = maxVotes / outputs.length;
    const unanimous = maxVotes === outputs.length;
    const confidence = agreement;

    fields[path] = {
      path,
      value: consensusValue,
      agreement,
      votes,
      values: allValues,
      unanimous,
      confidence,
    };
  }

  // Calculate overall metrics
  const agreedFields = Object.keys(fields).filter((k) => fields[k]!.unanimous);
  const disagreedFields = Object.keys(fields).filter(
    (k) => !fields[k]!.unanimous,
  );
  const fieldCount = Object.keys(fields).length;
  const overallAgreement =
    fieldCount > 0
      ? Object.values(fields).reduce((sum, f) => sum + f.agreement, 0) /
        fieldCount
      : 0;

  return {
    fields,
    overallAgreement,
    agreedFields,
    disagreedFields,
  };
}

/**
 * Get all paths in an object (dot notation)
 */
function getAllPaths(obj: any, prefix: string = ""): string[] {
  const paths: string[] = [];

  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const key of Object.keys(obj)) {
      const path = prefix ? `${prefix}.${key}` : key;
      paths.push(path);

      const value = obj[key];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        paths.push(...getAllPaths(value, path));
      }
    }
  }

  return paths;
}

/**
 * Get value at path in object
 */
function getValueAtPath(obj: any, path: string): any {
  if (!obj) return undefined;

  const parts = path.split(".");
  let current = obj;

  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = current[part];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Resolve consensus using majority vote
 *
 * @param outputs - Array of consensus outputs
 * @param weights - Optional weights for each output
 * @returns Consensus output
 */
export function resolveMajority(
  outputs: ConsensusOutput[],
  weights?: number[],
): ConsensusOutput {
  if (outputs.length === 0) {
    throw new Error("No outputs to resolve");
  }

  // Use weights if provided
  const outputWeights = weights || outputs.map((o) => o.weight ?? 1);

  // For structured outputs, do field-by-field voting
  if (outputs[0]!.data) {
    const fieldConsensus = calculateFieldConsensus(outputs);
    const consensusData: any = {};

    for (const [path, field] of Object.entries(fieldConsensus.fields)) {
      setValueAtPath(consensusData, path, field.value);
    }

    return {
      ...outputs[0]!,
      index: outputs[0]!.index ?? 0,
      data: consensusData,
      text: JSON.stringify(consensusData),
    };
  }

  // For text outputs, find most similar to all
  let bestIndex = 0;
  let bestScore = -1;

  for (let i = 0; i < outputs.length; i++) {
    let score = 0;
    for (let j = 0; j < outputs.length; j++) {
      if (i !== j) {
        const similarity = calculateOutputSimilarity(outputs[i]!, outputs[j]!);
        score += similarity * (outputWeights[j] ?? 1);
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return outputs[bestIndex]!;
}

/**
 * Resolve consensus by choosing best output
 *
 * @param outputs - Array of consensus outputs
 * @param weights - Optional weights for each output
 * @returns Best output
 */
export function resolveBest(
  outputs: ConsensusOutput[],
  weights?: number[],
): ConsensusOutput {
  if (outputs.length === 0) {
    throw new Error("No outputs to resolve");
  }

  const outputWeights = weights || outputs.map((o) => o.weight ?? 1);

  // Find output with highest weight
  let bestIndex = 0;
  let bestWeight = outputWeights[0] ?? 1;

  for (let i = 1; i < outputs.length; i++) {
    if ((outputWeights[i] ?? 1) > bestWeight) {
      bestWeight = outputWeights[i] ?? 1;
      bestIndex = i;
    }
  }

  return outputs[bestIndex]!;
}

/**
 * Resolve consensus by merging all outputs
 *
 * @param outputs - Array of consensus outputs
 * @returns Merged output
 */
export function resolveMerge(outputs: ConsensusOutput[]): ConsensusOutput {
  if (outputs.length === 0) {
    throw new Error("No outputs to resolve");
  }

  if (outputs.length === 1) {
    return outputs[0]!;
  }

  // For structured outputs, merge field by field
  if (outputs[0]!.data) {
    const merged: any = {};
    const allPaths = new Set<string>();

    outputs.forEach((o) => {
      if (o.data) {
        getAllPaths(o.data).forEach((p) => allPaths.add(p));
      }
    });

    for (const path of allPaths) {
      const values = outputs
        .map((o) => getValueAtPath(o.data, path))
        .filter((v) => v !== undefined);

      // Take first non-undefined value (or could use voting)
      if (values.length > 0) {
        setValueAtPath(merged, path, values[0]);
      }
    }

    return {
      ...outputs[0]!,
      index: outputs[0]!.index ?? 0,
      data: merged,
      text: JSON.stringify(merged),
    };
  }

  // For text outputs, concatenate unique parts
  const uniqueTexts = Array.from(new Set(outputs.map((o) => o.text.trim())));
  const mergedText = uniqueTexts.join("\n\n");

  return {
    ...outputs[0]!,
    index: outputs[0]!.index ?? 0,
    text: mergedText,
  };
}

/**
 * Set value at path in object
 */
function setValueAtPath(obj: any, path: string, value: any): void {
  const parts = path.split(".");
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (!(part in current)) {
      current[part] = {};
    }
    current = current[part];
  }

  current[parts[parts.length - 1]!] = value;
}

/**
 * Check if consensus meets minimum agreement threshold
 *
 * @param agreements - Array of agreements
 * @param outputs - Total outputs
 * @param threshold - Minimum agreement ratio
 * @returns Whether consensus is sufficient
 */
export function meetsMinimumAgreement(
  agreements: Agreement[],
  outputs: number,
  threshold: number,
): boolean {
  // If threshold is 0, any level of agreement (including none) is acceptable
  if (threshold === 0) return true;

  // Single output is trivially unanimous
  if (outputs === 1) return true;

  if (agreements.length === 0) return false;

  // Find highest agreement ratio (use count/outputs for accuracy)
  const maxRatio = Math.max(...agreements.map((a) => a.count / outputs));
  return maxRatio >= threshold;
}
