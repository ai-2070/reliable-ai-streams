// Drift and anomaly detection for L0

/**
 * Drift detection result
 */
export interface DriftResult {
  /**
   * Whether drift was detected
   */
  detected: boolean;

  /**
   * Confidence score (0-1)
   */
  confidence: number;

  /**
   * Type of drift detected
   */
  types: DriftType[];

  /**
   * Details about the drift
   */
  details?: string;
}

/**
 * Types of drift that can be detected
 */
export type DriftType =
  | "tone_shift"
  | "meta_commentary"
  | "format_collapse"
  | "repetition"
  | "entropy_spike"
  | "markdown_collapse"
  | "hedging";

/**
 * Configuration for drift detection
 */
export interface DriftConfig {
  /**
   * Enable tone shift detection
   */
  detectToneShift?: boolean;

  /**
   * Enable meta commentary detection
   */
  detectMetaCommentary?: boolean;

  /**
   * Enable repetition detection
   */
  detectRepetition?: boolean;

  /**
   * Enable entropy spike detection
   */
  detectEntropySpike?: boolean;

  /**
   * Repetition threshold (max repeated tokens)
   */
  repetitionThreshold?: number;

  /**
   * Entropy threshold (standard deviations)
   */
  entropyThreshold?: number;

  /**
   * Window size for entropy calculation
   */
  entropyWindow?: number;

  /**
   * Sliding window size for content checks (characters)
   * Only the last N characters are checked for patterns
   * Set to 0 for full content scan (slower)
   * @default 500
   */
  slidingWindowSize?: number;
}

/**
 * Drift detector for detecting model derailment
 */
export class DriftDetector {
  private config: DriftConfig;
  private history: {
    entropy: number[];
    tokens: string[];
    lastContent: string;
    /** Last window content for efficient delta processing */
    lastWindowContent: string;
    /** Cached result for format collapse (only checked once) */
    formatCollapseDetected: boolean | null;
    /** Cached result for hedging (only checked once) */
    hedgingDetected: boolean | null;
  };

  constructor(config: DriftConfig = {}) {
    this.config = {
      detectToneShift: config.detectToneShift ?? true,
      detectMetaCommentary: config.detectMetaCommentary ?? true,
      detectRepetition: config.detectRepetition ?? true,
      detectEntropySpike: config.detectEntropySpike ?? true,
      repetitionThreshold: config.repetitionThreshold ?? 3,
      entropyThreshold: config.entropyThreshold ?? 2.5,
      entropyWindow: config.entropyWindow ?? 50,
      slidingWindowSize: config.slidingWindowSize ?? 500,
    };

    this.history = {
      entropy: [],
      tokens: [],
      lastContent: "",
      lastWindowContent: "",
      formatCollapseDetected: null,
      hedgingDetected: null,
    };
  }

  /**
   * Get the sliding window of content for efficient pattern matching
   * @param content - Full content
   * @returns Last N characters based on slidingWindowSize config
   */
  private getWindow(content: string): string {
    const windowSize = this.config.slidingWindowSize!;
    if (windowSize <= 0 || content.length <= windowSize) {
      return content;
    }
    return content.slice(-windowSize);
  }

  /**
   * Check content for drift
   * Uses sliding window for O(windowSize) instead of O(contentLength) checks
   *
   * @param content - Current content
   * @param delta - Latest token/delta (optional)
   * @returns Drift detection result
   */
  check(content: string, delta?: string): DriftResult {
    const types: DriftType[] = [];
    let confidence = 0;
    const details: string[] = [];

    // Use sliding window for efficient pattern matching
    const windowContent = this.getWindow(content);
    const lastWindowContent = this.history.lastWindowContent;

    // Update history
    if (delta) {
      this.history.tokens.push(delta);
      if (this.history.tokens.length > this.config.entropyWindow!) {
        this.history.tokens.shift();
      }
    }

    // Check for meta commentary (on window only)
    if (this.config.detectMetaCommentary) {
      const meta = this.detectMetaCommentary(windowContent);
      if (meta) {
        types.push("meta_commentary");
        confidence = Math.max(confidence, 0.9);
        details.push("Meta commentary detected");
      }
    }

    // Check for tone shift (comparing windows)
    if (this.config.detectToneShift) {
      const tone = this.detectToneShift(windowContent, lastWindowContent);
      if (tone) {
        types.push("tone_shift");
        confidence = Math.max(confidence, 0.7);
        details.push("Tone shift detected");
      }
    }

    // Check for repetition (on window only - most expensive check)
    if (this.config.detectRepetition) {
      const rep = this.detectRepetition(windowContent);
      if (rep) {
        types.push("repetition");
        confidence = Math.max(confidence, 0.8);
        details.push("Excessive repetition detected");
      }
    }

    // Check for entropy spike (already O(delta) - no change needed)
    if (this.config.detectEntropySpike && delta) {
      const entropy = this.calculateEntropy(delta);
      this.history.entropy.push(entropy);
      if (this.history.entropy.length > this.config.entropyWindow!) {
        this.history.entropy.shift();
      }

      if (this.detectEntropySpike()) {
        types.push("entropy_spike");
        confidence = Math.max(confidence, 0.6);
        details.push("Entropy spike detected");
      }
    }

    // Check for format collapse (only on first check, result is cached)
    if (this.history.formatCollapseDetected === null) {
      this.history.formatCollapseDetected = this.detectFormatCollapse(content);
    }
    if (this.history.formatCollapseDetected) {
      types.push("format_collapse");
      confidence = Math.max(confidence, 0.8);
      details.push("Format collapse detected");
    }

    // Check for markdown collapse (comparing windows)
    if (this.detectMarkdownCollapse(windowContent, lastWindowContent)) {
      types.push("markdown_collapse");
      confidence = Math.max(confidence, 0.7);
      details.push("Markdown formatting collapse detected");
    }

    // Check for excessive hedging (only on first check, result is cached)
    if (this.history.hedgingDetected === null) {
      this.history.hedgingDetected = this.detectExcessiveHedging(content);
    }
    if (this.history.hedgingDetected) {
      types.push("hedging");
      confidence = Math.max(confidence, 0.5);
      details.push("Excessive hedging detected");
    }

    // Update history with window content for next comparison
    this.history.lastContent = content;
    this.history.lastWindowContent = windowContent;

    return {
      detected: types.length > 0,
      confidence,
      types,
      details: details.join("; "),
    };
  }

  /**
   * Detect meta commentary patterns
   */
  private detectMetaCommentary(content: string): boolean {
    const metaPatterns = [
      /as an ai/i,
      /i'm an ai/i,
      /i am an ai/i,
      /i cannot actually/i,
      /i don't have personal/i,
      /i apologize, but i/i,
      /i'm sorry, but i/i,
      /let me explain/i,
      /to clarify/i,
      /in other words/i,
    ];

    // Check last 200 characters for meta commentary
    const recent = content.slice(-200);
    return metaPatterns.some((pattern) => pattern.test(recent));
  }

  /**
   * Detect tone shift between old and new content
   */
  private detectToneShift(content: string, previousContent: string): boolean {
    if (!previousContent || previousContent.length < 100) {
      return false;
    }

    // Simple heuristic: check if formality suddenly changes
    const recentChunk = content.slice(-200);
    const previousChunk = previousContent.slice(-200);

    // Count formal markers
    const formalMarkers =
      /\b(therefore|thus|hence|moreover|furthermore|consequently)\b/gi;
    const recentFormal = (recentChunk.match(formalMarkers) || []).length;
    const previousFormal = (previousChunk.match(formalMarkers) || []).length;

    // Count informal markers
    const informalMarkers = /\b(gonna|wanna|yeah|yep|nope|ok|okay)\b/gi;
    const recentInformal = (recentChunk.match(informalMarkers) || []).length;
    const previousInformal = (previousChunk.match(informalMarkers) || [])
      .length;

    // Check for sudden shift
    const formalShift = Math.abs(recentFormal - previousFormal) > 2;
    const informalShift = Math.abs(recentInformal - previousInformal) > 2;

    return formalShift || informalShift;
  }

  /**
   * Detect excessive repetition
   */
  private detectRepetition(content: string): boolean {
    // Split into sentences
    const sentences = content
      .split(/[.!?]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 20);

    if (sentences.length < 3) {
      return false;
    }

    // Check for repeated sentences
    const counts = new Map<string, number>();
    for (const sentence of sentences) {
      counts.set(sentence, (counts.get(sentence) || 0) + 1);
    }

    // Check if any sentence repeats more than threshold
    for (const count of counts.values()) {
      if (count >= this.config.repetitionThreshold!) {
        return true;
      }
    }

    // Check for repeated phrases (5+ words)
    const words = content.toLowerCase().split(/\s+/);
    const phrases = new Map<string, number>();

    for (let i = 0; i < words.length - 5; i++) {
      const phrase = words.slice(i, i + 5).join(" ");
      phrases.set(phrase, (phrases.get(phrase) || 0) + 1);
    }

    for (const count of phrases.values()) {
      if (count >= this.config.repetitionThreshold!) {
        return true;
      }
    }

    return false;
  }

  /**
   * Calculate Shannon entropy of text
   */
  private calculateEntropy(text: string): number {
    if (!text || text.length === 0) {
      return 0;
    }

    const frequencies = new Map<string, number>();
    for (const char of text) {
      frequencies.set(char, (frequencies.get(char) || 0) + 1);
    }

    let entropy = 0;
    const length = text.length;

    for (const count of frequencies.values()) {
      const probability = count / length;
      entropy -= probability * Math.log2(probability);
    }

    return entropy;
  }

  /**
   * Detect entropy spike
   */
  private detectEntropySpike(): boolean {
    if (this.history.entropy.length < 10) {
      return false;
    }

    // Calculate mean and standard deviation
    const mean =
      this.history.entropy.reduce((a, b) => a + b, 0) /
      this.history.entropy.length;

    const variance =
      this.history.entropy.reduce(
        (acc, val) => acc + Math.pow(val - mean, 2),
        0,
      ) / this.history.entropy.length;

    const stdDev = Math.sqrt(variance);

    // Check if last value is significantly higher
    const last = this.history.entropy[this.history.entropy.length - 1] ?? 0;
    return last > mean + this.config.entropyThreshold! * stdDev;
  }

  /**
   * Detect format collapse (mixing instruction with output)
   */
  private detectFormatCollapse(content: string): boolean {
    const collapsePatterns = [
      /here is the .+?:/i,
      /here's the .+?:/i,
      /let me .+? for you/i,
      /i'll .+? for you/i,
      /here you go/i,
    ];

    // Only check beginning of content
    const beginning = content.slice(0, 100);
    return collapsePatterns.some((pattern) => pattern.test(beginning));
  }

  /**
   * Detect markdown to plaintext collapse
   */
  private detectMarkdownCollapse(
    content: string,
    previousContent: string,
  ): boolean {
    if (!previousContent || previousContent.length < 100) {
      return false;
    }

    // Count markdown elements in recent chunks
    const markdownPatterns = [
      /```/g,
      /^#{1,6}\s/gm,
      /\*\*.*?\*\*/g,
      /\[.*?\]\(.*?\)/g,
    ];

    const recent = content.slice(-200);
    const previous = previousContent.slice(-200);

    let recentMarkdown = 0;
    let previousMarkdown = 0;

    for (const pattern of markdownPatterns) {
      recentMarkdown += (recent.match(pattern) || []).length;
      previousMarkdown += (previous.match(pattern) || []).length;
    }

    // Check if markdown suddenly drops
    return previousMarkdown > 3 && recentMarkdown === 0;
  }

  /**
   * Detect excessive hedging at start
   */
  private detectExcessiveHedging(content: string): boolean {
    const hedgingPatterns = [
      /^sure!?\s*$/im,
      /^certainly!?\s*$/im,
      /^of course!?\s*$/im,
      /^absolutely!?\s*$/im,
    ];

    const firstLine = content.trim().split("\n")[0] ?? "";
    return hedgingPatterns.some((pattern) => pattern.test(firstLine));
  }

  /**
   * Reset detector state
   */
  reset(): void {
    this.history = {
      entropy: [],
      tokens: [],
      lastContent: "",
      lastWindowContent: "",
      formatCollapseDetected: null,
      hedgingDetected: null,
    };
  }

  /**
   * Get detection history
   */
  getHistory() {
    return { ...this.history };
  }
}

/**
 * Create a drift detector with configuration
 */
export function createDriftDetector(config?: DriftConfig): DriftDetector {
  return new DriftDetector(config);
}

/**
 * Quick check for drift without creating detector instance
 */
export function checkDrift(content: string): DriftResult {
  const detector = new DriftDetector();
  return detector.check(content);
}
