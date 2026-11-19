/** Utilidades para los tests de schemas Joi: validan con las mismas opciones que la app. */
import type Joi from 'joi';
import { expect } from 'vitest';
import type { FieldError } from '../../src/core/errors.js';
import {
  JOI_OPTIONS,
  RESPONSE_JOI_OPTIONS,
  joiErrorToFieldErrors,
  type HttpPart,
} from '../../src/http/joi-validator.js';

/** Valida y devuelve el valor ya normalizado; falla el test si el schema lo rechaza. */
export function expectValid<T>(schema: Joi.Schema<T>, value: unknown, part: HttpPart = 'body'): T {
  const result = schema.validate(value, JOI_OPTIONS[part]);
  expect(result.error?.message, 'el ejemplo válido debería pasar').toBeUndefined();
  return result.value as T;
}

/** Errores por campo que produce `value`, tal como saldrían en `errors[]`. */
export function fieldErrors(
  schema: Joi.Schema,
  value: unknown,
  part: HttpPart = 'body',
): FieldError[] {
  const result = schema.validate(value, JOI_OPTIONS[part]);
  return result.error === undefined ? [] : joiErrorToFieldErrors(result.error, part);
}

/** Verifica que `value` produce exactamente un error, en `field` y con `code`. */
export function expectInvalid(
  schema: Joi.Schema,
  value: unknown,
  field: string,
  code: FieldError['code'],
  part: HttpPart = 'body',
): void {
  expect(fieldErrors(schema, value, part)).toEqual([{ field, code }]);
}

/** Valida una respuesta como lo hace el hook `onSend` en `APP_ENV=test`. */
export function expectResponseValid<T>(schema: Joi.Schema<T>, value: T): void {
  const result = schema.validate(value, RESPONSE_JOI_OPTIONS);
  expect(result.error?.message, 'la respuesta debería cumplir su schema').toBeUndefined();
}

export function responseErrors(schema: Joi.Schema, value: unknown): string[] {
  const result = schema.validate(value, RESPONSE_JOI_OPTIONS);
  return result.error?.details.map((detail) => detail.path.join('.')) ?? [];
}
