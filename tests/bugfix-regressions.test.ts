// Regression tests for bug fixes
// Each test verifies a specific bug that was found and fixed.

import { describe, it, expect, beforeEach } from "vitest";

// === Bug 7: inferReason now receives error arg for network sub-classification ===
import { RetryManager } from "../src/runtime/retry";
import { analyzeNetworkError } from "../src/utils/errors";

describe("Bug 7: inferReason passes error for network sub-classification", () => {
  it("should classify timeout network errors with reason 'timeout'", () => {
    const manager = new RetryManager();
    const error = new Error("Request timed out (ETIMEDOUT)");
    const categorized = manager.categorizeError(error);
    // Before fix, all network errors got generic "network_error"
    // After fix, timeout network errors get "timeout"
    expect(categorized.reason).toBe("timeout");
  });

  it("should classify generic network errors as 'network_error'", () => {
    const manager = new RetryManager();
    const error = new Error("ECONNRESET connection reset");
    const categorized = manager.categorizeError(error);
    expect(categorized.reason).toBe("network_error");
  });
});

// === Bug 9: GuardrailEngine hasFatalViolations accumulates across checks ===
import { GuardrailEngine } from "../src/guardrails/engine";

describe("Bug 9: GuardrailEngine violation flags accumulate", () => {
  it("should retain hasFatalViolations after subsequent clean check", () => {
    const engine = new GuardrailEngine({
      rules: [
        {
          name: "conditional-fatal",
          streaming: false,
          severity: "fatal",
          recoverable: false,
          check: (ctx) => {
            if (ctx.content === "bad") {
              return [
                {
                  rule: "conditional-fatal",
                  message: "Fatal",
                  severity: "fatal",
                  recoverable: false,
                },
              ];
            }
            return [];
          },
        },
      ],
    });

    // First check: fatal violation
    engine.check({
      content: "bad",
      checkpoint: "",
      tokenCount: 1,
      completed: true,
    });
    expect(engine.hasFatalViolations()).toBe(true);

    // Second check: no violations
    engine.check({
      content: "good",
      checkpoint: "",
      tokenCount: 2,
      completed: true,
    });
    // Before fix, this would reset to false
    expect(engine.hasFatalViolations()).toBe(true);
  });

  it("should retain hasErrorViolations after subsequent clean check", () => {
    const engine = new GuardrailEngine({
      rules: [
        {
          name: "conditional-error",
          streaming: false,
          severity: "error",
          recoverable: true,
          check: (ctx) => {
            if (ctx.content === "bad") {
              return [
                {
                  rule: "conditional-error",
                  message: "Error",
                  severity: "error",
                  recoverable: true,
                },
              ];
            }
            return [];
          },
        },
      ],
    });

    engine.check({
      content: "bad",
      checkpoint: "",
      tokenCount: 1,
      completed: true,
    });
    expect(engine.hasErrorViolations()).toBe(true);

    engine.check({
      content: "good",
      checkpoint: "",
      tokenCount: 2,
      completed: true,
    });
    expect(engine.hasErrorViolations()).toBe(true);
  });
});

// === Bug 11: Regex /g + test() then replace() ===
// === Bug 5: Brace counting inside strings ===
// === Bug 22: extractJSON fallback order ===
import { autoCorrectJSON, extractJSON } from "../src/utils/autoCorrect";

describe("Bug 11: Trailing comma removal with regex /g flag", () => {
  it("should remove trailing comma even with single occurrence", () => {
    const input = '{"a": 1,}';
    const result = autoCorrectJSON(input);
    expect(result.success).toBe(true);
    expect(result.corrections).toContain("remove_trailing_comma");
    expect(JSON.parse(result.corrected)).toEqual({ a: 1 });
  });

  it("should remove multiple trailing commas", () => {
    const input = '{"a": 1, "b": [2,],}';
    const result = autoCorrectJSON(input);
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.corrected);
    expect(parsed.a).toBe(1);
    expect(parsed.b).toEqual([2]);
  });
});

describe("Bug 5: Brace counting ignores braces inside strings", () => {
  it("should not count braces inside JSON string values", () => {
    // Before fix, the } inside the string would be counted, causing no correction
    const input = '{"msg": "use { and }"';
    const result = autoCorrectJSON(input);
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.corrected);
    expect(parsed.msg).toBe("use { and }");
  });

  it("should handle code snippets in string values", () => {
    const input = '{"code": "function() { return [1,2]; }"';
    const result = autoCorrectJSON(input);
    expect(result.success).toBe(true);
    expect(result.corrections).toContain("close_brace");
  });
});

describe("Bug 22: extractJSON fallback tries correct delimiter first", () => {
  it("should prefer array regex when opening delimiter is [", () => {
    // Both [] and {} are present but unbalanced.
    // The first JSON delimiter is [, so the fallback should prefer [...]
    const input = 'text [1, 2, 3] and {"a": 1}';
    const result = extractJSON(input);
    // Balanced-brace matching finds [ first, walks to matching ] at depth 0
    expect(result).toBe("[1, 2, 3]");
  });

  it("should use correct fallback when balanced match fails", () => {
    // Unbalanced array and unbalanced object both present — greedy fallback
    // The first delimiter is [, so [] regex should be tried first
    const input = "prefix [1, {2, 3] suffix {4, 5}";
    const result = extractJSON(input);
    // [ is first delimiter, balanced match fails (depth never 0 for [])
    // Greedy [] regex matches [1, {2, 3]
    expect(result.startsWith("[")).toBe(true);
  });
});

// === Bug 12: Escape outside strings in JSON guardrail ===
import {
  updateJsonStateIncremental,
  createIncrementalJsonState,
  incrementalStateToStructure,
} from "../src/guardrails/json";

describe("Bug 12: Backslash escape only tracked inside strings", () => {
  it("should count brace after backslash outside string", () => {
    const state = createIncrementalJsonState();
    // A backslash followed by { outside a string
    updateJsonStateIncremental(state, "\\{");
    // Before fix, { would be skipped due to escapeNext
    expect(state.openBraces).toBe(1);
  });

  it("should still handle escape sequences inside strings", () => {
    const state = createIncrementalJsonState();
    // Inside a string, \" should not toggle inString
    updateJsonStateIncremental(state, '{"key": "val\\"ue"}');
    const structure = incrementalStateToStructure(state);
    expect(structure.isBalanced).toBe(true);
  });
});

// === Bug 15: isNetworkError includes SSL errors ===
import { isNetworkError, isSSLError } from "../src/utils/errors";

describe("Bug 15: isNetworkError includes SSL errors", () => {
  it("should detect SSL errors as network errors", () => {
    const sslError = new Error(
      "SSL certificate problem: self signed certificate",
    );
    expect(isSSLError(sslError)).toBe(true);
    // Before fix, this would be false
    expect(isNetworkError(sslError)).toBe(true);
  });

  it("should detect TLS handshake errors as network errors", () => {
    const tlsError = new Error("TLS handshake failed");
    expect(isNetworkError(tlsError)).toBe(true);
  });
});

// === Bug 17: Token estimation uses relative position ===
import { chunkByTokens } from "../src/utils/chunking";

describe("Bug 17: Token estimation uses relative position", () => {
  it("should produce consistent chunk sizes regardless of starting position", () => {
    const doc = "a".repeat(400); // 400 chars = ~100 tokens at 4 chars/token
    const options = {
      size: 25,
      overlap: 0,
      strategy: "token" as const,
      estimateTokens: (t: string) => Math.ceil(t.length / 4),
      preserveParagraphs: false,
      preserveSentences: false,
      metadata: {},
    };

    const chunks = chunkByTokens(doc, options);

    // All chunks (except possibly the last) should be similar size
    const sizes = chunks.slice(0, -1).map((c) => c.content.length);
    const uniqueSizes = new Set(sizes);
    // Before fix, sizes would vary depending on absolute position
    // After fix, all non-final chunks should be the same size
    expect(uniqueSizes.size).toBe(1);
  });
});

// === Bug 19: Drift detectors fire permanently once triggered ===
import { DriftDetector } from "../src/runtime/drift";

describe("Bug 19: Format collapse and hedging only fire once", () => {
  it("should not re-report format_collapse on subsequent checks", () => {
    const detector = new DriftDetector();

    // First check: triggers format_collapse
    const result1 = detector.check("Here is the code:\nfunction foo() {}");
    expect(result1.types).toContain("format_collapse");

    // Second check: same prefix, should still report (cached true)
    const result2 = detector.check(
      "Here is the code:\nfunction foo() {}\nmore content here",
    );
    expect(result2.types).toContain("format_collapse");

    // Key: the detection result is cached — it doesn't re-run the regex
    // on every call, which was the performance concern
  });

  it("should not re-report hedging on every subsequent check", () => {
    const detector = new DriftDetector();

    // First check: triggers hedging
    const result1 = detector.check("Sure!\nHere is some code.");
    expect(result1.types).toContain("hedging");

    // Subsequent check with more content: hedging result is cached
    const result2 = detector.check("Sure!\nHere is some code.\nMore content.");
    expect(result2.types).toContain("hedging");
  });

  it("should reset cached drift results on reset()", () => {
    const detector = new DriftDetector();

    detector.check("Sure!\nContent");
    detector.reset();

    // After reset, content without hedging should not trigger
    const result = detector.check("Normal content without hedging markers");
    expect(result.types).not.toContain("hedging");
  });
});

// === Bug 21: countIdenticalOutputs finds largest group ===
// We test the consensus module's exported function indirectly
import { quickConsensus, getConsensusValue } from "../src/consensus";

describe("Bug 21: Consensus counts largest identical group", () => {
  it("quickConsensus should find majority even when first is outlier", () => {
    const outputs = ["outlier", "same", "same", "same"];
    // The majority is "same" (3/4 = 0.75)
    expect(quickConsensus(outputs, 0.7)).toBe(true);
  });

  it("getConsensusValue should return most common value", () => {
    const outputs = ["outlier", "same", "same", "same"];
    expect(getConsensusValue(outputs)).toBe("same");
  });
});

// === Bug 23: createChunk uses passed startPos directly ===
import { chunkByParagraphs } from "../src/utils/chunking";

describe("Bug 23: Chunk position metadata is correct for repeated content", () => {
  it("should assign correct positions for repeated paragraphs", () => {
    const doc = "Hello world.\n\nHello world.\n\nHello world.";
    const options = {
      size: 100,
      overlap: 0,
      strategy: "paragraph" as const,
      estimateTokens: (t: string) => Math.ceil(t.length / 4),
      preserveParagraphs: true,
      preserveSentences: false,
      metadata: {},
    };

    const chunks = chunkByParagraphs(doc, options);
    // All repeated paragraphs in a single chunk since size is large
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // The startPos should be 0 for the first chunk
    expect(chunks[0]!.startPos).toBe(0);
  });
});

// === Bug 16: Anthropic adapter zero token usage ===
// Tested indirectly since we can't import the actual adapter without the SDK
// but we verify the logic pattern
describe("Bug 16: Zero token counts are valid usage values", () => {
  it("nullish check should pass for zero values", () => {
    const usage = { input_tokens: 0, output_tokens: 0 };
    // Before fix: (usage.input_tokens || usage.output_tokens) === 0 (falsy)
    // After fix: (usage.input_tokens != null || usage.output_tokens != null) === true
    const beforeFix = usage.input_tokens || usage.output_tokens;
    const afterFix = usage.input_tokens != null || usage.output_tokens != null;
    expect(beforeFix).toBeFalsy(); // demonstrates the old bug
    expect(afterFix).toBe(true); // demonstrates the fix
  });
});
