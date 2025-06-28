import HttpResponse from "../response";
import FetchAdapter from "./adapters/fetch";
import InterceptorChain from "../interceptor";
import XMLHttpRequestAdapter from "./adapters/xhr";
import { Disposable } from "../@internals/disposable";
import { type AdapterBuilder } from "./adapters/_defs";
import { Cookie, type ICookie, isCookie } from "../defs";
import { Exception, onUnexpected } from "../@internals/errors";

import {
  CancellationTokenSource,
  ICancellationToken,
} from "../@internals/cancellation";

import {
  assert,
  exclude,
  isAsyncIterable,
  isIterable,
  isPlainObject,
} from "../@internals/util";

import type {
  BufferLike,
  CommonHttpHeaders,
  HttpHeaders,
  HttpMethod,
  LooseAutocomplete,
} from "../@internals/_types";


export const enum REQUEST_STATE {
  UNINITIALIZED = 0x0,
  READY = 0xA,
  HEADERS_RECEIVED = 0xB,
  DONE = 0xC,
  ERROR = 0XF1,
  DISPOSED = 0xFF,
}

export interface RequestInit {
  url?: string | URL;
  method?: HttpMethod;
  headers?: HttpHeaders;
  credentials?: RequestCredentials;
  keepAlive?: boolean;
  mode?: RequestMode;
  priority?: RequestPriority;
  redirect?: RequestRedirect;
  signal?: AbortSignal;
  cache?: RequestCache;
  errorHandler?: (err: Error) => unknown,
  secureTransportKey?: BufferLike;
  body?: XMLHttpRequestBodyInit | ReadableStream<Uint8Array>;
  token?: ICancellationToken;
  timeout?: number;
}

export class HttpRequest extends Disposable.Disposable {
  #headers: Headers;
  #state: REQUEST_STATE;
  #extendedCookies: Set<Cookie>;
  #source: CancellationTokenSource;
  readonly #Adapter: AdapterBuilder;
  readonly #interceptors: [InterceptorChain<HttpRequest>, InterceptorChain<HttpResponse>];

  public constructor(
    adapter?: "xhr" | "fetch" | "default" | null,
    private readonly _options: RequestInit = {} // eslint-disable-line comma-dangle
  ) {
    if(_options.token && _options.signal) {
      throw new Exception("Cannot use both cancellation token and abort signal in HttpRequest");
    }

    super();

    this.#headers = new Headers();
    this.#extendedCookies = new Set();
    this.#source = new CancellationTokenSource(_options.token);

    this.#Adapter = adapter !== "xhr" ?
      (url, options) => new FetchAdapter(url, options) :
      XMLHttpRequestAdapter.secureConstructor;

    this.#interceptors = [
      new InterceptorChain(),
      new InterceptorChain(),
    ];

    _options.signal?.addEventListener("abort", () => {
      this.#source.cancel();
    });

    if(typeof _options.headers === "object" && isPlainObject(_options.headers)) {
      for(const prop in _options.headers) {
        if(!Object.prototype.hasOwnProperty.call(_options.headers, prop))
          continue;

        for(const value of Array.isArray(_options.headers[prop]) ? _options.headers[prop] : [_options.headers[prop]]) {
          if(!value) continue;
          this.#headers.append(prop, value);
        }
      }
    } else if(_options.headers instanceof Headers) {
      for(const [key, value] of _options.headers.entries()) {
        this.#headers.append(key, value);
      }
    }

    // eslint-disable-next-line no-extra-boolean-cast
    this.#state = !!_options.url ? REQUEST_STATE.READY : REQUEST_STATE.UNINITIALIZED;
  }

  public get interceptors(): { readonly request: InterceptorChain<HttpRequest>, readonly response: InterceptorChain<HttpResponse> } {
    this.#ensureNotDisposed();
    
    return {
      request: this.#interceptors[0],
      response: this.#interceptors[1],
    };
  }

  public get readyState(): number {
    return this.#state;
  }

  public getURL(): URL | null {
    this.#ensureNotDisposed();
    
    if(!this._options.url)
      return null;

    return new URL(this._options.url);
  }

  public setURL(value: string | URL): this {
    this.#ensureNotDisposed();
    this._options.url = value;

    if(this.#state === REQUEST_STATE.UNINITIALIZED) {
      this.#state = REQUEST_STATE.READY;
    }

    return this;
  }

  public getMethod(): HttpMethod {
    this.#ensureNotDisposed();
    return this._options.method ?? "GET";
  }

  public setMethod(value: HttpMethod): this {
    this.#ensureNotDisposed();

    this._options.method = value;
    return this;
  }

  public setHeader(key: LooseAutocomplete<keyof CommonHttpHeaders>, value: string | string[] | undefined): this {
    this.#ensureNotDisposed();
    if(!value) return this;
    
    for(const v of Array.isArray(value) ? value : [value]) {
      this.#headers.append(key as string, v);
    }

    return this;
  }

  public deleteHeader(key: LooseAutocomplete<keyof CommonHttpHeaders>): this {
    this.#ensureNotDisposed();

    this.#headers.delete(key as string);
    return this;
  }

  public setCookie(c: Omit<ICookie, "name"> & { readonly name: string }): this;
  public setCookie(name: string, value: string, options?: Omit<ICookie, "name" | "value">): this;
  public setCookie(
    cookieOrName: ICookie | string,
    value?: string,
    options?: Omit<ICookie, "name" | "value" | "expires"> & { expires?: string | number | Date } // eslint-disable-line comma-dangle
  ): this {
    this.#ensureNotDisposed();

    if(typeof cookieOrName === "object" && isCookie(cookieOrName)) {
      const cookie = new Cookie(cookieOrName.value);
      Object.assign(cookie, cookieOrName);

      this.#extendedCookies.add(cookie);
      return this;
    }

    assert(value, "Cookie must have a value");

    const cookie = new Cookie(value, cookieOrName, options?.expires);
    Object.assign(cookie, exclude(options ?? {}, "expires"));

    this.#extendedCookies.add(cookie);
    return this;
  }

  public deleteCookie(value: string, name?: string): boolean {
    this.#ensureNotDisposed();

    if(this.#extendedCookies.size === 0)
      return false;

    let delIndex = -1;
    const arr = [ ...this.#extendedCookies ];

    for(let i = 0; i < arr.length; i++) {
      if(
        (arr[i].name && name ? arr[i].name === name : true) &&
        value === arr[i].value
      ) {
        delIndex = i;
        break;
      }
    }

    if(delIndex > -1) {
      arr.splice(delIndex, 1);
    }

    this.#extendedCookies = new Set(arr);
    return delIndex > -1;
  }

  public async dispatch(): Promise<HttpResponse> {
    const errorHandler = this._options.errorHandler && typeof this._options.errorHandler === "function" ?
      this._options.errorHandler :
      onUnexpected;

    try {
      this.#ensureNotDisposed();

      if(this.#source.token.isCancellationRequested) {
        throw new Exception("Asynchronous network request was cancelled by token", "ERR_TOKEN_CANCELLED");
      }
    
      if(this.#state !== REQUEST_STATE.READY) {
        throw new Exception("This HttpRequest is not more ready to be dispatched");
      }

      assert(this._options.url, "A URL object must be defined to dispatch a network request");
      const ac = new AbortController();

      this.#source.token.onCancellationRequested(reason => {
        ac.abort(reason);
      });

      const headers = new Headers();

      for(const [key, value] of this.#headers.entries()) {
        headers.append(key, value);
      }

      for(const c of this.#extendedCookies.values()) {
        headers.append("Set-Cookie", c.toString(false));
      }

    
      if(this._options.body) {
        let body = null;

        if(isIterable(this._options.body) || isAsyncIterable(this._options.body)) {
          const chunks: Uint8Array[] = [];
          let len: number = 0;

          for await (const chunk of (this._options.body as unknown as IterableIterator<Uint8Array>)) {
            chunks.push(chunk);
            len += chunk.length;
          }

          body = new Uint8Array(len);
          let offset: number = 0;

          for(let i = 0; i < chunks.length; i++) {
            body.set(chunks[i], offset);
            offset += chunks[i].length;
          }

          this._options.body = body;
        }
      }

      if(this.#source.token.isCancellationRequested) {
        throw new Exception("Asynchronous network request was cancelled by token", "ERR_TOKEN_CANCELLED");
      }

      // TODO: if(this.#transportKey && this._options.body is Buffer) {...}

      // eslint-disable-next-line @typescript-eslint/no-this-alias
      let req = this as HttpRequest;
      req = await this.#interceptors[0].fulfilled(req);

      if(this.#source.token.isCancellationRequested) {
        throw new Exception("Asynchronous network request was cancelled by token", "ERR_TOKEN_CANCELLED");
      }

      assert(req._options.url, "A URL object must be defined to dispatch a network request");

      const adapter = this.#Adapter(req._options.url, {
        headers,
        signal: ac.signal,
        body: req._options.body,
        cache: req._options.cache,
        credentials: req._options.credentials,
        keepalive: req._options.keepAlive,
        keepAlive: req._options.keepAlive,
        method: req._options.method ?? "GET",
        mode: req._options.mode,
        priority: req._options.priority,
        redirect: req._options.redirect,
        timeout: req._options.timeout,
      } as any);

      super._register(adapter);
      const rawResponse = await adapter.dispatch();

      if((rawResponse.status / 100 | 0) === 3 && adapter instanceof XMLHttpRequestAdapter) {
        // TODO: handle redirect polices
      }

      const buffer = await rawResponse.arrayBuffer();

      // if(this.#transportKey) {...}

      if(this.#source.token.isCancellationRequested) {
        throw new Exception("Asynchronous network request was cancelled by token", "ERR_TOKEN_CANCELLED");
      }

      let response = new HttpResponse(buffer, {
        headers: rawResponse.headers,
        status: rawResponse.status,
      });

      response = await this.#interceptors[1].fulfilled(response);

      if(this.#source.token.isCancellationRequested) {
        throw new Exception("Asynchronous network request was cancelled by token", "ERR_TOKEN_CANCELLED");
      }

      return response;
    } catch (err: any) {
      errorHandler(err);
      this.#state = REQUEST_STATE.ERROR;

      return new HttpResponse(null, { status: 500 });
    }
  }

  public dispose(): void {
    if(this.#state !== REQUEST_STATE.DISPOSED) {
      this.#state = REQUEST_STATE.DISPOSED;

      this.#extendedCookies.clear();
      this.#headers = null!;
      this.#interceptors[0] = null!;
      this.#interceptors[1] = null!;
    }

    super.dispose();
  }

  public cancel(reason?: unknown): void {
    this.#source.cancel(reason);
  }

  #ensureNotDisposed(): void {
    if(this.#state === REQUEST_STATE.DISPOSED) {
      throw new Exception("This HttpRequest is already disposed and cannot be used anymore", "ERR_RESOURCE_DISPOSED");
    }
  }
}
