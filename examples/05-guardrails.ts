// Guardrails Example
// Run: OPENAI_API_KEY=sk-... npx tsx examples/05-guardrails.ts

import {
  l0,
  jsonRule,
  markdownRule,
  latexRule,
  zeroOutputRule,
  patternRule,
  customPatternRule,
  minimalGuardrails,
  recommendedGuardrails,
  strictGuardrails,
  jsonOnlyGuardrails,
  type GuardrailRule,
  type GuardrailContext,
} from "reliable-ai-streams";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

// Example 1: JSON validation
async function jsonGuardrail() {
  console.log("=== JSON Guardrail ===\n");

  const result = await l0({
    stream: () =>
      streamText({
        model: openai("gpt-4o-mini"),
        prompt: "Generate a JSON object with name and age fields",
      }),
    guardrails: [jsonRule()],
    onViolation: (v) => console.log("⚠ Violation:", v.message),
  });

  let content = "";
  for await (const event of result.stream) {
    if (event.type === "token" && event.value) {
      content += event.value;
    }
  }

  console.log("Output:", content);
  console.log(
    "Valid JSON:",
    (() => {
      try {
        JSON.parse(content);
        return true;
      } catch {
        return false;
      }
    })(),
  );
  console.log("Violations:", result.state.violations.length);
}

// Example 2: Custom pattern detection
async function customPatterns() {
  console.log("\n=== Custom Pattern Detection ===\n");

  const result = await l0({
    stream: () =>
      streamText({
        model: openai("gpt-4o-mini"),
        prompt: "Write a short greeting",
      }),
    guardrails: [
      patternRule(), // Detects "As an AI..." patterns
      customPatternRule(
        [/sorry/i, /apologize/i, /unfortunately/i],
        "Detected apologetic language",
      ),
    ],
    onViolation: (v) => console.log("⚠ Detected:", v.message),
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }
  console.log("\n");
}

// Example 3: Using presets
async function presets() {
  console.log("=== Guardrail Presets ===\n");

  // Show what each preset includes
  console.log("Available presets:");
  console.log(
    "  minimalGuardrails:",
    minimalGuardrails.map((g) => g.name).join(", "),
  );
  console.log(
    "  recommendedGuardrails:",
    recommendedGuardrails.map((g) => g.name).join(", "),
  );
  console.log(
    "  strictGuardrails:",
    strictGuardrails.map((g) => g.name).join(", "),
  );
  console.log(
    "  jsonOnlyGuardrails:",
    jsonOnlyGuardrails.map((g) => g.name).join(", "),
  );
  console.log();

  const result = await l0({
    stream: () =>
      streamText({
        model: openai("gpt-4o-mini"),
        prompt: "Say hello",
      }),
    guardrails: recommendedGuardrails,
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }
  console.log("\n");
}

// Example 4: Custom guardrail with proper types
async function customGuardrail() {
  console.log("\n=== Custom Guardrail ===\n");

  // Custom guardrail with full type safety
  const minLengthRule: GuardrailRule = {
    name: "min-length",
    description: "Ensure minimum response length",
    streaming: false, // Only check on completion
    severity: "warning",
    recoverable: true,
    check: (context: GuardrailContext) => {
      if (context.completed && context.content.length < 20) {
        return [
          {
            rule: "min-length",
            message: `Response too short: ${context.content.length} chars (min: 20)`,
            severity: "warning",
            recoverable: true,
          },
        ];
      }
      return [];
    },
  };

  const result = await l0({
    stream: () =>
      streamText({
        model: openai("gpt-4o-mini"),
        prompt: "Write a detailed explanation of recursion",
      }),
    guardrails: [minLengthRule, ...recommendedGuardrails],
    onViolation: (v) =>
      console.log(`⚠ Violation [${v.severity}]: ${v.message}`),
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }
  console.log("\n\nLength:", result.state.content.length, "chars");
  console.log("Total violations:", result.state.violations.length);
}

// Example 5: Check intervals for performance
async function checkIntervals() {
  console.log("\n=== Check Intervals ===\n");

  const result = await l0({
    stream: () =>
      streamText({
        model: openai("gpt-4o-mini"),
        prompt: "Write a paragraph about TypeScript",
      }),
    guardrails: recommendedGuardrails,

    // Tune check frequency for performance
    // Lower = more checks, higher = better performance
    checkIntervals: {
      guardrails: 10, // Check every 10 tokens (default: 5)
      drift: 20, // Check drift every 20 tokens (default: 10)
      checkpoint: 10, // Save checkpoint every 10 tokens (default: 10)
    },
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }
  console.log("\n\nTokens:", result.state.tokenCount);
}

async function main() {
  await jsonGuardrail();
  await customPatterns();
  await presets();
  await customGuardrail();
  await checkIntervals();
}

main().catch(console.error);
