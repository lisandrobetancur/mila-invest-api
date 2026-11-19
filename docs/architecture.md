# Arquitectura

Servicio REST en TypeScript (ESM, `strict`) con Fastify 5, Joi y PostgreSQL 17
vía drizzle-orm + pg.

## Capas

```
HTTP (Fastify)
  │  hooks globales: request id, helmet, CORS, lectura del Bearer, rate limit
  ▼
routes.ts      defineRoute(): schemas Joi → validación + OpenAPI + serialización
  │            el handler llama a un service y devuelve un objeto plano
  ▼
service.ts     reglas de negocio; abre transacciones con withTransaction()
  │            mapea filas → respuestas del contrato
  ▼
repository.ts  consultas drizzle; reciben el cliente o la transacción
  ▼
PostgreSQL
```

Reglas (verificables con grep, ver criterio 10 del prompt):

1. `routes → service → repository`, en un sentido. Ningún `routes.ts` importa
   drizzle, la base ni una tabla.
2. La transacción la abre el service. Todo lo que mueve dinero o posiciones
   ocurre en una sola transacción.
3. `buildApp(deps)` (`src/app.ts`) es la raíz de composición: recibe
   `{ config, clock, db, logger }` y llama a `createServices`
   (`src/services.ts`), que construye repositorios y services una sola vez y
   los expone como `app.services`.
4. Nadie usa `new Date()` sin argumentos fuera de `src/core/clock.ts`: el
   `Clock` se inyecta.
5. Nadie usa `number` para dinero; nadie lee `process.env` fuera de
   `src/core/config.ts`; nadie usa `console.*`.
6. Las excepciones de negocio son `AppError`; el error handler las convierte
   en `problem+json`.

## Estructura

```
src/
├── main.ts              lee config, construye la app y escucha
├── app.ts               buildApp: plugins, swagger, rutas, errores
├── services.ts          contenedor de servicios (createServices)
├── core/                config (Joi), clock, ids (ULID), money, errors,
│                        security (argon2, jose), pagination, idempotency, logger
├── http/                joi-validator, define-route, error-handler, auth,
│                        health-route, schemas/common.ts
├── db/                  client, transaction, migrate, seed, seed-data,
│                        columns, keyset, idempotency-table, health
├── modules/<módulo>/    routes, schemas, table, repository, service, errors
└── types/fastify.d.ts   app.services, request.user
```

Módulos: `auth`, `users`, `meta`, `accounts`, `market`, `orders`,
`portfolio`, `transactions`, `dashboard` y `testing` (solo dev/test).

Archivos extra respecto de la estructura del prompt, todos por analogía:

| Archivo                                                                        | Por qué                                                             |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `src/services.ts`                                                              | separa la construcción del grafo de dependencias de `buildApp`      |
| `src/core/domain.ts`                                                           | enums compartidos (países, monedas, estados) como tuplas `as const` |
| `src/core/logger.ts`                                                           | opciones de pino con `redact`, compartidas por la app y los scripts |
| `src/db/columns.ts`, `keyset.ts`, `health.ts`, `run-script.ts`, `seed-data.ts` | helpers de la capa de datos                                         |
| `src/db/idempotency-table.ts`                                                  | `idempotency_records` es transversal, no pertenece a un módulo      |
| `src/http/health-route.ts`                                                     | `/health` vive fuera de `/api/v1`                                   |
| `modules/meta/data.ts`, `calendar.ts`, `rules.ts`                              | configuración simulada, calendario y cálculos puros                 |
| `modules/accounts/ledger.ts`                                                   | el ledger de doble partida                                          |
| `modules/market/engine.ts`, `prng.ts`, `lru.ts`                                | motor de precios                                                    |

## Validación con Joi

- `src/http/joi-validator.ts` es el `validatorCompiler`: valida cada parte con
  sus opciones (`body` sin conversión de tipos; `querystring`/`params` con
  conversión; `headers` admitiendo desconocidos) y devuelve el valor validado.
- `src/http/define-route.ts` convierte cada schema a JSON Schema con
  `joi-to-json` para el OpenAPI y para `schema.response`, que filtra y
  serializa la respuesta. En `APP_ENV=test` además valida cada respuesta contra
  su schema Joi en `onSend`: cualquier desvío del contrato se vuelve un 500 y
  hace fallar el test que lo provocó.
- Joi no infiere tipos: cada `schemas.ts` declara la interfaz junto al schema
  (`Joi.ObjectSchema<T>`), y los tests de `tests/unit/schemas-*.test.ts`
  validan un ejemplo tipado con la interfaz y un ejemplo inválido por regla.

## Autenticación

- `onRequest` global (`readAccessToken`): verifica el JWT si viene y deja los
  claims en la petición, sin consultar la base. Así el rate limit puede contar
  por usuario.
- `preParsing` de las rutas con `auth: true` (`requireAuth`): exige token
  válido y carga `request.user`. Corre antes de leer el cuerpo, así que una
  petición sin token responde 401 antes que un 422.

## Errores

`AppError(code, { detail, fieldErrors })` → `toProblem()`. El error handler
(`src/http/error-handler.ts`) también traduce los errores de Joi
(`VALIDATION_ERROR` con `errors[]`), los de Fastify (413, JSON malformado) y
cualquier otro (`INTERNAL_ERROR`, sin stack). `setNotFoundHandler` responde
`NOT_FOUND`.

## Tests

Vitest + `app.inject()` contra un PostgreSQL real (`TEST_DATABASE_URL`, cuyo
nombre debe terminar en `_test`). `tests/helpers/global-setup.ts` crea la base
y aplica migraciones; `buildTestApp()` construye la app real con un
`FrozenClock` (detrás de un `ControllableClock`) y la base truncada con el
seed mínimo. Los archivos corren en serie (`fileParallelism: false`).

| Carpeta             | Qué cubre                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit`        | money, clock e ids, paginación, config, comisiones y tasas, calendario, motor de precios, errores y seguridad, validador Joi, schemas de cada módulo    |
| `tests/integration` | HTTP (errores, CORS, auth), auth, cuentas e idempotencia, mercado, órdenes, concurrencia, portafolio/transacciones/dashboard, módulo `testing` y `prod` |
| `tests/contract`    | `docs/openapi.json` actualizado, endpoints de §7.2 documentados, flujo demo completo, errores problem+json                                              |

Los tests que mueven dinero verifican las invariantes del ledger en
`afterEach`. Para el rechazo "al momento de ejecutar",
`tests/helpers/locks.ts` retiene el bloqueo de la cuenta hasta que todas las
peticiones están esperando, y recién entonces lo libera.
