const cache = new Map<string, { value: string; expires: number }>();

const TTL_MS = 3600 * 1000;

export function getCached(key: string): string | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

export function setCached(key: string, value: string): void {
  cache.set(key, { value, expires: Date.now() + TTL_MS });
}
