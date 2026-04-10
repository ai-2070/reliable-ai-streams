// Event normalization for unified L0 event format

import type { L0Event } from "../types/l0";

/**
 * Normalize a stream event from Vercel AI SDK or other providers
 * into unified L0 event format
 *
 * @param chunk - Raw stream chunk from provider
 * @returns Normalized L0 event
 */
export function normalizeStreamEvent(chunk: any): L0Event {
  // Handle null/undefined
  if (!chunk) {
    return {
      type: "error",
      error: new Error("Received null or undefined chunk"),
      timestamp: Date.now(),
    };
  }

  // If already in L0 format
  if (isL0Event(chunk)) {
    return chunk;
  }

  // Handle Vercel AI SDK format
  if (chunk.type) {
    switch (chunk.type) {
      case "text-delta":
      case "content-delta":
        return {
          type: "token",
          value: chunk.textDelta || chunk.delta || chunk.content || "",
          timestamp: Date.now(),
        };

      case "finish":
      case "complete":
      case "message_stop":
      case "content_block_stop":
        return {
          type: "complete",
          timestamp: Date.now(),
        };

      case "error":
        return {
          type: "error",
          error: chunk.error || new Error(chunk.message || "Stream error"),
          timestamp: Date.now(),
        };

      case "tool-call":
      case "function-call":
        // Convert tool call to message event
        return {
          type: "message",
          value: JSON.stringify(chunk),
          role: "assistant",
          timestamp: Date.now(),
        };

      default:
        // Unknown type, try to extract text
        const text = extractTextFromChunk(chunk);
        if (text) {
          return {
            type: "token",
            value: text,
            timestamp: Date.now(),
          };
        }
        return {
          type: "error",
          error: new Error(`Unknown chunk type: ${chunk.type}`),
          timestamp: Date.now(),
        };
    }
  }

  // Handle OpenAI streaming format
  if (chunk.choices && Array.isArray(chunk.choices)) {
    const choice = chunk.choices[0];
    if (choice?.delta?.content) {
      return {
        type: "token",
        value: choice.delta.content,
        timestamp: Date.now(),
      };
    }
    if (choice?.finish_reason) {
      return {
        type: "complete",
        timestamp: Date.now(),
      };
    }
  }

  // Handle Anthropic streaming format (content_delta without a .type field)
  if (chunk.delta?.text) {
    return {
      type: "token",
      value: chunk.delta.text,
      timestamp: Date.now(),
    };
  }

  // Handle simple string chunks
  if (typeof chunk === "string") {
    return {
      type: "token",
      value: chunk,
      timestamp: Date.now(),
    };
  }

  // Try to extract any text content
  const text = extractTextFromChunk(chunk);
  if (text) {
    return {
      type: "token",
      value: text,
      timestamp: Date.now(),
    };
  }

  // Unknown format
  return {
    type: "error",
    error: new Error(`Unable to normalize chunk: ${JSON.stringify(chunk)}`),
    timestamp: Date.now(),
  };
}

/**
 * Check if object is already an L0 event
 */
function isL0Event(obj: any): obj is L0Event {
  return (
    obj &&
    typeof obj === "object" &&
    "type" in obj &&
    (obj.type === "token" ||
      obj.type === "message" ||
      obj.type === "data" ||
      obj.type === "progress" ||
      obj.type === "error" ||
      obj.type === "complete")
  );
}

/**
 * Try to extract text from various chunk formats
 */
function extractTextFromChunk(chunk: any): string | null {
  if (!chunk || typeof chunk !== "object") {
    return null;
  }

  // Try common field names
  const textFields = [
    "text",
    "content",
    "delta",
    "textDelta",
    "token",
    "message",
    "data",
  ];

  for (const field of textFields) {
    if (chunk[field] && typeof chunk[field] === "string") {
      return chunk[field];
    }
  }

  // Try nested delta/content
  if (chunk.delta && typeof chunk.delta === "object") {
    for (const field of textFields) {
      if (chunk.delta[field] && typeof chunk.delta[field] === "string") {
        return chunk.delta[field];
      }
    }
  }

  return null;
}

/**
 * Normalize an error into L0 event format
 *
 * @param error - Error to normalize
 * @returns L0 error event
 */
export function normalizeError(error: Error | string | unknown): L0Event {
  const err = error instanceof Error ? error : new Error(String(error));

  return {
    type: "error",
    error: err,
    timestamp: Date.now(),
  };
}

/**
 * Create a token event
 *
 * @param value - Token value
 * @returns L0 token event
 */
export function createTokenEvent(value: string): L0Event {
  return {
    type: "token",
    value,
    timestamp: Date.now(),
  };
}

/**
 * Create a message event
 *
 * @param value - Message content
 * @param role - Message role
 * @returns L0 message event
 */
export function createMessageEvent(
  value: string,
  role: "user" | "assistant" | "system",
): L0Event {
  return {
    type: "message",
    value,
    role,
    timestamp: Date.now(),
  };
}

/**
 * Create a complete event
 *
 * @returns L0 complete event
 */
export function createCompleteEvent(): L0Event {
  return {
    type: "complete",
    timestamp: Date.now(),
  };
}

/**
 * Create an error event
 *
 * @param error - Error
 * @returns L0 error event
 */
export function createErrorEvent(error: Error): L0Event {
  return {
    type: "error",
    error,
    timestamp: Date.now(),
  };
}

/**
 * Batch normalize multiple chunks
 *
 * @param chunks - Array of chunks to normalize
 * @returns Array of normalized L0 events
 */
export function normalizeStreamEvents(chunks: any[]): L0Event[] {
  return chunks.map((chunk) => normalizeStreamEvent(chunk));
}

/**
 * Filter events by type
 *
 * @param events - Events to filter
 * @param type - Event type to filter for
 * @returns Filtered events
 */
export function filterEventsByType(
  events: L0Event[],
  type: L0Event["type"],
): L0Event[] {
  return events.filter((event) => event.type === type);
}

/**
 * Get all token values from events
 *
 * @param events - Events to extract tokens from
 * @returns Array of token values
 */
export function extractTokens(events: L0Event[]): string[] {
  return events
    .filter((event) => event.type === "token" && event.value)
    .map((event) => event.value!);
}

/**
 * Reconstruct text from token events
 *
 * @param events - Events to reconstruct from
 * @returns Reconstructed text
 */
export function reconstructText(events: L0Event[]): string {
  return extractTokens(events).join("");
}

/**
 * Check if event is an error event
 *
 * @param event - Event to check
 * @returns True if error event
 */
export function isErrorEvent(event: L0Event): boolean {
  return event.type === "error";
}

/**
 * Check if event is a complete event
 *
 * @param event - Event to check
 * @returns True if complete event
 */
export function isCompleteEvent(event: L0Event): boolean {
  return event.type === "complete";
}

/**
 * Check if event is a token event
 *
 * @param event - Event to check
 * @returns True if token event
 */
export function isTokenEvent(event: L0Event): boolean {
  return event.type === "token";
}

/**
 * Get first error from events
 *
 * @param events - Events to search
 * @returns First error or null
 */
export function getFirstError(events: L0Event[]): Error | null {
  const errorEvent = events.find((event) => event.type === "error");
  return errorEvent?.error || null;
}
