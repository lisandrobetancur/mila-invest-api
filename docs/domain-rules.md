# Reglas de dominio

Reglas de negocio de la fase 1 (§6 y §8 del prompt), con el archivo donde vive
cada una. Todo lo que es **configuración simulada** (horarios, comisiones,
límites, tasas) está en [`src/modules/meta/data.ts`](../src/modules/meta/data.ts):
los services no tienen esos valores hardcodeados.

> Las comisiones, horarios y tasas son simulados: no reflejan tarifas ni
> horarios reales de la BVC, la BMV ni la BVL.

## Dinero y precisión

| Dónde      | Tipo                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| Lógica     | `Decimal` (decimal.js), `precision: 28`, `ROUND_HALF_EVEN`, configurado una vez en `src/core/money.ts` |
| PostgreSQL | montos `NUMERIC(20,4)`, precios `NUMERIC(20,6)`, porcentajes `NUMERIC(10,4)`, cantidades `BIGINT`      |
| JSON       | string decimal (`"1234.56"`); un número JSON en un campo de dinero se rechaza                          |

- Montos: 2 decimales en COP, MXN, PEN y USD, redondeo bancario.
- Precios: se guardan con hasta 6 decimales y se responden con 2.
- `number` solo para cantidades de acciones, `limit`, volumen y contadores.

## Países (§8.1)

| País | Moneda | Zona horaria          | Documentos  | Mercado (lun a vie, hora local) | Comisión                                                      |
| ---- | ------ | --------------------- | ----------- | ------------------------------- | ------------------------------------------------------------- |
| CO   | COP    | `America/Bogota`      | `CC`, `CE`  | 09:30 – 16:00                   | 0,30 % del bruto, mínimo COP 5.000                            |
| MX   | MXN    | `America/Mexico_City` | `CURP`      | 08:30 – 15:00                   | 0,25 % del bruto, mínimo MXN 15, + IVA 16 % sobre la comisión |
| PE   | PEN    | `America/Lima`        | `DNI`, `CE` | 09:00 – 16:00                   | 0,35 % del bruto, mínimo PEN 5                                |

- Sin feriados en la fase 1 (la estructura los admite: `holidays`).
- El estado del mercado se calcula con el `Clock` inyectado e
  `Intl.DateTimeFormat` (`src/modules/meta/calendar.ts`). Abierto si
  `apertura <= t < cierre`.
- `MARKET_ALWAYS_OPEN=true` ignora los horarios (default en `dev`/`test`).
  `POST /_testing/market/{country}` lo pisa por país.

## Registro (§8.2)

| Campo             | Regla                                                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `email`           | email válido, se pasa a minúsculas, máximo 254, único                                                                                                                         |
| `password`        | 8 a 128 caracteres, al menos una letra y un número                                                                                                                            |
| `full_name`       | se recorta, 3 a 80 caracteres                                                                                                                                                 |
| `country`         | `CO`, `MX` o `PE`                                                                                                                                                             |
| `document_type`   | uno de los permitidos para el país                                                                                                                                            |
| `document_number` | `CC`: 6–10 dígitos · `CE` (CO): 6–12 alfanuméricos · `CURP`: se pasa a mayúsculas, `^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$` · `DNI`: 8 dígitos · `CE` (PE): 9–12 alfanuméricos |

- Del documento solo se guarda `HMAC-SHA256(DOCUMENT_PEPPER, país|tipo|NÚMERO)`
  (para la unicidad, con el número en mayúsculas) y los últimos 4 caracteres.
- Al registrarse, el usuario recibe sus cuentas COP, MXN y PEN en cero; su
  `base_currency` es la de su país.

## Depósitos virtuales (§8.3)

| Moneda | Máximo por depósito | Máximo acumulado por cuenta |
| ------ | ------------------- | --------------------------- |
| COP    | 100.000.000         | 1.000.000.000               |
| MXN    | 500.000             | 5.000.000                   |
| PEN    | 100.000             | 1.000.000                   |

- Monto > 0 con hasta 2 decimales. Por encima de un máximo →
  `VALIDATION_ERROR` en `amount` con `TOO_LARGE`.
- Journal `system:deposits:<CUR>` → cuenta del usuario, más una transacción
  `DEPOSIT`. Requiere `Idempotency-Key`.

## Órdenes (§8.4) — `src/modules/orders/service.ts`

- Solo `MARKET`, lados `BUY`/`SELL`, para `STOCK` y `ETF`; `quantity` entero de
  1 a 1.000.000.
- Se paga con la cuenta en la moneda del instrumento; no hay conversión
  automática. No hay ventas en corto.
- **Precio de ejecución:** último precio (redondeado a 2 decimales) ± spread
  de 0,10 % (compra arriba, venta abajo), cuantizado a 2 decimales.
- **Bruto** = precio × cantidad. **Total** de una compra = bruto + comisión; de
  una venta = bruto − comisión.
- **Preview:** el mismo cálculo, sin escribir nada. `warnings`:
  `MARKET_CLOSING_SOON` si faltan menos de 15 minutos para el cierre,
  `PRICE_MAY_CHANGE` siempre.
- **Ejecución**, en una sola transacción:
  1. registro de `Idempotency-Key`;
  2. chequeos sin bloqueo (mercado, saldo, posición): si fallan, responde el
     error y no crea orden;
  3. `SELECT … FOR UPDATE` de la cuenta y después de la posición;
  4. recálculo del precio y nueva verificación: si ahora falla, la orden se
     guarda `REJECTED` con su `reject_code` y se responde 201;
  5. journal, posición, orden `FILLED`, transacciones `BUY`/`SELL` + `FEE`.
- **Posiciones:** costo promedio ponderado en las compras; las ventas no lo
  cambian y registran la ganancia realizada (`orders.realized_pnl`, interna).
  Con cantidad 0 la posición se borra.

## Ledger de doble partida (§6) — `src/modules/accounts/ledger.ts`

| Movimiento | Entradas (positivo = crédito)                                                       |
| ---------- | ----------------------------------------------------------------------------------- |
| Depósito   | usuario `+monto`; `system:deposits` `−monto`                                        |
| Compra     | usuario `−bruto` y `−comisión`; `system:market` `+bruto`; `system:fees` `+comisión` |
| Venta      | usuario `+bruto` y `−comisión`; `system:market` `−bruto`; `system:fees` `+comisión` |

- Cada journal suma cero por moneda; se verifica con `Decimal` antes de
  escribir (`INTERNAL_ERROR` si no cuadra).
- El saldo cacheado (`available`, `reserved`) se actualiza en la misma
  transacción, por `id` de cuenta ascendente.
- Invariante: para toda cuenta, `available + reserved == SUM(ledger_entries)`.
  Los tests de integración la verifican después de cada escenario; en dev/test
  también `GET /_testing/ledger`.
- `CHECK (available >= 0 AND reserved >= 0)` en las cuentas de usuario. Las de
  sistema son contrapartidas y pueden quedar negativas.

## Concurrencia

- Bloqueos explícitos en orden fijo: cuenta antes que posición.
- `READ COMMITTED`; `withTransaction` reintenta hasta 3 veces ante `40P01` y
  `40001` (`src/db/transaction.ts`).
- Pool de `pg` de tamaño configurable y `statement_timeout` de 5 s.

## Motor de precios (§8.5) — `src/modules/market/engine.ts`

- Función pura de `(PRICE_SEED, instrument_id, minuto)`, sin jobs ni tablas.
- PRNG `mulberry32` sembrado con los primeros 4 bytes de
  `sha256(seed|instrument_id|día)` (`src/modules/market/prng.ts`).
- Cierres: random walk geométrico con volatilidad diaria por instrumento
  (1 % a 3 %), anclado en el precio base del seed como cierre del
  **17-nov-2026**; hacia atrás el walk se recorre al revés.
- Intradía: puente browniano por minuto entre el cierre anterior (más un gap de
  apertura) y el cierre del día. Todo con `Decimal`.
- Fuera de horario el precio queda congelado en el último cierre.
- Series: `1D` cada 5 min de la sesión, `1W` cada hora (5 sesiones), `1M` y
  `3M` diario, `1Y` semanal (cierre de cada semana). Máximo 400 puntos.
- `change` / `change_pct` contra el cierre del día hábil anterior.
- `POST /_testing/prices/{id}` congela un precio en memoria.
- Cachés LRU en proceso; el resultado no depende de ellas.

## Tasas de cambio (§8.6)

`USD/COP 4000`, `USD/MXN 18.5`, `USD/PEN 3.75`. Las cruzadas se derivan vía USD
con `Decimal`. Solo se usan para valorizar el portafolio en la moneda base.

## Seed (§8.7 y §10) — `src/db/seed-data.ts`

| País | Instrumentos (precio base)                                                                  |
| ---- | ------------------------------------------------------------------------------------------- |
| CO   | `ECOPETROL` 2.400 · `PFBCOLOM` 34.000 · `ISA` 18.000 · `GEB` 2.700 · `ICOLCAP` (ETF) 15.000 |
| MX   | `WALMEX` 60 · `AMXB` 17 · `GFNORTEO` 160 · `CEMEXCPO` 12                                    |
| PE   | `BAP` 650 · `SCCO` 380 · `BVN` 55 · `FERREYC1` 2,50                                         |

Usuario demo: `demo@milainvest.app` / `Demo1234!` (CO), con COP 50.000.000,
MXN 200.000, PEN 40.000 y posiciones `ECOPETROL-CO` 120 (costo 2.210,50),
`WALMEX-MX` 50 (58,40) y `BAP-PE` 10 (640,00), creadas con depósitos, órdenes
y journals reales. Ids literales y fechas fijas; correr el seed dos veces no
cambia nada.
