// OpenAI SDK Direct Example (without Vercel AI SDK)
// Run: OPENAI_API_KEY=sk-... npx tsx examples/04-openai-sdk.ts

import OpenAI from "openai";
import {
  l0,
  openaiStream,
  openaiText,
  openaiJSON,
  openaiWithTools,
  recommendedGuardrails,
  recommendedRetry,
} from "reliable-ai-streams";

const client = new OpenAI();

// Example 1: Using openaiStream helper
async function withOpenaiStream() {
  console.log("=== OpenAI SDK with openaiStream ===\n");

  const result = await l0({
    stream: openaiStream(client, {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Write a limerick about APIs" }],
    }),
    guardrails: recommendedGuardrails,
    retry: recommendedRetry,
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }
  console.log("\n");
}

// Example 2: Using openaiText helper (simpler)
async function withOpenaiText() {
  console.log("=== OpenAI SDK with openaiText ===\n");

  const result = await l0({
    // openaiText: simple string prompt or messages array
    stream: openaiText(client, "gpt-4o-mini", "What is 2 + 2? Answer briefly."),
    guardrails: recommendedGuardrails,
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }
  console.log("\n");
}

// Example 3: Using openaiJSON helper for JSON output
async function withJSON() {
  console.log("=== OpenAI SDK with openaiJSON ===\n");

  const result = await l0({
    // openaiJSON: sets response_format: { type: "json_object" }
    stream: openaiJSON(
      client,
      "gpt-4o-mini",
      "Generate a person with name and age as JSON",
    ),
    guardrails: recommendedGuardrails,
  });

  let content = "";
  for await (const event of result.stream) {
    if (event.type === "token") {
      content += event.value || "";
      process.stdout.write(event.value || "");
    }
  }
  console.log("\n\nParsed:", JSON.parse(content));
}

// Example 4: With tool calls using openaiWithTools
async function withTools() {
  console.log("=== OpenAI SDK with Tools ===\n");

  const tools: OpenAI.ChatCompletionTool[] = [
    {
      type: "function",
      function: {
        name: "get_weather",
        description: "Get weather for a location",
        parameters: {
          type: "object",
          properties: {
            location: { type: "string", description: "City name" },
          },
          required: ["location"],
        },
      },
    },
  ];

  const result = await l0({
    // openaiWithTools: helper for tool/function calling
    stream: openaiWithTools(
      client,
      "gpt-4o-mini",
      [{ role: "user", content: "What's the weather in Paris?" }],
      tools,
    ),
    guardrails: recommendedGuardrails,

    // Track tool calls via callback
    onToolCall: (toolName, toolCallId, args) => {
      console.log(`\n🔧 Tool called: ${toolName}`);
      console.log(`   ID: ${toolCallId}`);
      console.log(`   Args: ${JSON.stringify(args)}`);
    },
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    } else if (event.type === "message") {
      // Tool calls also appear as message events
      console.log("\nMessage event:", event.value);
    }
  }
  console.log("\n");
}

async function main() {
  await withOpenaiStream();
  await withOpenaiText();
  await withJSON();
  await withTools();
}

main().catch(console.error);
