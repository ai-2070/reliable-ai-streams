import { build } from "esbuild";
import { gzipSync } from "zlib";

const entries = [
  { name: "reliable-ai-streams (full)", entry: "./src/index.ts" },
  { name: "reliable-ai-streams/core", entry: "./src/core.ts" },
  { name: "reliable-ai-streams/structured", entry: "./src/structured.ts" },
  { name: "reliable-ai-streams/consensus", entry: "./src/consensus.ts" },
  { name: "reliable-ai-streams/parallel", entry: "./src/runtime/parallel.ts" },
  { name: "reliable-ai-streams/window", entry: "./src/window.ts" },
  { name: "reliable-ai-streams/guardrails", entry: "./src/guardrails.ts" },
  { name: "reliable-ai-streams/monitoring", entry: "./src/monitoring.ts" },
  { name: "reliable-ai-streams/drift", entry: "./src/drift.ts" },
];

console.log("| Import | Size | Gzipped |");
console.log("|--------|------|---------|");

for (const { name, entry } of entries) {
  try {
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: "esm",
      platform: "node",
      external: [
        "ai",
        "@ai-sdk/*",
        "zod",
        "@effect/schema",
        "@sentry/*",
        "@opentelemetry/*",
      ],
      minify: true,
    });

    const code = result.outputFiles[0].text;
    const size = Buffer.byteLength(code);
    const gzipped = gzipSync(code).length;

    const sizeKB = Math.round(size / 1024);
    const gzipKB = Math.round(gzipped / 1024);

    console.log(`| ${name} | ${sizeKB}KB | ${gzipKB}KB |`);
  } catch (e) {
    console.log(`| ${name} | ERROR | ${e.message} |`);
  }
}
