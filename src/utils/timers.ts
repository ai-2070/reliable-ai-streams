// Backoff and timer helpers for L0

import type { BackoffResult, BackoffStrategy } from "../types/retry";
import { RETRY_DEFAULTS } from "../types/retry";

/**
 * Calculate exponential backoff delay
 * @param attempt - Current attempt number (0-based)
 * @param baseDelay - Base delay in milliseconds (default: 1000)
 * @param maxDelay - Maximum delay cap in milliseconds (default: 10000)
 */
export function exponentialBackoff(
  attempt: number,
  baseDelay: number = RETRY_DEFAULTS.baseDelay,
  maxDelay: number = RETRY_DEFAULTS.maxDelay,
): BackoffResult {
  const rawDelay = baseDelay * Math.pow(2, attempt);
  const delay = Math.min(rawDelay, maxDelay);

  return {
    delay,
    cappedAtMax: rawDelay > maxDelay,
    rawDelay,
  };
}

/**
 * Calculate linear backoff delay
 * @param attempt - Current attempt number (0-based)
 * @param baseDelay - Base delay in milliseconds (default: 1000)
 * @param maxDelay - Maximum delay cap in milliseconds (default: 10000)
 */
export function linearBackoff(
  attempt: number,
  baseDelay: number = RETRY_DEFAULTS.baseDelay,
  maxDelay: number = RETRY_DEFAULTS.maxDelay,
): BackoffResult {
  const rawDelay = baseDelay * (attempt + 1);
  const delay = Math.min(rawDelay, maxDelay);

  return {
    delay,
    cappedAtMax: rawDelay > maxDelay,
    rawDelay,
  };
}

/**
 * Fixed backoff delay (same delay every time)
 * @param baseDelay - Delay in milliseconds (default: 1000)
 */
export function fixedBackoff(
  baseDelay: number = RETRY_DEFAULTS.baseDelay,
): BackoffResult {
  return {
    delay: baseDelay,
    cappedAtMax: false,
    rawDelay: baseDelay,
  };
}

/**
 * Fixed jitter backoff (fixed base delay + random jitter)
 * AWS-style predictable retry timing with jitter to prevent thundering herd
 * @param baseDelay - Base delay in milliseconds (default: 1000)
 * @param maxDelay - Maximum delay cap in milliseconds (default: 10000)
 */
export function fixedJitterBackoff(
  baseDelay: number = RETRY_DEFAULTS.baseDelay,
  maxDelay: number = RETRY_DEFAULTS.maxDelay,
): BackoffResult {
  // Add up to 50% jitter to the base delay
  const jitter = Math.random() * baseDelay * 0.5;
  const rawDelay = baseDelay + jitter;
  const delay = Math.min(Math.floor(rawDelay), maxDelay);

  return {
    delay,
    cappedAtMax: rawDelay > maxDelay,
    rawDelay,
  };
}

/**
 * Full jitter backoff (random between 0 and exponential)
 * AWS recommended approach for distributed systems
 * @param attempt - Current attempt number (0-based)
 * @param baseDelay - Base delay in milliseconds (default: 1000)
 * @param maxDelay - Maximum delay cap in milliseconds (default: 10000)
 */
export function fullJitterBackoff(
  attempt: number,
  baseDelay: number = RETRY_DEFAULTS.baseDelay,
  maxDelay: number = RETRY_DEFAULTS.maxDelay,
): BackoffResult {
  const exponential = baseDelay * Math.pow(2, attempt);
  const cappedExponential = Math.min(exponential, maxDelay);
  const rawDelay = Math.random() * cappedExponential;
  const delay = Math.floor(rawDelay);

  return {
    delay,
    cappedAtMax: exponential > maxDelay,
    rawDelay,
  };
}

/**
 * Decorrelated jitter backoff
 * Prevents thundering herd while maintaining good retry behavior
 * @param attempt - Current attempt number (0-based)
 * @param baseDelay - Base delay in milliseconds (default: 1000)
 * @param maxDelay - Maximum delay cap in milliseconds (default: 10000)
 * @param previousDelay - Previous delay value (for decorrelation)
 */
export function decorrelatedJitterBackoff(
  attempt: number,
  baseDelay: number = RETRY_DEFAULTS.baseDelay,
  maxDelay: number = RETRY_DEFAULTS.maxDelay,
  previousDelay?: number,
): BackoffResult {
  // Use previousDelay if provided, otherwise scale baseDelay by attempt
  const prev = previousDelay ?? baseDelay * Math.pow(2, attempt);
  const rawDelay = Math.random() * (prev * 3 - baseDelay) + baseDelay;
  const delay = Math.min(Math.floor(rawDelay), maxDelay);

  return {
    delay,
    cappedAtMax: rawDelay > maxDelay,
    rawDelay,
  };
}

/**
 * Calculate backoff delay based on strategy
 * @param strategy - Backoff strategy
 * @param attempt - Current attempt number (0-based)
 * @param baseDelay - Base delay in milliseconds
 * @param maxDelay - Maximum delay cap in milliseconds
 */
export function calculateBackoff(
  strategy: BackoffStrategy,
  attempt: number,
  baseDelay: number = RETRY_DEFAULTS.baseDelay,
  maxDelay: number = RETRY_DEFAULTS.maxDelay,
): BackoffResult {
  switch (strategy) {
    case "exponential":
      return exponentialBackoff(attempt, baseDelay, maxDelay);
    case "linear":
      return linearBackoff(attempt, baseDelay, maxDelay);
    case "fixed":
      return fixedBackoff(baseDelay);
    case "full-jitter":
      return fullJitterBackoff(attempt, baseDelay, maxDelay);
    case "fixed-jitter":
      return fixedJitterBackoff(baseDelay, maxDelay);
    default:
      return exponentialBackoff(attempt, baseDelay, maxDelay);
  }
}

/**
 * Sleep/delay helper
 * @param ms - Milliseconds to sleep
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a timeout promise that rejects after specified time
 * @param ms - Timeout in milliseconds
 * @param message - Error message
 */
export function timeout(
  ms: number,
  message: string = "Timeout",
): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}

/**
 * Race a promise against a timeout
 * @param promise - Promise to race
 * @param timeoutMs - Timeout in milliseconds
 * @param timeoutMessage - Error message for timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage?: string,
): Promise<T> {
  let timerId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = setTimeout(
      () => reject(new Error(timeoutMessage ?? "Timeout")),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timerId!);
  }
}

/**
 * Create a timer that can be started, stopped, and queried
 */
export class Timer {
  private startTime?: number;
  private endTime?: number;
  private pauseTime?: number;
  private totalPausedTime: number = 0;

  /**
   * Start the timer
   */
  start(): void {
    this.startTime = Date.now();
    this.endTime = undefined;
    this.pauseTime = undefined;
    this.totalPausedTime = 0;
  }

  /**
   * Pause the timer
   */
  pause(): void {
    if (!this.startTime || this.pauseTime) return;
    this.pauseTime = Date.now();
  }

  /**
   * Resume the timer
   */
  resume(): void {
    if (!this.pauseTime) return;
    this.totalPausedTime += Date.now() - this.pauseTime;
    this.pauseTime = undefined;
  }

  /**
   * Stop the timer
   */
  stop(): void {
    if (!this.startTime) return;
    if (this.pauseTime) {
      this.resume();
    }
    this.endTime = Date.now();
  }

  /**
   * Get elapsed time in milliseconds
   */
  elapsed(): number {
    if (!this.startTime) return 0;

    const end = this.endTime ?? Date.now();
    const paused = this.pauseTime
      ? this.totalPausedTime + (Date.now() - this.pauseTime)
      : this.totalPausedTime;

    return end - this.startTime - paused;
  }

  /**
   * Reset the timer
   */
  reset(): void {
    this.startTime = undefined;
    this.endTime = undefined;
    this.pauseTime = undefined;
    this.totalPausedTime = 0;
  }

  /**
   * Check if timer is running
   */
  isRunning(): boolean {
    return !!this.startTime && !this.endTime && !this.pauseTime;
  }

  /**
   * Check if timer is paused
   */
  isPaused(): boolean {
    return !!this.pauseTime;
  }
}

/**
 * Debounce a function call
 * @param fn - Function to debounce
 * @param delay - Delay in milliseconds
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number,
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, delay);
  };
}

/**
 * Throttle a function call
 * @param fn - Function to throttle
 * @param delay - Minimum delay between calls in milliseconds
 */
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  delay: number,
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  let timeoutId: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;

    if (timeSinceLastCall >= delay) {
      lastCall = now;
      fn(...args);
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        fn(...args);
        timeoutId = null;
      }, delay - timeSinceLastCall);
    }
  };
}
