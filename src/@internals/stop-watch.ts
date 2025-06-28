const hasPerformanceNow = (
  typeof globalThis === "object" &&
  typeof globalThis.performance !== "undefined" &&
  typeof globalThis.performance.now === "function"
);

const performanceNow = hasPerformanceNow ?
  globalThis.performance.now.bind(globalThis.performance) :
  () => Date.now();


class StopWatch {
  readonly #now: () => number;

  private _startTime: number;
  private _stopTime: number;

  // Wrap for factory dependant resources "State.create() -> Resource"
  public static create(highResolution?: boolean): StopWatch {
    return new StopWatch(highResolution);
  }

  public constructor(hr?: boolean) {
    this.#now = hr !== false ? performanceNow : Date.now;

    this._startTime = this.#now();
    this._stopTime = -1;
  }

  public stop(): void {
    this._stopTime = this.#now();
  }

  public reset(): void {
    this._startTime = this.#now();
    this._stopTime = -1;
  }

  public elapsed(): number {
    return this._stopTime !== -1 ?
      this._stopTime - this._startTime :
      this.#now() - this._startTime;
  }
}

export default StopWatch;
