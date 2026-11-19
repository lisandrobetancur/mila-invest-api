/**
 * PRNG determinístico del motor de precios (§8.5).
 *
 * `mulberry32` solo usa aritmética entera de 32 bits (`Math.imul` y
 * corrimientos), así que la secuencia es idéntica en cualquier máquina. La
 * semilla sale de los primeros 4 bytes de `sha256(seed|instrument_id|día)`.
 *
 * No se usa el generador aleatorio global de JavaScript, que no admite semilla.
 */
import { createHash } from 'node:crypto';

export const UINT32_RANGE = 4_294_967_296;

/** Devuelve un generador de enteros uniformes en `[0, 2^32)`. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return (mixed ^ (mixed >>> 14)) >>> 0;
  };
}

/** Semilla de 32 bits para un instrumento en un día (`YYYY-MM-DD` local del mercado). */
export function seedFor(priceSeed: string, instrumentId: string, day: string): number {
  return createHash('sha256')
    .update(`${priceSeed}|${instrumentId}|${day}`, 'utf8')
    .digest()
    .readUInt32BE(0);
}
