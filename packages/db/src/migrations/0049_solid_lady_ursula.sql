ALTER TABLE polymarket_runtime_configs
  ALTER COLUMN paper_starting_bankroll_usd SET DEFAULT 100;

ALTER TABLE polymarket_runtime_configs
  ADD COLUMN IF NOT EXISTS active_trading_capital_mode text NOT NULL DEFAULT 'capped_equity',
  ADD COLUMN IF NOT EXISTS active_trading_capital_cap_usd double precision NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS monthly_target_usd double precision NOT NULL DEFAULT 200,
  ADD COLUMN IF NOT EXISTS profit_sweep_reserve_usd double precision NOT NULL DEFAULT 25;
