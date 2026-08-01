const MASK_64 = 0xffffffffffffffffn;
const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const SPLITMIX_INCREMENT = 0x9e3779b97f4a7c15n;
const textEncoder = new TextEncoder();

const uint64 = (value) => value & MASK_64;

export const fnv1a64 = (bytes) => {
  let hash = FNV_OFFSET_64;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = uint64(hash * FNV_PRIME_64);
  }
  return hash;
};

export const splitMix64 = (state) => {
  const nextState = uint64(state + SPLITMIX_INCREMENT);
  let output = nextState;
  output = uint64((output ^ (output >> 30n)) * 0xbf58476d1ce4e5b9n);
  output = uint64((output ^ (output >> 27n)) * 0x94d049bb133111ebn);
  output ^= output >> 31n;
  return { state: nextState, output: uint64(output) };
};

const encodeSeedParts = (parts) => {
  const encoded = parts.map((part) => textEncoder.encode(String(part)));
  const size = encoded.reduce((total, bytes) => total + 8 + bytes.length, 0);
  const result = new Uint8Array(size);
  const view = new DataView(result.buffer);
  let offset = 0;
  for (const bytes of encoded) {
    view.setBigUint64(offset, BigInt(bytes.length), false);
    offset += 8;
    result.set(bytes, offset);
    offset += bytes.length;
  }
  return result;
};

export const deriveRandomState = (parts) => fnv1a64(encodeSeedParts(parts));

export const deterministicRandomUnit = (parts, counter = 0) => {
  if (!Number.isSafeInteger(counter) || counter < 0) {
    throw new Error("random counter must be a non-negative safe integer.");
  }
  let state = deriveRandomState(parts);
  let output = 0n;
  for (let index = 0; index <= counter; index++) {
    ({ state, output } = splitMix64(state));
  }
  return Number(output >> 11n) / 2 ** 53;
};

export const randomStateHex = (value) =>
  `0x${value.toString(16).padStart(16, "0")}`;
