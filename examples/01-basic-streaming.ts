// Basic L0 Streaming Example
// Run: OPENAI_API_KEY=sk-... npx tsx examples/01-basic-streaming.ts

import {
  l0,
  recommendedGuardrails,
  recommendedRetry,
} from "reliable-ai-streams";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

async function main() {
  console.log("=== Basic Streaming Example ===\n");

  const result = await l0({
    stream: () =>
      streamText({
        model: openai("gpt-4o-mini"),
        prompt: "Write a haiku about TypeScript",
      }),

    // Guardrails: jsonRule, markdownRule, zeroOutputRule, patternRule
    guardrails: recommendedGuardrails,

    // Retry: { attempts: 3, maxRetries: 6, backoff: "fixed-jitter" }
    retry: recommendedRetry,

    // Optional: User context attached to all observability events
    context: {
      example: "01-basic-streaming",
    },
  });

  // Consume the stream
  for await (const event of result.stream) {
    switch (event.type) {
      case "token":
        process.stdout.write(event.value || "");
        break;
      case "complete":
        console.log("\n\n✓ Stream completed");
        break;
      case "error":
        console.error("\n✗ Error:", event.error?.message);
        break;
    }
  }

  // Access final state
  console.log("\nFinal state:", {
    tokens: result.state.tokenCount,
    content: result.state.content,
    duration: result.state.duration,
    violations: result.state.violations.length,
    networkRetryCount: result.state.networkRetryCount,
  });
}

main().catch(console.error);
