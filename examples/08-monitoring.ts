// Monitoring Example (Sentry + OpenTelemetry)
// Run: OPENAI_API_KEY=sk-... npx tsx examples/08-monitoring.ts

import {
  l0,
  recommendedGuardrails,
  createSentryHandler,
  createOpenTelemetryHandler,
  combineEvents,
  filterEvents,
  excludeEvents,
  EventType,
  type L0Telemetry,
} from "reliable-ai-streams";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

// Example 1: Basic telemetry
async function basicTelemetry() {
  console.log("=== Basic Telemetry ===\n");

  const result = await l0({
    stream: () =>
      streamText({
        model: openai("gpt-4o-mini"),
        prompt: "Write a short poem about monitoring",
      }),
    guardrails: recommendedGuardrails,
    monitoring: {
      enabled: true,
      includeTimings: true,
      includeNetworkDetails: true,
    },

    // Optional: User context attached to all events
    context: {
      example: "08-monitoring",
    },
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }

  const telemetry: L0Telemetry | undefined = result.telemetry;
  console.log("\n\nTelemetry:");
  console.log("  Session ID:", telemetry?.sessionId);
  console.log("  Duration:", telemetry?.duration, "ms");
  console.log("  Tokens:", telemetry?.metrics.totalTokens);
  console.log("  TTFT:", telemetry?.metrics.timeToFirstToken, "ms");
  console.log("  Tokens/sec:", telemetry?.metrics.tokensPerSecond?.toFixed(1));
  console.log("  Model retries:", telemetry?.metrics.modelRetryCount);
  console.log("  Network retries:", telemetry?.metrics.networkRetryCount);
}

// Example 2: With custom metadata
async function customMetadata() {
  console.log("\n=== Custom Metadata ===\n");

  const result = await l0({
    stream: () =>
      streamText({
        model: openai("gpt-4o-mini"),
        prompt: "Summarize: The quick brown fox jumps over the lazy dog.",
      }),

    // User context (immutable for session, on all events)
    context: {
      userId: "user-123",
      requestType: "summarization",
    },

    // Monitoring metadata (on telemetry object)
    monitoring: {
      enabled: true,
      metadata: {
        priority: "high",
        source: "api",
      },
    },
  });

  for await (const event of result.stream) {
    // consume stream
  }

  console.log("Monitoring metadata:", result.telemetry?.metadata);
}

// Example 3: Event handler utilities
async function eventHandlers() {
  console.log("\n=== Event Handler Utilities ===\n");

  // Custom logging handler for observability events
  const loggingHandler = (event: { type: string }) => {
    console.log(`  Observability Event: ${event.type}`);
  };

  const result = await l0({
    stream: () =>
      streamText({
        model: openai("gpt-4o-mini"),
        prompt: "Say hello",
      }),

    // Simple event handler for streaming events
    onEvent: (event) => {
      // Handle streaming events (token, complete, error, etc.)
      if (event.type === "token") {
        // Token events handled below in stream loop
      } else if (event.type === "complete") {
        console.log("  Stream completed");
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

// Example 4: Sentry integration (requires @sentry/node)
async function sentryExample() {
  console.log("\n=== Sentry Integration ===\n");
  console.log("(Requires @sentry/node to be installed and configured)\n");

  // Uncomment to use with Sentry:
  // import * as Sentry from "@sentry/node";
  // Sentry.init({ dsn: "your-dsn" });
  //
  // const result = await l0({
  //   stream: () => streamText({ model: openai("gpt-4o-mini"), prompt: "Hello" }),
  //   onEvent: createSentryHandler({ sentry: Sentry }),
  // });

  console.log("Example code:");
  console.log(`
  import * as Sentry from "@sentry/node";
  import { l0, createSentryHandler } from "reliable-ai-streams";

  const result = await l0({
    stream: () => streamText({ model, prompt }),
    onEvent: createSentryHandler({ sentry: Sentry }),
  });
  `);

  console.log("Sentry tracks:");
  console.log("  - Breadcrumbs for all events");
  console.log("  - Network errors with context");
  console.log("  - Guardrail violations");
  console.log("  - Performance transactions with TTFT and token count");
}

// Example 5: OpenTelemetry integration (requires @opentelemetry/api)
async function openTelemetryExample() {
  console.log("\n=== OpenTelemetry Integration ===\n");
  console.log("(Requires @opentelemetry/api to be installed and configured)\n");

  // Uncomment to use with OpenTelemetry:
  // import { trace, metrics } from "@opentelemetry/api";
  //
  // const result = await l0({
  //   stream: () => streamText({ model: openai("gpt-4o-mini"), prompt: "Hello" }),
  //   onEvent: createOpenTelemetryHandler({
  //     tracer: trace.getTracer("my-app"),
  //     meter: metrics.getMeter("my-app"),
  //   }),
  // });

  console.log("Example code (event handler - recommended):");
  console.log(`
  import { trace, metrics } from "@opentelemetry/api";
  import { l0, createOpenTelemetryHandler } from "reliable-ai-streams";

  const result = await l0({
    stream: () => streamText({ model, prompt }),
    onEvent: createOpenTelemetryHandler({
      tracer: trace.getTracer("my-app"),
      meter: metrics.getMeter("my-app"),
    }),
  });
  `);

  console.log("Metrics exported:");
  console.log("  - l0.requests (counter)");
  console.log("  - l0.tokens (counter)");
  console.log("  - l0.retries (counter)");
  console.log("  - l0.errors (counter)");
  console.log("  - l0.duration (histogram)");
  console.log("  - l0.time_to_first_token (histogram)");
  console.log("  - l0.active_streams (up-down counter)");
  console.log(
    "\nSpan attributes follow OpenTelemetry GenAI semantic conventions",
  );
  console.log("  - gen_ai.* and l0.* attributes");
}

// Example 6: Combined monitoring (code example)
async function combinedMonitoring() {
  console.log("\n=== Combined Monitoring ===\n");

  console.log("Example: Sentry + OpenTelemetry + custom logger");
  console.log(`
  import * as Sentry from "@sentry/node";
  import { trace, metrics } from "@opentelemetry/api";
  import { l0, combineEvents, createSentryHandler, createOpenTelemetryHandler } from "reliable-ai-streams";

  const result = await l0({
    stream: () => streamText({ model, prompt }),
    onEvent: combineEvents(
      createOpenTelemetryHandler({
        tracer: trace.getTracer("my-app"),
        meter: metrics.getMeter("my-app"),
      }),
      createSentryHandler({ sentry: Sentry }),
      (event) => console.log(event.type), // custom handler
    ),
  });
  `);
}

// Example 7: Filter and exclude events (code example)
async function filterExcludeExample() {
  console.log("\n=== Filter and Exclude Events ===\n");

  console.log("filterEvents - only process specific event types:");
  console.log(`
  import { l0, filterEvents, EventType } from "reliable-ai-streams";

  const result = await l0({
    stream: () => streamText({ model, prompt }),
    onEvent: filterEvents(
      [EventType.SESSION_START, EventType.COMPLETE, EventType.ERROR],
      (event) => {
        // Only receives SESSION_START, COMPLETE, ERROR events
        console.log('Important event:', event.type);
      }
    ),
  });
  `);

  console.log("excludeEvents - process all except specific event types:");
  console.log(`
  import { l0, excludeEvents, EventType } from "reliable-ai-streams";

  const result = await l0({
    stream: () => streamText({ model, prompt }),
    onEvent: excludeEvents(
      [EventType.CHECKPOINT_SAVED], // Exclude checkpoint events
      (event) => {
        // Receives all events EXCEPT CHECKPOINT_SAVED
        console.log('Event:', event.type);
      }
    ),
  });
  `);
}

// Example 8: EventType reference
function showEventTypes() {
  console.log("\n=== EventType Reference ===\n");

  console.log("Session events:");
  console.log("  EventType.SESSION_START, SESSION_END, SESSION_SUMMARY");

  console.log("\nStream events:");
  console.log("  EventType.STREAM_INIT, STREAM_READY");

  console.log("\nCompletion events:");
  console.log("  EventType.COMPLETE, ERROR");

  console.log("\nRetry/Fallback events:");
  console.log(
    "  EventType.RETRY_START, RETRY_ATTEMPT, RETRY_END, RETRY_GIVE_UP",
  );
  console.log(
    "  EventType.FALLBACK_START, FALLBACK_MODEL_SELECTED, FALLBACK_END",
  );

  console.log("\nGuardrail events:");
  console.log("  EventType.GUARDRAIL_PHASE_START, GUARDRAIL_RULE_RESULT, etc.");

  console.log("\nCheckpoint/Resume events:");
  console.log("  EventType.CHECKPOINT_SAVED");
  console.log("  EventType.RESUME_START, RESUME_END");

  console.log("\nNetwork events:");
  console.log("  EventType.NETWORK_ERROR, NETWORK_RETRY");

  console.log(
    "\nNote: Streaming token events use type: 'token' (lowercase string),",
  );
  console.log(
    "      not EventType.TOKEN. Handle them with: if (event.type === 'token')",
  );
}

async function main() {
  await basicTelemetry();
  await customMetadata();
  await eventHandlers();
  await sentryExample();
  await openTelemetryExample();
  await combinedMonitoring();
  await filterExcludeExample();
  showEventTypes();
}

main().catch(console.error);
