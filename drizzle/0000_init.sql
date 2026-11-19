CREATE TABLE "accounts" (
	"id" text NOT NULL,
	"user_id" text,
	"system_code" text,
	"currency" text NOT NULL,
	"available" numeric(20, 4) DEFAULT '0' NOT NULL,
	"reserved" numeric(20, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "pk_accounts" PRIMARY KEY("id"),
	CONSTRAINT "uq_accounts_user_currency" UNIQUE("user_id","currency"),
	CONSTRAINT "uq_accounts_system_code" UNIQUE("system_code"),
	CONSTRAINT "ck_accounts_currency" CHECK ("accounts"."currency" IN ('COP', 'MXN', 'PEN', 'USD')),
	CONSTRAINT "ck_accounts_owner" CHECK (("accounts"."user_id" IS NULL) <> ("accounts"."system_code" IS NULL)),
	CONSTRAINT "ck_accounts_non_negative" CHECK ("accounts"."user_id" IS NULL OR ("accounts"."available" >= 0 AND "accounts"."reserved" >= 0))
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" text NOT NULL,
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status_code" integer,
	"response_body" jsonb,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "pk_idempotency_records" PRIMARY KEY("id"),
	CONSTRAINT "uq_idempotency_records_user_key" UNIQUE("user_id","key")
);
--> statement-breakpoint
CREATE TABLE "instruments" (
	"id" text NOT NULL,
	"ticker" text NOT NULL,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"type" text NOT NULL,
	"currency" text NOT NULL,
	"base_price" numeric(20, 6) NOT NULL,
	"daily_volatility_pct" numeric(10, 4) NOT NULL,
	"base_volume" bigint NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "pk_instruments" PRIMARY KEY("id"),
	CONSTRAINT "uq_instruments_country_ticker" UNIQUE("country","ticker"),
	CONSTRAINT "ck_instruments_country" CHECK ("instruments"."country" IN ('CO', 'MX', 'PE')),
	CONSTRAINT "ck_instruments_type" CHECK ("instruments"."type" IN ('STOCK', 'ETF')),
	CONSTRAINT "ck_instruments_currency" CHECK ("instruments"."currency" IN ('COP', 'MXN', 'PEN')),
	CONSTRAINT "ck_instruments_base_price_positive" CHECK ("instruments"."base_price" > 0),
	CONSTRAINT "ck_instruments_volatility_range" CHECK ("instruments"."daily_volatility_pct" > 0 AND "instruments"."daily_volatility_pct" <= 10)
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" text NOT NULL,
	"journal_id" text NOT NULL,
	"account_id" text NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "pk_ledger_entries" PRIMARY KEY("id"),
	CONSTRAINT "ck_ledger_entries_amount_non_zero" CHECK ("ledger_entries"."amount" <> 0),
	CONSTRAINT "ck_ledger_entries_currency" CHECK ("ledger_entries"."currency" IN ('COP', 'MXN', 'PEN', 'USD'))
);
--> statement-breakpoint
CREATE TABLE "ledger_journals" (
	"id" text NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "pk_ledger_journals" PRIMARY KEY("id"),
	CONSTRAINT "ck_ledger_journals_kind" CHECK ("ledger_journals"."kind" IN ('DEPOSIT', 'ORDER'))
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text NOT NULL,
	"user_id" text NOT NULL,
	"instrument_id" text NOT NULL,
	"side" text NOT NULL,
	"type" text NOT NULL,
	"quantity" bigint NOT NULL,
	"limit_price" numeric(20, 6),
	"status" text NOT NULL,
	"executed_price" numeric(20, 6),
	"gross" numeric(20, 4) NOT NULL,
	"commission" numeric(20, 4) NOT NULL,
	"total" numeric(20, 4) NOT NULL,
	"currency" text NOT NULL,
	"reject_code" text,
	"realized_pnl" numeric(20, 4),
	"created_at" timestamp (3) with time zone NOT NULL,
	"filled_at" timestamp (3) with time zone,
	CONSTRAINT "pk_orders" PRIMARY KEY("id"),
	CONSTRAINT "ck_orders_side" CHECK ("orders"."side" IN ('BUY', 'SELL')),
	CONSTRAINT "ck_orders_type" CHECK ("orders"."type" IN ('MARKET', 'LIMIT')),
	CONSTRAINT "ck_orders_status" CHECK ("orders"."status" IN ('PENDING', 'FILLED', 'REJECTED', 'CANCELLED')),
	CONSTRAINT "ck_orders_quantity_range" CHECK ("orders"."quantity" BETWEEN 1 AND 1000000),
	CONSTRAINT "ck_orders_currency" CHECK ("orders"."currency" IN ('COP', 'MXN', 'PEN')),
	CONSTRAINT "ck_orders_amounts_non_negative" CHECK ("orders"."gross" >= 0 AND "orders"."commission" >= 0),
	CONSTRAINT "ck_orders_filled_consistency" CHECK (("orders"."status" = 'FILLED') = ("orders"."filled_at" IS NOT NULL AND "orders"."executed_price" IS NOT NULL)),
	CONSTRAINT "ck_orders_reject_consistency" CHECK (("orders"."status" = 'REJECTED') = ("orders"."reject_code" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" text NOT NULL,
	"user_id" text NOT NULL,
	"instrument_id" text NOT NULL,
	"quantity" bigint NOT NULL,
	"avg_cost" numeric(20, 6) NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "pk_positions" PRIMARY KEY("id"),
	CONSTRAINT "uq_positions_user_instrument" UNIQUE("user_id","instrument_id"),
	CONSTRAINT "ck_positions_quantity_positive" CHECK ("positions"."quantity" > 0),
	CONSTRAINT "ck_positions_avg_cost_non_negative" CHECK ("positions"."avg_cost" >= 0),
	CONSTRAINT "ck_positions_currency" CHECK ("positions"."currency" IN ('COP', 'MXN', 'PEN'))
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" text NOT NULL,
	"user_id" text NOT NULL,
	"family_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"revoked_at" timestamp (3) with time zone,
	"replaced_by" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "pk_refresh_tokens" PRIMARY KEY("id"),
	CONSTRAINT "uq_refresh_tokens_token_hash" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" text NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"currency" text NOT NULL,
	"description" text NOT NULL,
	"order_id" text,
	"journal_id" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "pk_transactions" PRIMARY KEY("id"),
	CONSTRAINT "ck_transactions_type" CHECK ("transactions"."type" IN ('DEPOSIT', 'BUY', 'SELL', 'FEE')),
	CONSTRAINT "ck_transactions_currency" CHECK ("transactions"."currency" IN ('COP', 'MXN', 'PEN'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"country" text NOT NULL,
	"base_currency" text NOT NULL,
	"document_type" text NOT NULL,
	"document_hash" text NOT NULL,
	"document_last4" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "pk_users" PRIMARY KEY("id"),
	CONSTRAINT "uq_users_email" UNIQUE("email"),
	CONSTRAINT "uq_users_document_hash" UNIQUE("document_hash"),
	CONSTRAINT "ck_users_country" CHECK ("users"."country" IN ('CO', 'MX', 'PE')),
	CONSTRAINT "ck_users_base_currency" CHECK ("users"."base_currency" IN ('COP', 'MXN', 'PEN')),
	CONSTRAINT "ck_users_document_type" CHECK ("users"."document_type" IN ('CC', 'CE', 'CURP', 'DNI')),
	CONSTRAINT "ck_users_email_lowercase" CHECK ("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "fk_accounts_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "fk_idempotency_records_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "fk_ledger_entries_journal_id" FOREIGN KEY ("journal_id") REFERENCES "public"."ledger_journals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "fk_ledger_entries_account_id" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "fk_orders_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "fk_orders_instrument_id" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "fk_positions_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "fk_positions_instrument_id" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "fk_refresh_tokens_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "fk_transactions_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "fk_transactions_order_id" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "fk_transactions_journal_id" FOREIGN KEY ("journal_id") REFERENCES "public"."ledger_journals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_ledger_entries_journal_id" ON "ledger_entries" USING btree ("journal_id");--> statement-breakpoint
CREATE INDEX "ix_ledger_entries_account_id" ON "ledger_entries" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ix_orders_user_created" ON "orders" USING btree ("user_id","created_at" desc,"id" desc);--> statement-breakpoint
CREATE INDEX "ix_orders_user_status_created" ON "orders" USING btree ("user_id","status","created_at" desc,"id" desc);--> statement-breakpoint
CREATE INDEX "ix_refresh_tokens_family_id" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "ix_refresh_tokens_user_id" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_transactions_user_created" ON "transactions" USING btree ("user_id","created_at" desc,"id" desc);--> statement-breakpoint
CREATE INDEX "ix_transactions_user_type_created" ON "transactions" USING btree ("user_id","type","created_at" desc,"id" desc);--> statement-breakpoint
CREATE INDEX "ix_transactions_order_id" ON "transactions" USING btree ("order_id");