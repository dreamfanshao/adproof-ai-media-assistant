/** Bounded lookahead with ordered consumption. Only take() starts work, so
 * stopping/cancelling consumption cannot schedule the rest of a batch. */
export class OrderedPrefetch<T, R> {
  private readonly pending = new Map<number, Promise<{ value: R } | { error: unknown }>>();
  private readonly width: number;
  constructor(private readonly items: readonly T[], concurrency: number, private readonly prepare: (item: T) => Promise<R>) {
    this.width = Number.isFinite(concurrency) ? Math.min(4, Math.max(1, Math.floor(concurrency))) : 4;
  }
  async take(index: number): Promise<R> {
    for (let next = index; next < Math.min(this.items.length, index + this.width); next += 1) {
      if (!this.pending.has(next)) {
        this.pending.set(next, Promise.resolve().then(() => this.prepare(this.items[next])).then(
          (value) => ({ value }), (error: unknown) => ({ error }),
        ));
      }
    }
    const result = await this.pending.get(index)!;
    this.pending.delete(index);
    if ("error" in result) throw result.error;
    return result.value;
  }
}
