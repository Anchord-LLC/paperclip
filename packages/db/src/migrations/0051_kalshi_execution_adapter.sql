ALTER TABLE "polymarket_runtime_configs" ADD COLUMN "kalshi_execution_mode" text DEFAULT 'dry_run' NOT NULL;
--> statement-breakpoint
ALTER TABLE "polymarket_runtime_configs" ADD COLUMN "kalshi_api_base_url" text DEFAULT 'https://api.elections.kalshi.com/trade-api/v2' NOT NULL;
--> statement-breakpoint
CREATE TABLE "polymarket_kalshi_mirror_orders" (
"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
"company_id" uuid NOT NULL,
"signal_id" uuid NOT NULL,
"source_wallet_address" text NOT NULL,
"cadence" text NOT NULL,
"source_market_id" text NOT NULL,
"source_market_title" text,
"source_action" text NOT NULL,
"source_side" text,
"execution_mode" text NOT NULL,
"match_status" text NOT NULL,
"execution_status" text NOT NULL,
"rejection_reason" text,
"match_confidence" double precision,
"match_quality" text,
"kalshi_event_ticker" text,
"kalshi_market_ticker" text,
"kalshi_market_title" text,
"kalshi_side" text,
"order_action" text,
"contract_count" integer,
"limit_price_dollars" double precision,
"notional_usd" double precision,
"metadata_json" jsonb,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "polymarket_kalshi_mirror_orders" ADD CONSTRAINT "polymarket_kalshi_mirror_orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "polymarket_kalshi_mirror_orders" ADD CONSTRAINT "polymarket_kalshi_mirror_orders_signal_id_polymarket_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."polymarket_signals"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "polymarket_kalshi_mirror_orders_signal_uq" ON "polymarket_kalshi_mirror_orders" USING btree ("signal_id");
--> statement-breakpoint
CREATE INDEX "polymarket_kalshi_mirror_orders_company_created_idx" ON "polymarket_kalshi_mirror_orders" USING btree ("company_id","created_at");
--> statement-breakpoint
CREATE INDEX "polymarket_kalshi_mirror_orders_company_execution_status_idx" ON "polymarket_kalshi_mirror_orders" USING btree ("company_id","execution_status","created_at");
--> statement-breakpoint
CREATE INDEX "polymarket_kalshi_mirror_orders_company_market_idx" ON "polymarket_kalshi_mirror_orders" USING btree ("company_id","kalshi_market_ticker","created_at");
