import { randomString } from "./@internals/util";


export type MultipartEntry = {
  readonly headers: Record<string, string | string[]>;
  readonly body: Blob;
};


export class UniversalFormData implements FormData {
  readonly #data: Map<string, [v: string | Blob | File, fn?: string | null | undefined][]>;

  public constructor(form?: HTMLFormElement, submitter?: HTMLElement | null) {
    this.#data = new Map();

    if(typeof window !== "undefined") {
      if(form instanceof HTMLFormElement) {
        const elements = Array.from(form.elements) as (HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)[];

        for(let i = 0; i < elements.length; i++) {
          const el = elements[i];

          if(!el.name || el.disabled)
            continue;

          if(
            el instanceof HTMLInputElement &&
            (el.type === "submit" || el.type === "button")
          ) {
            if(submitter === el || (!submitter && el.type === "submit")) {
              this.append(el.name, el.value);
            }
          } else if(el instanceof HTMLInputElement && el.type === "file") {
            for(let i = 0; i < (el.files?.length ?? 0); i++) {
              const file = el.files?.item(i);

              if(!file) continue;
              this.append(el.name, file);
            }
          } else if(
            el instanceof HTMLInputElement &&
            (el.type === "checkbox" || el.type === "radio")
          ) {
            if(el.checked) {
              this.append(el.name, el.value);
            }
          } else if(el instanceof HTMLSelectElement) {
            for(const option of el.selectedOptions) {
              this.append(el.name, option.value);
            }
          } else {
            this.append(el.name, el.value);
          }
        }
      }
    }
  }

  public append(name: string, value: unknown, filename?: string): void {
    const entry = [
      normalizeFormValue(value),
      normalizeFormFilename(value, filename),
    ] as [string | Blob, string | undefined];

    const list = this.#data.get(name);

    if(!list) {
      this.#data.set(name, [entry]);
    } else {
      list.push(entry);
    }
  }

  public set(name: string, value: unknown, filename?: string): void {
    const entry = [
      normalizeFormValue(value),
      normalizeFormFilename(value, filename),
    ] as [string | Blob, string | undefined];

    this.#data.set(name, [entry]);
  }

  public get<T = unknown>(name: string): T | null {
    const values = this.#data.get(name);
    return (values?.[0]?.[0] as T) ?? null;
  }

  public getAll(name: string): (string | File)[] {
    return (this.#data.get(name) ?? []).map(item => item?.[0]) as any[];
  }

  public delete(name: string): void {
    this.#data.delete(name);
  }

  public has(name: string): boolean {
    return this.#data.has(name);
  }

  public *entries(): IterableIterator<[string, string | File]> {
    for(const [key, values] of this.#data.entries()) {
      for(const [value] of values) {
        yield [key, value as any];
      }
    }
  }

  public *keys(): IterableIterator<string> {
    for(const [key] of this.#data.entries()) {
      yield key;
    }
  }

  public *values(): IterableIterator<string | File> {
    for(const [, values] of this.#data.entries()) {
      yield* values.map(item => item[0]) as any;
    }
  }

  public forEach(
    callbackfn: (value: string | File, key: string, data: FormData) => unknown,
    thisArg?: any // eslint-disable-line comma-dangle
  ): void {
    for(const [key, values] of this.#data.entries()) {
      for(const [value] of values) {
        if(!thisArg) {
          callbackfn(value as any, key, this);
        } else {
          callbackfn.bind(thisArg)(value as any, key, this);
        }
      }
    }
  }

  public dispose(): void {
    this.#data.clear();
  }

  public get [Symbol.toStringTag](): string {
    return "[object UniversalFormData]";
  }

  public *[Symbol.iterator](): IterableIterator<[string, string | File]> {
    for(const [key, values] of this.#data.entries()) {
      for(const [value] of values) {
        yield [key, value as any];
      }
    }
  }
}


export function normalizeFormValue(value: unknown): string | Blob | File {
  if(
    typeof value === "string" ||
    value instanceof Blob ||
    value instanceof File
  ) return value;

  return String(value);
}

export function normalizeFormFilename(value: unknown, filename?: string): string | undefined {
  if(filename && typeof filename === "string")
    return filename;

  if(value instanceof File && value.name)
    return value.name;

  return void 0;
}


export function createFormData(form?: HTMLFormElement, submitter?: HTMLElement | null): FormData {
  if(
    typeof globalThis.FormData !== "undefined" &&
    typeof globalThis.FormData === "function"
  ) return globalThis.FormData.length > 0 ?
    new globalThis.FormData(form, submitter) :
    new globalThis.FormData();

  return new UniversalFormData(form, submitter);
}


export function parseMultipart(data: FormData): MultipartEntry {
  const boundary = `FormBounday${randomString()}`;
  const parts: (string | File | Blob)[] = [];

  for(const [key, value] of data.entries() as IterableIterator<[string, unknown]>) {
    parts.push(`--${boundary}\r\n`);

    if((value instanceof Blob) || (value instanceof File)) {
      const name = (value as File).name ?? "blob";
      const type = value.type || "application/octet-stream";

      parts.push(
        `Content-Disposition: form-data; name="${key}"; filename="${name}"\r\n` +
        `Content-Type: ${type}\r\n\r\n`,
        value,
        "\r\n" // eslint-disable-line comma-dangle
      );
    } else {
      parts.push(
        `Content-Disposition: form-data; name="${key}"\r\n\r\n`,
        String(value),
        "\r\n" // eslint-disable-line comma-dangle
      );
    }
  }
  
  parts.push(`--${boundary}--\r\n`);

  return {
    body: new Blob(parts),
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
  };
}
