import { Exception } from "./errors";


export function exclude<T extends object, K extends keyof T>(obj: T, ...keys: K[]): Omit<T, K> {
  return Object.fromEntries( Object.entries(obj).filter(([key]) => !keys.includes(key as K)) ) as Omit<T, K>;
}


export function randomString(length: number = 16, special?: boolean | "underscore"): string {
  const base = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0987654321";
  const specials = special === "underscore" ? "-_" : "!@#$%&*()-_=+çÇ,.;:/?\\[]{}";
  const alphabet = strShuffle(base + (special ? specials : ""));
  
  let result: string = "";

  do {
    result = "";

    for(let i = 0; i < length; i++) {
      result += choose(alphabet);
    }
  } while(result[0] === "0");

  return result;
}


export function isBase64(str: unknown): str is string {
  if(!str || typeof str !== "string") return false;

  try {
    // eslint-disable-next-line no-useless-escape
    const base64Regex = /^(?:[A-Za-z0-9+\/]{4})*?(?:[A-Za-z0-9+\/]{2}==|[A-Za-z0-9+\/]{3}=)?$/;
    return (str.length % 4 === 0 && base64Regex.test(str)) || btoa(atob(str)) === str;
  } catch {
    return false;
  }
}


export function __assertType<T>(arg: unknown): asserts arg is T { void arg; }


export function isNumber(arg: unknown): boolean {
  if(typeof arg === "number")
    return true;

  if(typeof arg !== "string")
    return false;

  if((/^0x[0-9a-f]+$/i).test(arg))
    return true;

  return (/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(e[-+]?\d+)?$/).test(arg);
}


export function parseBufferEncoding(payload: Buffer, encoding?: unknown): Buffer | string {
  return typeof encoding === "string" && Buffer.isEncoding(encoding) ?
    payload.toString(encoding) :
    payload;
}


export function strShuffle(str: string): string {
  const arr = str.split("");

  for(let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr.join("");
}


export function choose<T>(arr: T[]): T;
export function choose(str: string): string;
export function choose<T>(val: T[] | string): T | string {
  return val[Math.floor(Math.random() * val.length - 1)];
}


export function isIterable<T>(arg: unknown): arg is Iterable<T> {
  return !!arg && typeof arg === "object" && typeof (arg as any)[Symbol.iterator] === "function";
}

export function isAsyncIterable<T>(arg: unknown): arg is Iterable<T> {
  return !!arg && typeof arg === "object" && typeof (arg as any)[Symbol.asyncIterator] === "function";
}


const kindOf = (cache => (thing: unknown) => {
  const str = Object.prototype.toString.call(thing);
  return cache[str] || (cache[str] = str.slice(8, -1).toLowerCase());
})(Object.create(null));


export const kindOfTest = (type: string) => {
  type = type.toLowerCase();
  return (thing: unknown) => kindOf(thing) === type;
};


export function isPlainObject(val: any): boolean {
  if(Array.isArray(val)) return false;
  if(kindOf(val) !== "object" || typeof val !== "object") return false;

  const prototype = Object.getPrototypeOf(val);
  return (prototype === null || prototype === Object.prototype || Object.getPrototypeOf(prototype) === null) && !(Symbol.toStringTag in val) && !(Symbol.iterator in val);
}


export function assert(c: unknown, msg?: string): asserts c {
  if(!c) {
    throw new Exception(msg ?? `Assertation failed for 'typeof ${typeof c}'`, "ERR_ASSERTATION_FAILED");
  }
}


export function immediate<TArgs extends any[]>(callback: (...args: TArgs) => void, ...args: TArgs): { dispose(): void } & Disposable {
  const hasNativeMethod = typeof setImmediate === "function";
  const id = hasNativeMethod ? setImmediate(callback, ...args) : setTimeout(callback, 0, ...args);

  return {
    dispose() {
      if(hasNativeMethod) {
        clearImmediate(id as NodeJS.Immediate);
      } else {
        clearTimeout(id as NodeJS.Timeout);
      }
    },

    [Symbol.dispose]() {
      if(hasNativeMethod) {
        clearImmediate(id as NodeJS.Immediate);
      } else {
        clearTimeout(id as NodeJS.Timeout);
      }
    },
  };
}
