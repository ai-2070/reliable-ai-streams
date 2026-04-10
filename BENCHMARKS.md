# Benchmarks

Performance benchmarks measuring L0 overhead on high-throughput streaming.

## Test Environment

- **CPU**: Apple M1 Max (10 cores)
- **Runtime**: Node.js 24 LTS (Krypton) with Vitest 4
- **Methodology**: Mock token streams with zero inter-token delay to measure pure L0 overhead

## Results

| Scenario                 | Tokens/s  | Avg Duration | TTFT    | Overhead |
| ------------------------ | --------- | ------------ | ------- | -------- |
| Baseline (raw streaming) | 2,861,107 | 0.78 ms      | 0.01 ms | -        |
| L0 Core (no features)    | 827,621   | 2.54 ms      | 0.09 ms | 226%     |
| L0 + JSON Guardrail      | 553,970   | 3.65 ms      | 0.11 ms | 370%     |
| L0 + All Guardrails      | 315,898   | 6.34 ms      | 0.13 ms | 714%     |
| L0 + Drift Detection     | 486,234   | 4.13 ms      | 0.17 ms | 431%     |
| L0 Full Stack            | 236,679   | 8.46 ms      | 0.10 ms | 988%     |

**Legend:**

- **Tokens/s** = Throughput (higher is better)
- **Avg Duration** = Average total duration for 2000 tokens
- **TTFT** = Time to first token (lower is better)
- **Overhead** = % slower than baseline

## Key Optimizations

L0 includes several optimizations for high-throughput streaming:

### 1. Incremental JSON State Tracking

Instead of re-scanning the entire content on each guardrail check, L0 tracks JSON structure incrementally:

- **O(delta)** per token instead of **O(content)**
- Only performs full content scan at stream completion

### 2. Sliding Window Drift Detection

Drift detection uses a sliding window (default 500 characters) instead of scanning full content:

- Meta commentary, tone shift, repetition checks operate on window only
- Configurable via `DriftConfig.slidingWindowSize`

### 3. Tunable Check Intervals

Default intervals optimized for high throughput:

- **Guardrails**: Every 15 tokens (was 5)
- **Drift**: Every 25 tokens (was 10)
- **Checkpoint**: Every 20 tokens (was 10)

Configure via `checkIntervals`:

```typescript
const result = await l0({
  stream: myStream,
  guardrails: [jsonRule()],
  checkIntervals: {
    guardrails: 15, // Check every N tokens
    drift: 25,
    checkpoint: 20,
  },
});
```

## Nvidia Blackwell Ready

Even with full guardrails, drift detection, and checkpointing enabled, L0 sustains **~237K tokens/s** - well above current LLM inference speeds and ready for Nvidia Blackwell's 1000+ tokens/s streaming.

| GPU Generation   | Expected Tokens/s | L0 Headroom |
| ---------------- | ----------------- | ----------- |
| Current (H100)   | ~100-200          | 1,180-2,370x |
| Blackwell (B200) | ~1000+            | ~237x       |

## Running Benchmarks

```bash
npm test -- -t "should generate full benchmark report"
```

To run all benchmark tests:

```bash
npm test -- tests/benchmark.test.ts
```

## Benchmark Scenarios

### Baseline

Raw async iteration without L0 - measures the cost of the mock stream itself.

### L0 Core

Minimal L0 wrapper with no guardrails or drift detection. Measures the base cost of the L0 runtime.

### L0 + JSON Guardrail

L0 with `jsonRule()` enabled. Tests incremental JSON structure validation.

### L0 + All Guardrails

L0 with `jsonRule()`, `markdownRule()`, and `zeroOutputRule()`. Tests multiple guardrail overhead.

### L0 + Drift Detection

L0 with drift detection enabled. Tests sliding window analysis overhead.

### L0 Full Stack

L0 with all features: JSON, Markdown, zero-output guardrails, drift detection, and checkpointing. Represents real-world production usage.
