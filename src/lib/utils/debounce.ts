export function debounce<Args extends unknown[]>(fn: (...args: Args) => void, delayMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}

/**
 * Like `debounce`, but keeps a separate timer per key so unrelated calls
 * (e.g. events for different request ids) don't reset each other's timers —
 * only repeated calls for the same key coalesce.
 */
export function debounceByKey<Args extends unknown[]>(fn: (key: string, ...args: Args) => void, delayMs: number) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  return (key: string, ...args: Args) => {
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);
    timers.set(key, setTimeout(() => { timers.delete(key); fn(key, ...args); }, delayMs));
  };
}
