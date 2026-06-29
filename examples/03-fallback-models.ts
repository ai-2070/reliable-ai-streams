// Fallback Models Example
// Run: OPENAI_API_KEY=sk-... npx tsx examples/03-fallback-models.ts

import {
  l0,
  recommendedGuardrails,
  recommendedRetry,
} from "reliable-ai-streams";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

const prompt = "Explain quantum computing in one sentence";

async function main() {
  console.log("=== Fallback Models Example ===\n");

  const modelNames = ["gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo"];

  const result = await l0({
    // Primary: GPT-4o
    stream: () =>
      streamText({
        model: openai("gpt-4o"),
        prompt,
      }),

    // Fallbacks: try cheaper/different models if primary fails
    // L0 tries each in order until one succeeds
    fallbackStreams: [
      () =>
        streamText({
          model: openai("gpt-4o-mini"),
          prompt,
        }),
      () =>
        streamText({
          model: openai("gpt-3.5-turbo"),
          prompt,
        }),
    ],

    guardrails: recommendedGuardrails,
    retry: recommendedRetry,

    // Callbacks to track fallback behavior
    onFallback: (index, reason) => {
      console.log(`\n⚠ Switching to fallback ${index}: ${reason}`);
    },
    onRetry: (attempt, reason) => {
      console.log(`\n↻ Retry attempt ${attempt}: ${reason}`);
    },
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }

  // Check which model succeeded
  const modelUsed = modelNames[result.state.fallbackIndex] || "unknown";
  console.log("\n\n--- Results ---");
  console.log(
    "Model used:",
    result.state.fallbackIndex === 0
      ? `Primary (${modelUsed})`
      : `Fallback ${result.state.fallbackIndex} (${modelUsed})`,
  );
  console.log("Tokens:", result.state.tokenCount);
  console.log("Model retries:", result.state.modelRetryCount);
  console.log("Network retries:", result.state.networkRetryCount);
}

main().catch(console.error);
