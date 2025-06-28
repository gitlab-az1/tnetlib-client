import HttpResponse from "../response";
import FetchAdapter from "./adapters/fetch";
import InterceptorChain from "../interceptor";
import XMLHttpRequestAdapter from "./adapters/xhr";
import WeakEmitter from "../@internals/weak-emitter";
import { type AdapterBuilder } from "./adapters/_defs";
import { Cookie, type ICookie, isCookie } from "../defs";
import { Exception, onUnexpected } from "../@internals/errors";
import { parseMultipart, UniversalFormData } from "../form-data";
import { BinaryWriter, chunkToBuffer } from "../@internals/binary-protocol";
import TransportKeyObject, { TRANSPORT_STRATEGY } from "../transport/key-object";
import { Disposable, DisposableStore, IDisposable } from "../@internals/disposable";

import {
  getDefaultMask,
  isSecurePacket,
  Transporter,
  unwrapPacket,
} from "../transport/core";

import {
  CancellationTokenSource,
  ICancellationToken,
} from "../@internals/cancellation";

import {
  assert,
  concatBuffers,
  exclude,
  isAsyncIterable,
  isIterable,
  isPlainObject,
  NEVER,
  timestamp,
} from "../@internals/util";

import type {
  BufferLike,
  CommonHttpHeaders,
  EventCallback,
  HttpHeaders,
  HttpMethod,
  LooseAutocomplete,
} from "../@internals/_types";


export interface RequestDefaultEventsMap {
  progress: [event: ProgressEvent<XMLHttpRequestEventTarget>];
  error: [error: Error];
  readystatechange: [request: HttpRequest];
  data: [chunk: Uint8Array];
  dispose: [never];
  done: [response: HttpResponse];
}

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
  headers?: HttpHeaders | Headers;
  credentials?: RequestCredentials;
  keepAlive?: boolean;
  mode?: RequestMode;
  priority?: RequestPriority;
  redirect?: RequestRedirect;
  signal?: AbortSignal;
  cache?: RequestCache;
  maskBytes?: number | Uint8Array;
  errorHandler?: (err: Error) => unknown,
  secureTransportKey?: BufferLike;
  transportStrategy?: TRANSPORT_STRATEGY;
  body?: XMLHttpRequestBodyInit | ReadableStream<Uint8Array> | FormData;
  token?: ICancellationToken;
  timeout?: number;
  allowEventProfilingMonitoring?: boolean;
  supressWarnings?: boolean;
}

export class HttpRequest extends Disposable.Disposable {
  #headers: Headers;
  #state: REQUEST_STATE;
  #extendedCookies: Set<Cookie>;
  #bodyWriter?: BinaryWriter | null;
  #source: CancellationTokenSource;
  #transportKey?: TransportKeyObject;
  readonly #Adapter: AdapterBuilder;
  readonly #emitter: WeakEmitter<RequestDefaultEventsMap>;
  readonly #interceptors: [InterceptorChain<HttpRequest>, InterceptorChain<HttpResponse>];

  public constructor(
    adapter?: "xhr" | "fetch" | "default" | null,
    private readonly _options: RequestInit = {} // eslint-disable-line comma-dangle
  ) {
    if(_options.token && _options.signal) {
      throw new Exception("Cannot use both cancellation token and abort signal in HttpRequest");
    }

    super();

    this.#bodyWriter = null;
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

    this.#emitter = new WeakEmitter({
      leakWarningThreshold: 14,
      onListenerError: _options.errorHandler,
      _profName: _options.allowEventProfilingMonitoring ? "HttpRequest" : void 0,
    });

    if(_options.headers instanceof Headers) {
      for(const [key, value] of _options.headers.entries()) {
        this.#headers.append(key, value);
      }
    } else if(typeof _options.headers === "object" && isPlainObject(_options.headers)) {
      for(const prop in _options.headers) {
        if(!Object.prototype.hasOwnProperty.call(_options.headers, prop))
          continue;

        for(const value of Array.isArray(_options.headers[prop]) ? _options.headers[prop] : [_options.headers[prop]]) {
          if(!value) continue;
          this.#headers.append(prop, value);
        }
      }
    }

    // eslint-disable-next-line no-extra-boolean-cast
    this.#state = !!_options.url ? REQUEST_STATE.READY : REQUEST_STATE.UNINITIALIZED;

    if(this.#state === REQUEST_STATE.READY) {
      this.#emitter.emit("readystatechange", this);
    }

    if(!this.#source.token.isCancellationRequested && _options.secureTransportKey) {
      this.#transportKey = new TransportKeyObject(_options.secureTransportKey, _options.transportStrategy);
    }
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

  public getMaskBytes(): Uint8Array | number | null {
    return this._options.maskBytes ?? null;
  }

  public setMaskBytes(value: Uint8Array | number): this {
    this.#ensureNotDisposed();

    this._options.maskBytes = value;
    return this;
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
      this.#emitter.emit("readystatechange", this);
    }

    return this;
  }

  public setBody(body?: RequestInit["body"] | null): this {
    this.#ensureNotDisposed();
    this._options.body = body ?? void 0;

    return this;
  }

  /**
   * Creates a chunked stream that will accept chunks by this#write()
   * 
   * ATTENTION: IF YOU CREATE A WRITER IT WILL OVERRIDE BODY
   */
  public createBodyWriter(): this {
    this.#ensureNotDisposed();

    if(!this.#bodyWriter) {
      this.#bodyWriter = new BinaryWriter();
      this.#headers.set("Content-Type", "application/octet-stream");
    }

    return this;
  }

  public write(chunk: BufferLike): boolean {
    this.#ensureNotDisposed();
    
    if(this.#bodyWriter) {
      this.#bodyWriter.write(chunk);
      this.#emitter.emit("data", chunkToBuffer(chunk));

      return true;
    } else if(this._options.supressWarnings !== true) {
      console.warn("[HttpRequest] Before use write() method you must call createBodyWriter()");
    }
    
    return false;
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

  public setTransportKey(key: BufferLike): this {
    this.#ensureNotDisposed();
    
    this.#transportKey?.dispose();
    this.#transportKey = new TransportKeyObject(key);

    return this;
  }

  public getTimeout(): number | null {
    this.#ensureNotDisposed();
    return this._options.timeout ?? null;
  }

  public setTimeout(value: number): this {
    this.#ensureNotDisposed();

    if(typeof value === "number" && value > 0) {
      this._options.timeout = value | 0;
    }

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

  public on<K extends keyof RequestDefaultEventsMap>(
    name: LooseAutocomplete<K>,
    callback: EventCallback<RequestDefaultEventsMap[K]>,
    thisArg?: any,
    options?: {
      toDisposeWithEvent?: IDisposable[];
      disposables?: IDisposable[] | DisposableStore
    } // eslint-disable-line comma-dangle
  ): IDisposable {
    if(this.#state === REQUEST_STATE.DISPOSED)
      return Disposable.None;

    return this.#emitter.addListener(name, callback, thisArg, {
      once: false,
      disposables: options?.disposables,
      toDisposeWithEvent: options?.toDisposeWithEvent,
    });
  }

  public once<K extends keyof RequestDefaultEventsMap>(
    name: LooseAutocomplete<K>,
    callback: EventCallback<RequestDefaultEventsMap[K]>,
    thisArg?: any,
    options?: {
      toDisposeWithEvent?: IDisposable[];
      disposables?: IDisposable[] | DisposableStore
    } // eslint-disable-line comma-dangle
  ): IDisposable {
    if(this.#state === REQUEST_STATE.DISPOSED)
      return Disposable.None;

    return this.#emitter.addListener(name, callback, thisArg, {
      once: true,
      disposables: options?.disposables,
      toDisposeWithEvent: options?.toDisposeWithEvent,
    });
  }

  public off<K extends keyof RequestDefaultEventsMap>(
    name: LooseAutocomplete<K>,
    callback: EventCallback<RequestDefaultEventsMap[K]> // eslint-disable-line comma-dangle
  ): boolean {
    if(this.#state === REQUEST_STATE.DISPOSED)
      return false;

    return this.#emitter.removeListener(name, callback);
  }

  public removeListener(name: LooseAutocomplete<keyof RequestDefaultEventsMap>): boolean {
    if(this.#state === REQUEST_STATE.DISPOSED) 
      return false;

    return this.#emitter.removeListener(name);
  }

  /**
   * Dispatch the request to target server.
   * 
   * @param t A optional `Transporter` object with body payload, if provided will override body
   * @returns A `HttpResponse` object 
   */
  public async dispatch(t?: Transporter): Promise<HttpResponse> {
    const errorHandler = this._options.errorHandler && typeof this._options.errorHandler === "function" ?
      this._options.errorHandler :
      onUnexpected;

    const st: number = timestamp();

    try {
      this.#ensureNotDisposed();

      if(this.#source.token.isCancellationRequested) {
        throw new Exception("Asynchronous network request was cancelled by token", "ERR_TOKEN_CANCELLED");
      }
    
      if(this.#state !== REQUEST_STATE.READY) {
        throw new Exception("This HttpRequest is not ready to be dispatched");
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

    
      if(t instanceof Transporter) {
        this._options.body = await t.return();
        
        this.#headers.set("Content-Type", "application/octet-stream");
        this.#headers.set("Content-Length", this._options.body.byteLength.toString());
      } else if(this.#bodyWriter) {
        this._options.body = this.#bodyWriter.drain();
        this.#headers.set("Content-Length", this._options.body.byteLength.toString());
      } else if(
        this._options.body instanceof UniversalFormData ||
        (typeof globalThis.FormData !== "undefined" ?
          this._options.body instanceof globalThis.FormData :
          false
        )
      ) {
        if(this._options.body instanceof UniversalFormData) {
          const { body, headers } = parseMultipart(this._options.body);

          let lastKey: string | undefined;

          for(const prop in headers) {
            const h = headers[prop];

            for(const value of Array.isArray(h) ? h : [h]) {
              this.#headers[lastKey === prop ? "append" : "set"](prop, value);
              lastKey = prop;
            }

            lastKey = void 0;
          }

          this._options.body = body;
        } else {
          this.#headers.set("Content-Type", "multipart/form-data");
        }
      } else if(this._options.body) {
        if(isIterable(this._options.body) || isAsyncIterable(this._options.body)) {
          const chunks: Uint8Array[] = [];
        
          for await (const chunk of (this._options.body as unknown as IterableIterator<Uint8Array>)) {
            chunks.push(chunk);
          }

          this._options.body = concatBuffers(...chunks);

          this.#headers.set("Content-Type", "application/octet-stream");
          this.#headers.set("Content-Length", this._options.body.byteLength.toString());
        }
      }

      if(this.#source.token.isCancellationRequested) {
        throw new Exception("Asynchronous network request was cancelled by token", "ERR_TOKEN_CANCELLED");
      }

      if(this.#transportKey && !t && this._options.body) {
        const transporter = new Transporter(this.#transportKey);

        if(this._options.maskBytes) {
          transporter.setMaskBytes(this._options.maskBytes);
        }

        this._options.body = await transporter.setPayload(this._options.body)
          .return();

        transporter.dispose();
      }

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
        onProgress: (e: any) => {
          this.#emitter.emit("progress", e);
        },
      } as any);
      
      super._register(adapter);

      const rawResponse = await adapter.dispatch();

      if((rawResponse.status / 100 | 0) === 3 && adapter instanceof XMLHttpRequestAdapter) {
        const location = rawResponse.headers.get("Location");

        if(location && this._options.redirect !== "manual") {
          if(this._options.redirect === "error") {
            throw new Exception("Redirect not allowed by redirect policy", "ERR_REDIRECT_BLOCKED");
          }

          this.setURL(new URL(location, this.getURL()!));
          return await this.dispatch();
        }
      }

      let buffer = await rawResponse.arrayBuffer();

      if(this.#transportKey && isSecurePacket(buffer)) {
        buffer = await unwrapPacket(
          buffer,
          this.#transportKey,
          this._options.maskBytes ?? getDefaultMask() // eslint-disable-line comma-dangle
        );
      }

      if(this.#source.token.isCancellationRequested) {
        throw new Exception("Asynchronous network request was cancelled by token", "ERR_TOKEN_CANCELLED");
      }

      let response = new HttpResponse(buffer, {
        url: this._options.url,
        headers: rawResponse.headers,
        statusText: rawResponse.statusText,
        status: rawResponse.status,
        responseTime: timestamp() - st,
      });

      response = await this.#interceptors[1].fulfilled(response);

      if(this.#source.token.isCancellationRequested) {
        throw new Exception("Asynchronous network request was cancelled by token", "ERR_TOKEN_CANCELLED");
      }

      this.#emitter.emit("done", response);
      return response;
    } catch (err: any) {
      this.#emitter.emit("error", err);

      errorHandler(err);
      this.#state = REQUEST_STATE.ERROR;

      return new HttpResponse(null, { status: 500 });
    }
  }

  public dispose(): void {
    if(this.#state !== REQUEST_STATE.DISPOSED) {
      this.#state = REQUEST_STATE.DISPOSED;
      this.#emitter.emit("dispose", NEVER);

      this.#extendedCookies.clear();
      this.#headers = null!;
      this.#interceptors[0] = null!;
      this.#interceptors[1] = null!;
      this.#emitter.dispose();
      this.#bodyWriter?.drain();
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
