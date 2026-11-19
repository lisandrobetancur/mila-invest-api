import { describe, expect, it } from 'vitest';
import {
  accountResponse,
  accountsResponse,
  depositBody,
  depositParams,
  type AccountResponse,
  type DepositBody,
  type DepositParams,
} from '../../src/modules/accounts/schemas.js';
import {
  INSTRUMENT_EXAMPLE,
  instrumentDetailResponse,
  instrumentParams,
  instrumentResponse,
  instrumentsPage,
  listInstrumentsQuery,
  pricesQuery,
  pricesResponse,
  type InstrumentDetailResponse,
  type ListInstrumentsQuery,
  type PricesResponse,
} from '../../src/modules/market/schemas.js';
import {
  ORDER_EXAMPLE,
  createOrderBody,
  listOrdersQuery,
  orderParams,
  orderPreviewResponse,
  orderResponse,
  ordersPage,
  type CreateOrderBody,
  type OrderPreviewResponse,
  type OrderResponse,
} from '../../src/modules/orders/schemas.js';
import {
  TRANSACTION_EXAMPLE,
  listTransactionsQuery,
  transactionResponse,
  transactionsPage,
  type ListTransactionsQuery,
  type TransactionResponse,
} from '../../src/modules/transactions/schemas.js';
import {
  expectInvalid,
  expectResponseValid,
  expectValid,
  responseErrors,
} from '../helpers/schema-assertions.js';

describe('accounts', () => {
  it('acepta ejemplos válidos tipados con sus interfaces', () => {
    const body: DepositBody = { amount: '1000000.00' };
    expect(expectValid(depositBody, body)).toEqual(body);
    const params: DepositParams = { currency: 'COP' };
    expect(expectValid(depositParams, params, 'params')).toEqual(params);
    const account: AccountResponse = {
      id: 'acc_01JC0000000000000000000101',
      currency: 'COP',
      available: '50000000.00',
      reserved: '0.00',
    };
    expectResponseValid(accountResponse, account);
    expectResponseValid(accountsResponse, [account]);
  });

  it('un depósito con el monto como número JSON se rechaza', () => {
    expectInvalid(depositBody, { amount: 1000 }, 'amount', 'INVALID_FORMAT');
  });

  it.each([
    [{}, 'amount', 'REQUIRED'],
    [{ amount: '' }, 'amount', 'REQUIRED'],
    [{ amount: '0' }, 'amount', 'TOO_SMALL'],
    [{ amount: '-5.00' }, 'amount', 'TOO_SMALL'],
    [{ amount: '1,000' }, 'amount', 'INVALID_FORMAT'],
    [{ amount: '10.00', currency: 'COP' }, 'currency', 'NOT_ALLOWED'],
  ] as const)('depositBody %j → %s %s', (body, field, code) => {
    expectInvalid(depositBody, body, field, code);
  });

  it('la moneda del path es COP, MXN o PEN', () => {
    expectInvalid(depositParams, { currency: 'USD' }, 'currency', 'NOT_ALLOWED', 'params');
    expectInvalid(depositParams, { currency: 'cop' }, 'currency', 'NOT_ALLOWED', 'params');
    expectInvalid(depositParams, {}, 'currency', 'REQUIRED', 'params');
  });

  it('la respuesta no admite saldos numéricos ni campos internos', () => {
    const account = {
      id: 'acc_01JC0000000000000000000101',
      currency: 'COP',
      available: '1.00',
      reserved: '0.00',
    };
    expect(responseErrors(accountResponse, { ...account, available: 1 })).toEqual(['available']);
    expect(responseErrors(accountResponse, { ...account, user_id: 'usr_1' })).toEqual(['user_id']);
    expect(responseErrors(accountsResponse, [{ ...account, currency: 'USD' }])).toEqual([
      '0.currency',
    ]);
  });
});

describe('orders', () => {
  const valid: CreateOrderBody = {
    instrument_id: 'ECOPETROL-CO',
    side: 'BUY',
    type: 'MARKET',
    quantity: 10,
  };

  it('acepta un ejemplo válido tipado con su interfaz', () => {
    expect(expectValid(createOrderBody, valid)).toEqual(valid);
    expect(
      expectValid(createOrderBody, { ...valid, side: 'SELL', quantity: 1_000_000 }).quantity,
    ).toBe(1_000_000);
  });

  it('una cantidad enviada como string se rechaza', () => {
    expectInvalid(createOrderBody, { ...valid, quantity: '10' }, 'quantity', 'INVALID_FORMAT');
  });

  it.each([
    ['instrument_id', undefined, 'REQUIRED'],
    ['instrument_id', 'ecopetrol', 'INVALID_FORMAT'],
    ['instrument_id', 123, 'INVALID_FORMAT'],
    ['side', undefined, 'REQUIRED'],
    ['side', 'HOLD', 'NOT_ALLOWED'],
    ['type', undefined, 'REQUIRED'],
    ['type', 'LIMIT', 'NOT_ALLOWED'],
    ['quantity', undefined, 'REQUIRED'],
    ['quantity', 0, 'TOO_SMALL'],
    ['quantity', -3, 'TOO_SMALL'],
    ['quantity', 1_000_001, 'TOO_LARGE'],
    ['quantity', 1.5, 'INVALID_FORMAT'],
    ['quantity', null, 'INVALID_FORMAT'],
  ] as const)('%s = %j → %s', (field, value, code) => {
    const body: Record<string, unknown> = { ...valid, [field]: value };
    if (value === undefined) delete body[field];
    expectInvalid(createOrderBody, body, field, code);
  });

  it('no acepta limit_price en la fase 1', () => {
    expectInvalid(
      createOrderBody,
      { ...valid, limit_price: '2400.00' },
      'limit_price',
      'NOT_ALLOWED',
    );
  });

  it('el JSON de ejemplo de order del contrato cumple su schema', () => {
    const order: OrderResponse = ORDER_EXAMPLE;
    expectResponseValid(orderResponse, order);
    expectResponseValid(ordersPage, { items: [order], next_cursor: null });
    const rejected: OrderResponse = {
      ...order,
      status: 'REJECTED',
      executed_price: null,
      reject_code: 'INSUFFICIENT_FUNDS',
      filled_at: null,
    };
    expectResponseValid(orderResponse, rejected);
    const preview: OrderPreviewResponse = {
      estimated_price: '2386.00',
      gross: '23860.00',
      commission: '5000.00',
      total: '28860.00',
      currency: 'COP',
      available_after: '49971140.00',
      warnings: ['MARKET_CLOSING_SOON', 'PRICE_MAY_CHANGE'],
    };
    expectResponseValid(orderPreviewResponse, preview);
  });

  it('la respuesta no admite montos numéricos, estados ni avisos desconocidos', () => {
    expect(responseErrors(orderResponse, { ...ORDER_EXAMPLE, gross: 23860 })).toEqual(['gross']);
    expect(responseErrors(orderResponse, { ...ORDER_EXAMPLE, status: 'DONE' })).toEqual(['status']);
    expect(responseErrors(orderResponse, { ...ORDER_EXAMPLE, reject_code: 'OTHER' })).toEqual([
      'reject_code',
    ]);
    expect(responseErrors(orderResponse, { ...ORDER_EXAMPLE, realized_pnl: '0.00' })).toEqual([
      'realized_pnl',
    ]);
    expect(
      responseErrors(orderResponse, { ...ORDER_EXAMPLE, created_at: '2026-11-18T14:43:10.000Z' }),
    ).toEqual(['created_at']);
    expect(
      responseErrors(orderPreviewResponse, {
        estimated_price: '1.00',
        gross: '1.00',
        commission: '1.00',
        total: '2.00',
        currency: 'COP',
        available_after: '0.00',
        warnings: ['SOMETHING'],
      }),
    ).toEqual(['warnings.0']);
  });

  it('valida el filtro por estado y el id del path', () => {
    expect(expectValid(listOrdersQuery, { status: 'FILLED', limit: '5' }, 'querystring')).toEqual({
      status: 'FILLED',
      limit: 5,
    });
    expectInvalid(listOrdersQuery, { status: 'DONE' }, 'status', 'NOT_ALLOWED', 'querystring');
    expectValid(orderParams, { id: 'ord_01JC0000000000000000000001' }, 'params');
    expectInvalid(
      orderParams,
      { id: 'txn_01JC0000000000000000000001' },
      'id',
      'INVALID_FORMAT',
      'params',
    );
  });
});

describe('market', () => {
  it('los JSON de ejemplo de instrument del contrato cumplen su schema', () => {
    expectResponseValid(instrumentResponse, INSTRUMENT_EXAMPLE);
    expectResponseValid(instrumentsPage, { items: [INSTRUMENT_EXAMPLE], next_cursor: 'abc' });
    const detail: InstrumentDetailResponse = {
      ...INSTRUMENT_EXAMPLE,
      open: '2352.00',
      high: '2391.00',
      low: '2348.00',
      prev_close: '2350.00',
      volume: 4_200_000,
      description: 'Precio simulado.',
    };
    expectResponseValid(instrumentDetailResponse, detail);
    const prices: PricesResponse = {
      range: '1D',
      currency: 'COP',
      points: [{ t: '2026-11-18T14:30:00Z', price: '2352.00' }],
    };
    expectResponseValid(pricesResponse, prices);
  });

  it('la respuesta no admite precios numéricos ni más de 400 puntos', () => {
    expect(responseErrors(instrumentResponse, { ...INSTRUMENT_EXAMPLE, last_price: 2385 })).toEqual(
      ['last_price'],
    );
    expect(responseErrors(instrumentResponse, { ...INSTRUMENT_EXAMPLE, type: 'BOND' })).toEqual([
      'type',
    ]);
    expect(responseErrors(instrumentResponse, { ...INSTRUMENT_EXAMPLE, base_price: '1' })).toEqual([
      'base_price',
    ]);
    const point = { t: '2026-11-18T14:30:00Z', price: '1.00' };
    expect(
      responseErrors(pricesResponse, {
        range: '1D',
        currency: 'COP',
        points: Array.from({ length: 401 }, () => point),
      }),
    ).toEqual(['points']);
    expect(responseErrors(pricesResponse, { range: '5Y', currency: 'COP', points: [] })).toEqual([
      'range',
    ]);
  });

  it('valida los filtros del catálogo', () => {
    const query: ListInstrumentsQuery = { country: 'CO', type: 'ETF', q: 'col', limit: 10 };
    expect(
      expectValid(listInstrumentsQuery, { ...query, limit: '10', q: ' col ' }, 'querystring'),
    ).toEqual(query);
    expectInvalid(listInstrumentsQuery, { country: 'AR' }, 'country', 'NOT_ALLOWED', 'querystring');
    expectInvalid(listInstrumentsQuery, { type: 'BOND' }, 'type', 'NOT_ALLOWED', 'querystring');
    expectInvalid(listInstrumentsQuery, { q: 'x'.repeat(51) }, 'q', 'TOO_LONG', 'querystring');
    expectInvalid(listInstrumentsQuery, { q: '' }, 'q', 'REQUIRED', 'querystring');
    expectInvalid(listInstrumentsQuery, { sort: 'name' }, 'sort', 'NOT_ALLOWED', 'querystring');
  });

  it('valida el id del instrumento y el rango de precios', () => {
    expectValid(instrumentParams, { id: 'BAP-PE' }, 'params');
    expectInvalid(instrumentParams, { id: 'bap' }, 'id', 'INVALID_FORMAT', 'params');
    expect(expectValid(pricesQuery, {}, 'querystring')).toEqual({ range: '1D' });
    expect(expectValid(pricesQuery, { range: '1Y' }, 'querystring')).toEqual({ range: '1Y' });
    expectInvalid(pricesQuery, { range: '5Y' }, 'range', 'NOT_ALLOWED', 'querystring');
  });
});

describe('transactions', () => {
  it('el JSON de ejemplo de transaction del contrato cumple su schema', () => {
    const transaction: TransactionResponse = TRANSACTION_EXAMPLE;
    expectResponseValid(transactionResponse, transaction);
    expectResponseValid(transactionResponse, {
      ...transaction,
      type: 'DEPOSIT',
      amount: '1000.00',
      order_id: null,
    });
    expectResponseValid(transactionsPage, { items: [transaction], next_cursor: null });
  });

  it('la respuesta no admite montos numéricos ni tipos desconocidos', () => {
    expect(responseErrors(transactionResponse, { ...TRANSACTION_EXAMPLE, amount: -23860 })).toEqual(
      ['amount'],
    );
    expect(responseErrors(transactionResponse, { ...TRANSACTION_EXAMPLE, type: 'REFUND' })).toEqual(
      ['type'],
    );
    expect(
      responseErrors(transactionResponse, { ...TRANSACTION_EXAMPLE, journal_id: 'jrn_1' }),
    ).toEqual(['journal_id']);
    const { order_id: _orderId, ...withoutOrder } = TRANSACTION_EXAMPLE;
    expect(responseErrors(transactionResponse, withoutOrder)).toEqual(['order_id']);
  });

  it('valida los filtros del historial', () => {
    const query: ListTransactionsQuery = {
      type: 'BUY',
      from: '2026-11-01T00:00:00Z',
      to: '2026-11-30T23:59:59Z',
      limit: 50,
    };
    expect(expectValid(listTransactionsQuery, { ...query, limit: '50' }, 'querystring')).toEqual(
      query,
    );
    expectInvalid(listTransactionsQuery, { type: 'REFUND' }, 'type', 'NOT_ALLOWED', 'querystring');
    expectInvalid(listTransactionsQuery, { from: 'ayer' }, 'from', 'INVALID_FORMAT', 'querystring');
    expectInvalid(
      listTransactionsQuery,
      { to: '2026-11-30' },
      'to',
      'INVALID_FORMAT',
      'querystring',
    );
    expectInvalid(listTransactionsQuery, { limit: '1000' }, 'limit', 'TOO_LARGE', 'querystring');
  });
});
