// Structured Output Example
// Run: OPENAI_API_KEY=sk-... npx tsx examples/02-structured-output.ts

import {
  structured,
  structuredObject,
  structuredArray,
  recommendedStructured,
} from "reliable-ai-streams";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

// Example 1: Basic structured output
async function basicStructured() {
  console.log("=== Basic Structured Output ===\n");

  const schema = z.object({
    name: z.string(),
    age: z.number(),
    occupation: z.string(),
  });

  const result = await structured({
    schema,
    stream: () =>
      streamText({
        model: openai("gpt-4o-mini"),
        prompt:
          "Generate a fictional person as JSON with name, age, and occupation fields",
      }),
    // Auto-correct: fix trailing commas, missing braces, markdown fences, etc.
    autoCorrect: true,
  });

  console.log("Validated data:", result.data);
  console.log("Was corrected:", result.corrected);
  if (result.corrections.length > 0) {
    console.log("Corrections applied:", result.corrections);
  }
}

// Example 2: Using structuredObject helper
async function objectHelper() {
  console.log("\n=== structuredObject Helper ===\n");

  // Shorthand: no need to wrap in z.object()
  const result = await structuredObject(
    {
      city: z.string(),
      country: z.string(),
      population: z.number(),
    },
    {
      stream: () =>
        streamText({
          model: openai("gpt-4o-mini"),
          prompt:
            "Generate a random major city as JSON with city, country, and population",
        }),
      autoCorrect: true,
    },
  );

  console.log(`${result.data.city}, ${result.data.country}`);
  console.log(`Population: ${result.data.population.toLocaleString()}`);
}

// Example 3: Complex nested schema
async function nestedSchema() {
  console.log("\n=== Nested Schema Example ===\n");

  const schema = z.object({
    company: z.string(),
    employees: z.array(
      z.object({
        name: z.string(),
        role: z.string(),
        yearsExperience: z.number(),
      }),
    ),
    founded: z.number(),
  });

  const result = await structured({
    schema,
    stream: () =>
      streamText({
        model: openai("gpt-4o-mini"),
        prompt: "Generate a fictional tech startup with 3 employees as JSON",
      }),
    // Use preset: { autoCorrect: true, retry: { attempts: 2 } }
    ...recommendedStructured,
  });

  console.log("Company:", result.data.company);
  console.log("Founded:", result.data.founded);
  console.log("Employees:");
  result.data.employees.forEach(
    (emp: { name: string; role: string; yearsExperience: number }) => {
      console.log(
        `  - ${emp.name}: ${emp.role} (${emp.yearsExperience} years)`,
      );
    },
  );
}

// Example 4: Array of items
async function arrayOutput() {
  console.log("\n=== Array Output Example ===\n");

  const itemSchema = z.object({
    title: z.string(),
    author: z.string(),
    year: z.number(),
  });

  const result = await structuredArray(itemSchema, {
    stream: () =>
      streamText({
        model: openai("gpt-4o-mini"),
        prompt:
          "List 3 classic science fiction books as a JSON array with title, author, and year",
      }),
    autoCorrect: true,
  });

  console.log(`Found ${result.data.length} books:`);
  result.data.forEach((book) => {
    console.log(`  - "${book.title}" by ${book.author} (${book.year})`);
  });
}

async function main() {
  await basicStructured();
  await objectHelper();
  await nestedSchema();
  await arrayOutput();
}

main().catch(console.error);
