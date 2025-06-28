import { assert } from "./@internals/util";


export const enum HTTP_RESPONSE_CODE {
  // Informational responses (100 - 199)
  CONTINUE = 100,
  SWITCHING_PROTOCOLS = 101,
  PROCESSING = 102,
  EARLY_HINTS = 103,

  // Successful responses (200 - 299)
  OK = 200,
  CREATED = 201,
  ACCEPTED = 202,
  NON_AUTHORITATIVE_INFORMATION = 203,
  NO_CONTENT = 204,
  RESET_CONTENT = 205,
  PARTIAL_CONTENT = 206,
  MULTI_STATUS = 207,
  ALREADY_REPORTED = 208,
  IM_USED = 226,

  // Redirection messages (300 - 399)
  MULTIPLE_CHOICES = 300,
  MOVED_PERMANENTLY = 301,
  FOUND = 302,
  SEE_OTHER = 303,
  NOT_MODIFIED = 304,
  USE_PROXY = 305,
  TEMPORARY_REDIRECT = 307,
  PERMANENT_REDIRECT = 308,

  // Client error responses (400 - 499)
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  PAYMENT_REQUIRED = 402,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  METHOD_NOT_ALLOWED = 405,
  NOT_ACCEPTABLE = 406,
  PROXY_AUTHENTICATION_REQUIRED = 407,
  REQUEST_TIMEOUT = 408,
  CONFLICT = 409,
  GONE = 410,
  LENGTH_REQUIRED = 411,
  PRECONDITION_FAILED = 412,
  PAYLOAD_TOO_LARGE = 413,
  URI_TOO_LONG = 414,
  UNSUPPORTED_MEDIA_TYPE = 415,
  RANGE_NOT_SATISFIABLE = 416,
  EXPECTATION_FAILED = 417,
  IM_A_TEAPOT = 418,
  MISDIRECTED_REQUEST = 421,
  UNPROCESSABLE_ENTITY = 422,
  LOCKED = 423,
  FAILED_DEPENDENCY = 424,
  TOO_EARLY = 425,
  UPGRADE_REQUIRED = 426,
  PRECONDITION_REQUIRED = 428,
  TOO_MANY_REQUESTS = 429,
  REQUEST_HEADER_FIELDS_TOO_LARGE = 431,
  UNAVAILABLE_FOR_LEGAL_REASONS = 451,

  // Server error responses (500 -599)
  INTERNAL_SERVER_ERROR = 500,
  NOT_IMPLEMENTED = 501,
  BAD_GATEWAY = 502,
  SERVICE_UNAVAILABLE = 503,
  GATEWAY_TIMEOUT = 504,
  HTTP_VERSION_NOT_SUPPORTED = 505,
  VARIANT_ALSO_NEGOTIATES = 506,
  INSUFFICIENT_STORAGE = 507,
  LOOP_DETECTED = 508,
  NOT_EXTENDED = 510,
  NETWORK_AUTHENTICATION_REQUIRED = 511,
}


export interface ICookie {
  /** Make it optional because can be defined elsewhere */
  readonly name?: string;
  readonly value: string;
  readonly expires?: string;
  readonly maxAge?: number;
  readonly secure?: boolean;
  readonly httpOnly?: boolean;
  readonly domain?: string;
  readonly path?: string;
  readonly sameSize?: "Strict" | "Lax" | "None";
  readonly partitioned?: boolean;
  readonly priority?: "Medium" | "Low" | "High";
  readonly size?: number;
}


export class Cookie implements ICookie {
  public expires?: string;
  public maxAge?: number;
  public secure?: boolean;
  public httpOnly?: boolean;
  public domain?: string;
  public path?: string;
  public sameSize?: "Strict" | "Lax" | "None";
  public partitioned?: boolean;
  public priority?: "Medium" | "Low" | "High";
  public size?: number;

  public constructor(
    public value: string,
    public name?: string,
    expires?: number | string | Date // eslint-disable-line comma-dangle
  ) {
    if(expires instanceof Date) {
      assert(expires > new Date(), "Cookie expiration date must be in the future");
      this.expires = expires.toUTCString();
      // eslint-disable-next-line no-extra-boolean-cast
    } else if(!!expires) {
      const d = new Date(expires);

      assert(d > new Date(), "Cookie expiration date must be in the future");
      this.expires = d.toUTCString();
    }

    this.path = "/";
    this.size = value.length;
  }

  public freeze(): ICookie {
    const obj = {
      value: this.value,
      domain: this.domain,
      expires: this.expires,
      httpOnly: this.httpOnly,
      maxAge: this.maxAge,
      name: this.name,
      partitioned: this.partitioned,
      path: this.path,
      priority: this.priority,
      sameSize: this.sameSize,
      secure: this.secure,
      size: this.size,
    } as const;

    for(const prop in obj) {
      if(!Object.prototype.hasOwnProperty.call(obj, prop))
        continue;

      if(!["string", "number"].includes(typeof (obj as any)[prop])) {
        delete (obj as any)[prop];
      }
    }

    return Object.freeze(obj);
  }

  public toString(hideName: boolean = false): string {
    let cookie = `${!hideName && this.name ? (this.name.trim() + "=") : ""}${this.value.trim()}`;

    if(this.expires) {
      cookie += `; Expires=${this.expires}`;
    }

    if(typeof this.maxAge === "number" && !isNaN(this.maxAge)) {
      cookie += `; Max-Age=${this.maxAge}`;
    }

    if(this.domain) {
      cookie += `; Domain=${this.domain}`;
    }

    if(this.path) {
      cookie += `; Path=${this.path}`;
    }

    if(this.secure) {
      cookie += "; Secure";
    }

    if(this.httpOnly) {
      cookie += "; HttpOnly";
    }

    if(this.sameSize) {
      cookie += `; SameSite=${this.sameSize}`;
    }

    if(this.partitioned) {
      cookie += "; Partitioned";
    }

    if(this.priority) {
      cookie += `; Priority=${this.priority}`;
    }

    return cookie;
  }
}


export function isCookie(obj: any): obj is ICookie {
  if(typeof obj !== "object" || Array.isArray(obj) || !obj)
    return false;

  if(typeof obj.value !== "string")
    return false;

  if("name" in obj && obj.name !== undefined && typeof obj.name !== "string")
    return false;

  if("expires" in obj && obj.expires !== undefined && typeof obj.expires !== "string")
    return false;

  if("maxAge" in obj && obj.maxAge !== undefined && typeof obj.maxAge !== "number")
    return false;

  if("secure" in obj && obj.secure !== undefined && typeof obj.secure !== "boolean")
    return false;

  if("httpOnly" in obj && obj.httpOnly !== undefined && typeof obj.httpOnly !== "boolean")
    return false;

  if("domain" in obj && obj.domain !== undefined && typeof obj.domain !== "string")
    return false;

  if("path" in obj && obj.path !== undefined && typeof obj.path !== "string")
    return false;

  if(
    "sameSize" in obj &&
    obj.sameSize !== undefined &&
    !["Strict", "Lax", "None"].includes(obj.sameSize)
  ) return false;

  if("partitioned" in obj && obj.partitioned !== undefined && typeof obj.partitioned !== "boolean")
    return false;

  if(
    "priority" in obj &&
    obj.priority !== undefined &&
    !["Low", "Medium", "High"].includes(obj.priority)
  ) return false;

  if("size" in obj && obj.size !== undefined && typeof obj.size !== "number")
    return false;

  return true;
}


const validHttpStatusCodes = new Set([
  // Informational responses (100 - 199)
  100, 101, 102, 103,

  // Successful responses (200 - 299)
  200, 201, 202, 203, 204, 205, 206, 207, 208, 226,

  // Redirection messages (300 - 399)
  300, 301, 302, 303, 304, 305, 307, 308,

  // Client error responses (400 - 499)
  400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414, 415, 416, 417, 
  418, 421, 422, 423, 424, 425, 426, 428, 429, 431, 451,

  // Server error responses (500 - 599)
  500, 501, 502, 503, 504, 505, 506, 507, 508, 510, 511,
]);


export function isValidHttpStatusCode(value: unknown): value is number {
  return typeof value === "number" && validHttpStatusCodes.has(value);
}
