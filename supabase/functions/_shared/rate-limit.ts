/**
 * Simple in-memory rate limiter for edge functions.
 * Limits requests per user per function within a sliding window.
 *
 * Note: Each Deno Deploy isolate has its own memory, so this is
 * approximate — but sufficient to prevent abuse from a single client.
 */

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

// Clean up old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => now - t < 3600_000);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}, 300_000);

/**
 * Check if a request is within rate limits.
 * @param userId - The authenticated user's ID
 * @param functionName - Name of the edge function
 * @param maxRequests - Max requests allowed in the window (default: 30)
 * @param windowMs - Window size in ms (default: 1 hour)
 * @returns true if allowed, false if rate limited
 */
export function checkRateLimit(
  userId: string,
  functionName: string,
  maxRequests = 30,
  windowMs = 3600_000,
): boolean {
  const key = `${functionName}:${userId}`;
  const now = Date.now();

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Remove timestamps outside the window
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

  if (entry.timestamps.length >= maxRequests) {
    return false;
  }

  entry.timestamps.push(now);
  return true;
}
