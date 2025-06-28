import { SetMap } from "./map";
import { EventMonitoring } from "./events";
import { Exception, onUnexpected } from "./errors";
import type { Dict, GenericFunction, LooseAutocomplete } from "./_types";
import { Disposable, DisposableStore, disposeIfDisposable, IDisposable, isDisposable, toDisposable } from "./disposable";


export type WeakEventListener<TArgs extends unknown[] = [never], R = unknown> = (...args: TArgs) => R;


interface ListenerMetadata {
  once: boolean;
  thisArg?: any;
  toDisposeWithEvent?: IDisposable[] | DisposableStore;
}

class Stacktrace {
  public static create(): Stacktrace {
    const err = new Error();
    return new Stacktrace(err.stack ?? "");
  }

  private constructor(
    public readonly value: string // eslint-disable-line comma-dangle
  ) { }
}


export interface EmitterOptions<TEvents extends Record<keyof TEvents, any[]> = Dict<[never]>> {
  _profName?: string;
  noDebug?: boolean;
  leakWarningThreshold?: number;

  onWillAddFirstListener?: (emitter: WeakEmitter<TEvents>) => unknown;
  onDidAddFirstListener?: (emitter: WeakEmitter<TEvents>) => unknown;

  onDidAddListener?: (emitter: WeakEmitter<TEvents>) => unknown;

  onDidRemoveLastListener?: (emitter: WeakEmitter<TEvents>) => unknown;
  onWillRemoveListener?: (emitter: WeakEmitter<TEvents>) => unknown;

  onListenerError?: (err: any) => unknown;
}


class WeakEmitter<TEvents extends Record<keyof TEvents, any[]> = Dict<[any]>> {
  private readonly _perfMonitor?: EventMonitoring.Profiling | null;
  private readonly _leakageMonitor?: EventMonitoring.LeakageMonitor | null;
  
  private readonly _state: { disposed: boolean; size: number };
  
  private readonly _options?: EmitterOptions<TEvents>;
  private readonly _disposables: DisposableStore;
  private readonly _listenerMetadata: Map<string, Map<WeakEventListener, ListenerMetadata>>;
  private readonly _listeners: SetMap<string, WeakEventListener>;

  public constructor(_options?: EmitterOptions<TEvents>) {
    this._options = _options;
    this._state = { disposed: false, size: 0 };
  
    this._disposables = new DisposableStore();
  
    this._leakageMonitor = typeof _options?.leakWarningThreshold === "number" && _options.leakWarningThreshold > 0 ?
      new EventMonitoring.LeakageMonitor(_options?.onListenerError ?? onUnexpected, _options.leakWarningThreshold) : null;
  
    this._perfMonitor = _options?._profName ? new EventMonitoring.Profiling(_options._profName) : null;
  
    this._listeners = new SetMap();
    this._listenerMetadata = new Map();
  }

  public get profiling(): null | Pick<EventMonitoring.Profiling, "durations" | "elapsedOverall" | "invocationCount" | "listenerCount"> {
    if(!this._perfMonitor)
      return null;

    return {
      durations: [ ...this._perfMonitor.durations ],
      elapsedOverall: this._perfMonitor.elapsedOverall,
      invocationCount: this._perfMonitor.invocationCount,
      listenerCount: this._perfMonitor.listenerCount,
    };
  }

  public addListener<K extends keyof TEvents>(
    event: LooseAutocomplete<K>,
    callback: (...args: TEvents[K]) => unknown,
    thisArg?: any,
    options?: {
      once?: boolean;
      disposables?: DisposableStore | IDisposable[];
      toDisposeWithEvent?: IDisposable[] | DisposableStore
    } // eslint-disable-line comma-dangle
  ): IDisposable {
    if(this._state.disposed)
      return Disposable.None;

    if(!this._checkLeakageBeforeAdd())
      return Disposable.None;

    let rmonitor: GenericFunction | null = null;

    if(this._leakageMonitor && this._state.size >= Math.ceil(this._leakageMonitor.threshold * 0.2)) {
      rmonitor = this._leakageMonitor.check(Stacktrace.create(), this._state.size + 1);
    }

    if(this._state.size === 0) {
      this._options?.onWillAddFirstListener?.(this);
    }

    let lm = this._listenerMetadata.get(event as string);

    if(!lm) {
      lm = new Map();
      this._listenerMetadata.set(event as string, lm);
    }

    lm.set(callback as () => void, {
      thisArg,
      once: options?.once ?? false,
      toDisposeWithEvent: options?.toDisposeWithEvent,
    });

    this._listeners.add(event as string, callback as () => void);

    if(++this._state.size === 1) {
      this._options?.onDidAddFirstListener?.(this);
    }

    this._options?.onDidAddListener?.(this);

    const result = toDisposable(() => {
      rmonitor?.();
      this.removeListener(event as string, callback as () => void);
    });

    if(options?.disposables instanceof DisposableStore) {
      options.disposables.add(result);
    } else if(!!options?.disposables && Array.isArray(options.disposables)) {
      options.disposables.push(result);
    }

    return result;
  }

  public removeListener<K extends keyof TEvents>(
    event: LooseAutocomplete<K>,
    callback?: (...args: TEvents[K]) => unknown // eslint-disable-line comma-dangle
  ): boolean {
    if(this._state.disposed)
      return false;

    this._options?.onWillRemoveListener?.(this);

    if(!callback) {
      const c = this._listeners.count(event as string);
      this._listeners.remove(event as string);

      this._state.size -= c;

      if(this._state.size === 0) {
        this._options?.onDidRemoveLastListener?.(this);
      }

      return true;
    }

    const meta = this._listenerMetadata.get(event as string)
      ?.get(callback as () => void);

    if(isDisposable(meta?.toDisposeWithEvent)) {
      meta.toDisposeWithEvent.dispose();
    } else if(Array.isArray(meta?.toDisposeWithEvent)) {
      disposeIfDisposable(meta.toDisposeWithEvent);
    }

    const r = this._listeners.delete(event as string, callback as () => void);

    if(r && --this._state.size === 0) {
      this._options?.onDidRemoveLastListener?.(this);
    }

    return r;
  }

  public emit<K extends keyof TEvents>(
    event: LooseAutocomplete<K>,
    ...args: TEvents[K] // eslint-disable-line comma-dangle
  ): void {
    if(this._state.disposed)
      return;

    this._perfMonitor?.start(this._state.size);

    if(this._listeners.count(event as string)) {
      for(const listener of this._listeners.get(event as string)) {
        const meta = this._listenerMetadata.get(event as string)
          ?.get(listener as () => void);

        this._deliver(event as string, listener, meta!, args);
      }
    }

    this._perfMonitor?.stop();
  }

  public clear(): void {
    if(this._state.disposed)
      return;

    this._options?.onWillRemoveListener?.(this);

    this._listeners.forEach((_, name) => {
      this.removeListener(name);
    });

    this._state.size = 0;
    this._options?.onDidRemoveLastListener?.(this);
  }

  public dispose(): void {
    if(!this._state.disposed) {
      this._state.disposed = false;
      this._state.size = 0;

      this._listeners.clear();
      this._disposables.clear();

      for(const x of this._listenerMetadata.values()) {
        for(const m of x.values()) {
          if(isDisposable(m.toDisposeWithEvent)) {
            m.toDisposeWithEvent.dispose();
          } else if (Array.isArray(m.toDisposeWithEvent)) {
            disposeIfDisposable(m.toDisposeWithEvent);
          }
        }
      }

      this._listenerMetadata.clear();
    }
  }

  public listenersCount(event?: LooseAutocomplete<keyof TEvents>): number {
    if(this._state.disposed)
      return 0;

    if(!event)
      return this._state.size;

    return this._listeners.get(event as string).size;
  }

  private _checkLeakageBeforeAdd(): boolean {
    if(this._state.disposed)
      return false;

    if(this._leakageMonitor && this._state.size > this._leakageMonitor.threshold ** 2) {
      const message = `[${this._leakageMonitor.name}] REFUSES to accept new listeners because it exceeded its threshold by far (${this._state.size} vs ${this._leakageMonitor.threshold})`;
      
      if(!this._options?.noDebug) {
        console.warn(message);
      }

      const tuple = this._leakageMonitor.getMostFrequentStack() ?? ["Unknown stack trace", -1];
      const error = new Exception(`${message}. HINT: Stack shows most frequent listener (${tuple[1]}-times)`, "ERR_LISTENER_REFUSAL", {
        overrideStack: tuple[0],
      });

      const errorHandler = this._options?.onListenerError || onUnexpected;
      errorHandler(error);

      return false;
    }

    return true;
  }

  private _deliver(event: string, listener: WeakEventListener, meta: ListenerMetadata, args: any[]): void {
    if(this._state.disposed)
      return;

    const errorHandler = this._options?.onListenerError || onUnexpected;

    const call = () => {
      if(!meta.thisArg)
        return (listener as any)(...args);

      return (listener as any).bind(meta.thisArg)(...args);
    };

    if(!errorHandler) {
      try {
        call();
      } finally {
        if(meta.once) {
          this.removeListener(event, listener as () => void);
        }
      }
    }

    try {
      call();
    } catch (err: any) {
      errorHandler(err);
    } finally {
      if(meta.once) {
        this.removeListener(event as string, listener as () => void);
      }
    }
  }
}

export default WeakEmitter;
