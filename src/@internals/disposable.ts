/* eslint-disable @typescript-eslint/no-namespace,no-inner-declarations */

import { isIterable } from "./util";


export interface IDisposable {
  dispose(): void;
}


export function toDisposable(dispose: () => void): IDisposable {
  return { dispose };
}


export class DisposableStore implements IDisposable {
  public static DISABLE_DISPOSED_WARNING = false;

  readonly #toDispose = new Set<IDisposable>();
  #isDisposed = false;

  /**
	 * Dispose of all registered disposables and mark this object as disposed.
	 *
	 * Any future disposables added to this object will be disposed of on `add`.
	 */
  public dispose(): void {
    if(this.#isDisposed) return;

    this.#isDisposed = true;
    this.clear();
  }

  /**
	 * @return `true` if this object has been disposed of.
	 */
  public get isDisposed(): boolean {
    return this.#isDisposed;
  }

  /**
	 * Dispose of all registered disposables but do not mark this object as disposed.
	 */
  public clear(): void {
    if(this.#toDispose.size === 0) return;

    try {
      dispose(this.#toDispose);
    } finally {
      this.#toDispose.clear();
    }
  }

  /**
	 * Add a new {@link IDisposable disposable} to the collection.
	 */
  public add<T extends IDisposable>(o: T): T {
    if(!o) return o;

    if((o as unknown as DisposableStore) === this) {
      throw new Error("Cannot register a disposable on itself!");
    }

    if(this.#isDisposed) {
      if(!DisposableStore.DISABLE_DISPOSED_WARNING) {
        console.warn(`Trying to add a disposable to a DisposableStore that has already been disposed of. The added object will be leaked!\n  At: ${new Error().stack || "Unknown stacktrace"}`);
      }
    } else {
      this.#toDispose.add(o);
    }

    return o;
  }

  /**
	 * Deletes a disposable from store and disposes of it. This will not throw or warn and proceed to dispose the
	 * disposable even when the disposable is not part in the store.
	 */
  public delete<T extends IDisposable>(o: T): void {
    if(!o) return;
    
    if((o as unknown as DisposableStore) === this) {
      throw new Error("Cannot dispose a disposable on itself!");
    }

    this.#toDispose.delete(o);
    o.dispose();
  }

  /**
	 * Deletes the value from the store, but does not dispose it.
	 */
  public deleteAndLeak<T extends IDisposable>(o: T): void {
    if(!o) return;

    if(this.#toDispose.has(o)) {
      this.#toDispose.delete(o);
      // setParentOfDisposable(o, null);
    }
  }
}


export namespace Disposable {
  export class Disposable implements IDisposable {
    public static readonly None: IDisposable = Object.freeze<IDisposable>({ dispose() {} });
    readonly #lifecycle: Set<IDisposable> = new Set();
    #isDisposed: boolean = false;

    public dispose(): void {
      if(this.#isDisposed) return;

      this.#isDisposed = true;
      this._clear();
    }
      
    protected _clear() {
      this.#lifecycle.forEach(item => item.dispose());
      this.#lifecycle.clear();
    }

    protected _isDisposed(): boolean {
      return this.#isDisposed;
    }

    protected _register<T extends IDisposable>(t: T): T {
      if(this.#isDisposed) {
        console.warn("[Disposable] Registering disposable on object that has already been disposed.");
        t.dispose();
      } else {
        this.#lifecycle.add(t);
      }

      return t;
    }
  }

  export const None = toDisposable(() => void 0);
}


export function isDisposable(arg: unknown): arg is IDisposable {
  return !!arg && typeof arg === "object" && typeof (<IDisposable>arg).dispose === "function";
}

export function dispose<T extends IDisposable>(disposable: T): T;
export function dispose<T extends IDisposable>(disposable: T | undefined): T | undefined;
export function dispose<T extends IDisposable, A extends Iterable<T> = Iterable<T>>(disposables: A): A;
export function dispose<T extends IDisposable>(disposables: Array<T>): Array<T>;
export function dispose<T extends IDisposable>(disposables: ReadonlyArray<T>): ReadonlyArray<T>;
export function dispose<T extends IDisposable>(arg: T | Iterable<T> | undefined): any {
  if(isIterable<IDisposable>(arg)) {
    const errors: any[] = [];

    for(const d of arg) {
      if(d) {
        try {
          d.dispose();
        } catch (e) {
          errors.push(e);
        }
      }
    }

    if(errors.length === 1) {
      throw errors[0];
    } else if (errors.length > 1) {
      throw new AggregateError(errors, "Encountered errors while disposing of store");
    }

    return Array.isArray(arg) ? [] : arg;
  } else if (arg && isDisposable(arg)) {
    (arg as T).dispose();
    return arg;
  }
}

export function disposeIfDisposable<T extends IDisposable | object>(disposables: Array<T>): Array<T> {
  for(const d of disposables) {
    if(isDisposable(d)) {
      d.dispose();
    }
  }
  
  return [];
}
