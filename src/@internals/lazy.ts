export class Lazy<T> {
  private _didRun: boolean = false;
  private _err: Error | null = null;
  private _value?: T;

  public constructor(
    private readonly _executor: () => T // eslint-disable-line comma-dangle
  ) { }

  public get hasValue(): boolean {
    return this._didRun;
  }

  public get value(): T {
    if(!this._didRun) {
      try {
        this._value = this._executor();
      } catch (err: any) {
        this._err = err;
      } finally {
        this._didRun = true;
      }
    }

    if(this._err) {
      throw this._err;
    }

    return this._value!;
  }

  public get rawValue(): T | undefined {
    return this._value;
  }
}


export class AsyncLazy<T> {
  private _didRun: boolean = false;
  private _err: Error | null = null;
  private _value?: T;

  public constructor(
    private readonly _executor: () => Promise<T> // eslint-disable-line comma-dangle
  ) { }

  public get hasValue(): boolean {
    return this._didRun;
  }

  public get value(): Promise<T> {
    return new Promise((resolve, reject) => {
      if(!this._didRun) {
        this._executor()
          .then(value => {
            this._value = value;
            resolve(value);
          }, err => {
            this._err = err;
            reject(err);
          }).finally(() => {
            this._didRun = true;
          });

        return;
      }

      if(this._err) {
        reject(this._err);
        return;
      }

      resolve(this._value!);
    });
  }

  public get rawValue(): T | undefined {
    return this._value;
  }
}
