import * as fs from "node:fs";

export interface WatchHandle {
  close(): void;
}

export function watchTripwires(
  tripwiresDir: string,
  onChange: () => void,
  options?: { debounceMs?: number },
): WatchHandle {
  const debounceMs = options?.debounceMs ?? 100;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const debounced = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  };

  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(tripwiresDir, { recursive: false }, debounced);
  } catch {
    // Directory doesn't exist yet — that's fine, no-op watcher
    return { close() {} };
  }

  return {
    close() {
      if (timer) clearTimeout(timer);
      watcher.close();
    },
  };
}
