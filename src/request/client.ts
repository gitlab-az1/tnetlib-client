import HttpResponse from "../response";
import { HttpRequest, RequestInit } from "./core";
import { isPlainObject } from "../@internals/util";
import { TRANSPORT_STRATEGY, Transporter } from "../transport";
import type { BufferLike, HttpHeaders } from "../@internals/_types";


export interface ClientInit {
  mode?: RequestMode;
  baseUrl?: string | URL;
  redirectPolicy?: RequestRedirect;
  credentialsPolicy?: RequestCredentials;
  cachePolicy?: RequestCache;
  errorHandler?: (err: Error) => unknown;
  defaultHeaders?: Headers | HttpHeaders;
  defualtAdapter?: "xhr" | "fetch" | "default";
  defaultAllowEventProfilingMonitoring?: boolean;
  defaultKeepAlive?: boolean;
  defaultMaskBytes?: Uint8Array | number;
  defaultSecureTransportKey?: BufferLike;
  defaultTransportStragety?: TRANSPORT_STRATEGY;
  supressWarnings?: boolean;
  defaultTimeout?: number;
}

export interface RequestOptions extends RequestInit {
  transporter?: Transporter;
  adapter?: "xhr" | "fetch" | "default";
  onProgress?: (event: ProgressEvent<XMLHttpRequestEventTarget>) => unknown;
}


class HttpClient {
  readonly #init: ClientInit;
  #defaultHeaders: Headers;

  public constructor(_init?: ClientInit) {
    this.#init = _init ?? {};
    this.#defaultHeaders = new Headers();

    if(_init?.defaultHeaders instanceof Headers) {
      for(const [key, value] of _init.defaultHeaders) {
        this.#defaultHeaders.append(key, value);
      }
    } else if(typeof _init?.defaultHeaders === "object" && isPlainObject(_init.defaultHeaders)) {
      for(const prop in _init.defaultHeaders) {
        if(!Object.prototype.hasOwnProperty.call(_init.defaultHeaders, prop))
          continue;

        const values = _init.defaultHeaders[prop];

        for(const v of Array.isArray(values) ? values : [values]) {
          if(!v) continue;
          this.#defaultHeaders.append(prop, v);
        }
      }
    }

    if(typeof this.#init.supressWarnings !== "boolean") {
      this.#init.supressWarnings = true;
    }

    if(typeof this.#init.defaultKeepAlive !== "boolean") {
      this.#init.defaultKeepAlive = false;
    }
  }

  public request(to: string | URL, options?: RequestOptions): Promise<HttpResponse> {
    return this.#DoRequest(to, options);
  }

  public get(to: string | URL, options?: Omit<RequestOptions, "method">): Promise<HttpResponse> {
    return this.#DoRequest(to, {
      ...options,
      method: "GET",
    });
  }

  public post(to: string | URL, options?: Omit<RequestOptions, "method">): Promise<HttpResponse> {
    return this.#DoRequest(to, {
      ...options,
      method: "POST",
    });
  }

  public put(to: string | URL, options?: Omit<RequestOptions, "method">): Promise<HttpResponse> {
    return this.#DoRequest(to, {
      ...options,
      method: "PUT",
    });
  }

  public patch(to: string | URL, options?: Omit<RequestOptions, "method">): Promise<HttpResponse> {
    return this.#DoRequest(to, {
      ...options,
      method: "PATCH",
    });
  }

  public delete(to: string | URL, options?: Omit<RequestOptions, "method">): Promise<HttpResponse> {
    return this.#DoRequest(to, {
      ...options,
      method: "DELETE",
    });
  }

  public options(to: string | URL, options?: Omit<RequestOptions, "method">): Promise<HttpResponse> {
    return this.#DoRequest(to, {
      ...options,
      method: "OPTIONS",
    });
  }

  public head(to: string | URL, options?: Omit<RequestOptions, "method">): Promise<HttpResponse> {
    return this.#DoRequest(to, {
      ...options,
      method: "HEAD",
    });
  }

  async #DoRequest(url: string | URL, options?: RequestOptions): Promise<HttpResponse> {
    const headers = new Headers([...this.#defaultHeaders.entries()]);

    if(options?.headers instanceof Headers) {
      for(const [key, value] of options.headers) {
        headers.append(key, value);
      }
    } else if(typeof options?.headers === "object" && isPlainObject(options.headers)) {
      for(const prop in options.headers) {
        if(!Object.prototype.hasOwnProperty.call(options.headers, prop))
          continue;

        const values = options.headers[prop];

        for(const v of Array.isArray(values) ? values : [values]) {
          if(!v) continue;
          headers.append(prop, v);
        }
      }
    }

    const req = new HttpRequest(options?.adapter || this.#init.defualtAdapter, {
      headers,
      body: options?.body,
      url: new URL(url, this.#init.baseUrl),
      keepAlive: options?.keepAlive ?? this.#init.defaultKeepAlive,
      maskBytes: options?.maskBytes ?? this.#init.defaultMaskBytes,
      method: options?.method,
      mode: options?.mode ?? this.#init.mode,
      priority: options?.priority,
      redirect: options?.redirect ?? this.#init.redirectPolicy,
      secureTransportKey: options?.secureTransportKey ?? this.#init.defaultSecureTransportKey,
      signal: options?.signal,
      token: options?.token,
      supressWarnings: options?.supressWarnings ?? this.#init.supressWarnings,
      cache: options?.cache ?? this.#init.cachePolicy,
      timeout: options?.timeout ?? this.#init.defaultTimeout,
      credentials: options?.credentials ?? this.#init.credentialsPolicy,
      errorHandler: options?.errorHandler ?? this.#init.errorHandler,
      transportStrategy: options?.transportStrategy ?? this.#init.defaultTransportStragety,
      allowEventProfilingMonitoring: options?.allowEventProfilingMonitoring ?? this.#init.defaultAllowEventProfilingMonitoring,
    });

    if(typeof options?.onProgress === "function") {
      req.on("progress", options.onProgress);
    }

    try {
      return await req.dispatch(options?.transporter);
    } finally {
      req.dispose();
    }
  }
}

export default HttpClient;
