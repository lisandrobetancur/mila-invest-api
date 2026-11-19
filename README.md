# mila-invest-api

Backend de **MILA Invest**, un simulador de inversiones (_paper trading_) para
Colombia, México y Perú. TypeScript + Fastify + Joi + PostgreSQL.

No se mueve dinero real, no hay integración con bolsas ni bancos, y la API no
es asesoría financiera: los precios, comisiones, horarios y tasas de cambio son
**simulados**.

## Arrancar

```bash
docker compose up --build
```

La API queda en `http://localhost:8000` con migraciones y seed aplicados:

- `GET http://localhost:8000/health`
- OpenAPI y Swagger UI: `http://localhost:8000/docs`
- Usuario demo: `demo@milainvest.app` / `Demo1234!`

## Desarrollo local

```bash
pnpm install
cp .env.example .env
docker compose up -d db
pnpm db:migrate && pnpm db:seed
pnpm dev
```

Si el puerto 5432 ya está ocupado (por un PostgreSQL local), publicá la base en
otro: `DB_HOST_PORT=5433 docker compose up -d db` y ajustá `DATABASE_URL`.

## Tests

Corren contra un PostgreSQL real, en una base aparte cuyo nombre debe terminar
en `_test` (se crea sola y se trunca en cada archivo):

```bash
TEST_DATABASE_URL=postgres://mila:mila@localhost:5432/mila_test pnpm test:coverage
```

## Comandos

| Comando                                               | Qué hace                           |
| ----------------------------------------------------- | ---------------------------------- |
| `pnpm dev`                                            | servidor con recarga (`tsx watch`) |
| `pnpm build` / `pnpm start`                           | compila a `dist/` y ejecuta        |
| `pnpm lint`, `pnpm format:check`, `pnpm typecheck`    | calidad de código                  |
| `pnpm test`, `pnpm test:coverage`                     | tests (requieren PostgreSQL)       |
| `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:seed` | migraciones y datos                |
| `pnpm openapi:export`                                 | regenera `docs/openapi.json`       |

## Documentación

- [`docs/architecture.md`](docs/architecture.md) — estructura y reglas de arquitectura
- [`docs/api-contract.md`](docs/api-contract.md) — contrato de la API (lo mismo que consume la app)
- [`docs/domain-rules.md`](docs/domain-rules.md) — reglas de dominio y dinero
- [`docs/decisions.md`](docs/decisions.md) — decisiones técnicas y sus consecuencias
