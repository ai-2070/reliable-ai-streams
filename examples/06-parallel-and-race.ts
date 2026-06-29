// Parallel and Race Example
// Run: OPENAI_API_KEY=sk-... npx tsx examples/06-parallel-and-race.ts

import {
  parallel,
  parallelAll,
  sequential,
  batched,
  race,
  createPool,
  recommendedGuardrails,
} from "reliable-ai-streams";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

// Example 1: Race - first response wins
async function raceExample() {
  console.log("=== Race Example ===\n");

  const models = ["gpt-4o-mini", "gpt-4o"];

  const result = await race([
    {
      stream: () =>
        streamText({
          model: openai("gpt-4o-mini"),
          prompt: "What is 2+2? Answer in one word.",
        }),
    },
    {
      stream: () =>
        streamText({
          model: openai("gpt-4o"),
          prompt: "What is 2+2? Answer in one word.",
        }),
    },
  ]);

  console.log("Winner:", result.state.content.trim());
  console.log("Winner Index:", result.winnerIndex);
  console.log("Winner Model:", models[result.winnerIndex]);
}

// Example 2: Parallel execution with concurrency
async function parallelExample() {
  console.log("\n=== Parallel Example ===\n");

  const prompts = ["Name a fruit", "Name a color", "Name an animal"];

  const results = await parallel(
    prompts.map((prompt) => ({
      stream: () =>
        streamText({
          model: openai("gpt-4o-mini"),
          prompt,
        }),
      guardrails: recommendedGuardrails,
    })),
    {
      concurrency: 3, // Max 3 concurrent (default: 5)
      failFast: false, // Continue on errors (default: false)
    },
  );

  console.log("Results:");
  results.results.forEach((r, i) => {
    console.log(`  ${prompts[i]}: ${r?.state.content.trim()}`);
  });
  console.log(`\nSuccess: ${results.successCount}/${results.results.length}`);
  console.log(`Duration: ${results.duration}ms`);
}

// Example 3: Parallel with limited concurrency and progress
async function batchedParallel() {
  console.log("\n=== Batched Parallel (concurrency=2) ===\n");

  const tasks = Array.from({ length: 5 }, (_, i) => ({
    stream: () =>
      streamText({
        model: openai("gpt-4o-mini"),
        prompt: `Count to ${i + 1}`,
      }),
  }));

  const results = await parallel(tasks, {
    concurrency: 2,
    onProgress: (completed, total) => {
      console.log(`Progress: ${completed}/${total}`);
    },
    onComplete: (result, index) => {
      console.log(`  Task ${index} done: ${result.state.content.trim()}`);
    },
  });

  console.log("\nAll done:", results.successCount, "succeeded");
  console.log("Total duration:", results.duration, "ms");
}

// Example 4: Sequential execution
async function sequentialExample() {
  console.log("\n=== Sequential Example ===\n");

  const prompts = ["First task", "Second task", "Third task"];

  const results = await sequential(
    prompts.map((prompt) => ({
      stream: () =>
        streamText({
          model: openai("gpt-4o-mini"),
          prompt: `Say "${prompt}" briefly`,
        }),
    })),
  );

  console.log("Results (in order):");
  results.results.forEach((r, i) => {
    console.log(`  ${i + 1}. ${r?.state.content.trim()}`);
  });
}

// Example 5: Operation Pool for dynamic workloads
async function poolExample() {
  console.log("\n=== Operation Pool Example ===\n");

  const pool = createPool(2); // Max 2 concurrent

  // Add operations dynamically
  const promises = [
    pool.execute({
      stream: () =>
        streamText({
          model: openai("gpt-4o-mini"),
          prompt: "Say 'Task A done'",
        }),
    }),
    pool.execute({
      stream: () =>
        streamText({
          model: openai("gpt-4o-mini"),
          prompt: "Say 'Task B done'",
        }),
    }),
    pool.execute({
      stream: () =>
        streamText({
          model: openai("gpt-4o-mini"),
          prompt: "Say 'Task C done'",
        }),
    }),
  ];

  console.log("Queue length:", pool.getQueueLength());
  console.log("Active workers:", pool.getActiveWorkers());

  // Wait for all
  const results = await Promise.all(promises);
  results.forEach((r, i) => {
    console.log(
      `  Task ${String.fromCharCode(65 + i)}: ${r.state.content.trim()}`,
    );
  });

  // Or use drain() to wait for all queued operations
  await pool.drain();
  console.log("Pool drained");
}

async function main() {
  await raceExample();
  await parallelExample();
  await batchedParallel();
  await sequentialExample();
  await poolExample();
}

main().catch(console.error);
