type Waiting = { start: () => void; cancel: () => void };
export type QueueOptions = {
  timeoutMs: number;
  signal?: AbortSignal;
  onQueued?: (ahead: number) => void;
  onStart?: (waitMs: number) => void;
};

// Bounded parallel execution per connection, with FIFO overflow.
// Waiting and execution share one deadline; cancellation is per call.
export class ToolQueue {
  private waiting: Waiting[] = [];
  private active = new Set<AbortController>();

  constructor(readonly maxConcurrent: number) {
    if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1)
      throw new Error("max_concurrent must be a positive safe integer");
  }

  close() {
    const waiting = this.waiting.splice(0);
    for (const entry of waiting) entry.cancel();
    for (const controller of [...this.active])
      controller.abort(
        new Error(
          "Device disconnected; operation cancelled. Side effects may have occurred.",
        ),
      );
  }

  run<T>(
    task: (signal: AbortSignal) => Promise<T>,
    options: QueueOptions,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const controller = new AbortController();
      const arrived = performance.now();
      const deadline = arrived + options.timeoutMs;
      let started = false;
      let settled = false;
      const clean = () => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", cancel);
        controller.signal.removeEventListener("abort", aborted);
      };
      const cancel = () => {
        const reason = options.signal?.reason;
        controller.abort(
          started && reason instanceof Error && reason.name !== "AbortError"
            ? reason
            : new Error(
                started
                  ? "Operation cancelled; side effects may have occurred. Do not retry automatically."
                  : "Queued operation cancelled before execution; not executed.",
              ),
        );
      };
      const expire = () =>
        controller.abort(
          new Error(
            started
              ? "Tool timed out; side effects may have occurred. Do not retry automatically."
              : "Queue wait timed out; not executed.",
          ),
        );
      const aborted = () => {
        if (started || settled) return;
        settled = true;
        this.waiting = this.waiting.filter((item) => item !== entry);
        clean();
        reject(controller.signal.reason);
      };
      const timer = setTimeout(expire, options.timeoutMs);
      const entry: Waiting = {
        cancel: () =>
          controller.abort(
            new Error("Device disconnected; queued operation not executed."),
          ),
        start: () => {
          if (performance.now() >= deadline) expire();
          if (controller.signal.aborted) return;
          started = true;
          this.active.add(controller);
          // Keep the slot until execution has actually stopped, even on abort.
          void (async () => {
            try {
              options.onStart?.(performance.now() - arrived);
              const result = await task(controller.signal);
              controller.signal.throwIfAborted();
              resolve(result);
            } catch (error) {
              reject(error);
            } finally {
              settled = true;
              clean();
              this.active.delete(controller);
              this.drain();
            }
          })();
        },
      };
      controller.signal.addEventListener("abort", aborted, { once: true });
      options.signal?.addEventListener("abort", cancel, { once: true });
      if (options.signal?.aborted) {
        cancel();
        return;
      }
      const ahead = this.waiting.length + this.active.size;
      const mustWait =
        this.waiting.length > 0 || this.active.size >= this.maxConcurrent;
      this.waiting.push(entry);
      try {
        if (mustWait) options.onQueued?.(ahead);
      } catch (error) {
        controller.abort(error);
      }
      this.drain();
    });
  }

  private drain() {
    while (this.active.size < this.maxConcurrent && this.waiting.length)
      this.waiting.shift()!.start();
  }
}
