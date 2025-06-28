import { Exception } from "../@internals/errors";
import { IDisposable } from "../@internals/disposable";
import type { BufferLike } from "../@internals/_types";
import { BinaryReader, chunkToBuffer } from "../@internals/binary-protocol";


export const enum TRANSPORT_STRATEGY {
  /** @default */
  K_DHAC_K64 = -2,
}


const $aLen = Symbol("kAlgLength");

type AlgorithmLengths = {
  master: number;
  signK: number;
  ivLength: number;
};


class TransportKeyObject implements IDisposable {
  readonly #state: { disposed: boolean };
  readonly #keyMaterial: BinaryReader;
  readonly #strategy: TRANSPORT_STRATEGY;
  #metadata: Record<symbol, unknown>;

  public constructor(key: BufferLike, strategy?: TRANSPORT_STRATEGY) {
    this.#keyMaterial = new BinaryReader(chunkToBuffer(key));
    this.#strategy = strategy ?? TRANSPORT_STRATEGY.K_DHAC_K64;

    this.#metadata = {};
    this.#state = { disposed: false };
  }

  public get strategy(): number {
    this.#ensureNotDisposed();
    return this.#strategy;
  }

  public master(c?: boolean): Uint8Array {
    const { master: masterLength } = this.#getAlgorithmLength();

    if(masterLength > this.#keyMaterial.byteLength) {
      throw new Exception("The provided key material is too short to extract `master`", "ERR_CRYPTO_KEY_SHORT");
    }

    return this.#keyMaterial[c ? "read" : "seek"](masterLength);
  }

  public signK(): Uint8Array {
    const { master: masterLength, signK: signKLength } = this.#getAlgorithmLength();

    if(masterLength + signKLength > this.#keyMaterial.byteLength) {
      throw new Exception("The provided key material is too short to extract `signK`", "ERR_CRYPTO_KEY_SHORT");
    }

    return this.#keyMaterial.seek(masterLength + signKLength, masterLength);
  }

  public generateRandomIV(): Uint8Array {
    const { ivLength } = this.#getAlgorithmLength();
    let target: Uint8Array | null = null;

    if(typeof process !== "undefined") {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { randomBytes } = require("node:crypto") as typeof import("node:crypto");
      target = randomBytes(ivLength);
    } else if(typeof window !== "undefined" && typeof window.crypto !== "undefined") {
      target = new Uint8Array(ivLength);
      window.crypto.getRandomValues(target);
    }

    if(!target) {
      throw new Exception("Failed to initialize crypto API to generate random bytes");
    }

    return target;
  }

  public dispose(): void {
    if(!this.#state.disposed) {
      this.#state.disposed = true;
      this.#keyMaterial.dispose();
      this.#metadata = null!;
    }
  }

  #getAlgorithmLength(): AlgorithmLengths {
    this.#ensureNotDisposed();
    const cached = this.#metadata[$aLen] as AlgorithmLengths | undefined;

    // eslint-disable-next-line no-extra-boolean-cast
    if(!!cached)
      return cached;

    const lengths: Record<TRANSPORT_STRATEGY, AlgorithmLengths> = {
      [TRANSPORT_STRATEGY.K_DHAC_K64]: {
        master: 32,
        ivLength: 16,
        signK: 48,
      },
    };

    const r = lengths[this.#strategy];

    if(!r) {
      throw new Exception("Something was wrong with TransportKeyObject");
    }

    this.#metadata[$aLen] = r;
    return r;
  }

  #ensureNotDisposed(): void {
    if(this.#state.disposed) {
      throw new Exception("This TransportKeyObject is already disposed and cannot be used anymore", "ERR_RESOURCE_DISPOSED");
    }
  }
}

export default TransportKeyObject;
