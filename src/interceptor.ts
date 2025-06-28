type Callback<T> = (value: T) => T | Promise<T>;

type Entry<T> = {
  callback: Callback<T>;
  once: boolean;
  id: number;
};


class InterceptorChain<T> {
  #poolId: number = 0;
  #successEntries: Entry<T>[] = [];
  #rejectionEntries: Entry<T>[] = [];

  public use(
    fulfilled: Callback<T>,
    rejected?: Callback<T>,
    options?: { once?: ("fulfilled" | "rejected")[] } // eslint-disable-line comma-dangle
  ): number {
    const id = this.#poolId++;

    this.#successEntries.push({
      id,
      callback: fulfilled,
      once: options?.once?.includes("fulfilled") ?? false,
    });

    if(typeof rejected === "function") {
      this.#rejectionEntries.push({
        id,
        callback: rejected,
        once: options?.once?.includes("rejected") ?? false,
      });
    }

    return id;
  }

  public eject(id: number): void {
    this.#successEntries = this.#successEntries.filter(e => e.id !== id);
    this.#rejectionEntries = this.#rejectionEntries.filter(e => e.id !== id);
  }

  public async fulfilled(value: T): Promise<T> {
    let result = value;
    const removeIndexes: Set<number> = new Set();
    
    for(let i = 0; i < this.#successEntries.length; i++) {
      const { callback, once, id } = this.#successEntries[i];
      result = await callback(result);

      if(once) {
        removeIndexes.add(id);
      }
    }

    if(removeIndexes.size > 0) {
      this.#successEntries = this.#successEntries.filter(e => !removeIndexes.has(e.id));
    }

    return result;
  }

  public async rejected(value: T): Promise<T> {
    let result = value;
    const removeIndexes: Set<number> = new Set();
    
    for(let i = 0; i < this.#rejectionEntries.length; i++) {
      const { callback, once, id } = this.#rejectionEntries[i];
      result = await callback(result);

      if(once) {
        removeIndexes.add(id);
      }
    }

    if(removeIndexes.size > 0) {
      this.#rejectionEntries = this.#rejectionEntries.filter(e => !removeIndexes.has(e.id));
    }

    return result;
  }

  public clear(): void {
    this.#successEntries = null!;
    this.#rejectionEntries = null!;

    this.#successEntries = [];
    this.#rejectionEntries = [];
  }

  public *[Symbol.iterator](): IterableIterator<{ fulfilled: Callback<T> | null; rejected: Callback<T> | null }> {
    for(let i = 0; i < Math.max(this.#successEntries.length, this.#rejectionEntries.length); i++) {
      const fulfilled = i < this.#successEntries.length ? this.#successEntries[i]?.callback ?? null : null;
      const rejected = i < this.#rejectionEntries.length ? this.#rejectionEntries[i]?.callback ?? null : null;

      yield { fulfilled, rejected };
    }
  }
}

export default InterceptorChain;
