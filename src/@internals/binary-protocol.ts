import { Exception } from "./errors";
import type { BufferLike } from "./_types";
import { jsonSafeParser, jsonSafeStringify } from "./safe-json";


export interface IWriter<T = Uint8Array> {
  write(data: T): void;
  readonly byteLength: number;
}

export interface IReader<T = Uint8Array> {
  read(length?: number): T;
  readonly byteLength: number;
}


export class BinaryWriter implements IWriter<Uint8Array> {
  readonly #state = {
    buffers: [] as Uint8Array[],
    bytes: 0,
  };

  public get buffer(): Uint8Array {
    return this.#ConcatBuffers();
  }

  public get byteLength(): number {
    return this.#state.bytes;
  }

  public write(data: BufferLike) {
    const buffer = chunkToBuffer(data);

    this.#state.buffers.push(buffer);
    this.#state.bytes += buffer.length;
  }

  public drain(): Uint8Array {
    const result = this.#ConcatBuffers();

    this.#state.buffers.length = 0;
    this.#state.bytes = 0;

    return result;
  }

  #ConcatBuffers(): Uint8Array {
    const result = new Uint8Array(this.#state.bytes);
    let offset: number = 0;

    for(let i = 0; i < this.#state.buffers.length; i++) {
      const buffer = this.#state.buffers[i];

      result.set(buffer, offset);
      offset += buffer.length;
    }

    return result;
  }
}

export class BinaryReader implements IReader<Uint8Array> {
  readonly #state = {
    total: -1,
    cursor: 0,
  };

  #data: Uint8Array;

  public constructor(data: BufferLike) {
    this.#data = chunkToBuffer(data);
    this.#state.total = this.#data.length;
  }

  public get consumed(): number {
    return this.#state.cursor;
  }

  public get remaining(): number {
    return this.#data.length - this.#state.cursor;
  }

  public get byteLength(): number {
    return this.#state.total;
  }

  public get readable(): boolean {
    return this.#state.cursor < this.#data.length;
  }

  public read(length?: number): Uint8Array {
    const remaining = this.#data.length - this.#state.cursor;

    if(remaining < 1) {
      throw new Exception("The buffer has already been completely consumed", "ERR_END_OF_STREAM");
    }

    if(typeof length !== "number" || length < 1) {
      const out = this.#data.slice(this.#state.cursor);

      this.#state.cursor = this.#data.length;
      this.#data = null!;

      return out;
    }

    const len = Math.min(length | 0, remaining);
    const chunk = this.#data.slice(this.#state.cursor, this.#state.cursor + len);

    this.#state.cursor += len;
    return chunk;
  }

  public dispose(): void {
    this.#data = null!;
    
    this.#state.total = -1;
    this.#state.cursor = 0;
  }
}


export function chunkToBuffer(input: BufferLike): Uint8Array {
  if(typeof input === "string")
    return getEncoder().encode(input);

  if(typeof Buffer !== "undefined" && Buffer.isBuffer(input))
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);

  if(input instanceof Uint8Array)
    return input;

  if(ArrayBuffer.isView(input))
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);

  if(
    input instanceof ArrayBuffer ||
    input instanceof SharedArrayBuffer
  ) return new Uint8Array(input);

  throw new Exception("Unsupported buffer like input", "ERR_INVALID_TYPE");
}


export const enum SerializableDataType {
  Null = 0,
  String = 1,
  Uint = 2,
  Object = 3,
  Array = 4,
  MarshallObject = 5,
  Buffer = 6,
}

function createOneByteArray(value: number): Uint8Array {
  return Uint8Array.of(value);
}

const TypePresets: { readonly [K in keyof typeof SerializableDataType]: Uint8Array } = {
  Null: createOneByteArray(SerializableDataType.Null),
  String: createOneByteArray(SerializableDataType.String),
  Buffer: createOneByteArray(SerializableDataType.Buffer),
  Array: createOneByteArray(SerializableDataType.Array),
  Object: createOneByteArray(SerializableDataType.Object),
  Uint: createOneByteArray(SerializableDataType.Uint),
  MarshallObject: createOneByteArray(SerializableDataType.MarshallObject),
};



export function readIntVQL(reader: IReader): number {
  let value = 0;

  for(let shift = 0; ; shift += 7) {
    const next = reader.read(1)[0];
    value |= (next & 0x7F) << shift;

    if((next & 0x80) === 0)
      break;
  }

  return value;
}

const vqlZero = createOneByteArray(0);

export function writeInt32VQL(writer: IWriter, value: number): void {
  if(value === 0) {
    writer.write(vqlZero);
    return;
  }

  const result: number[] = [];

  while(value !== 0) {
    let byte = value & 0x7F;
    value >>>= 7;

    if(value > 0) {
      byte |= 0x80;
    }

    result.push(byte);
  }

  writer.write(Uint8Array.from(result));
}


export function serialize(writer: IWriter, data: unknown): void {
  if(data === null || typeof data === "undefined") {
    writer.write(TypePresets.Null);
  } else if(typeof data === "string") {
    const buffer = getEncoder().encode(data);

    writer.write(TypePresets.String);
    writeInt32VQL(writer, buffer.length);
    writer.write(buffer);
  } else if(data instanceof Uint8Array) {
    writer.write(TypePresets.Buffer);
    writeInt32VQL(writer, data.length);
    writer.write(data);
  } else if(typeof data === "number" && Number.isInteger(data)) {
    writer.write(TypePresets.Uint);
    writeInt32VQL(writer, data);
  } else if(Array.isArray(data)) {
    writer.write(TypePresets.Array);
    writeInt32VQL(writer, data.length);

    for(let i = 0; i < data.length; i++) {
      serialize(writer, data[i]);
    }
  } else {
    const json = jsonSafeStringify(data);

    if(json.isLeft()) {
      throw json.value;
    }

    const buffer = getEncoder().encode(json.value);

    writer.write(TypePresets.Object);
    writeInt32VQL(writer, buffer.length);
    writer.write(buffer);
  }
}

export function deserialize<T = any>(reader: IReader): T {
  const type = reader.read(1)[0];

  switch(type) {
    case SerializableDataType.Null:
      return null as T;
    case SerializableDataType.String: {
      const len = readIntVQL(reader);
      return new TextDecoder().decode(reader.read(len)) as T;
    } break;
    case SerializableDataType.Uint:
      return readIntVQL(reader) as T;
    case SerializableDataType.Buffer: {
      const len = readIntVQL(reader);
      return reader.read(len) as T;
    } break;
    case SerializableDataType.Array: {
      const len = readIntVQL(reader);
      const result = [];

      for(let i = 0; i < len; i++) {
        result.push(deserialize(reader));
      }

      return result as T;
    } break;
    case SerializableDataType.Object: {
      const len = readIntVQL(reader);
      const json = getDecoder().decode(reader.read(len));
      const parsed = jsonSafeParser<T>(json);

      if(parsed.isLeft()) {
        throw parsed.value;
      }

      return parsed.value;
    }

    default:
      throw new Exception(`Unknown data type: 0x${type.toString(16).toUpperCase()}`, "ERR_INVALID_TYPE");
  }
}


let te: TextEncoder | null = null;
let td: TextDecoder | null = null;

function getEncoder(r: boolean = false): TextEncoder {
  if(!te) {
    te = new TextEncoder();
  }

  if(r) {
    te = new TextEncoder();
  }

  return te;
}


function getDecoder(r: boolean = false): TextDecoder {
  if(!td) {
    td = new TextDecoder();
  }

  if(r) {
    td = new TextDecoder();
  }

  return td;
}
