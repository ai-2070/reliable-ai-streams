// Retry and Error Handling Example
// Run: OPENAI_API_KEY=sk-... npx tsx examples/10-retry-and-errors.ts

import {
  l0,
  // Guardrail presets
  recommendedGuardrails,
  // Retry presets
  minimalRetry, // attempts: 2, maxRetries: 4, backoff: linear
  recommendedRetry, // attempts: 3, maxRetries: 6, backoff: fixed-jitter
  strictRetry, // attempts: 3, maxRetries: 6, backoff: full-jitter
  exponentialRetry, // attempts: 4, maxRetries: 8, backoff: exponential
  // Error utilities
  isL0Error,
  isNetworkError,
  analyzeNetworkError,
  describeNetworkError,
  suggestRetryDelay,
  L0Error,
  L0ErrorCodes,
  // Error types
  ErrorCategory,
  NetworkErrorType,
  type NetworkErrorAnalysis,
  type RetryOptions,
} from "reliable-ai-streams";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

// Example 1: Basic retry configuration
async function basicRetry() {
  console.log("=== Basic Retry ===\n");

  const result = await l0({
    stream: () =>
      streamText({
        model: openai("gpt-4o-mini"),
        prompt: "Say hello",
      }),
    context: { example: "basic-retry" },
    retry: {
      attempts: 3, // Model failures (counts toward limit)
      maxRetries: 6, // Hard cap on ALL retries including network
      baseDelay: 1000,
      maxDelay: 10000,
      backoff: "fixed-jitter", // AWS-style predictable jitter

      // Specify which error types to retry on
      retryOn: [
        "zero_output",
        "guardrail_violation",
        "drift",
        "incomplete",
        "network_error",
        "timeout",
        "rate_limit",
        "server_error",
        // Note: "unknown" is NOT included by default (opt-in)
      ],

      // Custom delays for specific network error types
      errorTypeDelays: {
        connectionDropped: 1000,
        fetchError: 500,
        econnreset: 1000,
        econnrefused: 2000,
        sseAborted: 500,
        runtimeKilled: 2000,
        backgroundThrottle: 5000,
        dnsError: 3000,
        timeout: 1000,
      },
    },
    onRetry: (attempt, reason) => {
      console.log(`Retry ${attempt}: ${reason}`);
    },
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }
  console.log("\n");
  console.log("Model retries:", result.state.modelRetryCount);
  console.log("Network retries:", result.state.networkRetryCount);
}

// Example 2: Retry presets comparison
async function retryPresets() {
  console.log("\n=== Retry Presets ===\n");

  const presets = [
    { name: "minimalRetry", config: minimalRetry },
    { name: "recommendedRetry", config: recommendedRetry },
    { name: "strictRetry", config: strictRetry },
    { name: "exponentialRetry", config: exponentialRetry },
  ];

  console.log("| Preset            | Attempts | MaxRetries | Backoff      |");
  console.log("|-------------------|----------|------------|--------------|");
  presets.forEach(({ name, config }) => {
    console.log(
      `| ${name.padEnd(17)} | ${String(config.attempts).padEnd(8)} | ${String(config.maxRetries).padEnd(10)} | ${(config.backoff || "").padEnd(12)} |`,
    );
  });

  console.log("\nUsing recommendedRetry:");
  const result = await l0({
    stream: () =>
      streamText({
        model: openai("gpt-4o-mini"),
        prompt: "Generate a random number between 1 and 100",
      }),
    retry: recommendedRetry,
    guardrails: recommendedGuardrails,
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }
  console.log("\n");
}

// Example 3: Custom retry logic
async function customRetryLogic() {
  console.log("\n=== Custom Retry Logic ===\n");

  const customRetry: RetryOptions = {
    attempts: 3,
    maxRetries: 10,
    backoff: "exponential",
    baseDelay: 1000,

    // Async shouldRetry callback (can only veto, never force retries)
    shouldRetry: async (error, state, attempt, category) => {
      console.log(
        `  shouldRetry called: attempt=${attempt}, category=${category}`,
      );

      // Veto retry if we have substantial content
      if (state.content.length > 100) {
        console.log("    -> vetoing: have enough content");
        return false;
      }

      // Veto retry for context length errors
      if (error.message.includes("context_length_exceeded")) {
        console.log("    -> vetoing: context length exceeded");
        return false;
      }

      // Allow default retry behavior
      console.log("    -> allowing default behavior");
      return true;
    },

    // Custom delay calculation
    calculateDelay: (context) => {
      // Different delays based on error type
      if (context.category === ErrorCategory.NETWORK) {
        return 500; // Fast retry for network errors
      }
      if (context.reason === "rate_limit") {
        return 5000; // Longer delay for rate limits
      }
      // Use default for everything else
      return undefined;
    },
  };

  const result = await l0({
    stream: () =>
      streamText({
        model: openai("gpt-4o-mini"),
        prompt: "Write a haiku about clouds",
      }),
    retry: customRetry,
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }
  console.log("\n");
}

// Example 4: Error handling with L0Error
async function errorHandling() {
  console.log("\n=== Error Handling ===\n");

  try {
    const result = await l0({
      stream: () =>
        streamText({
          model: openai("gpt-4o-mini"),
          prompt: "Hello",
        }),
      guardrails: recommendedGuardrails,
      retry: { attempts: 1, maxRetries: 2 },
    });

    for await (const event of result.stream) {
      if (event.type === "token") {
        process.stdout.write(event.value || "");
      }
    }
    console.log("\n✓ Success");
  } catch (error) {
    if (isL0Error(error)) {
      console.log("L0 Error:");
      console.log("  Code:", error.code);
      console.log("  Category:", error.category);
      console.log("  Message:", error.message);
      console.log("  Has checkpoint:", error.hasCheckpoint);
      console.log("  Timestamp:", new Date(error.timestamp).toISOString());

      if (error.hasCheckpoint) {
        console.log("  Checkpoint:", error.getCheckpoint()?.slice(0, 50));
      }

      // Detailed string for logging
      console.log("  Details:", error.toDetailedString());

      // JSON serialization for transport
      console.log("  JSON:", JSON.stringify(error.toJSON(), null, 2));
    } else if (error instanceof Error && isNetworkError(error)) {
      const analysis: NetworkErrorAnalysis = analyzeNetworkError(error);
      console.log("Network Error:");
      console.log("  Type:", analysis.type);
      console.log("  Retryable:", analysis.retryable);
      console.log("  Counts toward limit:", analysis.countsTowardLimit);
      console.log("  Suggestion:", analysis.suggestion);
      if (analysis.context) {
        console.log("  Context:", analysis.context);
      }

      // Human-readable description
      console.log("  Description:", describeNetworkError(error));

      // Suggested retry delay
      const delay = suggestRetryDelay(error, 0);
      console.log("  Suggested delay:", delay, "ms");
    } else {
      console.log("Unknown error:", error);
    }
  }
}

// Example 5: Error codes reference
function showErrorCodes() {
  console.log("\n=== L0 Error Codes ===\n");

  const codes = Object.entries(L0ErrorCodes);
  console.log("Available error codes:");
  codes.forEach(([key, value]) => {
    console.log(`  ${key}: "${value}"`);
  });

  console.log("\nError Categories:");
  Object.values(ErrorCategory).forEach((cat) => {
    console.log(`  ${cat}`);
  });

  console.log("\nNetwork Error Types:");
  Object.values(NetworkErrorType).forEach((type) => {
    console.log(`  ${type}`);
  });
}

// Example 6: Timeouts
async function timeouts() {
  console.log("\n=== Timeout Configuration ===\n");

  const result = await l0({
    stream: () =>
      streamText({
        model: openai("gpt-4o-mini"),
        prompt: "Write a haiku",
      }),
    timeout: {
      initialToken: 5000, // 5s to first token
      interToken: 10000, // 10s between tokens
    },
    onEvent: (event) => {
      if (event.type === "token") {
        // Track timing between tokens
      }
    },
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }
  console.log("\n\n✓ Completed within timeouts");
}

// Example 7: Abort handling
async function abortHandling() {
  console.log("\n=== Abort Handling ===\n");

  const controller = new AbortController();

  // Abort after 100ms
  setTimeout(() => {
    console.log("\n[Aborting...]");
    controller.abort();
  }, 100);

  try {
    const result = await l0({
      stream: () =>
        streamText({
          model: openai("gpt-4o-mini"),
          prompt: "Write a long story about a dragon",
        }),
      signal: controller.signal,
    });

    for await (const event of result.stream) {
      if (event.type === "token") {
        process.stdout.write(event.value || "");
      }
    }
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      console.log("\n✓ Request was aborted as expected");
    } else if (isL0Error(error) && error.code === L0ErrorCodes.STREAM_ABORTED) {
      console.log("\n✓ Stream aborted (L0Error)");
      if (error.hasCheckpoint) {
        console.log("  Partial content:", error.getCheckpoint()?.slice(0, 50));
      }
    } else {
      throw error;
    }
  }
}

// Example 8: Error category behavior
function showErrorCategoryBehavior() {
  console.log("\n=== Error Category Behavior ===\n");

  console.log("| Category  | Retries | Counts | Backoff       |");
  console.log("|-----------|---------|--------|---------------|");
  console.log("| NETWORK   | Forever | No     | Custom delays |");
  console.log("| TRANSIENT | Forever | No     | Exponential   |");
  console.log("| MODEL     | Limited | Yes    | Fixed-jitter  |");
  console.log("| CONTENT   | Limited | Yes    | Fixed-jitter  |");
  console.log("| PROVIDER  | Depends | Varies | Varies        |");
  console.log("| FATAL     | Never   | N/A    | N/A           |");
  console.log("| INTERNAL  | Never   | N/A    | N/A           |");
}

async function main() {
  await basicRetry();
  await retryPresets();
  await customRetryLogic();
  await errorHandling();
  showErrorCodes();
  await timeouts();
  await abortHandling();
  showErrorCategoryBehavior();
}

main().catch(console.error);
