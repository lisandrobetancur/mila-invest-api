import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from '../../src/core/pagination.js';
import type {
  InstrumentDetailResponse,
  InstrumentResponse,
  PricesResponse,
} from '../../src/modules/market/schemas.js';
import { buildTestApp, type TestApp } from '../helpers/build-test-app.js';
import { freezePrice, get, post, registerUser, type Session } from '../helpers/factories.js';

let ctx: TestApp;
let session: Session;

beforeAll(async () => {
  ctx = await buildTestApp();
  session = await registerUser(ctx.app);
});

afterAll(async () => {
  await ctx.close();
});

const list = async (query = ''): Promise<Page<InstrumentResponse>> => {
  const response = await get(ctx.app, `/instruments${query}`, session.headers);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<Page<InstrumentResponse>>();
};

describe('GET /instruments', () => {
  it('requiere autenticación', async () => {
    expect((await get(ctx.app, '/instruments')).statusCode).toBe(401);
  });

  it('devuelve los 13 instrumentos del seed ordenados por país y ticker', async () => {
    const page = await list();
    expect(page.next_cursor).toBeNull();
    expect(page.items.map((item) => item.id)).toEqual([
      'ECOPETROL-CO',
      'GEB-CO',
      'ICOLCAP-CO',
      'ISA-CO',
      'PFBCOLOM-CO',
      'AMXB-MX',
      'CEMEXCPO-MX',
      'GFNORTEO-MX',
      'WALMEX-MX',
      'BAP-PE',
      'BVN-PE',
      'FERREYC1-PE',
      'SCCO-PE',
    ]);
    expect(page.items[0]).toEqual({
      id: 'ECOPETROL-CO',
      ticker: 'ECOPETROL',
      name: 'Ecopetrol S.A.',
      country: 'CO',
      type: 'STOCK',
      currency: 'COP',
      last_price: expect.stringMatching(/^\d+\.\d{2}$/) as string,
      change: expect.stringMatching(/^-?\d+\.\d{2}$/) as string,
      change_pct: expect.stringMatching(/^-?\d+\.\d{2}$/) as string,
      updated_at: '2026-11-18T15:00:00Z',
    });
  });

  it('filtra por país, por tipo y por texto', async () => {
    expect((await list('?country=MX')).items.map((item) => item.ticker)).toEqual([
      'AMXB',
      'CEMEXCPO',
      'GFNORTEO',
      'WALMEX',
    ]);
    expect((await list('?type=ETF')).items.map((item) => item.id)).toEqual(['ICOLCAP-CO']);
    expect((await list('?country=PE&type=ETF')).items).toEqual([]);
    expect((await list('?q=cop')).items.map((item) => item.id)).toEqual([
      'ECOPETROL-CO',
      'SCCO-PE',
    ]);
    expect((await list('?q=BANORTE')).items.map((item) => item.id)).toEqual(['GFNORTEO-MX']);
    // Los comodines de LIKE se buscan literalmente.
    expect((await list('?q=%25')).items).toEqual([]);
    expect((await list('?q=_')).items).toEqual([]);
  });

  it('pagina por cursor sin repetir ni saltear instrumentos', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: Page<InstrumentResponse> = await list(
        `?limit=5${cursor === null ? '' : `&cursor=${cursor}`}`,
      );
      seen.push(...page.items.map((item) => item.id));
      cursor = page.next_cursor;
      pages += 1;
    } while (cursor !== null && pages < 10);

    expect(pages).toBe(3);
    expect(seen).toHaveLength(13);
    expect(new Set(seen).size).toBe(13);
    expect(seen).toEqual((await list('?limit=100')).items.map((item) => item.id));
  });

  it('el cursor respeta los filtros', async () => {
    const first = await list('?country=CO&limit=2');
    expect(first.items.map((item) => item.ticker)).toEqual(['ECOPETROL', 'GEB']);
    const second = await list(`?country=CO&limit=2&cursor=${first.next_cursor ?? ''}`);
    expect(second.items.map((item) => item.ticker)).toEqual(['ICOLCAP', 'ISA']);
  });

  it('un cursor corrupto → VALIDATION_ERROR en cursor', async () => {
    const response = await get(
      ctx.app,
      '/instruments?cursor=bm8tZXMtdW4tY3Vyc29y',
      session.headers,
    );
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'cursor', code: 'INVALID_FORMAT' }],
    });
  });
});

describe('GET /instruments/{id}', () => {
  it('agrega apertura, máximo, mínimo, cierre anterior, volumen y descripción', async () => {
    const response = await get(ctx.app, '/instruments/ECOPETROL-CO', session.headers);
    expect(response.statusCode).toBe(200);
    const detail = response.json<InstrumentDetailResponse>();

    expect(detail.prev_close).toBe('2400.00');
    expect(Number(detail.high)).toBeGreaterThanOrEqual(Number(detail.last_price));
    expect(Number(detail.low)).toBeLessThanOrEqual(Number(detail.last_price));
    expect(detail.volume).toBeGreaterThan(0);
    expect(detail.description).toMatch(/precio simulado/);
    // change y change_pct salen de last_price y prev_close, tal como se muestran.
    expect((Number(detail.last_price) - Number(detail.prev_close)).toFixed(2)).toBe(detail.change);
    expect(((Number(detail.change) / Number(detail.prev_close)) * 100).toFixed(2)).toBe(
      detail.change_pct,
    );
  });

  it('un id inexistente → INSTRUMENT_NOT_FOUND', async () => {
    const response = await get(ctx.app, '/instruments/NOEXISTE-CO', session.headers);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'INSTRUMENT_NOT_FOUND' });
  });

  it('el precio es determinístico: no cambia entre dos consultas en el mismo instante', async () => {
    const first = (
      await get(ctx.app, '/instruments/BAP-PE', session.headers)
    ).json<InstrumentDetailResponse>();
    const second = (
      await get(ctx.app, '/instruments/BAP-PE', session.headers)
    ).json<InstrumentDetailResponse>();
    expect(second).toEqual(first);
  });

  it('un precio congelado se refleja en el detalle y en el listado', async () => {
    await freezePrice(ctx.app, 'ISA-CO', '20000.00');
    const detail = (
      await get(ctx.app, '/instruments/ISA-CO', session.headers)
    ).json<InstrumentDetailResponse>();
    expect(detail.last_price).toBe('20000.00');
    expect(detail.prev_close).toBe('18000.00');
    expect(detail.change).toBe('2000.00');
    expect(detail.change_pct).toBe('11.11');
    expect(detail.high).toBe('20000.00');
    expect((await list('?q=ISA')).items[0]?.last_price).toBe('20000.00');

    await freezePrice(ctx.app, 'ISA-CO', null);
    const released = (
      await get(ctx.app, '/instruments/ISA-CO', session.headers)
    ).json<InstrumentDetailResponse>();
    expect(released.last_price).not.toBe('20000.00');
  });
});

describe('GET /instruments/{id}/prices', () => {
  const prices = async (id: string, range?: string): Promise<PricesResponse> => {
    const response = await get(
      ctx.app,
      `/instruments/${id}/prices${range === undefined ? '' : `?range=${range}`}`,
      session.headers,
    );
    expect(response.statusCode, response.body).toBe(200);
    return response.json<PricesResponse>();
  };

  it('por defecto devuelve 1D cada 5 minutos desde la apertura', async () => {
    const series = await prices('ECOPETROL-CO');
    expect(series.range).toBe('1D');
    expect(series.currency).toBe('COP');
    // 15:00Z son 30 minutos de sesión: 14:30, 14:35, …, 15:00.
    expect(series.points.map((point) => point.t)).toEqual([
      '2026-11-18T14:30:00Z',
      '2026-11-18T14:35:00Z',
      '2026-11-18T14:40:00Z',
      '2026-11-18T14:45:00Z',
      '2026-11-18T14:50:00Z',
      '2026-11-18T14:55:00Z',
      '2026-11-18T15:00:00Z',
    ]);
    for (const point of series.points) expect(point.price).toMatch(/^\d+\.\d{2}$/);
  });

  it.each(['1D', '1W', '1M', '3M', '1Y'])(
    'el rango %s termina en el último precio y no pasa de 400 puntos',
    async (range) => {
      const series = await prices('WALMEX-MX', range);
      const detail = (
        await get(ctx.app, '/instruments/WALMEX-MX', session.headers)
      ).json<InstrumentDetailResponse>();
      expect(series.range).toBe(range);
      expect(series.currency).toBe('MXN');
      expect(series.points.length).toBeGreaterThan(1);
      expect(series.points.length).toBeLessThanOrEqual(400);
      expect(series.points.at(-1)?.price).toBe(detail.last_price);
    },
  );

  it('un rango inválido → VALIDATION_ERROR; un id inexistente → 404', async () => {
    const invalid = await get(ctx.app, '/instruments/WALMEX-MX/prices?range=5Y', session.headers);
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json()).toMatchObject({ errors: [{ field: 'range', code: 'NOT_ALLOWED' }] });

    const missing = await get(ctx.app, '/instruments/NOEXISTE-MX/prices', session.headers);
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: 'INSTRUMENT_NOT_FOUND' });
  });
});

describe('precio congelado fuera de horario', () => {
  it('después del cierre el precio no cambia hasta la próxima apertura', async () => {
    const at = async (now: string): Promise<InstrumentDetailResponse> => {
      await post(ctx.app, '/_testing/clock', { now });
      return (
        await get(ctx.app, '/instruments/GEB-CO', session.headers)
      ).json<InstrumentDetailResponse>();
    };

    // El access token se emite de nuevo en cada salto de reloj para que no venza.
    const fresh = async (): Promise<void> => {
      session = await registerUser(ctx.app);
    };

    await post(ctx.app, '/_testing/clock', { now: '2026-11-20T21:30:00Z' });
    await fresh();
    const afterClose = await at('2026-11-20T21:30:00Z');
    expect(afterClose.updated_at).toBe('2026-11-20T21:00:00Z');

    await post(ctx.app, '/_testing/clock', { now: '2026-11-22T12:00:00Z' });
    await fresh();
    const weekend = await at('2026-11-22T12:00:00Z');
    expect(weekend.last_price).toBe(afterClose.last_price);
    expect(weekend.updated_at).toBe('2026-11-20T21:00:00Z');
    expect(weekend.volume).toBe(afterClose.volume);

    await post(ctx.app, '/_testing/clock', { now: '2026-11-23T16:00:00Z' });
    await fresh();
    const monday = await at('2026-11-23T16:00:00Z');
    expect(monday.prev_close).toBe(afterClose.last_price);
    expect(monday.updated_at).toBe('2026-11-23T16:00:00Z');

    await post(ctx.app, '/_testing/clock', { now: null });
  });
});
