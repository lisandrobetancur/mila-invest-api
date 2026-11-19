# Contrato de la API — MILA Invest

Este documento es el §7 del prompt del backend y es **idéntico al §8 del prompt
de la app** (`mila-invest-app`). Si cambia uno, cambia el otro en el mismo PR.
El OpenAPI generado (`docs/openapi.json`, servido en `/openapi.json` y `/docs`)
tiene que coincidir con él; un test de contrato lo verifica.

Al final hay una sección de **precisiones de implementación**: detalles que el
contrato deja abiertos y que la API resolvió por analogía. No cambian ninguna
forma del contrato, pero la app puede apoyarse en ellos.

## 7.1 Convenciones

- Base `/api/v1`, JSON UTF-8, claves en `snake_case`.
- Auth: `Authorization: Bearer <access_token>`. El access token (JWT, HS256;
  `sub` = user id, `exp`, `iat`, `jti`) vive 15 min. El refresh token es
  **opaco** (32 bytes aleatorios en base64url), vive 7 días y tiene
  **rotación**: cada refresh devuelve un par nuevo e invalida el anterior.
- Dinero como string decimal (`"1234.56"`) más `currency` en ISO 4217.
  Porcentajes como string decimal (`"2.35"` es 2,35 %).
- Timestamps ISO 8601 UTC con `Z` (`"2026-11-18T14:42:00Z"`).
- Ids con prefijo y opacos (`usr_…`, `acc_…`, `ord_…`, `txn_…`); los de
  instrumentos son `<TICKER>-<PAÍS>`.
- Paginación por cursor: query `cursor` y `limit` (default 20, máximo 100);
  respuesta `{ "items": [...], "next_cursor": "..." | null }`. El cursor es
  opaco (base64url de `(created_at, id)`), y el orden es estable:
  `created_at DESC, id DESC`.
- `Idempotency-Key` (UUID) **obligatorio** en `POST /orders` y
  `POST /accounts/{currency}/deposits`. Sin él → 422 `VALIDATION_ERROR` en el
  campo `Idempotency-Key`.
- 429 trae `Retry-After` en segundos.
- Toda respuesta trae `X-Request-Id` (se respeta el que manda el cliente o se
  genera uno), que también va en cada línea de log.
- CORS: orígenes permitidos desde `CORS_ORIGINS` (en dev, `localhost` y
  `127.0.0.1` en cualquier puerto, para Flutter web).

## 7.2 Endpoints de la Fase 1

| Método y ruta                        | Auth | Cuerpo / query                                                        | Respuesta                                                                                                                                                                                  |
| ------------------------------------ | ---- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /health`                        | no   | —                                                                     | `{ "status": "ok", "db": "ok" }` (fuera de `/api/v1`)                                                                                                                                      |
| `POST /auth/register`                | no   | `email, password, full_name, country, document_type, document_number` | 201 `{ user, tokens }`                                                                                                                                                                     |
| `POST /auth/login`                   | no   | `email, password`                                                     | `{ access_token, refresh_token, token_type: "bearer", expires_in }`                                                                                                                        |
| `POST /auth/refresh`                 | no   | `refresh_token`                                                       | par nuevo de tokens                                                                                                                                                                        |
| `POST /auth/logout`                  | sí   | `refresh_token`                                                       | 204                                                                                                                                                                                        |
| `GET /me`                            | sí   | —                                                                     | `{ id, email, full_name, country, base_currency, document_type, document_last4 }`                                                                                                          |
| `GET /meta/countries`                | no   | —                                                                     | `[{ code, currency, time_zone, document_types, market: { status, opens_at, closes_at } }]`                                                                                                 |
| `GET /accounts`                      | sí   | —                                                                     | `[{ id, currency, available, reserved }]`                                                                                                                                                  |
| `POST /accounts/{currency}/deposits` | sí   | `amount` (+ `Idempotency-Key`)                                        | 201 `transaction`                                                                                                                                                                          |
| `GET /instruments`                   | sí   | `country, type (STOCK\|ETF), q, cursor, limit`                        | paginado de `instrument` (orden: `country, ticker`)                                                                                                                                        |
| `GET /instruments/{id}`              | sí   | —                                                                     | `instrument` + `{ open, high, low, prev_close, volume, description }`                                                                                                                      |
| `GET /instruments/{id}/prices`       | sí   | `range` = `1D\|1W\|1M\|3M\|1Y`                                        | `{ range, currency, points: [{ t, price }] }`                                                                                                                                              |
| `POST /orders/preview`               | sí   | `instrument_id, side, type: "MARKET", quantity`                       | `{ estimated_price, gross, commission, total, currency, available_after, warnings: [] }`                                                                                                   |
| `POST /orders`                       | sí   | igual que preview (+ `Idempotency-Key`)                               | 201 `order`                                                                                                                                                                                |
| `GET /orders`                        | sí   | `status, cursor, limit`                                               | paginado de `order`                                                                                                                                                                        |
| `GET /orders/{id}`                   | sí   | —                                                                     | `order` (solo del propio usuario; si no, 404)                                                                                                                                              |
| `GET /portfolio`                     | sí   | —                                                                     | `{ base_currency, total_value, cash_value, invested_value, day_change, day_change_pct, positions: [...], allocation: [{ type, value, pct }], fx_rates_used: [{ from, to, rate, as_of }] }` |
| `GET /transactions`                  | sí   | `type (DEPOSIT\|BUY\|SELL\|FEE), from, to, cursor, limit`             | paginado de `transaction`                                                                                                                                                                  |
| `GET /dashboard/summary`             | sí   | —                                                                     | `{ portfolio_summary, top_movers: { gainers: [...], losers: [...] }, recent_transactions: [...] }`                                                                                         |

Formas principales:

```json
// instrument
{ "id": "ECOPETROL-CO", "ticker": "ECOPETROL", "name": "Ecopetrol S.A.",
  "country": "CO", "type": "STOCK", "currency": "COP",
  "last_price": "2385.00", "change": "35.00", "change_pct": "1.49",
  "updated_at": "2026-11-18T14:42:00Z" }

// position
{ "instrument": { ...instrument }, "quantity": 120, "avg_cost": "2210.50",
  "market_value": "286200.00", "unrealized_pnl": "20940.00",
  "unrealized_pnl_pct": "7.89", "currency": "COP" }

// order
{ "id": "ord_01H...", "instrument_id": "ECOPETROL-CO", "side": "BUY",
  "type": "MARKET", "quantity": 10, "status": "FILLED",
  "executed_price": "2386.00", "gross": "23860.00", "commission": "5000.00",
  "total": "28860.00", "currency": "COP", "reject_code": null,
  "created_at": "2026-11-18T14:43:10Z", "filled_at": "2026-11-18T14:43:10Z" }

// transaction
{ "id": "txn_01H...", "type": "BUY", "amount": "-23860.00", "currency": "COP",
  "description": "Compra 10 ECOPETROL", "order_id": "ord_01H...",
  "created_at": "2026-11-18T14:43:10Z" }
```

Notas:

- En `transaction`, `amount` lleva signo desde el punto de vista del usuario.
  Una compra genera una transacción `BUY` por el bruto y otra `FEE` por la
  comisión, ambas enlazadas a la misma orden; la suma de las dos es el total
  de la orden. `description` va en español; el cliente puede reconstruirla
  con `type`, la cantidad y el ticker si necesita otro idioma.
- `portfolio.total_value` y los totales del dashboard se expresan en la moneda
  base del usuario. En la fase 1 las posiciones de otras monedas se convierten
  con las tasas simuladas de §8.6, informadas en `fx_rates_used`.
- `day_change` = valor actual − valor al cierre anterior de las posiciones
  actuales.

Puntos de extensión de la fase 2 (no implementados, pero previstos):
`type: "LIMIT"` con `limit_price` en el enum y la columna; `status: "PENDING"`;
`accounts.reserved`; `DELETE /orders/{id}`; `/cdts`, `/funds`, `/fx/quotes`,
`/fx/conversions`.

## 7.3 Errores

Todo error es `application/problem+json`:

```json
{
  "type": "about:blank",
  "title": "Insufficient funds",
  "status": 422,
  "code": "INSUFFICIENT_FUNDS",
  "detail": "Available 12000.00 COP",
  "errors": [{ "field": "quantity", "code": "TOO_LARGE" }]
}
```

| `code`                     | Status | Cuándo                                                                                                                                             |
| -------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VALIDATION_ERROR`         | 422    | Joi rechazó body, query, path o headers, o una regla de validación del service; trae `errors[]` por campo. Reemplaza el 400 por defecto de Fastify |
| `AUTH_INVALID_CREDENTIALS` | 401    | email o contraseña incorrectos (mismo mensaje para ambos casos)                                                                                    |
| `AUTH_EMAIL_TAKEN`         | 409    | registro con email existente                                                                                                                       |
| `AUTH_DOCUMENT_TAKEN`      | 409    | registro con documento existente en el mismo país                                                                                                  |
| `AUTH_TOKEN_EXPIRED`       | 401    | access token vencido                                                                                                                               |
| `AUTH_TOKEN_INVALID`       | 401    | access token ausente, malformado o con firma inválida                                                                                              |
| `AUTH_REFRESH_INVALID`     | 401    | refresh inexistente, vencido, revocado o reutilizado                                                                                               |
| `INSUFFICIENT_FUNDS`       | 422    | compra sin saldo suficiente para bruto + comisión                                                                                                  |
| `INSUFFICIENT_POSITION`    | 422    | venta por más de lo que se tiene                                                                                                                   |
| `MARKET_CLOSED`            | 422    | orden o preview con el mercado del instrumento cerrado                                                                                             |
| `INSTRUMENT_NOT_FOUND`     | 404    | id de instrumento inexistente                                                                                                                      |
| `ORDER_NOT_FOUND`          | 404    | orden inexistente o de otro usuario                                                                                                                |
| `IDEMPOTENCY_CONFLICT`     | 409    | misma `Idempotency-Key` con otro cuerpo                                                                                                            |
| `RATE_LIMITED`             | 429    | límite de peticiones excedido                                                                                                                      |
| `NOT_FOUND`                | 404    | ruta inexistente                                                                                                                                   |
| `PAYLOAD_TOO_LARGE`        | 413    | cuerpo mayor que 64 KB                                                                                                                             |
| `INTERNAL_ERROR`           | 500    | cualquier error no controlado (sin stack trace en la respuesta)                                                                                    |

Códigos de campo en `errors[].code`: `REQUIRED`, `INVALID_FORMAT`, `TOO_SHORT`,
`TOO_LONG`, `TOO_SMALL`, `TOO_LARGE`, `NOT_ALLOWED`.

Una orden que pasa la validación pero se rechaza por regla de negocio **en el
momento de ejecutar** (por ejemplo, saldo insuficiente por una orden
concurrente) se guarda con `status: "REJECTED"` y su `reject_code`, y la
respuesta es 201 con esa orden. Los rechazos detectables antes de crear la
orden (mercado cerrado, validación) responden con el error y no crean orden.

---

## Precisiones de implementación

Detalles que el contrato no fija y que la API resolvió así. Ninguno cambia una
forma del contrato.

| Tema                             | Comportamiento                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rechazos previos                 | Además de mercado cerrado y validación, `INSUFFICIENT_FUNDS` e `INSUFFICIENT_POSITION` se responden como error (422, sin crear orden) si ya se detectan con el saldo y la posición antes de bloquear. `REJECTED` queda para cuando el estado cambia entre ese chequeo y la ejecución bloqueada. Ambos traen `errors: [{ field: "quantity", code: "TOO_LARGE" }]` |
| `reject_code`                    | Uno de `INSUFFICIENT_FUNDS`, `INSUFFICIENT_POSITION`, `MARKET_CLOSED`, o `null`. En una orden `REJECTED`, `executed_price` y `filled_at` son `null`; `gross`, `commission` y `total` muestran el cálculo al precio de ese instante                                                                                                                               |
| `total` en ventas                | Bruto − comisión (lo que se acredita). Puede ser negativo si la comisión mínima supera al bruto; en ese caso el neto se debita del saldo                                                                                                                                                                                                                         |
| `warnings`                       | `MARKET_CLOSING_SOON` (si aplica) antes de `PRICE_MAY_CHANGE`, que va siempre                                                                                                                                                                                                                                                                                    |
| `market` en `/meta/countries`    | `status` es `OPEN` o `CLOSED`. `opens_at`/`closes_at` son los de la sesión en curso, o los de la próxima si está cerrado                                                                                                                                                                                                                                         |
| Precio fuera de horario          | Congelado en el cierre de la última sesión; `updated_at` es ese cierre. `change` es contra el cierre de la sesión anterior a esa                                                                                                                                                                                                                                 |
| `volume`                         | Entero (acciones negociadas en la sesión hasta ese minuto)                                                                                                                                                                                                                                                                                                       |
| `allocation`                     | Siempre tres filas, en este orden: `CASH`, `STOCK`, `ETF`; `value` en moneda base                                                                                                                                                                                                                                                                                |
| `fx_rates_used`                  | Una fila por cada otra moneda de usuario hacia la moneda base, aunque no haya saldo en ella; `rate` con 6 decimales                                                                                                                                                                                                                                              |
| Orden de `positions`             | Por `instrument.id` ascendente                                                                                                                                                                                                                                                                                                                                   |
| `top_movers`                     | Hasta 3 por lista; `gainers` solo con `change_pct > 0` (de mayor a menor), `losers` solo con `< 0` (de menor a mayor)                                                                                                                                                                                                                                            |
| `recent_transactions`            | Las 5 más recientes                                                                                                                                                                                                                                                                                                                                              |
| `from` / `to` en `/transactions` | Inclusivos; ISO 8601 con `Z` u offset                                                                                                                                                                                                                                                                                                                            |
| Cursor de `/instruments`         | Opaco, pero codifica `(country, ticker)` porque ese es el orden de esa lista                                                                                                                                                                                                                                                                                     |
| Idempotencia                     | Por usuario; vigencia 24 h. La repetición devuelve la respuesta guardada aunque el estado haya cambiado. Una petición que terminó en error no consume la clave                                                                                                                                                                                                   |
| Depósitos                        | Montos con hasta 2 decimales; más decimales → `INVALID_FORMAT` en `amount`                                                                                                                                                                                                                                                                                       |
| Login                            | Rate limit de 5 por minuto por IP + email (configurable)                                                                                                                                                                                                                                                                                                         |
| Endpoints `_testing`             | Solo en `dev`/`test`. Además de los cinco de §11, hay `GET /_testing/ledger`, que verifica las invariantes del ledger                                                                                                                                                                                                                                            |
