CREATE TABLE "polymarket_paper_trade_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"paper_trade_id" uuid NOT NULL,
	"signal_id" uuid,
	"event_type" text NOT NULL,
	"quantity_delta" double precision,
	"price" double precision,
	"realized_pnl_usd" double precision,
	"unrealized_pnl_usd" double precision,
	"assumptions_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "polymarket_paper_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source_wallet_address" text NOT NULL,
	"signal_id" uuid,
	"market_id" text NOT NULL,
	"market_slug" text,
	"market_title" text,
	"asset_id" text,
	"side" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"quantity" double precision DEFAULT 0 NOT NULL,
	"notional_usd" double precision DEFAULT 0 NOT NULL,
	"estimated_entry_price" double precision,
	"current_mark_price" double precision,
	"realized_pnl_usd" double precision DEFAULT 0 NOT NULL,
	"unrealized_pnl_usd" double precision DEFAULT 0 NOT NULL,
	"source_to_copy_delay_ms" integer,
	"assumption_note" text,
	"metadata_json" jsonb,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"last_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "polymarket_runtime_configs" (
	"company_id" uuid NOT NULL,
	"mode" text DEFAULT 'paper' NOT NULL,
	"live_enabled" boolean DEFAULT false NOT NULL,
	"trading_kill_switch" boolean DEFAULT true NOT NULL,
	"wallet_selection_enabled" boolean DEFAULT true NOT NULL,
	"wallet_selection_time_zone" text DEFAULT 'UTC' NOT NULL,
	"wallet_selection_hour" integer DEFAULT 9 NOT NULL,
	"wallet_selection_minute" integer DEFAULT 0 NOT NULL,
	"selector_max_candidates" integer DEFAULT 25 NOT NULL,
	"target_watched_wallet_count" integer DEFAULT 10 NOT NULL,
	"target_bench_wallet_count" integer DEFAULT 10 NOT NULL,
	"max_daily_replacements" integer DEFAULT 2 NOT NULL,
	"selector_replacement_score_delta" double precision DEFAULT 0.08 NOT NULL,
	"efficiency_weight" double precision DEFAULT 0.35 NOT NULL,
	"consistency_weight" double precision DEFAULT 0.2 NOT NULL,
	"diversification_weight" double precision DEFAULT 0.2 NOT NULL,
	"recency_weight" double precision DEFAULT 0.15 NOT NULL,
	"concentration_penalty_weight" double precision DEFAULT 0.1 NOT NULL,
	"min_wallet_score" double precision DEFAULT 0.45 NOT NULL,
	"min_signal_materiality" double precision DEFAULT 250 NOT NULL,
	"max_spread_bps" integer DEFAULT 800 NOT NULL,
	"stale_signal_threshold_minutes" integer DEFAULT 30 NOT NULL,
	"max_exposure_per_market" double precision DEFAULT 5000 NOT NULL,
	"max_total_open_paper_exposure" double precision DEFAULT 20000 NOT NULL,
	"max_open_simulated_positions" integer DEFAULT 30 NOT NULL,
	"max_daily_simulated_loss" double precision DEFAULT 2000 NOT NULL,
	"monitor_5m_enabled" boolean DEFAULT true NOT NULL,
	"monitor_15m_enabled" boolean DEFAULT true NOT NULL,
	"monitor_5m_interval_minutes" integer DEFAULT 5 NOT NULL,
	"monitor_15m_interval_minutes" integer DEFAULT 15 NOT NULL,
	"paper_trade_usd_per_signal" double precision DEFAULT 250 NOT NULL,
	"artifact_root_path" text,
	"auth_env_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "polymarket_runtime_configs_pk" PRIMARY KEY("company_id")
);
--> statement-breakpoint
CREATE TABLE "polymarket_signal_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"reason_code" text NOT NULL,
	"reason_detail" text,
	"governor_snapshot_json" jsonb,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "polymarket_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"worker_run_id" uuid,
	"wallet_snapshot_id" uuid,
	"source_wallet_address" text NOT NULL,
	"watched_wallet_id" uuid,
	"wallet_score" double precision,
	"market_id" text NOT NULL,
	"market_slug" text,
	"market_title" text,
	"asset_id" text,
	"action" text NOT NULL,
	"side" text,
	"size_delta" double precision,
	"previous_size" double precision,
	"current_size" double precision,
	"materiality_usd" double precision,
	"detection_timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"source_snapshot_timestamp" timestamp with time zone,
	"cadence" text NOT NULL,
	"raw_metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "polymarket_wallet_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"selection_run_id" uuid NOT NULL,
	"wallet_address" text NOT NULL,
	"label" text,
	"source" text DEFAULT 'data_api_leaderboard' NOT NULL,
	"leaderboard_rank" integer,
	"rank" integer,
	"status" text DEFAULT 'rejected' NOT NULL,
	"eligible" boolean DEFAULT true NOT NULL,
	"eligibility_reasons" jsonb,
	"volume" double precision,
	"pnl" double precision,
	"open_market_count" integer DEFAULT 0 NOT NULL,
	"closed_market_count" integer DEFAULT 0 NOT NULL,
	"recent_trade_count" integer DEFAULT 0 NOT NULL,
	"recent_trade_at" timestamp with time zone,
	"concentration_ratio" double precision,
	"composite_score" double precision DEFAULT 0 NOT NULL,
	"efficiency_score" double precision DEFAULT 0 NOT NULL,
	"consistency_score" double precision DEFAULT 0 NOT NULL,
	"diversification_score" double precision DEFAULT 0 NOT NULL,
	"recency_score" double precision DEFAULT 0 NOT NULL,
	"concentration_penalty_score" double precision DEFAULT 0 NOT NULL,
	"snapshot_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "polymarket_wallet_selection_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"candidate_count" integer DEFAULT 0 NOT NULL,
	"active_count" integer DEFAULT 0 NOT NULL,
	"bench_count" integer DEFAULT 0 NOT NULL,
	"replacement_count" integer DEFAULT 0 NOT NULL,
	"summary_json" jsonb,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "polymarket_wallet_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"worker_run_id" uuid,
	"wallet_address" text NOT NULL,
	"cadence" text,
	"source_fetched_at" timestamp with time zone,
	"latest_activity_at" timestamp with time zone,
	"positions_count" integer DEFAULT 0 NOT NULL,
	"open_exposure_usd" double precision DEFAULT 0 NOT NULL,
	"positions_json" jsonb,
	"trades_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "polymarket_watched_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"wallet_address" text NOT NULL,
	"label" text,
	"status" text DEFAULT 'bench' NOT NULL,
	"source_selection_run_id" uuid,
	"current_rank" integer,
	"score" double precision DEFAULT 0 NOT NULL,
	"efficiency_score" double precision DEFAULT 0 NOT NULL,
	"consistency_score" double precision DEFAULT 0 NOT NULL,
	"diversification_score" double precision DEFAULT 0 NOT NULL,
	"recency_score" double precision DEFAULT 0 NOT NULL,
	"concentration_penalty_score" double precision DEFAULT 0 NOT NULL,
	"concentration_ratio" double precision,
	"last_refreshed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"replaced_at" timestamp with time zone,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "polymarket_worker_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"worker_key" text NOT NULL,
	"cadence" text,
	"status" text DEFAULT 'running' NOT NULL,
	"wallet_count" integer DEFAULT 0 NOT NULL,
	"signal_count" integer DEFAULT 0 NOT NULL,
	"accepted_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"blocked_count" integer DEFAULT 0 NOT NULL,
	"details_json" jsonb,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "polymarket_paper_trade_events" ADD CONSTRAINT "polymarket_paper_trade_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polymarket_paper_trade_events" ADD CONSTRAINT "polymarket_paper_trade_events_paper_trade_id_polymarket_paper_trades_id_fk" FOREIGN KEY ("paper_trade_id") REFERENCES "public"."polymarket_paper_trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polymarket_paper_trade_events" ADD CONSTRAINT "polymarket_paper_trade_events_signal_id_polymarket_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."polymarket_signals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polymarket_paper_trades" ADD CONSTRAINT "polymarket_paper_trades_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polymarket_paper_trades" ADD CONSTRAINT "polymarket_paper_trades_signal_id_polymarket_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."polymarket_signals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polymarket_runtime_configs" ADD CONSTRAINT "polymarket_runtime_configs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polymarket_signal_decisions" ADD CONSTRAINT "polymarket_signal_decisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polymarket_signal_decisions" ADD CONSTRAINT "polymarket_signal_decisions_signal_id_polymarket_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."polymarket_signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polymarket_signals" ADD CONSTRAINT "polymarket_signals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polymarket_signals" ADD CONSTRAINT "polymarket_signals_worker_run_id_polymarket_worker_runs_id_fk" FOREIGN KEY ("worker_run_id") REFERENCES "public"."polymarket_worker_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polymarket_signals" ADD CONSTRAINT "polymarket_signals_wallet_snapshot_id_polymarket_wallet_snapshots_id_fk" FOREIGN KEY ("wallet_snapshot_id") REFERENCES "public"."polymarket_wallet_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polymarket_signals" ADD CONSTRAINT "polymarket_signals_watched_wallet_id_polymarket_watched_wallets_id_fk" FOREIGN KEY ("watched_wallet_id") REFERENCES "public"."polymarket_watched_wallets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polymarket_wallet_candidates" ADD CONSTRAINT "polymarket_wallet_candidates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polymarket_wallet_candidates" ADD CONSTRAINT "polymarket_wallet_candidates_selection_run_id_polymarket_wallet_selection_runs_id_fk" FOREIGN KEY ("selection_run_id") REFERENCES "public"."polymarket_wallet_selection_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polymarket_wallet_selection_runs" ADD CONSTRAINT "polymarket_wallet_selection_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polymarket_wallet_snapshots" ADD CONSTRAINT "polymarket_wallet_snapshots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polymarket_wallet_snapshots" ADD CONSTRAINT "polymarket_wallet_snapshots_worker_run_id_polymarket_worker_runs_id_fk" FOREIGN KEY ("worker_run_id") REFERENCES "public"."polymarket_worker_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polymarket_watched_wallets" ADD CONSTRAINT "polymarket_watched_wallets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polymarket_watched_wallets" ADD CONSTRAINT "polymarket_watched_wallets_source_selection_run_id_polymarket_wallet_selection_runs_id_fk" FOREIGN KEY ("source_selection_run_id") REFERENCES "public"."polymarket_wallet_selection_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polymarket_worker_runs" ADD CONSTRAINT "polymarket_worker_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "polymarket_paper_trade_events_company_trade_created_idx" ON "polymarket_paper_trade_events" USING btree ("company_id","paper_trade_id","created_at");--> statement-breakpoint
CREATE INDEX "polymarket_paper_trades_company_status_updated_idx" ON "polymarket_paper_trades" USING btree ("company_id","status","last_updated_at");--> statement-breakpoint
CREATE INDEX "polymarket_paper_trades_company_wallet_market_status_idx" ON "polymarket_paper_trades" USING btree ("company_id","source_wallet_address","market_id","side","status");--> statement-breakpoint
CREATE UNIQUE INDEX "polymarket_signal_decisions_signal_uq" ON "polymarket_signal_decisions" USING btree ("signal_id");--> statement-breakpoint
CREATE INDEX "polymarket_signal_decisions_company_decision_created_idx" ON "polymarket_signal_decisions" USING btree ("company_id","decision","created_at");--> statement-breakpoint
CREATE INDEX "polymarket_signals_company_created_idx" ON "polymarket_signals" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "polymarket_signals_company_market_created_idx" ON "polymarket_signals" USING btree ("company_id","market_id","created_at");--> statement-breakpoint
CREATE INDEX "polymarket_signals_company_wallet_created_idx" ON "polymarket_signals" USING btree ("company_id","source_wallet_address","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "polymarket_wallet_candidates_selection_wallet_uq" ON "polymarket_wallet_candidates" USING btree ("selection_run_id","wallet_address");--> statement-breakpoint
CREATE INDEX "polymarket_wallet_candidates_company_selection_rank_idx" ON "polymarket_wallet_candidates" USING btree ("company_id","selection_run_id","rank");--> statement-breakpoint
CREATE INDEX "polymarket_wallet_candidates_company_wallet_idx" ON "polymarket_wallet_candidates" USING btree ("company_id","wallet_address");--> statement-breakpoint
CREATE INDEX "polymarket_wallet_selection_runs_company_started_idx" ON "polymarket_wallet_selection_runs" USING btree ("company_id","started_at");--> statement-breakpoint
CREATE INDEX "polymarket_wallet_snapshots_company_wallet_cadence_created_idx" ON "polymarket_wallet_snapshots" USING btree ("company_id","wallet_address","cadence","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "polymarket_watched_wallets_company_wallet_uq" ON "polymarket_watched_wallets" USING btree ("company_id","wallet_address");--> statement-breakpoint
CREATE INDEX "polymarket_watched_wallets_company_status_rank_idx" ON "polymarket_watched_wallets" USING btree ("company_id","status","current_rank");--> statement-breakpoint
CREATE INDEX "polymarket_worker_runs_company_worker_started_idx" ON "polymarket_worker_runs" USING btree ("company_id","worker_key","started_at");
