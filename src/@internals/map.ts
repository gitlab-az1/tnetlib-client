import { Exception } from "./errors";


interface MapItem<K, V> {
  previous: MapItem<K, V> | null;
  next: MapItem<K, V> | null;
  key: K;
  value: V;
}

export const enum Touch {
  None,
  AsOld,
  AsNew,
}


export class LinkedMap<K, V> implements Map<K, V> {
  public static from<K extends string | number | symbol, V>(o?: Record<K, V> | null): LinkedMap<K, V>;
  public static from<K, V>(iterable?: Iterable<[K, V]> | null): LinkedMap<K, V>;
  public static from(resource?: any): LinkedMap<any, any> {
    const map = new LinkedMap<any, any>();

    // eslint-disable-next-line no-extra-boolean-cast
    if(!!resource) {
      if(typeof resource[Symbol.iterator] === "function") {
        for(const result of resource as Iterable<any[]>) {
          if(!Array.isArray(result) || !result[0]) {
            throw new Exception("This iterable resource does not return a object entry", "ERR_INVALID_TYPE");
          }

          map.set(result[0], result[1]);
        }
      } else if(typeof resource === "object") {
        for(const key in resource) {
          if(!Object.prototype.hasOwnProperty.call(resource, key))
            continue;

          map.set(key, resource[key]);
        }
      } else {
        throw new Exception("Couldn't build a LinkedMap with unsupported input type", "ERR_INVALID_TYPE");
      }
    }

    return map;
  }

  private readonly _map: Map<K, MapItem<K, V>>;
  private _head: MapItem<K, V> | null;
  private _tail: MapItem<K, V> | null;
  private _size: number;
  private _currentState: number;

  public constructor(iterable?: Iterable<[K, V]>) {
    this._map = new Map();
    
    this._head = null;
    this._tail = null;
    this._size = 0;
    this._currentState = 0;

    // eslint-disable-next-line no-extra-boolean-cast
    if(!!iterable) {
      for(const [key, value] of iterable) {
        this.set(key, value);
      }
    }
  }

  public get size(): number {
    return this._size;
  }

  public get first(): V | undefined {
    return this._head?.value;
  }

  public get last(): V | undefined {
    return this._tail?.value;
  }

  public has(key: K): boolean {
    return this._map.has(key);
  }

  public get(key: K, touch: Touch = Touch.None): V | undefined {
    const item = this._map.get(key);

    if(!item)
      return void 0;

    if(touch !== Touch.None) {
      this._touch(item, touch);
    }

    return item.value;
  }

  public set(key: K, value: V, touch: Touch = Touch.None): this {
    let item = this._map.get(key);

    if(!item) {
      item = { key, value, next: null, previous: null };

      switch(touch) {
        case Touch.AsOld:
          this._addItemFirst(item);
          break;
        case Touch.None:
        case Touch.AsNew:
        default:
          this._addItemLast(item);
          break;
      }

      this._map.set(key, item);
      this._size++;
    } else {
      item.value = value;

      if(touch !== Touch.None) {
        this._touch(item, touch);
      }
    }

    return this;
  }

  public delete(key: K): boolean {
    return !!this.remove(key);
  }

  public remove(key: K): V | undefined {
    const item = this._map.get(key);

    if(!item)
      return void 0;

    this._map.delete(key);
    this._removeItem(item);
    this._size--;

    return item.value;
  }

  public shift(): V | undefined {
    if(!this._head && !this._tail)
      return void 0;

    if(!this._head || !this._tail) {
      throw new Exception("An internal error was occured with LinkedMap", "ERR_UNKNOWN_ERROR");
    }

    const item = this._head;

    this._map.delete(item.key);
    this._removeItem(item);
    this._size--;

    return item.value;
  }

  public isEmpty(): boolean {
    return !this._head && !this._tail;
  }

  public clear(): void {
    this._map.clear();
    
    this._head = null;
    this._tail = null;
    this._size = 0;
    this._currentState++;
  }

  public keys(): IterableIterator<K> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const map = this;
    const state = this._currentState;

    let current = this._head;

    const iterator: IterableIterator<K> = {
      [Symbol.iterator]() {
        return iterator;
      },

      next(): IteratorResult<K> {
        if(map._currentState !== state) {
          throw new Exception("LinkedMap got modified during iteration");
        }

        if(!current)
          return { value: void 0, done: true };

        const result = {
          value: current.key,
          done: false,
        };

        current = current.next;
        return result;
      },
    };

    return iterator;
  }

  public values(): IterableIterator<V> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const map = this;
    const state = this._currentState;

    let current = this._head;

    const iterator: IterableIterator<V> = {
      [Symbol.iterator]() {
        return iterator;
      },

      next(): IteratorResult<V> {
        if(map._currentState !== state) {
          throw new Exception("LinkedMap got modified during iteration");
        }

        if(!current)
          return { value: void 0, done: true };

        const result = {
          value: current.value,
          done: false,
        };

        current = current.next;
        return result;
      },
    };

    return iterator;
  }

  public entries(): IterableIterator<[K, V]> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const map = this;
    const state = this._currentState;

    let current = this._head;

    const iterator: IterableIterator<[K, V]> = {
      [Symbol.iterator]() {
        return iterator;
      },

      next(): IteratorResult<[K, V]> {
        if(map._currentState !== state) {
          throw new Exception("LinkedMap got modified during iteration");
        }

        if(!current)
          return { value: void 0, done: true };

        const result = {
          value: [current.key, current.value],
          done: false,
        } as const satisfies IteratorResult<[K, V]>;

        current = current.next;
        return result;
      },
    };

    return iterator;
  }

  public forEach(
    callback: (value: V, key: K, map: LinkedMap<K, V>) => unknown,
    thisArg?: any // eslint-disable-line comma-dangle
  ): void {
    const state = this._currentState;
    let current = this._head;

    while(current) {
      if(!thisArg) {
        callback(current.value, current.key, this);
      } else {
        callback.bind(thisArg)(current.value, current.key, this);
      }

      if(this._currentState !== state) {
        throw new Exception("LinkedMap got modified during iteration");
      }

      current = current.next;
    }
  }

  public toJSON(): [K, V][] {
    const entries: [K, V][] = [];

    this.forEach((value, key) => {
      entries.push([key, value]);
    });

    return entries;
  }

  protected _trimOld(size: number): void {
    if(size >= this._size)
      return;

    if(size === 0) {
      this.clear();
      return;
    }

    let current = this._head;
    let csize = this._size;

    while(current && csize > size) {
      this._map.delete(current.key);
      current = current.next;
      csize--;
    }

    this._head = current;
    this._size = csize;

    if(current) {
      current.previous = null;
    }

    this._currentState++;
  }

  protected _trimNew(size: number): void {
    if(size >= this._size)
      return;

    if(size === 0) {
      this.clear();
      return;
    }

    let current = this._tail;
    let csize = this._size;

    while(current && csize > size) {
      this._map.delete(current.key);
      current = current.previous;
      csize--;
    }

    this._tail = current;
    this._size = csize;

    if(current) {
      current.next = null;
    }

    this._currentState++;
  }

  protected _addItemFirst(item: MapItem<K, V>): void {
    if(!this._head && !this._tail) {
      this._tail = item;
    } else if(!this._head) {
      throw new Exception("An internal error was occured with LinkedMap", "ERR_UNKNOWN_ERROR");
    } else {
      item.next = this._head;
      this._head.previous = item;
    }

    this._head = item;
    this._currentState++;
  }

  protected _addItemLast(item: MapItem<K, V>): void {
    if(!this._head && !this._tail) {
      this._head = item;
    } else if(!this._tail) {
      throw new Exception("An internal error was occured with LinkedMap", "ERR_UNKNOWN_ERROR");
    } else {
      item.previous = this._tail;
      this._tail.next = item;
    }

    this._tail = item;
    this._currentState++;
  }

  private _removeItem(item: MapItem<K, V>): void {
    if(item === this._head && item === this._tail) {
      this._head = null;
      this._tail = null;
    } else if(item === this._head) {
      if(!item.next) {
        throw new Exception("An internal error was occured with LinkedMap", "ERR_UNKNOWN_ERROR");
      }

      item.next.previous = null;
      this._head = item.next;
    } else if(this._tail === item) {
      if(!item.previous) {
        throw new Exception("An internal error was occured with LinkedMap", "ERR_UNKNOWN_ERROR");
      }

      item.previous.next = null;
      this._tail = item.previous;
    } else {
      const prev = item.previous;
      const next = item.next;

      if(!prev || !next) {
        throw new Exception("An internal error was occured with LinkedMap", "ERR_UNKNOWN_ERROR");
      }

      next.next = next;
      next.previous = prev;
    }

    item.next = null;
    item.previous = null;
    this._currentState++;
  }

  private _touch(item: MapItem<K, V>, touch: Touch): void {
    if(!this._head || !this._tail) {
      throw new Exception("An internal error was occured with LinkedMap", "ERR_UNKNOWN_ERROR");
    }

    if(touch !== Touch.AsOld && touch !== Touch.AsNew)
      return;

    if(touch === Touch.AsOld) {
      if(item === this._head)
        return;

      const prev = item.previous;
      const next = item.next;

      if(item === this._tail) {
        prev!.next = null;
        this._tail = prev;
      } else {
        next!.previous = prev;
        prev!.next = next;
      }

      item.previous = null;
      item.next = this._head;

      this._head.previous = item;
      this._head = item;

      this._currentState++;
    } else if(touch === Touch.AsNew) {
      if(item === this._tail)
        return;

      const prev = item.previous;
      const next = item.next;

      if(item === this._head) {
        next!.previous = null;
        this._head = next;
      } else {
        next!.previous = prev;
        prev!.next = next;
      }

      item.next = null;
      item.previous = this._tail;

      this._tail.next = item;
      this._tail = item;

      this._currentState++;
    }
  }

  public get [Symbol.toStringTag](): string {
    return `LinkedMap (${this._size})`;
  }

  public [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }
}


export class SetMap<K, V> {
  private readonly _map: Map<K, Set<V>> = new Map();

  public add(key: K, value: V): void {
    let values = this._map.get(key);

    if(!values) {
      values = new Set();
      this._map.set(key, values);
    }

    values.add(value);
  }

  public delete(key: K, value: V): boolean {
    const values = this._map.get(key);

    if(!values)
      return false;

    const r = values.delete(value);

    if(values.size === 0) {
      this._map.delete(key);
    }

    return r;
  }

  public remove(key: K): void {
    this._map.delete(key);
  }

  public get(key: K): ReadonlySet<V> {
    return this._map.get(key) ?? new Set();
  }

  public clear(): void {
    this._map.clear();
  }

  public count(key: K): number {
    return this.get(key).size;
  }

  public forEach(callback: (value: V, key: K) => unknown): void;
  public forEach(key: K, callback: (value: V, key: K) => unknown): void;
  public forEach(
    keyOrCallback: K | ((value: V, key: K) => unknown),
    callback?: (value: V, key: K) => unknown // eslint-disable-line comma-dangle
  ): void {
    if(typeof callback === "function") {
      const values = this._map.get(keyOrCallback as K);

      if(!values)
        return;

      values.forEach(x => callback(x, keyOrCallback as K));
    } else {
      if(typeof keyOrCallback !== "function") {
        throw new Exception("The \"forEach\" argument must be a function", "ERR_INVALID_ARGUMENT");
      }

      for(const [key, set] of this._map.entries()) {
        set.forEach(x => (keyOrCallback as (value: V, key: K) => unknown)(x, key));
      }
    }
  }

  public [Symbol.iterator](): IterableIterator<readonly [K, ReadonlySet<V>]> {
    return this._map.entries();
  }
}
