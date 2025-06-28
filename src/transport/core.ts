import { Exception } from "../@internals/errors";
import { IDisposable } from "../@internals/disposable";
import type { BufferLike } from "../@internals/_types";
import { concatBuffers, maskBuffer, timingSafeEqual } from "../@internals/util";
import TransportKeyObject, { TRANSPORT_STRATEGY } from "./key-object";
import { BinaryReader, BinaryWriter, chunkToBuffer, deserialize, serialize } from "../@internals/binary-protocol";


const PACKET_MAGIC_BUFFER = Uint8Array.from([
  0x0, 0x54, 0x4E, 0x45,
  0x54, 0x4C, 0x49, 0x42,
  0x53, 0x45, 0x43, 0x55,
  0x52, 0x45, 0x50, 0x41,
  0x43, 0x4B, 0x45, 0x54,
]);


type TransportPayload = 
  | { type: "dict"; pairs: [string, unknown][] }
  | { type: "raw"; writer: BinaryWriter }
  | { type: "native"; value: unknown };


export class Transporter implements IDisposable {
  #payload: TransportPayload;
  readonly #key: TransportKeyObject;
  #state: { disposed: boolean; maskBytes: number | Uint8Array; };

  public constructor(key: TransportKeyObject);
  public constructor(key: BufferLike, strategy?: TRANSPORT_STRATEGY); 
  public constructor(keyOrSource?: BufferLike | TransportKeyObject, s?: TRANSPORT_STRATEGY) {
    if(keyOrSource instanceof TransportKeyObject) {
      this.#key = keyOrSource;
    } else {
      this.#key = new TransportKeyObject(keyOrSource as BufferLike, s);
    }

    this.#state = { disposed: false, maskBytes: getDefaultMask() };
    this.#payload = { type: "raw", writer: new BinaryWriter() };
  }

  public setMaskBytes(mask: Uint8Array | number): this {
    this.#ensureNotDisposed();
    this.#state.maskBytes = mask;
    
    return this;
  }

  public getMaskBytes(): Uint8Array | number {
    this.#ensureNotDisposed();
    return this.#state.maskBytes;
  }

  public write(chunk: BufferLike): this {
    this.#ensureNotDisposed();

    if(this.#payload.type !== "raw") {
      this.#payload = {
        type: "raw",
        writer: new BinaryWriter(),
      };
    }

    this.#payload.writer.write(chunk);
    return this;
  }

  public append(key: string, value: unknown): this {
    this.#ensureNotDisposed();

    if(this.#payload.type !== "dict") {
      this.#payload = {
        type: "dict",
        pairs: [],
      };
    }

    this.#payload.pairs.push([key, value]);
    return this;
  }

  public setPayload(value: unknown): this {
    this.#ensureNotDisposed();

    this.#payload = {
      type: "native",
      value,
    };

    return this;
  }

  public bytes(): Uint8Array {
    this.#ensureNotDisposed();
    return this.#toBytes();
  }

  public return(): Promise<Uint8Array> {
    this.#ensureNotDisposed();
    return createPacket(this.#toBytes(), this.#key, this.#state.maskBytes);
  }

  public dispose(): void {
    if(!this.#state.disposed) {
      this.#state.disposed = true;

      this.#key.dispose();
      this.#payload = null!;
      this.#state.maskBytes = null!;
    }
  }

  #ensureNotDisposed(): void {
    if(this.#state.disposed) {
      throw new Exception("This Transporter is already disposed and cannot be used anymore", "ERR_RESOURCE_DISPOSED");
    }
  }

  #toBytes(): Uint8Array {
    const writer = new BinaryWriter();

    switch(this.#payload.type) {
      case "dict":
        serialize(writer, this.#payload.pairs);
        break;
      case "native":
        serialize(writer, this.#payload.value);
        break;
      case "raw":
        serialize(writer, this.#payload.writer.buffer);
        break;
    }

    return writer.drain();
  }
}


export async function createPacket(
  payload: BufferLike,
  key: TransportKeyObject,
  mask: Uint8Array | number // eslint-disable-line comma-dangle
): Promise<Uint8Array> {
  const iv = key.generateRandomIV();
  let sk: Uint8Array | undefined = void 0;

  try {
    sk = key.signK();
  } catch {
    sk = void 0;
  }

  switch(key.strategy) {
    case TRANSPORT_STRATEGY.K_DHAC_K64: {
      const writer = new BinaryWriter();
      const signature = await sign(payload, sk);

      if(typeof process !== "undefined") {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { createCipheriv } = require("node:crypto") as typeof import("node:crypto");

        const cipher = createCipheriv("aes-256-ctr", key.master(), iv);
        const enc = Buffer.concat([ cipher.update(chunkToBuffer(payload)), cipher.final() ]);

        serialize(writer, enc);
        serialize(writer, signature);
        serialize(writer, maskBuffer(iv, mask));
      } else if(typeof window === "undefined" || !window.crypto.subtle) {
        throw new Exception("Failed to load crypto API in current environment");
      } else {
        const ek = await window.crypto.subtle.importKey(
          "raw",
          key.master(),
          { name: "AES-CTR" },
          false,
          ["encrypt"] // eslint-disable-line comma-dangle
        );

        const enc = await window.crypto.subtle.encrypt(
          {
            name: "AES-CTR",
            counter: iv,
            length: 64,
          },
          ek,
          chunkToBuffer(payload) // eslint-disable-line comma-dangle
        );

        serialize(writer, enc);
        serialize(writer, signature);
        serialize(writer, maskBuffer(iv, mask));
      }

      return concatBuffers(PACKET_MAGIC_BUFFER, writer.drain());
    } break;
    default:
      throw new Exception(`Unsupported transport strategy (0x${key.strategy.toString(16)})`, "ERR_INVALID_ARGUMENT");
  }
}


export async function unwrapPacket<T = unknown>(
  payload: BufferLike,
  key: TransportKeyObject,
  mask: Uint8Array | number // eslint-disable-line comma-dangle
): Promise<T> {
  let signKey: Uint8Array | undefined = void 0;

  const buffer = chunkToBuffer(payload);

  if(!isSecurePacket(buffer)) {
    throw new Exception("The provided binary source doesn't appear to be a secure packet", "ERR_MARIGC_NUMNER_MISMATCH");
  }

  const reader = new BinaryReader(buffer.slice(PACKET_MAGIC_BUFFER.length));

  try {
    signKey = key.signK();
  } catch {
    signKey = void 0;
  }

  switch(key.strategy) {
    case TRANSPORT_STRATEGY.K_DHAC_K64: {
      const ec = deserialize<Uint8Array>(reader);
      const sg = deserialize<Uint8Array>(reader);
      const iv = deserialize<Uint8Array>(reader);
      
      if(
        !(ec instanceof Uint8Array) ||
        !(sg instanceof Uint8Array) ||
        !(iv instanceof Uint8Array) 
      ) {
        throw new Exception("This entry is not a valid packet format");
      }

      const ivBuffer = maskBuffer(iv, mask);
      let dec: Uint8Array;

      if(typeof process !== "undefined") {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { createDecipheriv } = require("node:crypto") as typeof import("node:crypto");
        const decipher = createDecipheriv("aes-256-ctr", key.master(), ivBuffer);

        dec = Buffer.concat([
          decipher.update(ec),
          decipher.final(),
        ]);
      } else if(typeof window === "undefined" || !window.crypto.subtle) {
        throw new Exception("Failed to load crypto API in current environment");
      } else {
        const ek = await window.crypto.subtle.importKey(
          "raw",
          key.master(),
          { name: "AES-CTR" },
          false,
          ["decrypt"] // eslint-disable-line comma-dangle
        );

        const decBuffer = await window.crypto.subtle.decrypt(
          {
            name: "AES-CTR",
            counter: iv,
            length: 64,
          },
          ek,
          ec // eslint-disable-line comma-dangle
        );

        dec = new Uint8Array(decBuffer);
      }

      const computedSign = await sign(dec, signKey);

      if(!timingSafeEqual(computedSign, sg)) {
        throw new Exception("Failed to validate integrity of packet", "ERR_INVALID_SIGNATURE");
      }

      const raw = deserialize<any>(new BinaryReader(dec));

      if(Array.isArray(raw) && (raw.length > 0 ? Array.isArray(raw[0]) : true)) {
        const obj: Record<string, unknown> = {};

        for(let i = 0; i < raw.length; i++) {
          obj[raw[i][0]] = raw[i][1];
        }

        return obj as T;
      }

      return raw as T;
    } break;
    default:
      throw new Exception(`Unsupported transport strategy (0x${key.strategy.toString(16)})`, "ERR_INVALID_ARGUMENT");
  }
}


export async function sign(
  content: BufferLike,
  key?: BufferLike // eslint-disable-line comma-dangle
): Promise<Uint8Array> {
  const payload = chunkToBuffer(content);

  if(typeof process !== "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { hash, createHmac } = require("node:crypto") as typeof import("node:crypto");

    if(!key)
      return hash("sha512", payload, "buffer");

    return createHmac("sha512", chunkToBuffer(key))
      .update(payload)
      .digest();
  }

  if(typeof window === "undefined" || !window.crypto.subtle) {
    throw new Exception("Failed to load crypto API in current environment");
  }

  if(!key) {
    const hash = await window.crypto.subtle.digest("SHA-512", payload);
    return new Uint8Array(hash);
  }

  const sk = await window.crypto.subtle.importKey(
    "raw",
    chunkToBuffer(key),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"] // eslint-disable-line comma-dangle
  );

  const sign = await window.crypto.subtle.sign("HMAC", sk, payload);
  return new Uint8Array(sign);
}


export function isSecurePacket(source: BufferLike): boolean {
  return timingSafeEqual(
    chunkToBuffer(source).slice(0, PACKET_MAGIC_BUFFER.length),
    PACKET_MAGIC_BUFFER // eslint-disable-line comma-dangle
  );
}


export function getDefaultMask(): number {
  return 0x5EC7BF;
}
