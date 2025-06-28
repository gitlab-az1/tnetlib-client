import { NetworkRequestAdapter } from "./_defs";
import { exclude, isPlainObject } from "../../@internals/util";


class FetchAdapter extends NetworkRequestAdapter {
  public constructor(
    _url: string | URL,
    _options?: Omit<RequestInit, "headers"> & {
      timeout?: number;
      auth?: [string, string];
      headers?: Record<string, string | string[]> | Headers;
    } // eslint-disable-line comma-dangle
  ) {
    super(_url, _options);
  }

  public get url(): URL {
    return new URL(this._url);
  }

  public async dispatch(): Promise<Response> {
    this._ensureNotDisposed();

    try {
      const headers = new Headers();

      if(this._options?.headers instanceof Headers) {
        for(const [key, value] of this._options.headers.entries()) {
          headers.append(key, value);
        }
      } else if(typeof this._options?.headers === "object" && isPlainObject(this._options.headers)) {
        for(const prop in this._options.headers) {
          if(!Object.prototype.hasOwnProperty.call(this._options.headers, prop))
            continue;
    
          for(const value of Array.isArray(this._options.headers[prop]) ? this._options.headers[prop] : [this._options.headers[prop]]) {
            headers.append(prop, value);
          }
        }
      }

      if(this._options?.auth) {
        let authText = this._options.auth[0];

        if(this._options.auth[1]) {
          authText += `:${this._options.auth[1]}`;
        }

        headers.append("Authorization", `Basic ${btoa(authText)}`);
      }

      const $call = () => fetch(this._url, {
        ...exclude(this._options ?? {}, "timeout", "auth", "headers"),
        headers,
      });

      const t = (
        typeof this._options?.timeout === "number" &&
        !isNaN(this._options.timeout) &&
        this._options.timeout > 1
      ) ?
        this._options.timeout : null;

      if(t != null) return await Promise.race([
        $call(),
        new Promise<Response>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Request timed out for '${this._url.toString()}' in ${t}ms`));
          }, t);
        }),
      ]);

      return await $call();
    } finally {
      this.dispose();
    }
  }
}

export default FetchAdapter;
