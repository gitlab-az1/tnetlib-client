import { immediate } from "./util";
import { Disposable, IDisposable, toDisposable } from "./disposable";


/**
 * Type defining a listener function for cancellation requests.
 * 
 * @callback CancellationRequestListener
 * @param listener - A function to handle the cancellation event.
 * @param thisArgs - Optional `this` context for the listener function.
 * @param disposables - Optional array to collect IDisposable resources.
 * @returns {IDisposable} A disposable object to cancel the listener.
 */
export type CancellationRequestListener = (listener: (e: any) => any, thisArgs?: any, disposables?: IDisposable[]) => IDisposable;


/**
 * Interface representing a cancellation token that signals whether cancellation has been requested
 * and includes an event listener for responding to cancellation requests.
 */
export interface ICancellationToken {
  /**
	 * A flag signalling is cancellation has been requested.
	 */
	readonly isCancellationRequested: boolean;

	/**
	 * An event which fires when cancellation is requested. This event
	 * only ever fires `once` as cancellation can only happen once. Listeners
	 * that are registered after cancellation will be called (next event loop run),
	 * but also only once.
	 *
	 * @event
	 */
	readonly onCancellationRequested: CancellationRequestListener;
}


export interface CancelableWithToken {
  
  /**
   * When provided, the corresponding `CancellationTokenSource`
   * can be used to cancel an asynchronous action.
   */
  token?: ICancellationToken;
}


const shortcutEvent = Object.freeze(function (callback: (...args: any[]) => any, context?: any): IDisposable {
  return immediate(callback.bind(context));
});


/**
 * Checks if the provided argument is an ICancellationToken.
 *
 * @param arg - The object to check.
 * @returns {boolean} `true` if `arg` is an ICancellationToken, otherwise `false`.
 */
export function isCancellationToken(arg: unknown): arg is ICancellationToken {
  if(typeof arg !== "object" || !arg || Array.isArray(arg)) return false;

  const candidate = (<ICancellationToken>arg);

  return typeof candidate.isCancellationRequested === "boolean" &&
    typeof candidate.onCancellationRequested === "function";
}


// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace CancellationToken {
  export const None = Object.freeze<ICancellationToken>({
    isCancellationRequested: false,
    onCancellationRequested: () => Object.freeze<IDisposable>({ dispose() { } }),
  });
  
  export const Cancelled = Object.freeze<ICancellationToken>({
    isCancellationRequested: true,
    onCancellationRequested: shortcutEvent,
  });
}


class MutableToken extends Disposable.Disposable implements ICancellationToken {
  private _isCancelled: boolean = false;
  private _cancellationListeners: Set<{ readonly listener: (e: any) => unknown; thisArgs?: any }> = new Set();

  /**
   * Returns whether cancellation has been requested.
   */
  public get isCancellationRequested(): boolean {
    return this._isCancelled;
  }

  /**
   * Returns an event listener for cancellation requests. If cancellation has been requested, returns an immediate event.
   */
  public get onCancellationRequested(): CancellationRequestListener {
    if(this._isCancelled) return shortcutEvent;

    return ((listener, thisArgs, disposables) => {
      if(!this._isCancelled) {
        const entry = { listener, thisArgs };
        this._cancellationListeners.add(entry);
        
        return toDisposable(() => {
          this._cancellationListeners.delete(entry);
        });
      }

      if(disposables && Array.isArray(disposables)) {
        disposables.push(shortcutEvent(listener, thisArgs));
        
        for(const d of disposables) {
          super._register(d);
        }
      } else return listener.call(thisArgs, void 0);
    }) as CancellationRequestListener;
  }

  /**
   * Requests cancellation, firing the cancellation event if applicable.
   * 
   * @param reason - Optional reason for the cancellation.
   */
  public cancel(reason?: any) {
    if(this._isCancelled) return;

    this._isCancelled = true;

    if(this._cancellationListeners.size === 0) 
      return this.dispose();

    
    for(const { listener, thisArgs } of this._cancellationListeners.values()) {
      if(!thisArgs) {
        listener(reason);
      } else {
        listener.bind(thisArgs)(reason);
      }
    }
    
    this.dispose();
  }

  /**
   * Disposes of the resources associated with the cancellation token.
   */
  public override dispose(): void {
    if(this._cancellationListeners.size > 0) {
      this._cancellationListeners.clear();
    }

    super.dispose();
  }
}


export class CancellationTokenSource {
  private _token?: ICancellationToken | null = null;
  private _parentListener?: IDisposable | null = null;

  /**
   * Constructs a CancellationTokenSource, optionally linked to a parent token to cascade cancellations.
   *
   * @param _parent - Optional parent cancellation token.
   */
  public constructor(private readonly _parent?: ICancellationToken) {
    if(!_parent) return;
    this._parentListener = _parent.onCancellationRequested(this.cancel, this);
  }

  /**
   * Gets the associated cancellation token, creating it if necessary.
   */
  public get token(): ICancellationToken {
    if(!this._token) {
      this._token = new MutableToken();
    }

    return this._token;
  }

  /**
   * Gets the parent cancellation token, if any.
   */
  public get parent(): ICancellationToken | undefined {
    return this._parent;
  }

  /**
   * Requests cancellation for the token, optionally providing a reason and a stack trace location.
   *
   * @param reason - Optional reason for the cancellation.
   * @param location - Optional stack trace location.
   */
  public cancel(reason?: any): void {
    if(!this._token) {
      this._token = CancellationToken.Cancelled;
    } else if(this._token instanceof MutableToken) {
      this._token.cancel(reason);
    }
  }

  /**
   * Disposes of the token source, optionally canceling it before disposal.
   *
   * @param cancel - If `true`, requests cancellation before disposal.
   * @param cancellationReason - Optional reason for cancellation.
   */
  public dispose(cancel: boolean = false, cancellationReason?: any): void {
    if(cancel === true) {
      this.cancel(cancellationReason);
    }

    this._parentListener?.dispose();

    if(!this._token) {
      this._token = CancellationToken.None;
    } else if(this._token instanceof MutableToken) {
      this._token.dispose();
    }
  }
}
