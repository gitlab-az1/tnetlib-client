import { Disposable } from "../../@internals/disposable";


export abstract class NetworkRequestAdapter extends Disposable.Disposable {
  #internalState = {
    disposed: false,
  };

  protected constructor(
    protected readonly _url: string | URL,
    protected readonly _options?: Omit<RequestInit, "headers"> & {
      timeout?: number;
      auth?: [string, string];
      headers?: Record<string, string | string[]> | Headers;
    } // eslint-disable-line comma-dangle
  ) { super(); }

  public override dispose(): void {
    if(!this.#internalState.disposed) {
      this.#internalState.disposed = true;
    }

    super.dispose();
  }

  protected _disposed(): boolean {
    return this.#internalState.disposed;
  }

  protected _ensureNotDisposed(): void {
    if(this.#internalState.disposed) {
      throw new Error("This request adapter is already disposed");
    }
  }

  public abstract dispatch(): Promise<Response>;
  public abstract readonly url: URL;
}


export interface AdapterConstructor {
  new (url: string | URL, options?: Omit<RequestInit, "headers"> & {
    timeout?: number;
    auth?: [string, string];
    headers?: Record<string, string | string[]> | Headers;
  }): NetworkRequestAdapter;
}

export type AdapterBuilder = (url: string | URL, options?: Omit<RequestInit, "headers"> & {
  timeout?: number;
  auth?: [string, string];
  headers?: Record<string, string | string[]> | Headers;
}) => NetworkRequestAdapter;
