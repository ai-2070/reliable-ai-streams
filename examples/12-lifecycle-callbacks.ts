/**
 * Example 12: Lifecycle Callbacks
 *
 * Demonstrates how to use L0's lifecycle callbacks for monitoring,
 * logging, and responding to runtime events.
 *
 * Run: OPENAI_API_KEY=sk-... npx tsx examples/12-lifecycle-callbacks.ts
 */

import {
  l0,
  recommendedGuardrails,
  recommendedRetry,
  type L0State,
  type GuardrailViolation,
} from "reliable-ai-streams";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

const model = openai("gpt-4o-mini");
const fallbackModel = openai("gpt-4o");

// -----------------------------------------------------------------------------
// Example 1: Basic Lifecycle Callbacks
// -----------------------------------------------------------------------------
async function basicCallbacks() {
  console.log("=== Basic Lifecycle Callbacks ===\n");

  const result = await l0({
    stream: () =>
      streamText({
        model,
        prompt: "Write a haiku about TypeScript.",
      }),
    context: { example: "basic-callbacks", userId: "demo" },

    // Called when execution starts
    onStart: (attempt, isRetry, isFallback) => {
      console.log(`[onStart] Attempt ${attempt}`);
      if (isRetry) console.log("  (this is a retry)");
      if (isFallback) console.log("  (using fallback model)");
    },

    // Called when stream completes successfully
    onComplete: (state: L0State) => {
      console.log(`[onComplete] Finished with ${state.tokenCount} tokens`);
      console.log(`  Duration: ${state.duration}ms`);
      console.log(`  Model retries: ${state.modelRetryCount}`);
      console.log(`  Network retries: ${state.networkRetryCount}`);
    },

    // Called for every streaming event
    onEvent: (event) => {
      if (event.type === "token") {
        process.stdout.write(event.value || "");
      }
    },
  });

  // Consume stream
  for await (const event of result.stream) {
    // Events already handled by onEvent
  }

  console.log("\n");
}

// -----------------------------------------------------------------------------
// Example 2: Error and Retry Callbacks
// -----------------------------------------------------------------------------
async function errorAndRetryCallbacks() {
  console.log("\n=== Error and Retry Callbacks ===\n");

  const result = await l0({
    stream: () =>
      streamText({
        model,
        prompt: "Generate a valid JSON object with name and age.",
      }),
    context: { example: "error-retry" },

    guardrails: recommendedGuardrails,
    retry: { ...recommendedRetry, attempts: 3 },

    onStart: (attempt, isRetry) => {
      console.log(`[onStart] Attempt ${attempt}${isRetry ? " (retry)" : ""}`);
    },

    // Called when an error occurs (before retry decision)
    onError: (error, willRetry, willFallback) => {
      console.log(`[onError] ${error.message}`);
      if (willRetry) console.log("  -> Will retry");
      if (willFallback) console.log("  -> Will try fallback");
      if (!willRetry && !willFallback) console.log("  -> Fatal, giving up");
    },

    // Called when a retry is triggered
    onRetry: (attempt, reason) => {
      console.log(`[onRetry] Attempt ${attempt}, reason: ${reason}`);
    },

    onComplete: (state: L0State) => {
      console.log(
        `[onComplete] Success after ${state.modelRetryCount} model retries`,
      );
    },
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }

  console.log("\n");
}

// -----------------------------------------------------------------------------
// Example 3: Fallback Callbacks
// -----------------------------------------------------------------------------
async function fallbackCallbacks() {
  console.log("\n=== Fallback Callbacks ===\n");

  const prompt = "Explain recursion in one sentence.";

  const result = await l0({
    stream: () => streamText({ model, prompt }),
    context: { example: "fallback" },

    fallbackStreams: [() => streamText({ model: fallbackModel, prompt })],

    retry: { attempts: 2 },

    onStart: (attempt, isRetry, isFallback) => {
      const status = isFallback ? "fallback" : isRetry ? "retry" : "initial";
      console.log(`[onStart] Attempt ${attempt} (${status})`);
    },

    // Called when switching to a fallback model
    onFallback: (index, reason) => {
      console.log(`[onFallback] Switching to fallback #${index}: ${reason}`);
    },

    onError: (error, willRetry, willFallback) => {
      console.log(`[onError] ${error.message}`);
      console.log(`  willRetry: ${willRetry}, willFallback: ${willFallback}`);
    },

    onComplete: (state: L0State) => {
      console.log(`[onComplete] Used fallback index: ${state.fallbackIndex}`);
    },
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }

  console.log("\n");
}

// -----------------------------------------------------------------------------
// Example 4: Guardrail Violation Callbacks
// -----------------------------------------------------------------------------
async function violationCallbacks() {
  console.log("\n=== Guardrail Violation Callbacks ===\n");

  const result = await l0({
    stream: () =>
      streamText({
        model,
        prompt: "Write a short greeting message.",
      }),
    context: { example: "violation" },

    guardrails: recommendedGuardrails,
    retry: { attempts: 2 },

    // Called when a guardrail violation is detected
    onViolation: (violation: GuardrailViolation) => {
      console.log(`[onViolation] Rule: ${violation.rule}`);
      console.log(`  Message: ${violation.message}`);
      console.log(`  Severity: ${violation.severity}`);
      console.log(`  Recoverable: ${violation.recoverable}`);
      if (violation.position) {
        console.log(`  Position: ${violation.position}`);
      }
    },

    onRetry: (attempt, reason) => {
      console.log(`[onRetry] Retrying due to: ${reason}`);
    },

    onComplete: (state: L0State) => {
      console.log(
        `[onComplete] Violations encountered: ${state.violations.length}`,
      );
    },
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }

  console.log("\n");
}

// -----------------------------------------------------------------------------
// Example 5: Checkpoint and Resume Callbacks
// -----------------------------------------------------------------------------
async function checkpointResumeCallbacks() {
  console.log("\n=== Checkpoint and Resume Callbacks ===\n");

  const result = await l0({
    stream: () =>
      streamText({
        model,
        prompt: "Write a paragraph about functional programming.",
      }),
    context: { example: "checkpoint-resume" },

    continueFromLastKnownGoodToken: true,
    checkIntervals: { checkpoint: 10 },
    retry: { attempts: 3 },

    onStart: (attempt, isRetry, isFallback) => {
      console.log(`[onStart] Attempt ${attempt}`);
    },

    // Called when a checkpoint is saved
    onCheckpoint: (checkpoint, tokenCount) => {
      console.log(`[onCheckpoint] Saved at ${tokenCount} tokens`);
      console.log(`  Preview: "...${checkpoint.slice(-30)}"`);
    },

    // Called when resuming from a checkpoint
    onResume: (checkpoint, tokenCount) => {
      console.log(`[onResume] Resuming from checkpoint`);
      console.log(`  Tokens preserved: ${tokenCount}`);
      console.log(`  Checkpoint preview: "${checkpoint.slice(0, 40)}..."`);
    },

    onComplete: (state: L0State) => {
      console.log(`[onComplete] Resumed: ${state.resumed}`);
      if (state.resumePoint) {
        console.log(`  Resume point length: ${state.resumePoint.length}`);
        console.log(`  Resume offset: ${state.resumeFrom}`);
      }
    },
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }

  console.log("\n");
}

// -----------------------------------------------------------------------------
// Example 6: Timeout, Abort, and Drift Callbacks
// -----------------------------------------------------------------------------
async function advancedCallbacks() {
  console.log("\n=== Advanced Callbacks (Timeout, Abort, Drift) ===\n");

  const abortController = new AbortController();

  // Example: abort after 5 seconds (comment out for full run)
  // setTimeout(() => abortController.abort(), 5000);

  const result = await l0({
    stream: () =>
      streamText({
        model,
        prompt:
          "Write a detailed explanation of how async/await works in JavaScript.",
      }),
    context: { example: "advanced" },

    continueFromLastKnownGoodToken: true,
    checkIntervals: { checkpoint: 5 },
    detectDrift: true,
    timeout: {
      initialToken: 10000,
      interToken: 5000,
    },
    signal: abortController.signal,

    onStart: (attempt) => {
      console.log(`[onStart] Attempt ${attempt}`);
    },

    // Called when a timeout occurs
    onTimeout: (type, elapsedMs) => {
      console.log(`[onTimeout] ${type} timeout after ${elapsedMs}ms`);
    },

    // Called when the stream is aborted
    onAbort: (tokenCount, contentLength) => {
      console.log(
        `[onAbort] Aborted after ${tokenCount} tokens (${contentLength} chars)`,
      );
    },

    // Called when drift is detected
    onDrift: (types, confidence) => {
      console.log(
        `[onDrift] Detected: ${types.join(", ")} (confidence: ${confidence ?? "N/A"})`,
      );
    },

    onComplete: (state: L0State) => {
      console.log(`[onComplete] Finished with ${state.tokenCount} tokens`);
      console.log(`  Drift detected: ${state.driftDetected}`);
    },

    onEvent: (event) => {
      if (event.type === "token") {
        process.stdout.write(event.value || "");
      }
    },
  });

  for await (const event of result.stream) {
    // Events handled by onEvent
  }

  console.log("\n");
}

// -----------------------------------------------------------------------------
// Example 7: Tool Call Callback
// -----------------------------------------------------------------------------
async function toolCallCallback() {
  console.log("\n=== Tool Call Callback ===\n");

  const result = await l0({
    stream: () =>
      streamText({
        model,
        prompt: "What is the weather in San Francisco?",
        // Note: Tool definitions would be passed to the model here
        // tools: { getWeather: { ... } }
      }),
    context: { example: "tool-call" },

    // Called when the model requests a tool call
    // L0 does NOT execute tools - this is for observability only
    onToolCall: (toolName, toolCallId, args) => {
      console.log(`[onToolCall] Tool: ${toolName}`);
      console.log(`  Call ID: ${toolCallId}`);
      console.log(`  Arguments:`, args);
    },

    onComplete: (state: L0State) => {
      console.log(`[onComplete] Finished with ${state.tokenCount} tokens`);
    },
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }

  console.log("\n");
}

// -----------------------------------------------------------------------------
// Example 8: Complete Callback Suite (All Callbacks)
// -----------------------------------------------------------------------------
async function allCallbacks() {
  console.log("\n=== Complete Callback Suite ===\n");

  const prompt = "List 3 benefits of unit testing.";

  const result = await l0({
    stream: () => streamText({ model, prompt }),
    context: {
      example: "all-callbacks",
      requestId: `req_${Date.now()}`,
      environment: "development",
    },

    fallbackStreams: [() => streamText({ model: fallbackModel, prompt })],

    guardrails: recommendedGuardrails,
    continueFromLastKnownGoodToken: true,
    checkIntervals: { checkpoint: 8 },
    detectDrift: true,
    retry: { ...recommendedRetry, attempts: 2 },
    timeout: {
      initialToken: 10000,
      interToken: 5000,
    },

    // All lifecycle callbacks
    onStart: (attempt, isRetry, isFallback) => {
      const flags = [isRetry && "retry", isFallback && "fallback"]
        .filter(Boolean)
        .join(", ");
      console.log(`[START] Attempt ${attempt}${flags ? ` (${flags})` : ""}`);
    },

    onComplete: (state: L0State) => {
      console.log(`[COMPLETE] ${state.tokenCount} tokens, ${state.duration}ms`);
      console.log(`  Model retries: ${state.modelRetryCount}`);
      console.log(`  Network retries: ${state.networkRetryCount}`);
    },

    onError: (error, willRetry, willFallback) => {
      const action = willRetry ? "retry" : willFallback ? "fallback" : "fail";
      console.log(`[ERROR] ${error.message} -> ${action}`);
    },

    onEvent: (event) => {
      if (event.type === "token") {
        process.stdout.write(event.value || "");
      }
    },

    onViolation: (violation: GuardrailViolation) => {
      console.log(`[VIOLATION] ${violation.rule}: ${violation.message}`);
    },

    onRetry: (attempt, reason) => {
      console.log(`[RETRY] Attempt ${attempt}: ${reason}`);
    },

    onFallback: (index, reason) => {
      console.log(`[FALLBACK] #${index}: ${reason}`);
    },

    onResume: (checkpoint, tokenCount) => {
      console.log(`[RESUME] From ${tokenCount} tokens`);
    },

    onCheckpoint: (checkpoint, tokenCount) => {
      console.log(`[CHECKPOINT] Saved at ${tokenCount} tokens`);
    },

    onTimeout: (type, elapsedMs) => {
      console.log(`[TIMEOUT] ${type} after ${elapsedMs}ms`);
    },

    onAbort: (tokenCount, contentLength) => {
      console.log(
        `[ABORT] After ${tokenCount} tokens (${contentLength} chars)`,
      );
    },

    onDrift: (types, confidence) => {
      console.log(
        `[DRIFT] ${types.join(", ")} (confidence: ${confidence ?? "N/A"})`,
      );
    },

    onToolCall: (toolName, toolCallId, args) => {
      console.log(`[TOOL] ${toolName} (${toolCallId}):`, args);
    },
  });

  for await (const event of result.stream) {
    // Events handled by onEvent
  }

  console.log("\n");
}

// -----------------------------------------------------------------------------
// Callback Reference
// -----------------------------------------------------------------------------
function showCallbackReference() {
  console.log("\n=== Callback Reference ===\n");

  console.log(
    "| Callback      | When Called                           | Parameters                           |",
  );
  console.log(
    "|---------------|---------------------------------------|--------------------------------------|",
  );
  console.log(
    "| onStart       | Stream execution starts               | attempt, isRetry, isFallback         |",
  );
  console.log(
    "| onComplete    | Stream completes successfully         | state: L0State                       |",
  );
  console.log(
    "| onError       | Error occurs (before retry decision)  | error, willRetry, willFallback       |",
  );
  console.log(
    "| onEvent       | Any streaming/lifecycle event         | event: L0Event                       |",
  );
  console.log(
    "| onViolation   | Guardrail violation detected          | violation: GuardrailViolation        |",
  );
  console.log(
    "| onRetry       | Retry is triggered                    | attempt, reason                      |",
  );
  console.log(
    "| onFallback    | Switching to fallback model           | index, reason                        |",
  );
  console.log(
    "| onResume      | Resuming from checkpoint              | checkpoint, tokenCount               |",
  );
  console.log(
    "| onCheckpoint  | Checkpoint is saved                   | checkpoint, tokenCount               |",
  );
  console.log(
    "| onTimeout     | Timeout occurs                        | type, elapsedMs                      |",
  );
  console.log(
    "| onAbort       | Stream is aborted                     | tokenCount, contentLength            |",
  );
  console.log(
    "| onDrift       | Drift is detected                     | types[], confidence                  |",
  );
  console.log(
    "| onToolCall    | Tool call detected (observability)    | toolName, toolCallId, args           |",
  );
}

// -----------------------------------------------------------------------------
// Run examples
// -----------------------------------------------------------------------------
async function main() {
  try {
    await basicCallbacks();
    await errorAndRetryCallbacks();
    await fallbackCallbacks();
    await violationCallbacks();
    await checkpointResumeCallbacks();
    await advancedCallbacks();
    await toolCallCallback();
    await allCallbacks();
    showCallbackReference();

    console.log("\n=== All examples completed ===");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
