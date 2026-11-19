import { describe, expect, it } from 'vitest';
import {
  loginBody,
  logoutBody,
  refreshBody,
  registerBody,
  registerResponse,
  tokensResponse,
  type LoginBody,
  type RefreshBody,
  type RegisterBody,
  type RegisterResponse,
  type TokensResponse,
} from '../../src/modules/auth/schemas.js';
import { userResponse, type UserResponse } from '../../src/modules/users/schemas.js';
import {
  expectInvalid,
  expectResponseValid,
  expectValid,
  fieldErrors,
  responseErrors,
} from '../helpers/schema-assertions.js';

const valid: RegisterBody = {
  email: 'ana@example.com',
  password: 'Secret123',
  full_name: 'Ana Gómez',
  country: 'CO',
  document_type: 'CC',
  document_number: '1020304050',
};

describe('registerBody', () => {
  it('acepta un ejemplo válido tipado con su interfaz', () => {
    expect(expectValid(registerBody, valid)).toEqual(valid);
  });

  it('normaliza el email a minúsculas y recorta el nombre', () => {
    const value = expectValid(registerBody, {
      ...valid,
      email: 'Ana@Example.COM',
      full_name: '  Ana Gómez  ',
    });
    expect(value.email).toBe('ana@example.com');
    expect(value.full_name).toBe('Ana Gómez');
  });

  it.each([
    ['email', undefined, 'REQUIRED'],
    ['email', 'no-es-email', 'INVALID_FORMAT'],
    ['email', 12345, 'INVALID_FORMAT'],
    ['password', undefined, 'REQUIRED'],
    ['password', 'Abc1234', 'TOO_SHORT'],
    ['password', `A1${'a'.repeat(127)}`, 'TOO_LONG'],
    ['password', 'sololetras', 'INVALID_FORMAT'],
    ['password', '1234567890', 'INVALID_FORMAT'],
    ['full_name', undefined, 'REQUIRED'],
    ['full_name', 'Al', 'TOO_SHORT'],
    ['full_name', '   A   ', 'TOO_SHORT'],
    ['full_name', 'A'.repeat(81), 'TOO_LONG'],
    ['country', undefined, 'REQUIRED'],
    ['country', 'AR', 'NOT_ALLOWED'],
    ['document_type', undefined, 'REQUIRED'],
    ['document_type', 'PASSPORT', 'NOT_ALLOWED'],
    ['document_number', undefined, 'REQUIRED'],
    ['document_number', 1020304050, 'INVALID_FORMAT'],
  ] as const)('%s = %j → %s', (field, value, code) => {
    const body: Record<string, unknown> = { ...valid, [field]: value };
    if (value === undefined) delete body[field];
    expectInvalid(registerBody, body, field, code);
  });

  it('rechaza emails de más de 254 caracteres', () => {
    const email = `${'a'.repeat(60)}@${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.example.com`;
    expect(email.length).toBeGreaterThan(254);
    expect(fieldErrors(registerBody, { ...valid, email })).toContainEqual({
      field: 'email',
      code: 'TOO_LONG',
    });
  });

  it('rechaza campos que no están en el contrato', () => {
    expectInvalid(registerBody, { ...valid, role: 'admin' }, 'role', 'NOT_ALLOWED');
  });

  it('informa todos los errores a la vez', () => {
    expect(fieldErrors(registerBody, {})).toEqual([
      { field: 'email', code: 'REQUIRED' },
      { field: 'password', code: 'REQUIRED' },
      { field: 'full_name', code: 'REQUIRED' },
      { field: 'country', code: 'REQUIRED' },
      { field: 'document_type', code: 'REQUIRED' },
      { field: 'document_number', code: 'REQUIRED' },
    ]);
  });

  describe('tipo de documento permitido por país', () => {
    it.each([
      ['CO', 'CC', '1020304050'],
      ['CO', 'CE', 'AB123456'],
      ['MX', 'CURP', 'GOMA900101HDFRRN09'],
      ['PE', 'DNI', '12345678'],
      ['PE', 'CE', 'AB1234567'],
    ] as const)('%s acepta %s', (country, document_type, document_number) => {
      expectValid(registerBody, { ...valid, country, document_type, document_number });
    });

    it.each([
      ['CO', 'CURP', 'GOMA900101HDFRRN09'],
      ['CO', 'DNI', '12345678'],
      ['MX', 'CC', '1020304050'],
      ['MX', 'CE', 'AB123456'],
      ['MX', 'DNI', '12345678'],
      ['PE', 'CC', '1020304050'],
      ['PE', 'CURP', 'GOMA900101HDFRRN09'],
    ] as const)('%s rechaza %s', (country, document_type, document_number) => {
      expectInvalid(
        registerBody,
        { ...valid, country, document_type, document_number },
        'document_type',
        'NOT_ALLOWED',
      );
    });
  });

  describe('formato del número de documento', () => {
    const cases: [string, 'CO' | 'MX' | 'PE', string, string[], string[]][] = [
      [
        'CC: 6 a 10 dígitos',
        'CO',
        'CC',
        ['123456', '1020304050'],
        ['12345', '10203040501', '12345A', ''],
      ],
      [
        'CE (CO): 6 a 12 alfanuméricos',
        'CO',
        'CE',
        ['AB1234', 'abc123456789'],
        ['AB123', 'ABC1234567890', 'AB-1234'],
      ],
      [
        'DNI: exactamente 8 dígitos',
        'PE',
        'DNI',
        ['12345678'],
        ['1234567', '123456789', '1234567A'],
      ],
      [
        'CE (PE): 9 a 12 alfanuméricos',
        'PE',
        'CE',
        ['AB1234567', 'ABC123456789'],
        ['AB123456', 'ABC1234567890', 'AB 1234567'],
      ],
      [
        'CURP: 18 caracteres con su estructura',
        'MX',
        'CURP',
        ['GOMA900101HDFRRN09', 'PERJ850315MJCRZN08'],
        ['GOMA900101XDFRRN09', 'GOMA900101HDFRRN0', 'GOM4900101HDFRRN09', 'GOMA900101HDFRRN0A'],
      ],
    ];

    it.each(cases)('%s', (_name, country, document_type, accepted, rejected) => {
      for (const document_number of accepted) {
        expectValid(registerBody, { ...valid, country, document_type, document_number });
      }
      for (const document_number of rejected) {
        const errors = fieldErrors(registerBody, {
          ...valid,
          country,
          document_type,
          document_number,
        });
        expect(errors, document_number).toHaveLength(1);
        expect(errors[0]?.field, document_number).toBe('document_number');
        expect(['INVALID_FORMAT', 'REQUIRED']).toContain(errors[0]?.code);
      }
    });

    it('pasa la CURP a mayúsculas', () => {
      const value = expectValid(registerBody, {
        ...valid,
        country: 'MX',
        document_type: 'CURP',
        document_number: 'goma900101hdfrrn09',
      });
      expect(value.document_number).toBe('GOMA900101HDFRRN09');
    });
  });
});

describe('loginBody, refreshBody y logoutBody', () => {
  it('aceptan ejemplos válidos tipados', () => {
    const login: LoginBody = { email: 'demo@milainvest.app', password: 'Demo1234!' };
    expect(expectValid(loginBody, { ...login, email: 'DEMO@milainvest.app' })).toEqual(login);
    const refresh: RefreshBody = { refresh_token: 'm2Yc0aXkW3tq8l1nV5bZ7pRj4sHd6fGu9eKoIxTyAwQ' };
    expect(expectValid(refreshBody, refresh)).toEqual(refresh);
    expect(expectValid(logoutBody, refresh)).toEqual(refresh);
  });

  it('rechazan cada regla', () => {
    expectInvalid(loginBody, { password: 'x' }, 'email', 'REQUIRED');
    expectInvalid(loginBody, { email: 'a@example.com' }, 'password', 'REQUIRED');
    expectInvalid(loginBody, { email: 'a@example.com', password: '' }, 'password', 'REQUIRED');
    expectInvalid(loginBody, { email: 'nope', password: 'x' }, 'email', 'INVALID_FORMAT');
    expectInvalid(
      loginBody,
      { email: 'a@example.com', password: 'a'.repeat(129) },
      'password',
      'TOO_LONG',
    );
    expectInvalid(refreshBody, {}, 'refresh_token', 'REQUIRED');
    expectInvalid(refreshBody, { refresh_token: 'corto' }, 'refresh_token', 'TOO_SHORT');
    expectInvalid(refreshBody, { refresh_token: 'a'.repeat(257) }, 'refresh_token', 'TOO_LONG');
    expectInvalid(
      refreshBody,
      { refresh_token: 'con espacios y símbolos!!' },
      'refresh_token',
      'INVALID_FORMAT',
    );
    expectInvalid(logoutBody, { refresh_token: 42 }, 'refresh_token', 'INVALID_FORMAT');
  });
});

describe('respuestas de auth y users', () => {
  const user: UserResponse = {
    id: 'usr_01JC0000000000000000000001',
    email: 'demo@milainvest.app',
    full_name: 'Usuario Demo',
    country: 'CO',
    base_currency: 'COP',
    document_type: 'CC',
    document_last4: '4050',
  };
  const tokens: TokensResponse = {
    access_token: 'header.payload.signature',
    refresh_token: 'm2Yc0aXkW3tq8l1nV5bZ7pRj4sHd6fGu9eKoIxTyAwQ',
    token_type: 'bearer',
    expires_in: 900,
  };

  it('aceptan ejemplos tipados con su interfaz', () => {
    expectResponseValid(userResponse, user);
    expectResponseValid(tokensResponse, tokens);
    const registered: RegisterResponse = { user, tokens };
    expectResponseValid(registerResponse, registered);
  });

  it('no dejan salir campos fuera del contrato ni tipos incorrectos', () => {
    expect(responseErrors(userResponse, { ...user, password_hash: 'x' })).toEqual([
      'password_hash',
    ]);
    expect(responseErrors(userResponse, { ...user, id: 'ord_01JC0000000000000000000001' })).toEqual(
      ['id'],
    );
    expect(responseErrors(userResponse, { ...user, base_currency: 'USD' })).toEqual([
      'base_currency',
    ]);
    expect(responseErrors(tokensResponse, { ...tokens, token_type: 'Bearer' })).toEqual([
      'token_type',
    ]);
    expect(responseErrors(tokensResponse, { ...tokens, expires_in: '900' })).toEqual([
      'expires_in',
    ]);
    expect(responseErrors(registerResponse, { user })).toEqual(['tokens']);
  });
});
