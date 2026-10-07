const isDev = process.env.NODE_ENV === "development";

type Level = 'log' | 'info' | 'warn' | 'error';

function emit(level: Level, prefix: string, ...args: unknown[]) {
  if (!isDev) return;
  console[level](`[${prefix}]`, ...args);
}

export function createLogger(name: string) {
  return {
    log:   (...args: unknown[]) => emit('log',   name, ...args),
    info:  (...args: unknown[]) => emit('info',  name, ...args),
    warn:  (...args: unknown[]) => emit('warn',  name, ...args),
    error: (...args: unknown[]) => emit('error', name, ...args),
  };
}
