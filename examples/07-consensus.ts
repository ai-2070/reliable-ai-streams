// Consensus Example
// Run: OPENAI_API_KEY=sk-... npx tsx examples/07-consensus.ts

import {
  consensus,
  quickConsensus,
  getConsensusValue,
  standardConsensus,
} from "reliable-ai-streams";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

// Example 1: Majority consensus
async function majorityConsensus() {
  console.log("=== Majority Consensus ===\n");

  const prompt =
    "What is the capital of France? Answer with just the city name.";

  const result = await consensus({
    streams: [
      () => streamText({ model: openai("gpt-4o-mini"), prompt }),
      () => streamText({ model: openai("gpt-4o-mini"), prompt }),
      () => streamText({ model: openai("gpt-4o-mini"), prompt }),
    ],
    strategy: "majority", // "majority" | "unanimous" | "weighted" | "best"
    threshold: 0.66, // Minimum agreement ratio
  });

  console.log("Consensus:", result.consensus);
  console.log("Confidence:", result.confidence.toFixed(2));
  console.log("Status:", result.status); // "success" | "partial" | "failed"
  console.log(
    "Individual responses:",
    result.outputs.map((o) => o.text.trim()),
  );
}

// Example 2: Unanimous consensus
async function unanimousConsensus() {
  console.log("\n=== Unanimous Consensus ===\n");

  const prompt = "What is 5 + 5? Answer with just the number.";

  const result = await consensus({
    streams: [
      () => streamText({ model: openai("gpt-4o-mini"), prompt }),
      () => streamText({ model: openai("gpt-4o-mini"), prompt }),
      () => streamText({ model: openai("gpt-4o-mini"), prompt }),
    ],
    strategy: "unanimous",
  });

  console.log("Consensus:", result.consensus);
  console.log("Confidence:", result.confidence.toFixed(2));
  console.log("Agreement reached:", result.confidence === 1);
  console.log("Agreements:", result.agreements.length);
  console.log("Disagreements:", result.disagreements.length);
}

// Example 3: Weighted consensus
async function weightedConsensus() {
  console.log("\n=== Weighted Consensus ===\n");

  const prompt = "What is the best programming language? Answer in one word.";

  const result = await consensus({
    streams: [
      () => streamText({ model: openai("gpt-4o"), prompt }), // Higher weight
      () => streamText({ model: openai("gpt-4o-mini"), prompt }),
      () => streamText({ model: openai("gpt-4o-mini"), prompt }),
    ],
    strategy: "weighted",
    weights: [1.0, 0.5, 0.5], // GPT-4o gets double weight
  });

  console.log("Weighted consensus:", result.consensus);
  console.log("Confidence:", result.confidence.toFixed(2));
  console.log(
    "Individual responses:",
    result.outputs.map((o) => o.text.trim()),
  );
}

// Example 4: Best response selection
async function bestResponse() {
  console.log("\n=== Best Response Selection ===\n");

  const prompt = "Write a one-sentence tagline for a coffee shop.";

  const result = await consensus({
    streams: [
      () => streamText({ model: openai("gpt-4o-mini"), prompt }),
      () => streamText({ model: openai("gpt-4o-mini"), prompt }),
      () => streamText({ model: openai("gpt-4o-mini"), prompt }),
    ],
    strategy: "best",
  });

  console.log("Best tagline:", result.consensus);
  console.log("All options:");
  result.outputs.forEach((o, i) => {
    console.log(`  ${i + 1}. ${o.text.trim()}`);
  });
}

// Example 5: Quick consensus helpers
async function quickHelpers() {
  console.log("\n=== Quick Consensus Helpers ===\n");

  // Simulate outputs (in real use, these would come from LLM calls)
  const outputs = ["Paris", "Paris", "London"];

  // Quick check if outputs agree
  const hasConsensus = quickConsensus(outputs, 0.66); // 66% threshold
  console.log("Has consensus (66%):", hasConsensus);

  // Get most common value
  const mostCommon = getConsensusValue(outputs);
  console.log("Most common value:", mostCommon);
}

// Example 6: Using presets
async function presetExample() {
  console.log("\n=== Consensus Preset ===\n");

  const prompt = "Name the largest planet. One word.";

  // standardConsensus preset: { strategy: "majority", threshold: 0.5, resolveConflicts: "vote" }
  const result = await consensus({
    streams: [
      () => streamText({ model: openai("gpt-4o-mini"), prompt }),
      () => streamText({ model: openai("gpt-4o-mini"), prompt }),
      () => streamText({ model: openai("gpt-4o-mini"), prompt }),
    ],
    ...standardConsensus,
  });

  console.log("Consensus:", result.consensus);
  console.log("Status:", result.status);
}

async function main() {
  await majorityConsensus();
  await unanimousConsensus();
  await weightedConsensus();
  await bestResponse();
  await quickHelpers();
  await presetExample();
}

main().catch(console.error);
