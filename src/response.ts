import { type ICookie } from "./defs";
import type { HttpHeaders, Mutable } from "./@internals/_types";


class HttpResponse extends Response {
  private _headersCache: HttpHeaders | null | undefined;

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
