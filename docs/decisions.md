# Decisiones técnicas

Formato: contexto, decisión, consecuencias. Las 12 primeras vienen del prompt
(§14); las siguientes se tomaron al implementar.

## 1. Fastify como framework

**Contexto.** Se buscaba lo más parecido a FastAPI en TypeScript: validación
declarativa por ruta, OpenAPI automático, async nativo y tests sin levantar el
servidor.
**Decisión.** Fastify 5. Descartados: hapi (Joi nativo, pero mantenido por un
comité chico y con OpenAPI vía un plugin comunitario), NestJS (más pesado,
orientado a decoradores y `class-validator`), Hono y Elysia (orientados a Zod o
TypeBox).
**Consecuencias.** Schemas por ruta, hooks, `app.inject()` en los tests y
`@fastify/swagger`. Hay que conectar Joi a mano (ver 2).

## 2. Joi como única librería de validación

**Contexto.** Joi valida bien y da errores detallados, pero Fastify trae AJV y
no infiere tipos.
**Decisión.** Joi valida requests (vía `validatorCompiler`), configuración y,
en `APP_ENV=test`, respuestas. `joi-to-json` convierte los schemas a JSON
Schema solo para documentar (OpenAPI) y para serializar respuestas.
**Consecuencias.** Las interfaces TypeScript se declaran a mano junto a cada
schema (`Joi.ObjectSchema<T>`) y un test por módulo verifica que coinciden. El
body se valida con `convert: false`, así que las normalizaciones de strings
(email en minúsculas, `trim`, CURP en mayúsculas) se habilitan campo por campo
con `prefs({ convert: true })`; los números siguen sin convertirse.

## 3. Drizzle + pg con repositorios explícitos

**Contexto.** Se necesita SQL tipado, `SELECT … FOR UPDATE` y `NUMERIC` como
string.
**Decisión.** drizzle-orm sobre `pg`, migraciones con drizzle-kit revisadas a
mano. Descartados Prisma (bloqueos solo con SQL crudo, `Decimal` propio) y
TypeORM.
**Consecuencias.** Cada módulo define sus tablas; los nombres de restricciones
siguen `pk_`, `fk_`, `uq_`, `ck_`, `ix_`.

## 4. Ledger de doble partida con saldo cacheado

**Decisión.** `ledger_journals` + `ledger_entries` que suman cero por moneda,
cuentas de sistema `system:{deposits,fees,market}:<CUR>`, y `available` /
`reserved` cacheados en `accounts`, actualizados en la misma transacción.
**Consecuencias.** Lecturas de saldo baratas, auditoría completa y una
invariante verificable (`available + reserved == SUM(entries)`) que los tests
comprueban después de cada escenario. Las cuentas de sistema pueden quedar en
negativo: el `CHECK` de saldo no negativo aplica solo a cuentas de usuario.

## 5. `decimal.js` + `NUMERIC` + strings en JSON

**Decisión.** Nunca `number` para dinero. `Decimal` con precisión 28 y
redondeo bancario, `NUMERIC` en la base, string decimal en el JSON.
**Consecuencias.** Un monto enviado como número JSON se rechaza. Los cálculos
son exactos (`0.1 + 0.2 == 0.3`).

## 6. Motor de precios como función pura

**Decisión.** El precio es función de `(PRICE_SEED, instrument_id, minuto)`:
PRNG `mulberry32` sembrado por día, random walk geométrico de cierres y un
puente browniano intradía. Sin jobs ni tablas de precios.
**Consecuencias.** Mismo seed y mismo instante dan el mismo precio en cualquier
máquina, lo que hace los escenarios de QA repetibles. El ancla del walk es el
cierre del 17-nov-2026 (igual al precio base del seed); calcular un día lejano
recorre el walk día por día, mitigado con cachés LRU.

## 7. Refresh tokens opacos con rotación y detección de reutilización

**Decisión.** 32 bytes aleatorios; se guarda su `sha256` con `family_id`,
`expires_at`, `revoked_at` y `replaced_by`. Presentar un token ya rotado revoca
toda la familia.
**Consecuencias.** Un token robado y usado deja inservible la sesión entera.
La revocación se confirma en su propia transacción aunque la respuesta sea un 401.

## 8. Idempotencia persistida

**Decisión.** `idempotency_records` (`user_id`, `key`, `request_hash`,
`status_code`, `response_body`, `created_at`), único por `(user_id, key)`,
vigencia 24 h, escrito en la misma transacción que la operación con
`INSERT … ON CONFLICT DO NOTHING`.
**Consecuencias.** Dos peticiones simultáneas con la misma clave se serializan
en la restricción única: la segunda espera y devuelve la respuesta guardada.
Si la operación falla, el registro se revierte con ella y la clave queda libre.
El `request_hash` se calcula sobre el cuerpo **ya validado y normalizado**
(`"250"` y `"250.00"` son el mismo depósito).

## 9. Bloqueos explícitos en orden fijo y reintento acotado

**Decisión.** `READ COMMITTED` + `FOR UPDATE` (cuenta antes que posición; los
saldos se actualizan por `id` ascendente). `withTransaction` reintenta hasta 3
veces ante `40P01` y `40001`.
**Consecuencias.** Sin deadlocks en los flujos normales; el reintento cubre los
casos raros sin duplicar efectos, porque la idempotencia vive dentro de la
misma transacción.

## 10. Errores `problem+json` con `code` estable

**Decisión.** Todo error sale como `application/problem+json` con un `code`
del catálogo y, si aplica, `errors[]` por campo. 422 en vez del 400 de Fastify.
**Consecuencias.** La app y los tests de QA dependen del `code`, no del texto.

## 11. Endpoints `_testing` solo en dev/test

**Decisión.** El módulo `testing` solo se construye y registra con `APP_ENV`
`dev` o `test`; en `prod` sus rutas no existen (404) y no aparecen en el
OpenAPI.
**Consecuencias.** Escenarios repetibles (reloj, mercado, precios, usuarios a
medida) sin exponer nada en producción. Un test lo verifica.

## 12. Rate limit en memoria

**Decisión.** `@fastify/rate-limit` con almacenamiento en memoria: 120/min por
usuario autenticado (o IP) y 5/min en login por IP + email.
**Consecuencias.** Suficiente para una réplica. **Con más de una réplica hace
falta un almacenamiento compartido** (p. ej. Redis), que quedó fuera de
alcance. Igual con los overrides de `_testing` (reloj, precios, mercado), que
también viven en memoria del proceso.

---

## 13. TypeScript 6.0 en lugar de 7.0

**Contexto.** Al instalar, la última estable de `typescript` era la 7.0.2, pero
`typescript-eslint` (8.73.0, la última) solo soporta `< 6.1.0`, y el lint
pedido (`strictTypeChecked`) necesita análisis con tipos.
**Decisión.** Fijar `typescript@6.0.3`, la última 6.x.
**Consecuencias.** Subir a 7.x cuando `typescript-eslint` lo soporte.

## 14. Rechazos previos antes de bloquear

**Contexto.** El contrato dice que los rechazos detectables antes de crear la
orden responden con error, y que los que ocurren "al momento de ejecutar"
quedan `REJECTED` con 201.
**Decisión.** La ejecución hace primero los chequeos sin bloqueo (mercado,
saldo, posición): si fallan, responde 422 y no crea orden. Después bloquea,
recalcula y vuelve a verificar: si ahora falla, guarda la orden `REJECTED`.
**Consecuencias.** Una orden sin saldo hecha en reposo responde
`INSUFFICIENT_FUNDS` (lo que espera la app). `REJECTED` queda para las
carreras reales, como el test de 20 órdenes simultáneas.

## 15. Ids ULID monotónicos

**Decisión.** El cuerpo del id es un ULID tomado del `Clock` inyectado; dentro
del mismo milisegundo la parte aleatoria se incrementa.
**Consecuencias.** Con el reloj congelado (tests, `_testing/clock`) los ids
siguen creciendo en orden de creación, y el desempate `created_at DESC, id DESC`
devuelve primero lo más nuevo.

## 16. Configuración de desarrollo

- El `.env` se carga con `process.loadEnvFile` (nativo de Node, sin `dotenv`)
  desde `loadConfig()`; las variables del entorno tienen prioridad.
- `drizzle.config.ts` lee `DATABASE_URL` directamente: es herramienta de
  build, fuera de `src/`.
- `DB_HOST_PORT` en `docker-compose.yml` permite publicar PostgreSQL en otro
  puerto si el 5432 está ocupado.
- `TRUST_PROXY` (default `false`) habilita `trustProxy` de Fastify.
- Los tests usan una base separada (`TEST_DATABASE_URL`, default
  `postgres://mila:mila@localhost:5432/mila_test`) cuyo nombre debe terminar en
  `_test`, porque se trunca en cada archivo.
