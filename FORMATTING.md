# Formatting Helpers

L0 provides utilities for formatting context, memory, output instructions, tool definitions, and strings.

## Context Formatting

Wrap documents and instructions with proper delimiters:

```typescript
import { formatContext, formatDocument, formatInstructions } from "reliable-ai-streams";

// XML delimiters (default)
formatContext("User manual content", { label: "Documentation" });
// <documentation>
// User manual content
// </documentation>

// Markdown delimiters
formatContext("Content", { label: "Context", delimiter: "markdown" });
// # Context
//
// Content

// Bracket delimiters
formatContext("Content", { delimiter: "brackets" });
// [CONTEXT]
// ==============================
// Content
// ==============================

// No delimiters
formatContext("Content", { delimiter: "none" });

// Custom delimiters
formatContext("Content", {
  customDelimiterStart: "<<<START>>>",
  customDelimiterEnd: "<<<END>>>",
});

// Document with metadata
formatDocument("Report content", { title: "Q4 Report", author: "Team" });

// System instructions
formatInstructions("You are a helpful assistant.");
```

### Options

```typescript
formatContext(content, {
  label: "Context", // Label for section (default: "Context")
  delimiter: "xml", // xml | markdown | brackets | none
  dedent: true, // Remove common indentation (default: true)
  normalize: true, // Normalize whitespace (default: true)
  customDelimiterStart: "...", // Custom start delimiter
  customDelimiterEnd: "...", // Custom end delimiter
});
```

### Multiple Contexts

```typescript
import { formatMultipleContexts } from "reliable-ai-streams";

formatMultipleContexts([
  { content: "Document 1", label: "Doc1" },
  { content: "Document 2", label: "Doc2" },
]);
```

### Delimiter Escaping

Prevent injection attacks:

```typescript
import { escapeDelimiters, unescapeDelimiters } from "reliable-ai-streams";

escapeDelimiters("<script>alert('xss')</script>", "xml");
// &lt;script&gt;alert('xss')&lt;/script&gt;

unescapeDelimiters("&lt;div&gt;", "xml");
// <div>

// Markdown escaping
escapeDelimiters("# Header", "markdown");
// \# Header

// Bracket escaping
escapeDelimiters("[section]", "brackets");
// \[section\]
```

---

## Memory Formatting

Format conversation history for model context:

```typescript
import { formatMemory, createMemoryEntry } from "reliable-ai-streams";

const memory = [
  { role: "user", content: "Hello" },
  { role: "assistant", content: "Hi there!" },
];

// Conversational style (default)
formatMemory(memory);
// User: Hello
//
// Assistant: Hi there!

// Structured XML style
formatMemory(memory, { style: "structured" });
// <conversation_history>
//   <message role="user">
//     Hello
//   </message>
//   <message role="assistant">
//     Hi there!
//   </message>
// </conversation_history>

// Compact style
formatMemory(memory, { style: "compact" });
// U: Hello
// A: Hi there!
```

### Options

```typescript
formatMemory(memory, {
  maxEntries: 10, // Limit entries (takes last N)
  includeTimestamps: true, // Add timestamps
  includeMetadata: true, // Add metadata
  style: "conversational", // conversational | structured | compact
  normalize: true, // Normalize content (default: true)
});
```

### Memory Utilities

```typescript
import {
  createMemoryEntry,
  mergeMemory,
  filterMemoryByRole,
  getLastNEntries,
  calculateMemorySize,
  truncateMemory,
} from "reliable-ai-streams";

// Create timestamped entry
const entry = createMemoryEntry("user", "Hello", { source: "chat" });
// { role: "user", content: "Hello", timestamp: 1234567890, metadata: { source: "chat" } }

// Merge and sort by timestamp
const merged = mergeMemory(memory1, memory2);

// Filter by role
const userMessages = filterMemoryByRole(memory, "user");

// Get recent entries
const recent = getLastNEntries(memory, 5);

// Calculate size
const size = calculateMemorySize(memory); // character count

// Truncate to fit limit (keeps most recent)
const truncated = truncateMemory(memory, 10000); // max chars
```

### Memory Entry Interface

```typescript
interface MemoryEntry {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: number;
  metadata?: Record<string, any>;
}
```

---

## Output Formatting

Generate instructions for requesting specific output formats:

```typescript
import { formatJsonOutput, formatStructuredOutput } from "reliable-ai-streams";

// Strict JSON output
formatJsonOutput({ strict: true });
// Respond with valid JSON only. Do not include any text before or after the JSON object.
// Do not wrap the JSON in markdown code blocks or backticks.
// Start your response with { and end with }.

// With schema
formatJsonOutput({
  strict: true,
  schema: '{ "name": "string", "age": "number" }',
});

// Non-strict (allows surrounding text)
formatJsonOutput({ strict: false });
// Respond with valid JSON.

// Control whether to include instructions
formatJsonOutput({ includeInstructions: false, schema: "..." });

// Other formats
formatStructuredOutput("yaml", { strict: true });
formatStructuredOutput("xml", { strict: true });
formatStructuredOutput("markdown");
formatStructuredOutput("plain");
```

### Output Constraints

```typescript
import {
  formatOutputConstraints,
  createOutputFormatSection,
  wrapOutputInstruction,
} from "reliable-ai-streams";

formatOutputConstraints({
  maxLength: 500,
  minLength: 100,
  noCodeBlocks: true,
  noMarkdown: true,
  language: "Spanish",
  tone: "professional",
});

// Complete format section
createOutputFormatSection("json", {
  strict: true,
  schema: '{ "result": "string" }',
  constraints: { maxLength: 1000 },
  wrap: true, // Wraps in <output_format> tags (default: true)
});

// Manual wrapping
wrapOutputInstruction("Respond with JSON only");
// <output_format>
// Respond with JSON only
// </output_format>
```

### Extract & Clean

````typescript
import { extractJsonFromOutput, cleanOutput } from "reliable-ai-streams";

// Extract JSON from model output with extra text
extractJsonFromOutput('Here is the result: {"name": "John"}');
// {"name": "John"}

// Extract from code blocks
extractJsonFromOutput('```json\n{"name": "John"}\n```');
// {"name": "John"}

// Extract arrays
extractJsonFromOutput("The list: [1, 2, 3]");
// [1, 2, 3]

// Returns null if no JSON found
extractJsonFromOutput("No JSON here");
// null

// Clean common prefixes
cleanOutput("Sure, here is the result:\n```json\n{}\n```");
// {}
````

---

## Tool Formatting

Format tool/function definitions for LLM consumption:

```typescript
import { formatTool, createTool, createParameter } from "reliable-ai-streams";

const tool = createTool("get_weather", "Get current weather", [
  createParameter("location", "string", "City name", true),
  createParameter("units", "string", "Temperature units", false),
]);

// JSON Schema format (OpenAI function calling)
formatTool(tool, { style: "json-schema" });
// {
//   "name": "get_weather",
//   "description": "Get current weather",
//   "parameters": {
//     "type": "object",
//     "properties": {...},
//     "required": ["location"]
//   }
// }

// TypeScript format
formatTool(tool, { style: "typescript" });
// /**
//  * Get current weather
//  * @param location - City name
//  * @param units - Temperature units
//  */
// function get_weather(location: string, units?: string): void;

// Natural language
formatTool(tool, { style: "natural" });
// Tool: get_weather
// Description: Get current weather
//
// Parameters:
//   - location (required): string - City name
//   - units (optional): string - Temperature units

// Natural language with examples
formatTool(tool, { style: "natural", includeExamples: true });

// XML format
formatTool(tool, { style: "xml" });
```

### Tool Options

```typescript
formatTool(tool, {
  style: "json-schema", // json-schema | typescript | natural | xml
  includeExamples: false, // Add usage examples (natural style only)
  includeTypes: true, // Include type info in JSON schema
});
```

### Multiple Tools

```typescript
import { formatTools, validateTool } from "reliable-ai-streams";

// Format array of tools
formatTools([tool1, tool2], { style: "json-schema" });

// Validate tool definition
const errors = validateTool(tool);
if (errors.length > 0) {
  console.error("Invalid tool:", errors);
}
```

### Validation Rules

`validateTool` checks:

- Tool name is required and must be a valid identifier (`[a-zA-Z_][a-zA-Z0-9_]*`)
- Tool description is required
- Parameters must be an array
- Each parameter needs a name (valid identifier) and type
- Valid types: `string`, `number`, `integer`, `boolean`, `array`, `object`

### Parse Function Calls

```typescript
import { parseFunctionCall, formatFunctionArguments } from "reliable-ai-streams";

// Parse from model output - JSON format
parseFunctionCall('{"name": "get_weather", "arguments": {"location": "NYC"}}');
// { name: "get_weather", arguments: { location: "NYC" } }

// Parse from model output - function call format
parseFunctionCall('get_weather({"location": "NYC"})');
// { name: "get_weather", arguments: { location: "NYC" } }

// Returns null if no match
parseFunctionCall("No function call here");
// null

// Format arguments
formatFunctionArguments({ location: "NYC" }, true);
// {
//   "location": "NYC"
// }

formatFunctionArguments({ location: "NYC" }, false);
// {"location":"NYC"}
```

### Parameter Options

```typescript
const param: ToolParameter = {
  name: "status",
  type: "string",
  description: "Order status",
  required: true,
  enum: ["pending", "shipped", "delivered"], // Allowed values
  default: "pending", // Default value
};
```

---

## String Utilities

Common string manipulation functions:

```typescript
import {
  trim,
  escape,
  unescape,
  escapeHtml,
  unescapeHtml,
  escapeRegex,
  sanitize,
  truncate,
  truncateWords,
  wrap,
  pad,
  removeAnsi,
} from "reliable-ai-streams";

// Trim whitespace
trim("  hello  "); // "hello"

// Escape special characters
escape('Hello\n"World"'); // Hello\\n\\"World\\"
unescape("Hello\\nWorld"); // Hello\nWorld

// HTML entities
escapeHtml("<div>"); // &lt;div&gt;
unescapeHtml("&lt;div&gt;"); // <div>

// Regex escaping
escapeRegex("file.txt"); // file\\.txt

// Sanitize (remove control chars except \n and \t)
sanitize("Hello\x00World"); // HelloWorld

// Truncate
truncate("Hello World", 8); // "Hello..."
truncate("Hello World", 8, "…"); // "Hello…"

// Truncate at word boundary
truncateWords("Hello World Test", 12); // "Hello..."

// Wrap to width
wrap("Hello World Test String", 10);
// Hello
// World Test
// String

// Pad string
pad("Hi", 10); // "Hi        "
pad("Hi", 10, " ", "right"); // "        Hi"
pad("Hi", 10, " ", "center"); // "    Hi    "
pad("Hi", 10, "-", "left"); // "Hi--------"

// Remove ANSI codes
removeAnsi("\x1b[31mRed\x1b[0m"); // "Red"
```

---

## API Reference

### Context

| Function                                     | Description                   |
| -------------------------------------------- | ----------------------------- |
| `formatContext(content, options)`            | Wrap content with delimiters  |
| `formatMultipleContexts(items, options)`     | Format multiple contexts      |
| `formatDocument(content, metadata, options)` | Format document with metadata |
| `formatInstructions(instructions, options)`  | Format system instructions    |
| `escapeDelimiters(content, delimiter)`       | Escape delimiters for safety  |
| `unescapeDelimiters(content, delimiter)`     | Unescape delimiters           |

### Memory

| Function                                     | Description                     |
| -------------------------------------------- | ------------------------------- |
| `formatMemory(memory, options)`              | Format conversation history     |
| `createMemoryEntry(role, content, metadata)` | Create timestamped entry        |
| `mergeMemory(...memories)`                   | Merge and sort by timestamp     |
| `filterMemoryByRole(memory, role)`           | Filter by user/assistant/system |
| `getLastNEntries(memory, n)`                 | Get last N entries              |
| `calculateMemorySize(memory)`                | Calculate character count       |
| `truncateMemory(memory, maxSize)`            | Truncate to fit size limit      |

### Output

| Function                                     | Description                      |
| -------------------------------------------- | -------------------------------- |
| `formatJsonOutput(options)`                  | JSON output instructions         |
| `formatStructuredOutput(format, options)`    | Format-specific instructions     |
| `formatOutputConstraints(constraints)`       | Length/tone/language constraints |
| `createOutputFormatSection(format, options)` | Complete format section          |
| `wrapOutputInstruction(instruction)`         | Wrap in `<output_format>` tags   |
| `extractJsonFromOutput(output)`              | Extract JSON from text           |
| `cleanOutput(output)`                        | Remove prefixes and wrappers     |

### Tools

| Function                                      | Description                     |
| --------------------------------------------- | ------------------------------- |
| `formatTool(tool, options)`                   | Format single tool definition   |
| `formatTools(tools, options)`                 | Format multiple tools           |
| `createTool(name, description, params)`       | Create tool definition          |
| `createParameter(name, type, desc, required)` | Create parameter                |
| `validateTool(tool)`                          | Validate tool structure         |
| `parseFunctionCall(output)`                   | Parse function call from output |
| `formatFunctionArguments(args, pretty)`       | Format arguments as JSON        |

### Utilities

| Function                                | Description                   |
| --------------------------------------- | ----------------------------- |
| `trim(str)`                             | Trim whitespace               |
| `escape(str)` / `unescape(str)`         | Escape/unescape special chars |
| `escapeHtml(str)` / `unescapeHtml(str)` | HTML entity escaping          |
| `escapeRegex(str)`                      | Escape regex special chars    |
| `sanitize(str)`                         | Remove control characters     |
| `truncate(str, max, suffix)`            | Truncate with suffix          |
| `truncateWords(str, max, suffix)`       | Truncate at word boundary     |
| `wrap(str, width)`                      | Wrap to width                 |
| `pad(str, length, char, align)`         | Pad left/right/center         |
| `removeAnsi(str)`                       | Remove ANSI color codes       |
