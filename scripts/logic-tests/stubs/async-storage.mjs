// In-memory stand-in for AsyncStorage in the Node logic tests.

const data = new Map();

/** Test controls. */
export const __storage = {
  data,
  failReads: false,
  failWrites: false,
  /** Every setItem that landed, in landing order, as [key, value]. */
  writes: [],
  /**
   * Optional hook awaited before a setItem lands: (key, value) => void | Promise.
   * A test can return a promise to hold a write back, or throw to fail just that write.
   */
  beforeWrite: null,
  reset() {
    data.clear();
    this.failReads = false;
    this.failWrites = false;
    this.writes = [];
    this.beforeWrite = null;
  },
};

const AsyncStorage = {
  async getItem(key) {
    if (__storage.failReads) throw new Error('read failed (stub)');
    // Like the real module: a missing key and a stored empty string both read as null.
    return data.get(key) || null;
  },
  async setItem(key, value) {
    if (typeof value !== 'string') throw new Error('setItem needs a string value (stub)');
    if (__storage.beforeWrite) await __storage.beforeWrite(key, value);
    if (__storage.failWrites) throw new Error('write failed (stub)');
    data.set(key, value);
    __storage.writes.push([key, value]);
  },
  async removeItem(key) {
    if (__storage.failWrites) throw new Error('write failed (stub)');
    data.delete(key);
  },
};

export default AsyncStorage;
