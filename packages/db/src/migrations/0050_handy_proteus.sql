ALTER TABLE polymarket_runtime_configs
  ALTER COLUMN target_watched_wallet_count SET DEFAULT 20,
  ALTER COLUMN max_daily_replacements SET DEFAULT 4;
