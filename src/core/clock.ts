/**
 * Reloj inyectable.
 *
 * Es el **único** lugar del código que puede llamar a `new Date()` sin
 * argumentos (regla 6 de §4). Todo lo demás recibe un `Clock`, así los tests y
 * los endpoints `_testing` pueden congelar el tiempo. Todas las fechas se
 * manejan en UTC.
 */

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  public now(): Date {
    return new Date();
  }
}

/** Reloj detenido en un instante, para tests determinísticos. */
export class FrozenClock implements Clock {
  private current: Date;

  public constructor(instant: Date | string) {
    this.current = typeof instant === 'string' ? new Date(instant) : new Date(instant.getTime());
  }

  public now(): Date {
    return new Date(this.current.getTime());
  }

  public set(instant: Date | string): void {
    this.current = typeof instant === 'string' ? new Date(instant) : new Date(instant.getTime());
  }

  public advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

/**
 * Reloj que puede congelarse en caliente. Es el que recibe la app en `dev` y
 * `test`, para que `POST /_testing/clock` lo fije o lo libere (§11).
 */
export class ControllableClock implements Clock {
  private frozenAt: Date | null = null;

  public constructor(private readonly base: Clock = new SystemClock()) {}

  public now(): Date {
    return this.frozenAt === null ? this.base.now() : new Date(this.frozenAt.getTime());
  }

  /** `null` devuelve el control al reloj base. */
  public freeze(instant: Date | string | null): void {
    if (instant === null) {
      this.frozenAt = null;
      return;
    }
    this.frozenAt = typeof instant === 'string' ? new Date(instant) : new Date(instant.getTime());
  }

  public get isFrozen(): boolean {
    return this.frozenAt !== null;
  }
}

export function isControllableClock(clock: Clock): clock is ControllableClock {
  return clock instanceof ControllableClock;
}

/** Timestamp ISO 8601 UTC con `Z`, como lo exige el contrato (§7.1). */
export function toIsoUtc(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}
