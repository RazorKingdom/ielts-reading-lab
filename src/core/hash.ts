/** Deterministic, dependency-free content hash (FNV-1a, doubled for 64-bit-ish output). */

export function fnv1a(input: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i) & 0xff
    h = Math.imul(h, 0x01000193) >>> 0
    // also mix the high byte so non-ASCII text changes the digest
    const hi = (input.charCodeAt(i) >>> 8) & 0xff
    if (hi) {
      h ^= hi
      h = Math.imul(h, 0x01000193) >>> 0
    }
  }
  return h >>> 0
}

export function contentHash(input: string): string {
  const a = fnv1a(input, 0x811c9dc5).toString(16).padStart(8, '0')
  const b = fnv1a(input, 0x9e3779b9).toString(16).padStart(8, '0')
  return a + b
}

export function makeId(prefix: string): string {
  const time = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 10)
  const mix = fnv1a(time + rand).toString(36)
  return `${prefix}_${time}${rand}${mix}`
}
