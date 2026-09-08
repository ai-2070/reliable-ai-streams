// OpenAI SDK adapter tests
import { describe, it, expect } from "vitest";
import {
  wrapOpenAIStream,
  openaiStream,
  openaiText,
  openaiJSON,
  openaiWithTools,
  isOpenAIChunk,
  extractOpenAIText,
  type OpenAIClient,
} from "../src/adapters/openai";
import type { L0Event } from "../src/types/l0";
import OpenAI from "openai";

// Mock OpenAI stream chunk format
function createMockOpenAIChunk(
  content?: string,
  options: {
    finishReason?: string | null;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
    toolCalls?: Array<{
      index: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    }>;
    functionCall?: { name?: string; arguments?: string };
  } = {},
) {
  return {
    id: "chatcmpl-123",
    object: "chat.completion.chunk",
    created: Date.now(),
    model: "gpt-4o",
    choices: [
      {
        index: 0,
        delta: {
          content: content,
          tool_calls: options.toolCalls,
          function_call: options.functionCall,
        },
        finish_reason: options.finishReason,
      },
    ],
    usage: options.usage,
  };
}

// Create an async iterable from chunks
async function* createMockOpenAIStream(chunks: any[]): AsyncIterable<any> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

// Mock OpenAI client
function createMockOpenAIClient(chunks: any[]): OpenAIClient {
  return {
    chat: {
      completions: {
        create: async () => {
          return createMockOpenAIStream(chunks);
        },
      },
    },
  };
}

describe("OpenAI SDK Adapter", () => {
  describe("wrapOpenAIStream", () => {
    it("should convert OpenAI chunks to L0 token events", async () => {
      const chunks = [
        createMockOpenAIChunk("Hello"),
        createMockOpenAIChunk(" "),
        createMockOpenAIChunk("world"),
        createMockOpenAIChunk(undefined, { finishReason: "stop" }),
      ];

      const stream = createMockOpenAIStream(chunks);
      const events: L0Event[] = [];

      for await (const event of wrapOpenAIStream(stream)) {
        events.push(event);
      }

      // Should have 3 token events + 1 done event
      const tokenEvents = events.filter((e) => e.type === "token");
      const completeEvent = events.filter((e) => e.type === "complete");

      expect(tokenEvents).toHaveLength(3);
      expect(tokenEvents[0]!.value).toBe("Hello");
      expect(tokenEvents[1]!.value).toBe(" ");
      expect(tokenEvents[2]!.value).toBe("world");
      expect(completeEvent).toHaveLength(1);
    });

    it("should include usage information when available", async () => {
      const chunks = [
        createMockOpenAIChunk("Hi"),
        createMockOpenAIChunk(undefined, {
          finishReason: "stop",
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      ];

      const stream = createMockOpenAIStream(chunks);
      const events: L0Event[] = [];

      for await (const event of wrapOpenAIStream(stream)) {
        events.push(event);
      }

      const doneEvent = events.find((e) => e.type === "complete");
      expect(doneEvent).toBeDefined();
      expect((doneEvent as any).usage).toBeDefined();
      expect((doneEvent as any).usage.total_tokens).toBe(15);
    });

    it("should exclude usage when includeUsage is false", async () => {
      const chunks = [
        createMockOpenAIChunk("Hi"),
        createMockOpenAIChunk(undefined, {
          finishReason: "stop",
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      ];

      const stream = createMockOpenAIStream(chunks);
      const events: L0Event[] = [];

      for await (const event of wrapOpenAIStream(stream, {
        includeUsage: false,
      })) {
        events.push(event);
      }

      const doneEvent = events.find((e) => e.type === "complete");
      expect(doneEvent).toBeDefined();
      expect((doneEvent as any).usage).toBeUndefined();
    });

    it("should handle tool calls", async () => {
      const chunks = [
        createMockOpenAIChunk(undefined, {
          toolCalls: [
            { index: 0, id: "call_123", function: { name: "get_weather" } },
          ],
        }),
        createMockOpenAIChunk(undefined, {
          toolCalls: [{ index: 0, function: { arguments: '{"location":' } }],
        }),
        createMockOpenAIChunk(undefined, {
          toolCalls: [{ index: 0, function: { arguments: '"Tokyo"}' } }],
        }),
        createMockOpenAIChunk(undefined, { finishReason: "tool_calls" }),
      ];

      const stream = createMockOpenAIStream(chunks);
      const events: L0Event[] = [];

      for await (const event of wrapOpenAIStream(stream)) {
        events.push(event);
      }

      const messageEvent = events.find((e) => e.type === "message");
      expect(messageEvent).toBeDefined();

      const data = JSON.parse(messageEvent!.value!);
      expect(data.type).toBe("tool_calls");
      expect(data.tool_calls).toHaveLength(1);
      expect(data.tool_calls[0].name).toBe("get_weather");
      expect(data.tool_calls[0].arguments).toBe('{"location":"Tokyo"}');
    });

    it("should handle multiple tool calls", async () => {
      const chunks = [
        createMockOpenAIChunk(undefined, {
          toolCalls: [
            { index: 0, id: "call_1", function: { name: "get_weather" } },
            { index: 1, id: "call_2", function: { name: "get_time" } },
          ],
        }),
        createMockOpenAIChunk(undefined, {
          toolCalls: [
            { index: 0, function: { arguments: '{"loc":"NYC"}' } },
            { index: 1, function: { arguments: '{"tz":"EST"}' } },
          ],
        }),
        createMockOpenAIChunk(undefined, { finishReason: "tool_calls" }),
      ];

      const stream = createMockOpenAIStream(chunks);
      const events: L0Event[] = [];

      for await (const event of wrapOpenAIStream(stream)) {
        events.push(event);
      }

      const messageEvent = events.find((e) => e.type === "message");
      expect(messageEvent).toBeDefined();

      const data = JSON.parse(messageEvent!.value!);
      expect(data.tool_calls).toHaveLength(2);
      expect(data.tool_calls[0].name).toBe("get_weather");
      expect(data.tool_calls[1].name).toBe("get_time");
    });

    it("should handle legacy function calls", async () => {
      const chunks = [
        createMockOpenAIChunk(undefined, {
          functionCall: { name: "get_weather" },
        }),
        createMockOpenAIChunk(undefined, {
          functionCall: { arguments: '{"loc":"Paris"}' },
        }),
        createMockOpenAIChunk(undefined, { finishReason: "function_call" }),
      ];

      const stream = createMockOpenAIStream(chunks);
      const events: L0Event[] = [];

      for await (const event of wrapOpenAIStream(stream)) {
        events.push(event);
      }

      const messageEvent = events.find((e) => e.type === "message");
      expect(messageEvent).toBeDefined();

      const data = JSON.parse(messageEvent!.value!);
      expect(data.type).toBe("function_call");
      expect(data.function_call.name).toBe("get_weather");
      expect(data.function_call.arguments).toBe('{"loc":"Paris"}');
    });

    it("should emit function call arguments as tokens when enabled", async () => {
      const chunks = [
        createMockOpenAIChunk(undefined, {
          toolCalls: [{ index: 0, id: "call_123", function: { name: "test" } }],
        }),
        createMockOpenAIChunk(undefined, {
          toolCalls: [{ index: 0, function: { arguments: '{"a":1}' } }],
        }),
        createMockOpenAIChunk(undefined, { finishReason: "tool_calls" }),
      ];

      const stream = createMockOpenAIStream(chunks);
      const events: L0Event[] = [];

      for await (const event of wrapOpenAIStream(stream, {
        emitFunctionCallsAsTokens: true,
      })) {
        events.push(event);
      }

      const tokenEvents = events.filter((e) => e.type === "token");
      expect(tokenEvents.length).toBeGreaterThan(0);
      expect(tokenEvents.some((e) => e.value === '{"a":1}')).toBe(true);
    });

    it("should exclude tool calls when includeToolCalls is false", async () => {
      const chunks = [
        createMockOpenAIChunk(undefined, {
          toolCalls: [
            {
              index: 0,
              id: "call_123",
              function: { name: "test", arguments: "{}" },
            },
          ],
        }),
        createMockOpenAIChunk(undefined, { finishReason: "tool_calls" }),
      ];

      const stream = createMockOpenAIStream(chunks);
      const events: L0Event[] = [];

      for await (const event of wrapOpenAIStream(stream, {
        includeToolCalls: false,
      })) {
        events.push(event);
      }

      const messageEvents = events.filter((e) => e.type === "message");
      expect(messageEvents).toHaveLength(0);
    });

    it("should handle errors in stream", async () => {
      async function* errorStream(): AsyncIterable<any> {
        yield createMockOpenAIChunk("Hello");
        throw new Error("Stream error");
      }

      const events: L0Event[] = [];

      for await (const event of wrapOpenAIStream(errorStream())) {
        events.push(event);
      }

      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
      expect(errorEvent!.error!.message).toBe("Stream error");
    });

    it("should handle empty chunks gracefully", async () => {
      const chunks = [
        { choices: [] },
        createMockOpenAIChunk("Hello"),
        { choices: [{ delta: {} }] },
        createMockOpenAIChunk(undefined, { finishReason: "stop" }),
      ];

      const stream = createMockOpenAIStream(chunks);
      const events: L0Event[] = [];

      for await (const event of wrapOpenAIStream(stream)) {
        events.push(event);
      }

      const tokenEvents = events.filter((e) => e.type === "token");
      expect(tokenEvents).toHaveLength(1);
      expect(tokenEvents[0]!.value).toBe("Hello");
    });
  });

  describe("openaiStream", () => {
    it("should create a stream factory", async () => {
      const chunks = [
        createMockOpenAIChunk("Test"),
        createMockOpenAIChunk(undefined, { finishReason: "stop" }),
      ];

      const client = createMockOpenAIClient(chunks);
      const factory = openaiStream(client, {
        model: "gpt-4o",
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(typeof factory).toBe("function");

      const stream = await factory();
      const events: L0Event[] = [];

      for await (const event of stream) {
        events.push(event);
      }

      expect(events.filter((e) => e.type === "token")).toHaveLength(1);
    });

    it("should pass options to wrapper", async () => {
      const chunks = [
        createMockOpenAIChunk("Test"),
        createMockOpenAIChunk(undefined, {
          finishReason: "stop",
          usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
        }),
      ];

      const client = createMockOpenAIClient(chunks);
      const factory = openaiStream(
        client,
        { model: "gpt-4o", messages: [] },
        { includeUsage: false },
      );

      const stream = await factory();
      const events: L0Event[] = [];

      for await (const event of stream) {
        events.push(event);
      }

      const doneEvent = events.find((e) => e.type === "complete");
      expect((doneEvent as any).usage).toBeUndefined();
    });
  });

  describe("openaiText", () => {
    it("should create a text stream from string prompt", async () => {
      const chunks = [
        createMockOpenAIChunk("Hello"),
        createMockOpenAIChunk(" there"),
        createMockOpenAIChunk(undefined, { finishReason: "stop" }),
      ];

      const client = createMockOpenAIClient(chunks);
      const factory = openaiText(client, "gpt-4o", "Say hello");

      const stream = await factory();
      const events: L0Event[] = [];

      for await (const event of stream) {
        events.push(event);
      }

      const tokens = events.filter((e) => e.type === "token");
      expect(tokens).toHaveLength(2);
    });

    it("should create a text stream from messages array", async () => {
      const chunks = [
        createMockOpenAIChunk("Response"),
        createMockOpenAIChunk(undefined, { finishReason: "stop" }),
      ];

      const client = createMockOpenAIClient(chunks);
      const factory = openaiText(client, "gpt-4o", [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hello" },
      ]);

      const stream = await factory();
      const events: L0Event[] = [];

      for await (const event of stream) {
        events.push(event);
      }

      expect(events.filter((e) => e.type === "token")).toHaveLength(1);
    });
  });

  describe("openaiJSON", () => {
    it("should create a JSON stream", async () => {
      const chunks = [
        createMockOpenAIChunk('{"name":'),
        createMockOpenAIChunk('"test"}'),
        createMockOpenAIChunk(undefined, { finishReason: "stop" }),
      ];

      const client = createMockOpenAIClient(chunks);
      const factory = openaiJSON(client, "gpt-4o", "Generate JSON");

      const stream = await factory();
      const events: L0Event[] = [];

      for await (const event of stream) {
        events.push(event);
      }

      const tokens = events
        .filter((e) => e.type === "token")
        .map((e) => e.value);
      expect(tokens.join("")).toBe('{"name":"test"}');
    });
  });

  describe("openaiWithTools", () => {
    it("should create a stream with tools", async () => {
      const chunks = [
        createMockOpenAIChunk(undefined, {
          toolCalls: [
            {
              index: 0,
              id: "call_123",
              function: { name: "search", arguments: '{"q":"test"}' },
            },
          ],
        }),
        createMockOpenAIChunk(undefined, { finishReason: "tool_calls" }),
      ];

      const client = createMockOpenAIClient(chunks);
      const factory = openaiWithTools(
        client,
        "gpt-4o",
        [{ role: "user", content: "Search for test" }],
        [
          {
            type: "function",
            function: {
              name: "search",
              description: "Search for something",
              parameters: {
                type: "object",
                properties: { q: { type: "string" } },
              },
            },
          },
        ],
      );

      const stream = await factory();
      const events: L0Event[] = [];

      for await (const event of stream) {
        events.push(event);
      }

      const messageEvent = events.find((e) => e.type === "message");
      expect(messageEvent).toBeDefined();

      const data = JSON.parse(messageEvent!.value!);
      expect(data.tool_calls[0].name).toBe("search");
    });
  });

  describe("isOpenAIChunk", () => {
    it("should return true for valid OpenAI chunks", () => {
      const chunk = createMockOpenAIChunk("Hello");
      expect(isOpenAIChunk(chunk)).toBe(true);
    });

    it("should return false for invalid objects", () => {
      expect(isOpenAIChunk(null)).toBe(false);
      expect(isOpenAIChunk(undefined)).toBe(false);
      expect(isOpenAIChunk({})).toBe(false);
      expect(isOpenAIChunk({ choices: [] })).toBe(false);
      expect(isOpenAIChunk({ choices: [{}] })).toBe(false);
    });

    it("should return true for chunks with delta", () => {
      expect(isOpenAIChunk({ choices: [{ delta: {} }] })).toBe(true);
      expect(isOpenAIChunk({ choices: [{ delta: { content: "hi" } }] })).toBe(
        true,
      );
    });
  });

  describe("extractOpenAIText", () => {
    it("should extract all text from a stream", async () => {
      const chunks = [
        createMockOpenAIChunk("Hello"),
        createMockOpenAIChunk(" "),
        createMockOpenAIChunk("world"),
        createMockOpenAIChunk(undefined, { finishReason: "stop" }),
      ];

      const stream = createMockOpenAIStream(chunks);
      const text = await extractOpenAIText(stream);

      expect(text).toBe("Hello world");
    });

    it("should handle empty stream", async () => {
      const chunks = [
        createMockOpenAIChunk(undefined, { finishReason: "stop" }),
      ];

      const stream = createMockOpenAIStream(chunks);
      const text = await extractOpenAIText(stream);

      expect(text).toBe("");
    });

    it("should skip non-content chunks", async () => {
      const chunks = [
        createMockOpenAIChunk(undefined, {
          toolCalls: [{ index: 0, id: "call", function: { name: "test" } }],
        }),
        createMockOpenAIChunk("Text"),
        createMockOpenAIChunk(undefined, { finishReason: "stop" }),
      ];

      const stream = createMockOpenAIStream(chunks);
      const text = await extractOpenAIText(stream);

      expect(text).toBe("Text");
    });
  });

  describe("Integration with mock client", () => {
    it("should handle a complete conversation flow", async () => {
      const chunks = [
        createMockOpenAIChunk("I"),
        createMockOpenAIChunk("'ll"),
        createMockOpenAIChunk(" help"),
        createMockOpenAIChunk(" you"),
        createMockOpenAIChunk(" with"),
        createMockOpenAIChunk(" that"),
        createMockOpenAIChunk("."),
        createMockOpenAIChunk(undefined, {
          finishReason: "stop",
          usage: { prompt_tokens: 10, completion_tokens: 7, total_tokens: 17 },
        }),
      ];

      const client = createMockOpenAIClient(chunks);
      const factory = openaiText(client, "gpt-4o", "Help me");

      const stream = await factory();
      let fullText = "";
      let usage: any;

      for await (const event of stream) {
        if (event.type === "token") {
          fullText += event.value;
        }
        if (event.type === "complete" && (event as any).usage) {
          usage = (event as any).usage;
        }
      }

      expect(fullText).toBe("I'll help you with that.");
      expect(usage).toBeDefined();
      expect(usage.total_tokens).toBe(17);
    });

    it("should work with additional chat params", async () => {
      const chunks = [
        createMockOpenAIChunk("Response"),
        createMockOpenAIChunk(undefined, { finishReason: "stop" }),
      ];

      const client = createMockOpenAIClient(chunks);
      const factory = openaiText(client, "gpt-4o", "Hello", {
        temperature: 0.7,
        max_tokens: 100,
      });

      const stream = await factory();
      const events: L0Event[] = [];

      for await (const event of stream) {
        events.push(event);
      }

      expect(events.filter((e) => e.type === "token")).toHaveLength(1);
    });
  });

  // Guards the `openai` peer range (^6.0.0 || ^7.0.0) at runtime: the real SDK
  // owns SSE parsing and the `Stream` wrapper, so a major bump can break the
  // adapter even while the mock-client tests above keep passing.
  describe("Real openai SDK stream", () => {
    it("consumes a Stream produced by the installed openai SDK", async () => {
      // Shape matches a real `stream_options: { include_usage: true }` stream:
      // usage arrives in a trailing chunk that carries no choices.
      const body =
        [
          createMockOpenAIChunk("Hello"),
          createMockOpenAIChunk(" world", { finishReason: "stop" }),
          {
            id: "chatcmpl-123",
            object: "chat.completion.chunk",
            created: Date.now(),
            model: "gpt-4o",
            choices: [],
            usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
          },
        ]
          .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
          .join("") + "data: [DONE]\n\n";

      const client = new OpenAI({
        apiKey: "test",
        fetch: async () =>
          new Response(body, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
      });

      const stream = await openaiStream(client, {
        model: "gpt-4o",
        messages: [{ role: "user", content: "Hello" }],
      })();

      const events: L0Event[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      expect(
        events
          .filter((e) => e.type === "token")
          .map((e) => e.value)
          .join(""),
      ).toBe("Hello world");

      const complete = events.find((e) => e.type === "complete");
      const usage =
        complete && "usage" in complete ? complete.usage : undefined;
      expect(usage).toEqual({
        prompt_tokens: 3,
        completion_tokens: 2,
        total_tokens: 5,
      });
    });
  });
});
