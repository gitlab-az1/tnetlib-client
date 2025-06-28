/* eslint-disable @typescript-eslint/no-namespace,no-inner-declarations */

import { SetMap } from "./map";
import StopWatch from "./stop-watch";
import { Exception, onUnexpected } from "./errors";
import type { Dict, GenericFunction, LooseAutocomplete } from "./_types";
import { Disposable, DisposableStore, dispose, IDisposable, toDisposable } from "./disposable";
import { CancellationToken, CancellationTokenSource, ICancellationToken } from "./cancellation";


export type EventListener<T, R = unknown> = (payload: T, token: ICancellationToken) => R;


const kListener = Symbol("kOriginalListener");


export type EventOptions = {
  cancelable?: boolean;
  once?: boolean;
  disposables?: IDisposable[] | DisposableStore;
  name?: string;
  thisArg?: any;
};

export class Event<T, R = unknown> extends Disposable.Disposable {
  private _source: CancellationTokenSource | null;
  private readonly _state: { callCount: number };

  public readonly [kListener]: EventListener<T, R>;
  
  public constructor(
    _listener: EventListener<T, R>,
    private readonly _options?: EventOptions // eslint-disable-line comma-dangle
  ) {
    super();
    
    this._state = { callCount: 0 };
    this._source = _options?.cancelable !== false ? new CancellationTokenSource() : null;

    this[kListener] = _listener;

    if(_options?.disposables instanceof DisposableStore) {
      super._register(_options.disposables);
    } else {
      super._register(toDisposable(() => {
        dispose(_options?.disposables as readonly IDisposable[]);
      }));
    }
  }

  public get name(): string | null {
    return this._options?.name?.trim() || null;
  }

  public $call(args: T): R {
    if(super._isDisposed()) {
      throw new Exception("Cannot call a disposed event listener", "ERR_RESOURCE_DISPOSED");
    }

    if(this._options?.once && this._state.callCount > 0) {
      throw new Exception("Cannot call \"once\" event more than once", "ERR_ONCE_WAS_CALLED_AGAIN");
    }

    if (
      this._source?.token.isCancellationRequested &&
      this._options?.cancelable !== false &&
      !(this._options?.once && this._state.callCount > 0)
    ) {
      this._source.dispose();
      this._source = new CancellationTokenSource();
    }

    const token = this._source?.token ?? CancellationToken.None;
    this._state.callCount++;

    if(!this._options?.thisArg)
      return this[kListener](args, token);

    return this[kListener].bind(this._options.thisArg)(args, token);
  }

  public isCancellationRequested(): boolean {
    return this._source?.token.isCancellationRequested ?? false;
  }

  public cancelable(): boolean {
    return this._options?.cancelable !== false && !this._source?.token.isCancellationRequested;
  }

  public cancel(): void {
    if(this._isDisposed())
      return;
    
    this._source?.cancel();
  }

  public override dispose(): void {
    this.cancel();
    
    if(!super._isDisposed()) {
      this._source?.dispose();
      this._source = null!;
    }

    super.dispose();
  }
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

  onWillAddFirstListener?: (emitter: Emitter<TEvents>) => unknown;
  onDidAddFirstListener?: (emitter: Emitter<TEvents>) => unknown;

  onDidAddListener?: (emitter: Emitter<TEvents>) => unknown;

  onDidRemoveLastListener?: (emitter: Emitter<TEvents>) => unknown;
  onWillRemoveListener?: (emitter: Emitter<TEvents>) => unknown;

  onListenerError?: (err: any) => unknown;
}


export namespace EventMonitoring {
  export class Profiling {
    public static readonly all: Set<Profiling> = new Set();
    private static _poolId: number = 0;

    public readonly name: string;
    public listenerCount: number = 0;
    public invocationCount: number = 0;
    public elapsedOverall: number = 0;

    public durations: number[] = [];

    private _stopWatch?: StopWatch | null = null;

    public constructor(name: string) {
      this.name = `${name}_${Profiling._poolId++}`;
      Profiling.all.add(this);
    }

    public start(lc: number): void {
      this._stopWatch = new StopWatch();
      this.listenerCount = lc;
    }

    public stop(): void {
      if(this._stopWatch) {
        const elapsed = this._stopWatch.elapsed();

        this.durations.push(elapsed);
        this.elapsedOverall += elapsed;
        this.invocationCount++;
        this._stopWatch = null;
      }
    }
  }

  export class LeakageMonitor implements IDisposable {
    private static _poolId: number = 1;

    private _stacks?: Map<string, number> | null;
    private _warnCountdown: number = 0;

    public constructor(
      private readonly _errorHandler: (err: Error) => void,
      public readonly threshold: number,
      public readonly name: string = (LeakageMonitor._poolId++).toString(16).padStart(3, "0") // eslint-disable-line comma-dangle
    ) { }

    public dispose(): void {
      this._stacks?.clear();
    }

    public check(stack: Stacktrace, lc: number): null | (() => void) {
      const t = this.threshold;

      if(t <= 0 || lc < t)
        return null;

      if(!this._stacks) {
        this._stacks = new Map();
      }

      const c = (this._stacks.get(stack.value) || 0);

      this._stacks.set(stack.value, c + 1);
      this._warnCountdown--;

      if(this._warnCountdown <= 0) {
        this._warnCountdown = t / 2;

        const [ts, tc] = this.getMostFrequentStack()!;

        const message = `[${this.name}] potential listener LEAK detected, having ${lc} listeners already. MOST frequent listener (${tc}):`;
        console.warn(message);
        console.warn(ts);

        this._errorHandler(new Exception(message, "ERR_LISTENER_LEAK"));
      }

      return () => {
        const c = (this._stacks!.get(stack.value) || 0);
        this._stacks!.set(stack.value, c - 1);
      };
    }

    public getMostFrequentStack(): [string, number] | null {
      if(!this._stacks)
        return null;

      let ts: [string, number] | null = null;
      let tc: number = 0;

      for(const [s, c] of this._stacks.entries()) {
        if(!ts || tc < c) {
          ts = [s, c];
          tc = c;
        }
      }

      return ts;
    }
  }
}


export class Emitter<TEvents extends Record<keyof TEvents, any[]> = Dict<[any]>> {
  private readonly _perfMonitor?: EventMonitoring.Profiling | null;
  private readonly _leakageMonitor?: EventMonitoring.LeakageMonitor | null;

  private readonly _state: { disposed: boolean; size: number };

  private readonly _options?: EmitterOptions<TEvents>;
  private readonly _disposables: DisposableStore;
  private readonly _listeners: SetMap<string | symbol, UniqueContainer<Event<TEvents[keyof TEvents]>>>;

  public constructor(_options?: EmitterOptions<TEvents>) {
    this._options = _options;
    this._state = { disposed: false, size: 0 };

    this._disposables = new DisposableStore();

    this._leakageMonitor = typeof _options?.leakWarningThreshold === "number" && _options.leakWarningThreshold > 0 ?
      new EventMonitoring.LeakageMonitor(_options?.onListenerError ?? onUnexpected, _options.leakWarningThreshold) : null;

    this._perfMonitor = _options?._profName ? new EventMonitoring.Profiling(_options._profName) : null;

    this._listeners = new SetMap();
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

  protected _addListener<K extends keyof TEvents>(
    event: LooseAutocomplete<K> | symbol,
    listener: Event<TEvents[K]> | EventListener<TEvents[K]>,
    thisArg?: any,
    options?: {
      once?: boolean;
      cancelable?: boolean;
      toDisposeWithEvent?: IDisposable[];
      disposables?: IDisposable[] | DisposableStore
    } // eslint-disable-line comma-dangle
  ): IDisposable {
    if(!(listener instanceof Event)) {
      listener = new Event(listener, {
        thisArg,
        name: `event:${String(event)}`,
        once: options?.once ?? false,
        disposables: options?.toDisposeWithEvent,
        cancelable: options?.cancelable ?? false,
      });
    }

    if(!["string", "symbol"].includes(typeof event)) {
      throw new Exception(`Cannot use 'typeof ${typeof event}' as key of event`, "ERR_INVALID_TYPE");
    }

    if(!this._checkLeakageBeforeAdd())
      return Disposable.None;

    if(this._state.disposed)
      return Disposable.None;

    const containedListener = new UniqueContainer<Event<any>>(listener);
    let rmonitor: GenericFunction | null = null;

    if(this._leakageMonitor && this._state.size >= Math.ceil(this._leakageMonitor.threshold * 0.2)) {
      containedListener.stack = Stacktrace.create();
      rmonitor = this._leakageMonitor.check(containedListener.stack, this._state.size + 1);
    }

    if(this._state.size === 0) {
      this._options?.onWillAddFirstListener?.(this);
    }

    this._listeners.add(event as string, containedListener);

    if(++this._state.size === 1) {
      this._options?.onDidAddFirstListener?.(this);
    }

    this._options?.onDidAddListener?.(this);

    const result = toDisposable(() => {
      rmonitor?.();
      this._removeUniqueListener(containedListener, event as string);
    });

    if(options?.disposables instanceof DisposableStore) {
      options.disposables.add(result);
    } else if(!!options?.disposables && Array.isArray(options.disposables)) {
      options.disposables.push(result);
    }

    return result;
  }

  public on<K extends keyof TEvents>(
    event: LooseAutocomplete<K> | symbol,
    listener: Event<TEvents[K]> | EventListener<TEvents[K]>,
    thisArg?: any,
    options?: {
      cancelable?: boolean;
      toDisposeWithEvent?: IDisposable[];
      disposables?: IDisposable[] | DisposableStore
    } // eslint-disable-line comma-dangle
  ): IDisposable {
    return this._addListener(event, listener, thisArg, {
      ...options,
      once: false,
    });
  }

  public once<K extends keyof TEvents>(
    event: LooseAutocomplete<K> | symbol,
    listener: Event<TEvents[K]> | EventListener<TEvents[K]>,
    thisArg?: any,
    options?: {
      cancelable?: boolean;
      toDisposeWithEvent?: IDisposable[];
      disposables?: IDisposable[] | DisposableStore
    } // eslint-disable-line comma-dangle
  ): IDisposable {
    return this._addListener(event, listener, thisArg, {
      ...options,
      once: true,
    });
  }

  public off<K extends keyof TEvents>(
    event: LooseAutocomplete<K> | symbol,
    listener: Event<TEvents[K]> | EventListener<TEvents[K]> // eslint-disable-line comma-dangle
  ): void {
    if(!["string", "symbol"].includes(typeof event)) {
      throw new Exception(`Cannot use 'typeof ${typeof event}' as key of event`, "ERR_INVALID_TYPE");
    }

    const set = this._listeners.get(event as string);
    const l = listener instanceof Event ? listener[kListener] : listener;

    for(const uc of set.values()) {
      if(uc.value[kListener] === l) {
        this._removeUniqueListener(uc, event as string);
        break;
      }
    }
  }

  public fire<K extends keyof TEvents>(event: LooseAutocomplete<K> | symbol, ...args: TEvents[K]): void {
    if(this._state.disposed)
      return;

    this._perfMonitor?.start(this._state.size);

    if(this._state.size > 0) {
      for(const listener of this._listeners.get(event as string)) {
        this._deliver(listener, ...args);
      }
    }

    this._perfMonitor?.stop();
  }

  public hasListeners(event?: LooseAutocomplete<keyof TEvents> | symbol): boolean {
    if(this._state.disposed)
      return false;
  
    if(!event)
      return this._state.size > 0;

    return this._listeners.get(event as string).size > 0;
  }

  public listenersCount(event?: LooseAutocomplete<keyof TEvents> | symbol): number {
    if(this._state.disposed)
      return 0;
  
    if(!event)
      return this._state.size;

    return this._listeners.get(event as string).size;
  }

  public clear(event?: LooseAutocomplete<keyof TEvents> | symbol): void {
    if(this._state.disposed)
      return;

    this._options?.onWillRemoveListener?.(this);
    
    if(!event) {
      this._listeners.forEach(e => e.value.dispose());
      this._listeners.clear();
      this._state.size = 0;
      this._options?.onDidRemoveLastListener?.(this);
      
      return;
    }

    const set = this._listeners.get(event as string);
    const size = set.size;

    set.forEach(e => e.value.dispose());

    this._listeners.remove(event as string);
    this._state.size -= size;

    if(this._state.size === 0) {
      this._options?.onDidRemoveLastListener?.(this);
    }
  }

  public dispose(): void {
    if(!this._state.disposed) {
      this._disposables.dispose();

      this._listeners.forEach(e => e.value.dispose());
      this._listeners.clear();
      this._state.size = 0;

      this._options?.onDidRemoveLastListener?.(this);
      this._leakageMonitor?.dispose();

      this._state.disposed = true;
    }
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

  private _removeUniqueListener(contained: UniqueContainer<Event<any>>, event?: string | symbol): void {
    if(this._state.disposed)
      return;

    this._options?.onWillRemoveListener?.(this);

    if(this._state.size === 0)
      return;

    let r = false;

    if(!event) {
      for(const [k] of this._listeners) {
        if(this._listeners.delete(k, contained)) {
          r = true;
          break;
        }
      }

      if(!r) {
        if(!this._options?.noDebug) {
          console.log("Disposed?", this._state.disposed);
          console.log("Size?", this._state.size);

          let i = 0;

          this._listeners.forEach((set, key) => {
            console.log(`Entry[${i++}] (${String(key)}):`, JSON.stringify(set, null, 2));
          });
        }

        throw new Exception("Attempted to dispose an unknown listener (no event provided)");
      }
    } else {
      if(!this._listeners.delete(event, contained)) {
        if(!this._options?.noDebug) {
          console.log("Disposed?", this._state.disposed);
          console.log("Size?", this._state.size);

          let i = 0;

          this._listeners.forEach((set, key) => {
            console.log(`Entry[${i++}] (${String(key)}):`, JSON.stringify(set, null, 2));
          });
        }

        throw new Exception("Attempted to dispose an unknown listener");
      }

      r = true;
    }

    if(r) {
      contained.value.dispose();

      if(--this._state.size === 0) {
        this._options?.onDidRemoveLastListener?.(this);
      }
    }
  }

  private _deliver(listener?: UniqueContainer<Event<any>> | null, ...args: any[]): void {
    if(!listener || this._state.disposed)
      return;

    const errorHandler = this._options?.onListenerError || onUnexpected;

    if(!errorHandler) {
      listener.value.$call(args);
      return;
    }

    try {
      listener.value.$call(args);
    } catch (err: any) {
      if(err instanceof Exception && err.is("ERR_ONCE_WAS_CALLED_AGAIN")) {
        this._removeUniqueListener(listener);
        return;
      }

      if(err instanceof Exception && err.is("ERR_RESOURCE_DISPOSED")) {
        if(!this._options?.noDebug) {
          console.warn(`Attempted to call a disposed event listener '${listener.value.name}'`);
        }

        this._removeUniqueListener(listener);
        return;
      }

      errorHandler(err);
    }
  }
}


let uci: number = 3;

class UniqueContainer<T> {
  public stack?: Stacktrace;
  public readonly id: number;

  public constructor(public readonly value: T) {
    this.id = uci++;
  }
}
