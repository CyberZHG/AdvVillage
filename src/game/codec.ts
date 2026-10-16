// Light obfuscation for saves: XOR with a seeded keystream plus a checksum, so casual edits are
// rejected. Not meant to resist a determined reader, only to keep honest players honest.

const MAGIC = 'AV1';
const SECRET = 'AdvVillage/save/keystream/v1';

function fnv(bytes: Uint8Array, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (const b of bytes) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

function xorStream(bytes: Uint8Array, seed: number): Uint8Array {
  const out = new Uint8Array(bytes.length);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < bytes.length; i++) {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    out[i] = bytes[i] ^ (s & 255);
  }
  return out;
}

const SECRET_HASH = fnv(new TextEncoder().encode(SECRET));
const hex8 = (n: number) => (n >>> 0).toString(16).padStart(8, '0');

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encode(text: string): string {
  const plain = new TextEncoder().encode(text);
  const nonce = (Math.random() * 0xffffffff) >>> 0;
  const sum = fnv(plain, SECRET_HASH);
  return MAGIC + hex8(nonce) + hex8(sum) + toBase64(xorStream(plain, SECRET_HASH ^ nonce));
}

export function decode(data: string): string {
  data = data.trim();
  if (data.startsWith('{')) return data;
  if (!data.startsWith(MAGIC)) throw new Error('bad format');
  const nonce = parseInt(data.slice(3, 11), 16), sum = parseInt(data.slice(11, 19), 16);
  const plain = xorStream(fromBase64(data.slice(19).replace(/\s+/g, '')), SECRET_HASH ^ nonce);
  if (fnv(plain, SECRET_HASH) !== sum) throw new Error('checksum');
  return new TextDecoder().decode(plain);
}
