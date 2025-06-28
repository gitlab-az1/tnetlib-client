import { immediate } from "./util";
import type { LooseAutocomplete } from "./_types";


export enum ERROR_CODE {
  ERR_UNKNOWN_ERROR = 100,
  ERR_ONCE_WAS_CALLED_AGAIN = 101,
  ERR_TOKEN_CANCELLED = 102,
  ERR_RESOURCE_DISPOSED = 103,
  ERR_LISTENER_LEAK = 104,
  ERR_INVALID_ARGUMENT = 105,
  ERR_INVALID_TYPE = 106,
  ERR_LISTENER_REFUSAL = 107,
  ERR_READYSTATE_UPDATED = 108,
  ERR_END_OF_STREAM = 109,
  ERR_ASSERTATION_FAILED = 110,
}


export class Exception extends Error {
  public readonly code: number;
  public override readonly name: string;
  public override readonly message: string;

  public constructor(
    message: string,
    code: LooseAutocomplete<keyof typeof ERROR_CODE> | number = "ERR_UNKNOWN_ERROR",
    options?: { overrideStack?: string } // eslint-disable-line comma-dangle
  ) {
    super(message);

    this.name = "Exception";
    this.message = message;
    
    if(typeof code !== "number") {
      this.code = -(ERROR_CODE[code as keyof typeof ERROR_CODE ?? "ERR_UNKNOWN_ERROR"] ?? ERROR_CODE.ERR_UNKNOWN_ERROR);
    } else {
      this.code = -Math.abs(code);
    }

    if(!!options?.overrideStack && typeof options.overrideStack === "string") {
      this.stack = options.overrideStack;
    }
  }

  public getErrorCode(): string {
    return ERROR_CODE[-this.code] ?? "ERR_UNKNOWN_ERROR";
  }

  public is(code: number | keyof typeof ERROR_CODE): boolean {
    if(typeof code === "number")
      return this.code === -Math.abs(code);

    if(!(code in ERROR_CODE))
      return false;

    return this.code === -ERROR_CODE[code];
  }
}


export function onUnexpected(err: unknown): void {
  immediate(() => {
    if(err instanceof Exception) {
      err = new Error(`[${err.getErrorCode()}] ${err.message}\n\n${err.stack?.toString()}`.trim());
    }

    throw err;
  });
}
