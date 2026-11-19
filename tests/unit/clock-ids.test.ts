import { describe, expect, it } from 'vitest';
import {
  ControllableClock,
  FrozenClock,
  SystemClock,
  isControllableClock,
  toIsoUtc,
} from '../../src/core/clock.js';
import {
  ID_PREFIXES,
  IdGenerator,
  PREFIXED_ID_PATTERN,
  idPattern,
  isPrefixedId,
} from '../../src/core/ids.js';

describe('clock', () => {
  it('FrozenClock devuelve siempre el mismo instante hasta que se mueve', () => {
    const clock = new FrozenClock('2026-11-18T15:00:00Z');
    expect(clock.now().toISOString()).toBe('2026-11-18T15:00:00.000Z');
    clock.advance(90_000);
    expect(clock.now().toISOString()).toBe('2026-11-18T15:01:30.000Z');
    clock.set(new Date('2027-01-01T00:00:00Z'));
    expect(clock.now().toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('FrozenClock no deja mutar su instante desde afuera', () => {
    const instant = new Date('2026-11-18T15:00:00Z');
    const clock = new FrozenClock(instant);
    instant.setUTCFullYear(2000);
    clock.now().setUTCFullYear(1990);
    expect(clock.now().getUTCFullYear()).toBe(2026);
  });

  it('SystemClock avanza con el reloj real', () => {
    const before = new SystemClock().now().getTime();
    expect(new SystemClock().now().getTime()).toBeGreaterThanOrEqual(before);
  });

  it('ControllableClock se congela y vuelve al reloj base', () => {
    const base = new FrozenClock('2026-11-18T15:00:00Z');
    const clock = new ControllableClock(base);
    expect(clock.isFrozen).toBe(false);
    expect(clock.now().toISOString()).toBe('2026-11-18T15:00:00.000Z');

    clock.freeze('2026-11-18T22:00:00Z');
    expect(clock.isFrozen).toBe(true);
    expect(clock.now().toISOString()).toBe('2026-11-18T22:00:00.000Z');

    clock.freeze(new Date('2026-11-19T01:00:00Z'));
    expect(clock.now().toISOString()).toBe('2026-11-19T01:00:00.000Z');

    clock.freeze(null);
    expect(clock.isFrozen).toBe(false);
    expect(clock.now().toISOString()).toBe('2026-11-18T15:00:00.000Z');
  });

  it('ControllableClock usa el reloj del sistema por defecto', () => {
    const clock = new ControllableClock();
    expect(isControllableClock(clock)).toBe(true);
    expect(isControllableClock(new SystemClock())).toBe(false);
    expect(Math.abs(clock.now().getTime() - new SystemClock().now().getTime())).toBeLessThan(5_000);
  });

  it('formatea timestamps en ISO 8601 UTC con Z y sin milisegundos', () => {
    expect(toIsoUtc(new Date('2026-11-18T14:42:00.987Z'))).toBe('2026-11-18T14:42:00Z');
  });
});

describe('ids', () => {
  const ids = new IdGenerator(new FrozenClock('2026-11-18T15:00:00Z'));

  it('genera ids con prefijo y cuerpo ULID de 26 caracteres', () => {
    for (const kind of Object.keys(ID_PREFIXES) as (keyof typeof ID_PREFIXES)[]) {
      const id = ids.next(kind);
      expect(id).toMatch(PREFIXED_ID_PATTERN);
      expect(id).toMatch(idPattern(kind));
      expect(id.startsWith(`${ID_PREFIXES[kind]}_`)).toBe(true);
      expect(isPrefixedId(id, kind)).toBe(true);
      expect(isPrefixedId(id)).toBe(true);
    }
  });

  it('no repite ids y el prefijo temporal sale del reloj inyectado', () => {
    const generated = new Set(Array.from({ length: 500 }, () => ids.next('order')));
    expect(generated.size).toBe(500);
    const [first, second] = [ids.ulid(), ids.ulid()];
    expect(first.slice(0, 10)).toBe(second.slice(0, 10));

    const later = new IdGenerator(new FrozenClock('2027-11-18T15:00:00Z'));
    expect(later.ulid().slice(0, 10) > first.slice(0, 10)).toBe(true);
  });

  it('dentro del mismo milisegundo los ids crecen en el orden en que se generan', () => {
    const generator = new IdGenerator(new FrozenClock('2026-11-18T15:00:00Z'));
    const generated = Array.from({ length: 200 }, () => generator.next('transaction'));
    expect([...generated].sort()).toEqual(generated);
    expect(new Set(generated).size).toBe(200);
  });

  it('reconoce ids inválidos', () => {
    expect(isPrefixedId(42)).toBe(false);
    expect(isPrefixedId('usr')).toBe(false);
    expect(isPrefixedId('usr_abc')).toBe(false);
    expect(isPrefixedId('xyz_01JC0000000000000000000001')).toBe(false);
    expect(isPrefixedId('usr_01JC0000000000000000000001_x')).toBe(false);
    expect(isPrefixedId('usr_01JC0000000000000000000001', 'order')).toBe(false);
    expect(isPrefixedId('usr_01JC0000000000000000000001', 'user')).toBe(true);
  });
});
