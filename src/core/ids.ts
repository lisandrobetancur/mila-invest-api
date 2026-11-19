/**
 * Ids opacos con prefijo (`usr_01H…`, `ord_01H…`).
 *
 * El cuerpo es un ULID (26 caracteres en base32 de Crockford): los primeros 10
 * codifican el milisegundo y los 16 restantes son aleatorios y monotónicos
 * dentro del mismo milisegundo, así que los ids crecen en el orden en que se
 * crean y desempatan el orden `created_at DESC, id DESC` de la paginación.
 *
 * El instante sale del `Clock` inyectado, nunca del reloj del sistema (regla 6).
 */
import { randomBytes } from 'node:crypto';
import type { Clock } from './clock.js';

export const ID_PREFIXES = {
  user: 'usr',
  account: 'acc',
  order: 'ord',
  transaction: 'txn',
  journal: 'jrn',
  entry: 'led',
  position: 'pos',
  refreshToken: 'rft',
  refreshFamily: 'rfm',
  idempotency: 'idm',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;
export type IdPrefix = (typeof ID_PREFIXES)[IdKind];

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID_LENGTH = 26;
const ULID_PATTERN = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;

const PREFIX_LIST = Object.values(ID_PREFIXES).join('|');
export const PREFIXED_ID_PATTERN = new RegExp(
  `^(?:${PREFIX_LIST})_[0-9ABCDEFGHJKMNPQRSTVWXYZ]{${String(ULID_LENGTH)}}$`,
);

/** Patrón de un id de un tipo concreto, para los schemas Joi de cada módulo. */
export function idPattern(kind: IdKind): RegExp {
  return new RegExp(`^${ID_PREFIXES[kind]}_[0-9ABCDEFGHJKMNPQRSTVWXYZ]{${String(ULID_LENGTH)}}$`);
}

function encodeTime(milliseconds: number): string {
  let rest = milliseconds;
  let out = '';
  for (let i = 0; i < 10; i += 1) {
    const index = rest % 32;
    out = `${CROCKFORD[index] ?? '0'}${out}`;
    rest = Math.floor(rest / 32);
  }
  return out;
}

const RANDOM_BITS = 80n;
const RANDOM_MAX = (1n << RANDOM_BITS) - 1n;

function randomPart(): bigint {
  return BigInt(`0x${randomBytes(10).toString('hex')}`);
}

function encodeRandom(value: bigint): string {
  let rest = value;
  let out = '';
  for (let i = 0; i < 16; i += 1) {
    out = `${CROCKFORD[Number.parseInt((rest % 32n).toString(), 10)] ?? '0'}${out}`;
    rest /= 32n;
  }
  return out;
}

export class IdGenerator {
  private lastTime = -1;
  private lastRandom = 0n;

  public constructor(private readonly clock: Clock) {}

  /**
   * ULID monotónico: dentro del mismo milisegundo la parte aleatoria se
   * incrementa en 1, así los ids de un proceso crecen en el orden en que se
   * generan (también con el reloj congelado de los tests y de `_testing`).
   */
  public ulid(): string {
    const time = this.clock.now().getTime();
    if (time === this.lastTime && this.lastRandom < RANDOM_MAX) {
      this.lastRandom += 1n;
    } else {
      this.lastTime = time;
      this.lastRandom = randomPart();
    }
    return `${encodeTime(time)}${encodeRandom(this.lastRandom)}`;
  }

  public next(kind: IdKind): string {
    return `${ID_PREFIXES[kind]}_${this.ulid()}`;
  }
}

export function isPrefixedId(value: unknown, kind?: IdKind): value is string {
  if (typeof value !== 'string') return false;
  const [prefix, body, ...extra] = value.split('_');
  if (prefix === undefined || body === undefined || extra.length > 0) return false;
  if (!ULID_PATTERN.test(body)) return false;
  if (kind !== undefined) return prefix === ID_PREFIXES[kind];
  return (Object.values(ID_PREFIXES) as string[]).includes(prefix);
}
