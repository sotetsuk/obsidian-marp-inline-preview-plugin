// 32-bit FNV-1a hash. Not cryptographic — used purely to detect whether the
// rendered Marp output for a given preview sizer needs to be redone.
export function fnv1a32(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}
