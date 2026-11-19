import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { OPENAPI_PATH, generateOpenApi } from '../../scripts/export-openapi.js';

interface Operation {
  summary?: string;
  tags?: string[];
  security?: unknown[];
  parameters?: { in: string; name: string; required?: boolean }[];
  requestBody?: { content: Record<string, { schema: Record<string, unknown> }> };
  responses: Record<string, { content?: Record<string, { schema: Record<string, unknown> }> }>;
}

interface OpenApiDocument {
  openapi: string;
  info: { title: string };
  paths: Record<string, Record<string, Operation>>;
  components: { securitySchemes: Record<string, unknown>; schemas: Record<string, unknown> };
}

const document = JSON.parse(await generateOpenApi()) as OpenApiDocument;

/** Endpoints de la fase 1 (§7.2), con su status de éxito y si requieren auth. */
const PHASE_1: [method: string, path: string, status: string, auth: boolean][] = [
  ['get', '/health', '200', false],
  ['post', '/api/v1/auth/register', '201', false],
  ['post', '/api/v1/auth/login', '200', false],
  ['post', '/api/v1/auth/refresh', '200', false],
  ['post', '/api/v1/auth/logout', '204', true],
  ['get', '/api/v1/me', '200', true],
  ['get', '/api/v1/meta/countries', '200', false],
  ['get', '/api/v1/accounts', '200', true],
  ['post', '/api/v1/accounts/{currency}/deposits', '201', true],
  ['get', '/api/v1/instruments', '200', true],
  ['get', '/api/v1/instruments/{id}', '200', true],
  ['get', '/api/v1/instruments/{id}/prices', '200', true],
  ['post', '/api/v1/orders/preview', '200', true],
  ['post', '/api/v1/orders', '201', true],
  ['get', '/api/v1/orders', '200', true],
  ['get', '/api/v1/orders/{id}', '200', true],
  ['get', '/api/v1/portfolio', '200', true],
  ['get', '/api/v1/transactions', '200', true],
  ['get', '/api/v1/dashboard/summary', '200', true],
];

const TESTING: [string, string][] = [
  ['post', '/api/v1/_testing/reset'],
  ['post', '/api/v1/_testing/clock'],
  ['post', '/api/v1/_testing/market/{country}'],
  ['post', '/api/v1/_testing/prices/{instrument_id}'],
  ['post', '/api/v1/_testing/users'],
  ['get', '/api/v1/_testing/ledger'],
];

describe('OpenAPI', () => {
  it('docs/openapi.json está actualizado (correr `pnpm openapi:export` si falla)', async () => {
    const committed = await readFile(OPENAPI_PATH, 'utf8');
    expect(JSON.parse(committed)).toEqual(document);
  });

  it('es OpenAPI 3 con autenticación bearer', () => {
    expect(document.openapi).toBe('3.0.3');
    expect(document.info.title).toBe('MILA Invest API');
    expect(document.components.securitySchemes.bearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
    expect(document.components.schemas).toHaveProperty('Problem');
  });

  it('documenta exactamente los endpoints de la fase 1 y los de testing', () => {
    const documented = Object.entries(document.paths)
      .flatMap(([path, operations]) => Object.keys(operations).map((method) => `${method} ${path}`))
      .sort();
    const expected = [
      ...PHASE_1.map(([method, path]) => `${method} ${path}`),
      ...TESTING.map(([method, path]) => `${method} ${path}`),
    ].sort();
    expect(documented).toEqual(expected);
  });

  it.each(PHASE_1)(
    '%s %s: status, seguridad, tags y errores problem+json',
    (method, path, status, auth) => {
      const operation = document.paths[path]?.[method];
      expect(operation).toBeDefined();
      expect(operation?.summary).toBeTruthy();
      expect(operation?.tags?.length).toBe(1);
      expect(Object.keys(operation?.responses ?? {})).toContain(status);
      expect(operation?.security !== undefined).toBe(auth);

      const errorStatuses = Object.keys(operation?.responses ?? {}).filter(
        (code) => code.startsWith('4') || code.startsWith('5'),
      );
      expect(errorStatuses).toContain('500');
      if (auth) expect(errorStatuses).toContain('401');
      for (const code of errorStatuses) {
        expect(operation?.responses[code]?.content).toHaveProperty(['application/problem+json']);
      }
    },
  );

  it('los endpoints con dinero en movimiento exigen Idempotency-Key', () => {
    for (const path of ['/api/v1/orders', '/api/v1/accounts/{currency}/deposits']) {
      const header = document.paths[path]?.post?.parameters?.find(
        (parameter) => parameter.in === 'header',
      );
      expect(header, path).toMatchObject({ name: 'Idempotency-Key', required: true });
    }
  });

  it('los campos de dinero se documentan como string, no como number', () => {
    const order = document.paths['/api/v1/orders']?.post?.responses['201']?.content?.[
      'application/json'
    ]?.schema as {
      properties: Record<string, { type: string; pattern?: string }>;
    };
    for (const field of ['executed_price', 'gross', 'commission', 'total']) {
      expect(order.properties[field]?.type, field).toBe('string');
      expect(order.properties[field]?.pattern, field).toBeDefined();
    }
    const body = document.paths['/api/v1/accounts/{currency}/deposits']?.post?.requestBody?.content[
      'application/json'
    ]?.schema as {
      properties: Record<string, { type: string }>;
      additionalProperties: boolean;
    };
    expect(body.properties.amount?.type).toBe('string');
    expect(body.additionalProperties).toBe(false);
  });

  it('los schemas de respuesta llevan ejemplos', () => {
    for (const [method, path, status] of PHASE_1) {
      const schema =
        document.paths[path]?.[method]?.responses[status]?.content?.['application/json']?.schema;
      if (status === '204') continue;
      expect(schema, `${method} ${path}`).toHaveProperty('example');
    }
  });
});
