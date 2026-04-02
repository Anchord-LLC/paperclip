ALTER TABLE "polymarket_runtime_configs"
  ADD COLUMN "min_trade_size_pct" double precision NOT NULL DEFAULT 7.5;--> statement-breakpoint
ALTER TABLE "polymarket_runtime_configs"
  ADD COLUMN "max_trade_size_pct" double precision NOT NULL DEFAULT 12.5;--> statement-breakpoint
ALTER TABLE "polymarket_runtime_configs"
  ADD COLUMN "max_exposure_per_market_pct" double precision NOT NULL DEFAULT 15;--> statement-breakpoint
ALTER TABLE "polymarket_runtime_configs"
  ADD COLUMN "max_exposure_per_wallet_pct" double precision NOT NULL DEFAULT 30;--> statement-breakpoint
ALTER TABLE "polymarket_runtime_configs"
  ADD COLUMN "max_total_open_exposure_pct" double precision NOT NULL DEFAULT 90;--> statement-breakpoint
ALTER TABLE "polymarket_runtime_configs"
  ADD COLUMN "dynamic_sizing" boolean NOT NULL DEFAULT true;--> statement-breakpoint
ALTER TABLE "polymarket_runtime_configs"
  ADD COLUMN "dynamic_sizing_basis" text NOT NULL DEFAULT 'current_exposure';--> statement-breakpoint
ALTER TABLE "polymarket_runtime_configs"
  ADD COLUMN "position_count_based_sizing" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "polymarket_runtime_configs"
  ADD COLUMN "paper_starting_bankroll_usd" double precision NOT NULL DEFAULT 1000;--> statement-breakpoint
