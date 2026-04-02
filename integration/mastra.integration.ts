// Mastra AI Integration Tests
// Run: OPENAI_API_KEY=sk-... npm run test:integration

import { describe, it, expect, vi } from "vitest";
import {
  describeIf,
  hasOpenAI,
  LLM_TIMEOUT,
  expectValidResponse,
} from "./setup";
import {
  l0,
  mastraStream,
  mastraAdapter,
  wrapMastraStream,
  extractMastraText,
  recommendedGuardrails,
} from "../src/index";
import { Agent } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";

// Create a test agent (requires OpenAI key since Mastra uses it under the hood)
const createTestAgent = () =>
  new Agent({
    id: "test-agent",
    name: "test-agent",
    instructions: "You are a helpful assistant. Keep responses brief.",
    model: openai("gpt-5-nano"),
  });

describeIf(hasOpenAI)("Mastra AI Integration", () => {
  describe("mastraStream", () => {
    it(
      "should stream from Mastra agent",
      async () => {
        const agent = createTestAgent();

        const result = await l0({
          stream: mastraStream(agent, "Say 'hello' and nothing else"),
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
        expect(result.state.content.toLowerCase()).toContain("hello");
      },
      LLM_TIMEOUT,
    );

    it(
      "should work with messages array",
      async () => {
        const agent = createTestAgent();

        const result = await l0({
          stream: mastraStream(agent, [
            {
              role: "user",
              content: "What is 1+1? Please explain your answer.",
            },
          ]),
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
        expect(result.state.content).toContain("2");
      },
      LLM_TIMEOUT,
    );
  });

  describe("mastraAdapter", () => {
    it(
      "should stream with explicit adapter",
      async () => {
        const agent = createTestAgent();

        const result = await l0({
          stream: () => agent.stream("Say 'adapter' and nothing else"),
          adapter: mastraAdapter,
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
        expect(result.state.content.toLowerCase()).toContain("adapter");
      },
      LLM_TIMEOUT,
    );
  });

  describe("wrapMastraStream", () => {
    it(
      "should wrap Mastra stream result",
      async () => {
        const agent = createTestAgent();
        const streamResult = await agent.stream("Say 'test'");

        const tokens: string[] = [];
        for await (const event of wrapMastraStream(streamResult)) {
          if (event.type === "token" && event.value) {
            tokens.push(event.value);
          }
        }

        expect(tokens.length).toBeGreaterThan(0);
        expect(tokens.join("").toLowerCase()).toContain("test");
      },
      LLM_TIMEOUT,
    );

    it(
      "should include usage when enabled",
      async () => {
        const agent = createTestAgent();
        const streamResult = await agent.stream("Hi");

        let doneEvent: any;
        for await (const event of wrapMastraStream(streamResult, {
          includeUsage: true,
        })) {
          if (event.type === "complete") {
            doneEvent = event;
          }
        }

        expect(doneEvent).toBeDefined();
        // Usage may or may not be present depending on Mastra version
      },
      LLM_TIMEOUT,
    );
  });

  describe("extractMastraText", () => {
    it(
      "should extract full text from stream",
      async () => {
        const agent = createTestAgent();
        const streamResult = await agent.stream("Count from 1 to 3");

        const text = await extractMastraText(streamResult);

        expectValidResponse(text);
        expect(text).toContain("1");
        expect(text).toContain("2");
        expect(text).toContain("3");
      },
      LLM_TIMEOUT,
    );
  });

  describe("With Guardrails", () => {
    it(
      "should apply guardrails to Mastra output",
      async () => {
        const agent = createTestAgent();
        const violations: any[] = [];

        const result = await l0({
          stream: mastraStream(agent, "Write a short greeting"),
          guardrails: recommendedGuardrails,
          onViolation: (v) => violations.push(v),
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
        expect(result.state.completed).toBe(true);
      },
      LLM_TIMEOUT,
    );
  });

  describe("With Monitoring", () => {
    it(
      "should collect telemetry from Mastra stream",
      async () => {
        const agent = createTestAgent();

        const result = await l0({
          stream: mastraStream(
            agent,
            "Say something interesting about programming",
          ),
          monitoring: { enabled: true },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expect(result.telemetry).toBeDefined();
        expect(result.telemetry?.duration).toBeGreaterThan(0);
        expect(result.telemetry?.metrics.totalTokens).toBeGreaterThan(0);
      },
      LLM_TIMEOUT,
    );
  });

  describe("With Fallback", () => {
    it(
      "should fall back from failed Mastra stream",
      async () => {
        const agent = createTestAgent();

        const result = await l0({
          stream: () => {
            throw new Error("Primary Mastra agent failed");
          },
          fallbackStreams: [
            mastraStream(agent, "Say 'fallback worked successfully'"),
          ],
          // Enable retry so thrown errors trigger fallback
          retry: {
            attempts: 1,
            retryOn: ["unknown", "server_error"],
          },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expect(result.state.fallbackIndex).toBe(1);
        expectValidResponse(result.state.content);
      },
      LLM_TIMEOUT,
    );
  });

  describe("Tool Call Observability", () => {
    it(
      "should detect tool calls from Mastra agent and fire onToolCall",
      async () => {
        const onToolCall = vi.fn();
        const toolCalls: Array<{ name: string; id: string; args: unknown }> =
          [];

        // Create agent with tools
        const agentWithTools = new Agent({
          id: "tool-agent",
          name: "tool-agent",
          instructions: "You are a helpful assistant with access to tools.",
          model: openai("gpt-5-nano"),
          tools: {
            get_weather: {
              description: "Get the current weather for a location",
              parameters: {
                type: "object",
                properties: {
                  location: { type: "string", description: "City name" },
                },
                required: ["location"],
              },
              execute: async ({ location }: { location: string }) => {
                return { temperature: 72, condition: "sunny", location };
              },
            },
          },
        });

        const result = await l0({
          stream: mastraStream(
            agentWithTools,
            "What's the weather in Seattle? Use the get_weather tool.",
          ),
          onToolCall: (name, id, args) => {
            onToolCall(name, id, args);
            toolCalls.push({ name, id, args: args as unknown });
          },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // consume stream
        }

        // Tool call should have been detected
        expect(onToolCall).toHaveBeenCalled();
        expect(toolCalls.length).toBeGreaterThanOrEqual(1);

        const weatherCall = toolCalls.find((t) => t.name === "get_weather");
        expect(weatherCall).toBeDefined();
        expect(weatherCall!.args).toHaveProperty("location");
      },
      LLM_TIMEOUT,
    );

    it(
      "should handle multiple tool calls from Mastra agent",
      async () => {
        const toolCalls: Array<{ name: string; id: string }> = [];

        const agentWithTools = new Agent({
          id: "multi-tool-agent",
          name: "multi-tool-agent",
          instructions: "You are a helpful assistant with access to tools.",
          model: openai("gpt-5-nano"),
          tools: {
            get_weather: {
              description: "Get the current weather for a location",
              parameters: {
                type: "object",
                properties: {
                  location: { type: "string", description: "City name" },
                },
                required: ["location"],
              },
              execute: async ({ location }: { location: string }) => {
                return { temperature: 72, condition: "sunny", location };
              },
            },
            get_time: {
              description: "Get the current time for a timezone",
              parameters: {
                type: "object",
                properties: {
                  timezone: { type: "string", description: "IANA timezone" },
                },
                required: ["timezone"],
              },
              execute: async ({ timezone }: { timezone: string }) => {
                return { time: "10:30 AM", timezone };
              },
            },
          },
        });

        const result = await l0({
          stream: mastraStream(
            agentWithTools,
            "What's the weather AND time in Tokyo? Use both tools.",
          ),
          onToolCall: (name, id) => {
            toolCalls.push({ name, id });
          },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // consume stream
        }

        // Should have both tool calls
        expect(toolCalls.length).toBeGreaterThanOrEqual(2);
        expect(toolCalls.map((t) => t.name)).toEqual(
          expect.arrayContaining(["get_weather", "get_time"]),
        );
      },
      LLM_TIMEOUT,
    );
  });
});
