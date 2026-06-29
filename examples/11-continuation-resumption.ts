/**
 * Example 11: Last-Known-Good Token Resumption
 *
 * Demonstrates how L0 can resume from checkpoints when streams fail mid-generation,
 * preserving already-generated content and reducing retry latency.
 *
 * Run: OPENAI_API_KEY=sk-... npx tsx examples/11-continuation-resumption.ts
 */

import {
  l0,
  recommendedRetry,
  type L0State,
  type L0Telemetry,
} from "reliable-ai-streams";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

const model = openai("gpt-4o-mini");

// -----------------------------------------------------------------------------
// Example 1: Basic Continuation
// -----------------------------------------------------------------------------
async function basicContinuation() {
  console.log("=== Basic Continuation ===\n");

  const result = await l0({
    stream: () =>
      streamText({
        model,
        prompt: "Write a short paragraph about the benefits of clean code.",
      }),
    context: { example: "basic-continuation" },

    // Enable continuation from last checkpoint
    continueFromLastKnownGoodToken: true,

    // Save checkpoint every 10 tokens
    checkIntervals: { checkpoint: 10 },

    retry: { ...recommendedRetry, attempts: 3 },

    // Optional: Track checkpoint saves
    onCheckpoint: (checkpoint, tokenCount) => {
      console.log(`[Checkpoint saved: ${tokenCount} tokens]`);
    },

    // Optional: Track resume events
    onResume: (checkpoint, tokenCount) => {
      console.log(`[Resuming from ${tokenCount} tokens]`);
    },
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }

  console.log("\n");

  // Check if continuation was used
  if (result.state.resumed) {
    console.log("Stream was resumed from checkpoint!");
    console.log(
      "Resume point:",
      result.state.resumePoint?.slice(0, 50) + "...",
    );
    console.log("Resume offset:", result.state.resumeFrom, "chars");
  } else {
    console.log("Stream completed without needing resumption.");
  }
}

// -----------------------------------------------------------------------------
// Example 2: Custom Continuation Prompt
// -----------------------------------------------------------------------------
async function customContinuationPrompt() {
  console.log("\n=== Custom Continuation Prompt ===\n");

  const originalPrompt = "Write a haiku about programming.";
  let continuationPrompt = "";

  const result = await l0({
    stream: () =>
      streamText({
        model,
        prompt: continuationPrompt || originalPrompt,
      }),

    continueFromLastKnownGoodToken: true,
    checkIntervals: { checkpoint: 5 },

    // Customize how the prompt is modified for continuation
    buildContinuationPrompt: (checkpoint) => {
      continuationPrompt = `${originalPrompt}\n\nContinue from where you left off. Here's what you wrote so far:\n${checkpoint}`;
      console.log("[Building continuation prompt with checkpoint]");
      return continuationPrompt;
    },

    retry: { attempts: 2 },
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }

  console.log("\n");
}

// -----------------------------------------------------------------------------
// Example 3: Continuation with Fallback Models
// -----------------------------------------------------------------------------
async function continuationWithFallback() {
  console.log("\n=== Continuation with Fallback Models ===\n");

  const prompt = "List 5 benefits of test-driven development.";

  const result = await l0({
    stream: () => streamText({ model: openai("gpt-4o"), prompt }),

    // Fallback models will also benefit from continuation
    fallbackStreams: [
      () => streamText({ model: openai("gpt-4o-mini"), prompt }),
    ],

    continueFromLastKnownGoodToken: true,
    checkIntervals: { checkpoint: 8 },

    retry: { attempts: 2 },

    onRetry: (attempt, reason) => {
      console.log(`[Retry ${attempt}: ${reason}]`);
    },
    onFallback: (index, reason) => {
      console.log(`[Fallback to model ${index + 1}: ${reason}]`);
    },
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }

  console.log("\n");

  // Check telemetry for continuation details
  const telemetry: L0Telemetry | undefined = result.telemetry;
  if (telemetry?.continuation?.used) {
    console.log("Continuation was used!");
    console.log("Checkpoint length:", telemetry.continuation.checkpointLength);
    console.log(
      "Continuation count:",
      telemetry.continuation.continuationCount,
    );
  }
}

// -----------------------------------------------------------------------------
// Example 4: Deduplication Options
// -----------------------------------------------------------------------------
async function deduplicationOptions() {
  console.log("\n=== Deduplication Options ===\n");

  // When LLMs continue from a checkpoint, they often repeat words.
  // L0 automatically detects and removes this overlap.

  const result = await l0({
    stream: () =>
      streamText({
        model,
        prompt: "Write a brief explanation of recursion in programming.",
      }),

    continueFromLastKnownGoodToken: true,

    // Deduplication is enabled by default when continuation is enabled
    deduplicateContinuation: true,

    // Fine-tune deduplication behavior
    deduplicationOptions: {
      minOverlap: 2, // Minimum characters to consider as overlap (default: 2)
      maxOverlap: 500, // Maximum characters to search for overlap (default: 500)
      caseSensitive: true, // Case-sensitive matching (default: true)
      normalizeWhitespace: false, // Treat multiple spaces as one (default: false)
    },

    checkIntervals: { checkpoint: 10 },
    retry: { attempts: 2 },
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }

  console.log("\n");

  // Check continuation telemetry
  const telemetry = result.telemetry;
  if (telemetry?.continuation?.used) {
    console.log("Continuation was used!");
    console.log("Checkpoint length:", telemetry.continuation.checkpointLength);
  }
}

// -----------------------------------------------------------------------------
// Example 5: Monitoring Continuation State
// -----------------------------------------------------------------------------
async function monitoringContinuation() {
  console.log("\n=== Monitoring Continuation State ===\n");

  const result = await l0({
    stream: () =>
      streamText({
        model,
        prompt:
          "Explain the concept of immutability in functional programming.",
      }),
    context: { example: "monitoring" },

    continueFromLastKnownGoodToken: true,
    checkIntervals: { checkpoint: 10 },
    retry: { attempts: 3 },

    // Monitor all events including internal state
    onEvent: (event) => {
      if (event.type === "complete") {
        console.log("\n[Stream complete]");
      }
    },
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }

  // Detailed state inspection
  const state: L0State = result.state;
  console.log("\n\n--- Final State ---");
  console.log("Content length:", state.content.length);
  console.log("Token count:", state.tokenCount);
  console.log("Resumed:", state.resumed);
  console.log("Model retries:", state.modelRetryCount);
  console.log("Network retries:", state.networkRetryCount);
  console.log("Duration:", state.duration, "ms");

  if (state.checkpoint) {
    console.log("Last checkpoint length:", state.checkpoint.length);
  }

  if (state.resumed) {
    console.log("Resume point:", state.resumePoint?.slice(0, 30) + "...");
    console.log("Resume offset:", state.resumeFrom);
  }
}

// -----------------------------------------------------------------------------
// Example 6: Continuation Telemetry
// -----------------------------------------------------------------------------
async function continuationTelemetry() {
  console.log("\n=== Continuation Telemetry ===\n");

  const result = await l0({
    stream: () =>
      streamText({
        model,
        prompt: "Write three sentences about functional programming.",
      }),

    continueFromLastKnownGoodToken: true,
    checkIntervals: { checkpoint: 5 },
    retry: { attempts: 2 },
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }

  console.log("\n");

  // Full telemetry inspection
  const telemetry = result.telemetry;
  if (telemetry) {
    console.log("--- Telemetry ---");
    console.log("Session ID:", telemetry.sessionId);
    console.log("Total duration:", telemetry.duration, "ms");

    if (telemetry.continuation) {
      console.log("\nContinuation telemetry:");
      console.log("  Enabled:", telemetry.continuation.enabled);
      console.log("  Used:", telemetry.continuation.used);
      console.log(
        "  Continuation count:",
        telemetry.continuation.continuationCount,
      );
      if (telemetry.continuation.checkpointLength) {
        console.log(
          "  Checkpoint length:",
          telemetry.continuation.checkpointLength,
        );
      }
    }
  }
}

// -----------------------------------------------------------------------------
// Run examples
// -----------------------------------------------------------------------------
async function main() {
  try {
    await basicContinuation();
    await customContinuationPrompt();
    await continuationWithFallback();
    await deduplicationOptions();
    await monitoringContinuation();
    await continuationTelemetry();

    console.log("\n=== All examples completed ===");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
