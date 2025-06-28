import FetchAdapter from "./fetch";
import { NetworkRequestAdapter } from "./_defs";
import { concatBuffers, isAsyncIterable, isIterable, isPlainObject } from "../../@internals/util";


class XMLHttpRequestAdapter extends NetworkRequestAdapter {
  public static secureConstructor(
    _url: string | URL,
    _options?: Omit<RequestInit, "headers"> & {
      timeout?: number;
      auth?: [string, string];
      onProgress?: (event: ProgressEvent<XMLHttpRequestEventTarget>) => unknown;
      headers?: Record<string, string | string[]> | Headers;
    } // eslint-disable-line comma-dangle
  ): NetworkRequestAdapter {
    if(typeof globalThis.XMLHttpRequest !== "function")
      return new FetchAdapter(_url, _options);

    return new XMLHttpRequestAdapter(_url, _options);
  }

  #xhr: XMLHttpRequest;

  public constructor(
    _url: string | URL,
    _options?: Omit<RequestInit, "headers"> & {
      timeout?: number;
      auth?: [string, string];
      headers?: Record<string, string | string[]> | Headers;
    } // eslint-disable-line comma-dangle
  ) {
    if(typeof globalThis.XMLHttpRequest === "undefined") {
      throw new Error("Unable to use XMLHttpRequest in current environment");
    }
    
    super(_url, _options);
    this.#xhr = new globalThis.XMLHttpRequest();
    
    this.#xhr.open(_options?.method ?? "GET", _url, true, _options?.auth?.[0], _options?.auth?.[1]);
    
    if(typeof _options?.timeout === "number" && _options.timeout > 1) {
      this.#xhr.timeout = _options.timeout;
    }

    if(_options?.signal?.aborted) {
      this.#xhr.abort();
    } else {
      _options?.signal?.addEventListener("abort", () => {
        this.#xhr.abort();
      }, { once: true });
    }
  }

  public get url(): URL {
    return new URL(this._url);
  }

  public async dispatch(): Promise<Response> {
    this._ensureNotDisposed();

    try {
      let body = null;

      if(this._options?.body) {
        if(isIterable(this._options.body) || isAsyncIterable(this._options.body)) {
          const chunks: Uint8Array[] = [];

          for await (const chunk of (this._options.body as unknown as IterableIterator<Uint8Array>)) {
            chunks.push(chunk);
          }

          body = concatBuffers(...chunks);
        } else {
          body = this._options.body as XMLHttpRequestBodyInit;
        }
      }
      
      return await new Promise((resolve, reject) => {
        if(this.#xhr.readyState > XMLHttpRequest.OPENED) {
          reject();
          return;
        }

        this.#xhr.onerror = reject;
        this.#xhr.onabort = reject;
        this.#xhr.ontimeout = reject;

        if(this._options?.headers instanceof Headers) {
          for(const [key, value] of this._options.headers.entries()) {
            this.#xhr.setRequestHeader(key, value);
          }
        } else if(typeof this._options?.headers === "object" && isPlainObject(this._options.headers)) {
          for(const prop in this._options.headers) {
            if(!Object.prototype.hasOwnProperty.call(this._options.headers, prop))
              continue;

            for(const value of Array.isArray(this._options.headers[prop]) ? this._options.headers[prop] : [this._options.headers[prop]]) {
              this.#xhr.setRequestHeader(prop, value);
            }
          }
        }

        this.#xhr.responseType = "arraybuffer";

        this.#xhr.onreadystatechange = () => {
          if(this.#xhr.readyState !== XMLHttpRequest.DONE)
            return;

          const arr = this.#xhr.getAllResponseHeaders()
            .trim().split(/[\r\n]+/);

          const headerMap: Record<string, string> = {};

          arr.forEach((line) => {
            const parts = line.split(": ");
            const header = parts.shift()!;
            const value = parts.join(": ");

            headerMap[header] = value;
          });

          const res = new Response(this.#xhr.response, {
            headers: Object.entries(headerMap),
            status: this.#xhr.status,
            statusText: this.#xhr.statusText,
          });

          resolve(res);
        };

        if(this._options?.onProgress) {
          this.#xhr.addEventListener("progress", this._options.onProgress);
        }

        this.#xhr.send(body);
      });
    } finally {
      this.dispose();
    }
  }
}

export default XMLHttpRequestAdapter;
