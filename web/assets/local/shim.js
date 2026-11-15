/* The little of Node's Buffer that server/app.js touches, for running it in the browser. */
class Buf extends Uint8Array {
  static from(v) {
    if (v instanceof ArrayBuffer) return new Buf(v);
    if (ArrayBuffer.isView(v)) return new Buf(v.buffer, v.byteOffset, v.byteLength);
    if (typeof v === "string") return new Buf(new TextEncoder().encode(v));
    return new Buf(Uint8Array.from(v));
  }
  equals(o) { return this.length === o.length && this.every((b, i) => b === o[i]); }
  toString(enc) {
    if (enc === "latin1" || enc === "ascii" || enc === "binary") { let s = ""; for (const b of this) s += String.fromCharCode(b); return s; }
    return new TextDecoder().decode(this);
  }
}
globalThis.Buffer ??= Buf;
