const timers = new Map<string, ReturnType<typeof setInterval>>();

export function startTradeTimer(
  tradeId: string,
  opts: {
    timeoutMinutes: number;
    onTick: (minutesLeft: number) => void | Promise<void>;
    onExpired: () => void | Promise<void>;
  }
): void {
  stopTradeTimer(tradeId);
  let left = opts.timeoutMinutes;
  const id = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      stopTradeTimer(tradeId);
      void opts.onExpired();
      return;
    }
    void opts.onTick(left);
  }, 60_000);
  timers.set(tradeId, id);
  const g = globalThis as { __sendflowIntervals?: ReturnType<typeof setInterval>[] };
  g.__sendflowIntervals ??= [];
  g.__sendflowIntervals.push(id);
}

export function stopTradeTimer(tradeId: string): void {
  const t = timers.get(tradeId);
  if (t) clearInterval(t);
  timers.delete(tradeId);
}
