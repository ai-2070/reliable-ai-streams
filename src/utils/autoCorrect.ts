// Auto-correction utilities for fixing common JSON issues in LLM output

import type {
  AutoCorrectOptions,
  AutoCorrectResult,
  CorrectionType,
} from "../types/structured";

/**
 * Auto-correct common JSON issues in LLM output
 *
 * @param raw - Raw JSON string from LLM
 * @param options - Auto-correction options
 * @returns Corrected JSON string and list of corrections applied
 */
export function autoCorrectJSON(
  raw: string,
  options: AutoCorrectOptions = {},
): AutoCorrectResult {
  const {
    structural = true,
    stripFormatting = true,
    // schemaBased and strict reserved for future use
  } = options;

  let corrected = raw;
  const corrections: CorrectionType[] = [];

  try {
    // Step 1: Strip formatting (markdown, prefixes, suffixes)
    if (stripFormatting) {
      const { text, applied } = stripUnwantedFormatting(corrected);
      corrected = text;
      corrections.push(...applied);
    }

    // Step 2: Structural fixes (braces, brackets, commas)
    if (structural) {
      const { text, applied } = applyStructuralFixes(corrected);
      corrected = text;
      corrections.push(...applied);
    }

    // Step 3: Quote and escape fixes
    const { text: fixedQuotes, applied: quoteCorrections } =
      fixQuotesAndEscapes(corrected);
    corrected = fixedQuotes;
    corrections.push(...quoteCorrections);

    // Step 4: Validate JSON
    JSON.parse(corrected);

    return {
      corrected,
      success: true,
      corrections,
    };
  } catch (error) {
    return {
      corrected,
      success: false,
      corrections,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Strip unwanted formatting (markdown fences, prefixes, suffixes)
 */
function stripUnwantedFormatting(text: string): {
  text: string;
  applied: CorrectionType[];
} {
  let result = text;
  const applied: CorrectionType[] = [];

  // Remove markdown code fences - handle both strict and embedded cases
  // First try strict case (fence at start/end)
  const strictFenceRegex = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/;
  if (strictFenceRegex.test(result)) {
    result = result.replace(strictFenceRegex, "$1");
    applied.push("strip_markdown_fence");
  } else {
    // Try to extract content from embedded fence
    // Use greedy match but require the closing fence to be on its own line or at string end
    // This handles cases where JSON contains literal ``` sequences
    const embeddedFenceRegex =
      /```(?:json)?\s*\n([\s\S]*?)\n[ \t]*```(?:\s*$|\n)/;
    const match = result.match(embeddedFenceRegex);
    if (match && match[1]) {
      result = match[1];
      applied.push("strip_markdown_fence");
    }
  }

  // Remove "json" prefix at start
  if (result.trim().startsWith("json")) {
    result = result.trim().replace(/^json\s*/i, "");
    applied.push("strip_json_prefix");
  }

  // Remove common LLM prefixes
  const prefixes = [
    /^Here's the JSON:?\s*/i,
    /^Here is the JSON:?\s*/i,
    /^The JSON is:?\s*/i,
    /^Sure,? here's the JSON:?\s*/i,
    /^Certainly[,!]? here's the JSON:?\s*/i,
    /^Output:?\s*/i,
    /^Result:?\s*/i,
    /^Response:?\s*/i,
    /^As an AI[^{]*/i,
    /^I can help[^{]*/i,
  ];

  for (const prefix of prefixes) {
    if (prefix.test(result)) {
      result = result.replace(prefix, "");
      applied.push("remove_prefix_text");
      break;
    }
  }

  // Remove common suffixes (text after closing brace/bracket)
  const suffixes = [
    /[\]}]\s*\n\n.*$/s,
    /[\]}]\s*I hope this helps.*$/is,
    /[\]}]\s*Let me know if.*$/is,
    /[\]}]\s*This JSON.*$/is,
  ];

  for (const suffix of suffixes) {
    if (suffix.test(result)) {
      // Find the last } or ]
      const lastBrace = result.lastIndexOf("}");
      const lastBracket = result.lastIndexOf("]");
      const lastIndex = Math.max(lastBrace, lastBracket);

      if (lastIndex !== -1) {
        result = result.substring(0, lastIndex + 1);
        applied.push("remove_suffix_text");
        break;
      }
    }
  }

  // Remove C-style comments (some models add them)
  if (/\/\*[\s\S]*?\*\/|\/\/.*$/gm.test(result)) {
    result = result.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    applied.push("remove_comments");
  }

  // Trim whitespace
  result = result.trim();

  return { text: result, applied };
}

/**
 * Apply structural fixes (close braces, remove trailing commas, etc.)
 */
function applyStructuralFixes(text: string): {
  text: string;
  applied: CorrectionType[];
} {
  let result = text;
  const applied: CorrectionType[] = [];

  // Count braces and brackets outside of quoted strings
  let openBraces = 0;
  let closeBraces = 0;
  let openBrackets = 0;
  let closeBrackets = 0;
  {
    let inStr = false;
    let esc = false;
    for (let i = 0; i < result.length; i++) {
      const ch = result[i];
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === "\\") {
        esc = true;
        continue;
      }
      if (ch === '"') {
        inStr = !inStr;
        continue;
      }
      if (!inStr) {
        if (ch === "{") openBraces++;
        else if (ch === "}") closeBraces++;
        else if (ch === "[") openBrackets++;
        else if (ch === "]") closeBrackets++;
      }
    }
  }

  // Close missing braces
  if (openBraces > closeBraces) {
    const missing = openBraces - closeBraces;
    result += "}".repeat(missing);
    applied.push("close_brace");
  }

  // Close missing brackets
  if (openBrackets > closeBrackets) {
    const missing = openBrackets - closeBrackets;
    result += "]".repeat(missing);
    applied.push("close_bracket");
  }

  // Remove trailing commas before closing braces/brackets
  const before = result;
  result = result.replace(/,(\s*[}\]])/g, "$1");
  if (result !== before) {
    applied.push("remove_trailing_comma");
  }

  // Remove trailing comma at the very end
  if (result.trim().endsWith(",")) {
    result = result.trim().slice(0, -1);
    applied.push("remove_trailing_comma");
  }

  return { text: result, applied };
}

/**
 * Fix quote issues and escape control characters
 */
function fixQuotesAndEscapes(text: string): {
  text: string;
  applied: CorrectionType[];
} {
  let result = text;
  const applied: CorrectionType[] = [];

  // Escape unescaped control characters in strings
  try {
    // Try to parse - if it fails due to control chars, fix them
    JSON.parse(result);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("control character") ||
        error.message.includes("Bad control character"))
    ) {
      // Escape newlines, tabs, etc. in string values
      result = result.replace(
        /"([^"\\]*(?:\\.[^"\\]*)*)"/g,
        (_match, content) => {
          const escaped = content
            .replace(/\n/g, "\\n")
            .replace(/\r/g, "\\r")
            .replace(/\t/g, "\\t");
          return `"${escaped}"`;
        },
      );
      applied.push("escape_control_chars");
    }
  }

  return { text: result, applied };
}

/**
 * Find the first JSON delimiter ({ or [) that is NOT inside a quoted string
 *
 * @param text - Text to search
 * @returns Object with startIndex, openChar, closeChar or null if not found
 */
function findFirstJSONDelimiter(
  text: string,
): { startIndex: number; openChar: string; closeChar: string } | null {
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    // Only consider delimiters outside of strings
    if (!inString) {
      if (char === "{") {
        return { startIndex: i, openChar: "{", closeChar: "}" };
      }
      if (char === "[") {
        return { startIndex: i, openChar: "[", closeChar: "]" };
      }
    }
  }

  return null;
}

/**
 * Attempt to extract JSON from text that may contain other content
 * Uses balanced brace matching to find the first complete JSON object or array
 * Correctly ignores braces that appear inside quoted strings in surrounding prose
 *
 * @param text - Text that may contain JSON
 * @returns Extracted JSON string or original text
 */
export function extractJSON(text: string): string {
  // Find the first { or [ that is NOT inside a quoted string
  const delimiter = findFirstJSONDelimiter(text);

  if (!delimiter) {
    return text;
  }

  const { startIndex, openChar, closeChar } = delimiter;

  // Use balanced brace matching to find the end
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === openChar) {
      depth++;
    } else if (char === closeChar) {
      depth--;
      if (depth === 0) {
        return text.substring(startIndex, i + 1);
      }
    }
  }

  // Couldn't find balanced braces, fall back to greedy regex
  // Try the detected delimiter type first
  const primaryRegex = openChar === "[" ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/;
  const secondaryRegex = openChar === "[" ? /\{[\s\S]*\}/ : /\[[\s\S]*\]/;

  const primaryMatch = text.match(primaryRegex);
  if (primaryMatch) {
    return primaryMatch[0];
  }

  const secondaryMatch = text.match(secondaryRegex);
  if (secondaryMatch) {
    return secondaryMatch[0];
  }

  return text;
}

/**
 * Check if a string is valid JSON
 *
 * @param text - String to check
 * @returns True if valid JSON
 */
export function isValidJSON(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get a human-readable description of JSON parse error
 *
 * @param error - JSON parse error
 * @returns Human-readable description
 */
export function describeJSONError(error: Error): string {
  const message = error.message.toLowerCase();

  if (message.includes("unexpected end")) {
    return "Incomplete JSON - missing closing braces or brackets";
  }

  if (message.includes("unexpected token")) {
    return "Invalid JSON syntax - unexpected character";
  }

  if (message.includes("control character")) {
    return "Invalid control characters in string values";
  }

  if (message.includes("trailing comma")) {
    return "Trailing commas not allowed in JSON";
  }

  if (message.includes("expected property name")) {
    return "Invalid property name - must be quoted";
  }

  return error.message;
}

/**
 * Repair common JSON structure issues
 * More aggressive than autoCorrectJSON - tries harder to salvage malformed JSON
 *
 * @param text - Potentially malformed JSON
 * @returns Repaired JSON or throws error
 */
export function repairJSON(text: string): string {
  // First try auto-correction
  const autoResult = autoCorrectJSON(text, {
    structural: true,
    stripFormatting: true,
  });

  if (autoResult.success) {
    return autoResult.corrected;
  }

  // Try to extract JSON from surrounding text
  const extracted = extractJSON(text);
  if (extracted !== text) {
    const retryResult = autoCorrectJSON(extracted, {
      structural: true,
      stripFormatting: true,
    });
    if (retryResult.success) {
      return retryResult.corrected;
    }
  }

  // Last resort: try to fix common patterns
  let result = text.trim();

  // Fix single quotes to double quotes (common in some models)
  result = result.replace(/'([^']*?)'/g, '"$1"');

  // Try one more time
  const finalResult = autoCorrectJSON(result, {
    structural: true,
    stripFormatting: true,
  });

  if (finalResult.success) {
    return finalResult.corrected;
  }

  throw new Error(
    `Unable to repair JSON: ${describeJSONError(finalResult.error!)}`,
  );
}

/**
 * Safely parse JSON with auto-correction
 *
 * @param text - JSON string to parse
 * @param options - Auto-correction options
 * @returns Parsed JSON object
 */
export function safeJSONParse<T = any>(
  text: string,
  options: AutoCorrectOptions = {},
): { data: T; corrected: boolean; corrections: CorrectionType[] } {
  // Try parsing as-is first
  try {
    const data = JSON.parse(text);
    return { data, corrected: false, corrections: [] };
  } catch {
    // Try with auto-correction
    const result = autoCorrectJSON(text, options);
    if (result.success) {
      const data = JSON.parse(result.corrected);
      return { data, corrected: true, corrections: result.corrections };
    }
    throw new Error(
      `Failed to parse JSON: ${describeJSONError(result.error!)}`,
    );
  }
}
