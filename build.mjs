import * as esbuild from "esbuild";
import { glob } from "glob";

// Find all TypeScript source files (excluding .d.ts)
const entryPoints = await glob("src/**/*.ts", { ignore: "**/*.d.ts" });

// Build ESM
await esbuild.build({
  entryPoints,
  outdir: "dist",
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: true,
  bundle: false,
  // Preserve directory structure
  outbase: "src",
});

console.log(`Built ${entryPoints.length} files to dist/`);
