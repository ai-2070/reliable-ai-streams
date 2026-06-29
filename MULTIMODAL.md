# Multimodal Support

L0 supports multimodal AI outputs including images, audio, video, and structured data. Build adapters for image generation models like Flux, Stable Diffusion, DALL-E, or audio models like TTS.

## Event Types

L0 extends the standard event system with multimodal-specific events:

| Event Type | Description                                            |
| ---------- | ------------------------------------------------------ |
| `token`    | Text token (standard LLM streaming)                    |
| `message`  | Structured message (tool calls, etc.)                  |
| `data`     | Multimodal content (images, audio, video, files, JSON) |
| `progress` | Progress updates for long-running operations           |
| `error`    | Error event                                            |
| `complete` | Stream completion                                      |

## Content Types

L0 defines a type for multimodal content:

```typescript
type L0ContentType =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "file"
  | "json"
  | "binary";
```

## Data Payload

The `data` event carries an `L0DataPayload`:

```typescript
interface L0DataPayload {
  /**
   * Content type of the data
   */
  contentType: L0ContentType;

  /**
   * MIME type (e.g., "image/png", "audio/mp3")
   */
  mimeType?: string;

  /**
   * Data as base64 string (for binary content)
   */
  base64?: string;

  /**
   * Data as URL (for remote content)
   */
  url?: string;

  /**
   * Data as raw bytes (for binary content in Node.js)
   */
  bytes?: Uint8Array;

  /**
   * Structured data (for JSON content type)
   */
  json?: unknown;

  /**
   * Optional metadata about the content
   */
  metadata?: {
    /** Width in pixels (for images/video) */
    width?: number;
    /** Height in pixels (for images/video) */
    height?: number;
    /** Duration in seconds (for audio/video) */
    duration?: number;
    /** File size in bytes */
    size?: number;
    /** Original filename */
    filename?: string;
    /** Generation seed (for reproducibility) */
    seed?: number;
    /** Model used for generation */
    model?: string;
    /** Additional provider-specific metadata */
    [key: string]: unknown;
  };
}
```

## Progress Updates

The `progress` event carries an `L0Progress`:

```typescript
interface L0Progress {
  /** Progress percentage (0-100) */
  percent?: number;
  /** Current step number */
  step?: number;
  /** Total steps */
  totalSteps?: number;
  /** Status message */
  message?: string;
  /** Estimated time remaining in ms */
  eta?: number;
}
```

## Building a Multimodal Adapter

### Using toMultimodalL0Events

The simplest way to build a multimodal adapter:

```typescript
import { toMultimodalL0Events } from "reliable-ai-streams/adapters/helpers";
import type { L0Adapter } from "reliable-ai-streams/core";

interface FluxChunk {
  type: "progress" | "image";
  percent?: number;
  status?: string;
  image?: string;
  width?: number;
  height?: number;
  seed?: number;
}

type FluxStream = AsyncIterable<FluxChunk>;

const fluxAdapter: L0Adapter<FluxStream> = {
  name: "flux",

  detect(input): input is FluxStream {
    return !!input && typeof input === "object" && "__flux" in input;
  },

  wrap(stream) {
    return toMultimodalL0Events(stream, {
      extractProgress: (chunk) => {
        if (chunk.type === "progress") {
          return { percent: chunk.percent, message: chunk.status };
        }
        return null;
      },
      extractData: (chunk) => {
        if (chunk.type === "image" && chunk.image) {
          return {
            contentType: "image",
            mimeType: "image/png",
            base64: chunk.image,
            metadata: {
              width: chunk.width,
              height: chunk.height,
              seed: chunk.seed,
            },
          };
        }
        return null;
      },
    });
  },
};
```

### toMultimodalL0Events Handlers

The `toMultimodalL0Events` function accepts the following handlers:

```typescript
toMultimodalL0Events(stream, {
  /** Extract text from chunk (for token events) */
  extractText?: (chunk: T) => string | null | undefined;
  /** Extract multimodal data from chunk */
  extractData?: (chunk: T) => L0DataPayload | null | undefined;
  /** Extract progress from chunk */
  extractProgress?: (chunk: T) => L0Progress | null | undefined;
  /** Extract message from chunk */
  extractMessage?: (chunk: T) => { value: string; role?: string } | null | undefined;
});
```

Handlers are tried in order: text → data → progress → message. The first handler that returns a non-null value creates the event, then processing continues to the next chunk.

### Using Helper Functions

For more control, use the individual helper functions:

```typescript
import {
  createAdapterProgressEvent,
  createImageEvent,
  createAdapterDoneEvent,
  createAdapterErrorEvent,
} from "reliable-ai-streams/adapters/helpers";
import type { L0Adapter, L0Event } from "reliable-ai-streams/core";

const fluxAdapter: L0Adapter<FluxStream> = {
  name: "flux",

  async *wrap(stream): AsyncGenerator<L0Event> {
    try {
      for await (const chunk of stream) {
        if (chunk.type === "progress") {
          yield createAdapterProgressEvent({
            percent: chunk.percent,
            message: chunk.status,
          });
        } else if (chunk.type === "image") {
          yield createImageEvent({
            base64: chunk.image,
            width: chunk.width,
            height: chunk.height,
            seed: chunk.seed,
            model: "flux-schnell",
          });
        }
      }
      yield createAdapterDoneEvent();
    } catch (err) {
      yield createAdapterErrorEvent(err);
    }
  },
};
```

## Helper Functions

### Stream Conversion Helpers

| Function                                   | Description                                   |
| ------------------------------------------ | --------------------------------------------- |
| `toL0Events(stream, extractText)`          | Convert text-only stream to L0Events          |
| `toL0EventsWithMessages(stream, handlers)` | Convert stream with text and messages         |
| `toMultimodalL0Events(stream, handlers)`   | Convert multimodal stream with all extractors |

### Event Creation Helpers

| Function                                  | Description                          |
| ----------------------------------------- | ------------------------------------ |
| `createAdapterTokenEvent(value)`          | Create token event with text         |
| `createAdapterMessageEvent(value, role?)` | Create message event                 |
| `createAdapterDataEvent(payload)`         | Create data event with full payload  |
| `createAdapterProgressEvent(progress)`    | Create progress event                |
| `createAdapterDoneEvent()`                | Create complete event                |
| `createAdapterErrorEvent(err)`            | Create error event (wraps non-Error) |

### Convenience Helpers

| Function                               | Description             |
| -------------------------------------- | ----------------------- |
| `createImageEvent(options)`            | Create image data event |
| `createAudioEvent(options)`            | Create audio data event |
| `createJsonDataEvent(data, metadata?)` | Create JSON data event  |

### createImageEvent Options

```typescript
createImageEvent({
  url?: string;        // URL to image
  base64?: string;     // Base64-encoded image data
  bytes?: Uint8Array;  // Raw bytes
  mimeType?: string;   // Default: "image/png"
  width?: number;      // Width in pixels
  height?: number;     // Height in pixels
  seed?: number;       // Generation seed
  model?: string;      // Model used
});
```

### createAudioEvent Options

```typescript
createAudioEvent({
  url?: string;        // URL to audio
  base64?: string;     // Base64-encoded audio data
  bytes?: Uint8Array;  // Raw bytes
  mimeType?: string;   // Default: "audio/mp3"
  duration?: number;   // Duration in seconds
  model?: string;      // Model used
});
```

## Consuming Multimodal Streams

```typescript
import { l0 } from "reliable-ai-streams/core";

const result = await l0({
  stream: () => fluxGenerate({ prompt: "A cat in space" }),
  adapter: fluxAdapter,
});

for await (const event of result.stream) {
  switch (event.type) {
    case "progress":
      console.log(`Progress: ${event.progress?.percent}%`);
      break;
    case "data":
      if (event.data?.contentType === "image") {
        // Save or display the image
        const imageData = event.data.base64;
        const { width, height } = event.data.metadata ?? {};
        console.log(`Generated ${width}x${height} image`);
      }
      break;
    case "complete":
      console.log("Generation complete");
      break;
  }
}

// Access all generated data
console.log(`Total images: ${result.state.dataOutputs.length}`);
```

## State Tracking

L0 automatically tracks multimodal outputs in the state:

```typescript
interface L0State {
  // ... existing fields ...

  /**
   * Multimodal data outputs collected during streaming.
   * Each entry corresponds to a "data" event received.
   */
  dataOutputs: L0DataPayload[];

  /**
   * Last progress update received (for long-running operations)
   */
  lastProgress?: L0Progress;
}
```

## Important Notes

### Zero Token Detection

For streams that only produce `data` or `progress` events (no text tokens), disable zero token detection:

```typescript
const result = await l0({
  stream: () => imageGenerator.generate(prompt),
  adapter: imageAdapter,
  detectZeroTokens: false, // Required for non-text streams
});
```

By default, `detectZeroTokens` is `true`, which will throw an error if no tokens are received. Set it to `false` for multimodal-only streams.

### Checkpoint Continuation

`continueFromLastKnownGoodToken` only works with text content. It has no effect on data-only streams since there's no text to checkpoint. For multimodal streams that include text, only the text portion will be checkpointed and resumed.

## Complete Example: Flux Image Generation

```typescript
import { l0 } from "reliable-ai-streams/core";
import { toMultimodalL0Events } from "reliable-ai-streams/adapters/helpers";
import type { L0Adapter } from "reliable-ai-streams/core";

// Define the Flux stream types
interface FluxChunk {
  type: "queued" | "processing" | "completed" | "error";
  progress?: number;
  image?: { url: string; width: number; height: number };
  seed?: number;
  error?: string;
}

type FluxStream = AsyncIterable<FluxChunk> & { __flux: true };

// Create the adapter
const fluxAdapter: L0Adapter<FluxStream> = {
  name: "flux",
  detect: (input): input is FluxStream =>
    !!input && typeof input === "object" && "__flux" in input,
  wrap: (stream) =>
    toMultimodalL0Events(stream, {
      extractProgress: (chunk) => {
        if (chunk.type === "queued") return { percent: 0, message: "Queued" };
        if (chunk.type === "processing")
          return { percent: chunk.progress ?? 50, message: "Generating" };
        return null;
      },
      extractData: (chunk) => {
        if (chunk.type === "completed" && chunk.image) {
          return {
            contentType: "image",
            mimeType: "image/png",
            url: chunk.image.url,
            metadata: {
              width: chunk.image.width,
              height: chunk.image.height,
              seed: chunk.seed,
              model: "flux-1.1-pro",
            },
          };
        }
        return null;
      },
    }),
};

// Use with L0
async function generateImage(prompt: string) {
  const result = await l0({
    stream: () => fluxAPI.generate({ prompt }),
    adapter: fluxAdapter,
    detectZeroTokens: false, // Required for image-only streams
    timeout: {
      initialToken: 30000, // 30s for queue
      interToken: 60000, // 60s between updates
    },
    retry: { attempts: 2 },
  });

  for await (const event of result.stream) {
    if (event.type === "progress") {
      updateProgressBar(event.progress?.percent ?? 0);
    }
  }

  return result.state.dataOutputs[0]; // First generated image
}
```

## Text Stream Helpers

For simpler text-only adapters, use the basic helpers:

### toL0Events

Convert a simple text stream:

```typescript
import { toL0Events } from "reliable-ai-streams/adapters/helpers";

const myAdapter: L0Adapter<MyStream> = {
  name: "myai",
  detect(input): input is MyStream {
    return input?.type === "myai-stream";
  },
  wrap(stream) {
    return toL0Events(stream, (chunk) => chunk.text);
  },
};
```

### toL0EventsWithMessages

Convert a stream with both text and messages:

```typescript
import { toL0EventsWithMessages } from "reliable-ai-streams/adapters/helpers";

const toolAdapter: L0Adapter<ToolStream> = {
  name: "tool-ai",
  wrap(stream) {
    return toL0EventsWithMessages(stream, {
      extractText: (chunk) => (chunk.type === "text" ? chunk.content : null),
      extractMessage: (chunk) => {
        if (chunk.type === "tool_call") {
          return {
            value: JSON.stringify(chunk.toolCall),
            role: "assistant",
          };
        }
        return null;
      },
    });
  },
};
```

## See Also

- [CUSTOM_ADAPTERS.md](./CUSTOM_ADAPTERS.md) - Full adapter development guide
- [API.md](./API.md) - Complete API reference
