import { type ICookie } from "./defs";
import type { HttpHeaders, Mutable } from "./@internals/_types";


export interface ResponseOptions extends ResponseInit {
  url?: string | URL;
  redirected?: boolean;
  responseTime?: number;
}

class HttpResponse extends Response {
  private _isRedirected: boolean | null;
  private _headersCache: HttpHeaders | null | undefined;

  public constructor(body?: BodyInit | null, private readonly _init?: ResponseOptions) {
    super(body, _init);
    this._isRedirected = typeof _init?.redirected === "boolean" ? _init.redirected : null;
  }

  public override get redirected(): boolean {
    if(this._isRedirected != null)
      return this._isRedirected;

    return super.redirected;
  }

  public get responseTime(): number | null {
    return this._init?.responseTime ?? null;
  }

  public override get url(): string {
    return this._init?.url ? new URL(this._init.url).toString() : "";
  }

  public override get ok(): boolean {
    return (this.status / 100 | 0) === 2;
  }

  public getHeaders(): HttpHeaders {
    if(!this._headersCache) {
      this._headersCache = {};

      for(const [key, value] of this.headers.entries()) {
        if(!this._headersCache[key]) {
          this._headersCache[key] = value;
          continue;
        }

        if(!Array.isArray(this._headersCache[key])) {
          this._headersCache[key] = [this._headersCache[key], value];
          continue;
        }

        this._headersCache[key].push(value);
      }
    }

    return { ...this._headersCache };
  }

  public getSetCookie(): readonly ICookie[] {
    return this.headers.getSetCookie().map(cookie => {
      const [nameValuePair, ...attrs] = cookie.split(";").map(p => p.trim());
      
      const [name, ...valueParts] = nameValuePair.split("=");
      const value = valueParts.join("=");

      const c: Mutable<ICookie> = { name, value };

      for(let i = 0; i < attrs.length; i++) {
        const [atName, rawAtValue] = attrs[i].split("=").map(p => p.trim());
        const atValue = rawAtValue ?? true;

        switch(atName.toLowerCase()) {
          case "expires":
            c.expires = atValue;
            break;
          case "max-age":
            c.maxAge = Number(atValue);
            break;
          case "secure":
            c.secure = true;
            break;
          case "httponly":
            c.httpOnly = true;
            break;
          case "domain":
            c.domain = atValue;
            break;
          case "path":
            c.path = atValue;
            break;
          case "samesite": {
            const v = (/^(strict|lax|none)$/i.exec(String(atValue).toLowerCase())?.[1] ?? undefined) as ICookie["sameSize"];
            c.sameSize = v;
          } break;
          case "partitioned":
            c.partitioned = true;
            break;
          case "priority": {
            const v = (/^(low|medium|high)$/i.exec(String(atValue).toLowerCase())?.[1] ?? undefined) as ICookie["priority"];
            c.priority = v;
          } break;
        }
      }

      return c;
    });
  }
}

export default HttpResponse;
