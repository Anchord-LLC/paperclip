# Polymarket Copy Desk V0

This V0 adds a Paperclip-native Polymarket domain for:

- daily wallet selection
- dual-cadence wallet monitoring (`5m` and `15m`)
- deterministic signal normalization and risk decisions
- paper-trade lifecycle tracking
- a separate operator dashboard surface for the desk

## Product Surface

Paperclip backend remains the control plane.

- backend services, routes, jobs, DB state, runtime config, secrets, and audit remain inside Paperclip
- the Polymarket Copy Desk dashboard is a separate operator UI surface on top of that engine
- the desk now lives at `/:companyPrefix/desk/polymarket`
- unprefixed `/desk/polymarket` redirects to the selected company desk route
- legacy `/:companyPrefix/trading/copy` redirects to the new desk route

This keeps one governed Polymarket Copy Desk while making the operator dashboard feel like its own product surface instead of another admin page inside the default backend chrome.

## Safety Model

Paper mode is the default and remains the only effective execution path in V0.

- `mode` defaults to `paper`
- `liveEnabled` defaults to `false`
- `tradingKillSwitch` defaults to `true`
- accepted signals can create paper trades
- future live dispatch remains blocked unless:
  - `mode=live`
  - `liveEnabled=true`
  - `tradingKillSwitch=false`
- even when all three are satisfied, V0 still records `live_execution_not_implemented_v0` instead of placing orders

This keeps the desk safely paper-only until the operator explicitly chooses to build or enable a real executor later.

## Secrets Pattern

Polymarket reuses the existing Paperclip secret-binding flow instead of adding a new secret mechanism.

- secret bindings use the same `env` binding shape as agents:
  - `{ type: "secret_ref", secretId, version? }`
- runtime resolution goes through `server/src/services/secrets.ts`
- worker execution uses the same runtime resolution path already used by heartbeat-managed agents
- optional Polymarket auth bindings live on the runtime config as `authEnv`

Supported Polymarket auth keys:

- `POLYMARKET_PRIVATE_KEY`
- `POLYMARKET_API_KEY`
- `POLYMARKET_API_SECRET`
- `POLYMARKET_API_PASSPHRASE`
- `POLYMARKET_FUNDER_ADDRESS`

These are optional for V0 startup and paper mode. Public Polymarket endpoints are enough for wallet selection, monitoring, signals, and paper simulation.

## Auth Setup and Live Readiness

The standalone desk dashboard now includes an `Auth Readiness` panel for operator-safe setup.

The panel shows only safe metadata:

- whether each Polymarket secret ref is present
- whether each bound ref passes config-only structural validation
- whether paper mode is active
- whether live is enabled
- whether the trading kill switch is on
- whether the current auth bundle is `ready` or `incomplete`
- the last validation timestamp and result
- the last credential-derivation attempt timestamp and result

The UI never renders raw secret values.

Paper mode remains fully functional with zero Polymarket auth secrets. In V0 the auth check is intentionally `config_only`:

- it verifies that required secret refs exist
- it resolves values through the existing Paperclip secret service
- it checks structural usability such as private key formatting and funder address formatting
- it does not place any order
- it does not dispatch any live trade
- it does not prove exchange-side authorization with certainty

### Operator Secret References

For future authenticated readiness, operators should add these secret refs through the existing Paperclip secret workflows:

- `POLYMARKET_PRIVATE_KEY`
- `POLYMARKET_API_KEY`
- `POLYMARKET_API_SECRET`
- `POLYMARKET_API_PASSPHRASE`
- `POLYMARKET_FUNDER_ADDRESS`

Only the private key is needed for the optional API-credential derivation helper. The rest can be absent in paper mode.

### L1 and L2 Auth Model

Paperclip treats Polymarket auth in the same conceptual layers Polymarket uses:

- L1: `POLYMARKET_PRIVATE_KEY`
- L2: `POLYMARKET_API_KEY`, `POLYMARKET_API_SECRET`, `POLYMARKET_API_PASSPHRASE`
- funding identity: `POLYMARKET_FUNDER_ADDRESS`

Relayer or builder attribution credentials are not part of this user trading auth path and should not be mixed into it.

### Safe Credential Derivation

If `POLYMARKET_PRIVATE_KEY` is already stored in the Paperclip secret store and bound on the runtime config, the operator can use `Derive API Credentials` from the dashboard.

That flow:

- reads the private key through the existing secret resolver
- uses the official `@polymarket/clob-client` derivation path
- writes derived credentials back into the same Paperclip secret store
- updates Polymarket `authEnv` to point at those secret refs
- records only safe audit metadata such as success, failure, timestamp, and reason code

It does not:

- print credentials
- change `mode`
- enable `liveEnabled`
- disable `tradingKillSwitch`
- place any trade

## Official Data Sources

V0 uses official Polymarket public endpoints only:

- Data API leaderboard: candidate wallets
- Data API positions / closed positions / trades: wallet monitoring and scoring
- CLOB order book: spread placeholder guardrail

No third-party trading libraries were added for V0.

## Runtime Config

Runtime state is stored in `polymarket_runtime_configs`.

Key fields:

- mode and live gate fields
- wallet selection schedule and timezone
- watched / bench counts and replacement cap
- score weights
- signal / spread / exposure / loss thresholds
- paper sizing assumption (`paperTradeUsdPerSignal`)
- artifact root path
- optional Polymarket auth bindings (`authEnv`)

The server seeds config on first use. Defaults can be influenced at seed time by:

- `POLYMARKET_PROJECT_ROOT`
- `POLYMARKET_COPY_TIME_ZONE`
- `POLYMARKET_LIVE_ENABLED`
- `POLYMARKET_TRADING_KILL_SWITCH`

After seeding, the DB-backed runtime config is authoritative for scheduling and thresholds.

## Artifact Path

By default V0 writes JSON artifacts under:

- `/mnt/ssd/paperclip/projects/polymarket/artifacts/`

This can be overridden with `POLYMARKET_PROJECT_ROOT`.

## Operating Pack

The repo-native operating pack for the live ANC desk lives under:

- `docs/companies/anchord-polymarket-copy-desk/TEAM.md`

That package defines the desk charter, roster, approval boundaries, routing policy, paper-vs-live stance, copy-trading flow, the Trading Analyst support-agent package, and the runtime-service packages for Wallet Selector, the 5m/15m copy bots, Risk Governor, and Execution Engine.

## Manual API Endpoints

Per-company routes:

- `GET /api/companies/:companyId/polymarket-copy/dashboard`
- `GET /api/companies/:companyId/polymarket-copy/runtime-config`
- `PATCH /api/companies/:companyId/polymarket-copy/runtime-config`
- `POST /api/companies/:companyId/polymarket-copy/auth/check-readiness`
- `POST /api/companies/:companyId/polymarket-copy/auth/derive-api-credentials`
- `POST /api/companies/:companyId/polymarket-copy/runs/wallet-selector`
- `POST /api/companies/:companyId/polymarket-copy/runs/monitor-5m`
- `POST /api/companies/:companyId/polymarket-copy/runs/monitor-15m`

Board-only auth operations use the same Paperclip permission model as the existing secrets routes.

`PATCH` is useful for controlled runtime updates such as:

- keep paper mode but change thresholds
- attach or rotate future Polymarket auth secret references without storing secret values in repo config
- test `mode=live` while leaving `liveEnabled=false`
- clear the kill switch only when a real executor exists later

## Worker Behavior

Scheduler tick flow:

- daily wallet selector runs when due in the configured timezone
- `5m` monitor runs independently on its own interval
- `15m` monitor runs independently on its own interval

Each worker writes its own `polymarket_worker_runs` records so health and last-run state stay separate.

## Paper Trade Assumptions

V0 uses clearly labeled assumptions:

- paper entries use the source position mark price when detected
- copied size uses a capped notional mirror scale derived from source position size
- increases and reductions reuse that mirror scale
- unrealized PnL uses the latest observed mark from source data
- exact slippage, queue position, and fill modeling are not implemented

These assumptions are stored in trade metadata and trade event records.

## Validation Checklist

1. Open `/desk/polymarket` and confirm it redirects to the selected company desk route and loads the standalone operator shell with `mode=paper`, `liveEnabled=false`, and `tradingKillSwitch=true`.
2. Trigger `Run Wallet Selection` and verify:
   - `polymarket_wallet_selection_runs` gets a successful run
   - watched wallets populate
   - bench wallets populate
   - a JSON artifact appears under the artifact root
3. Trigger `Run 5m Monitor` and `Run 15m Monitor` separately and verify:
   - each creates its own `polymarket_worker_runs` record
   - last successful run timestamps differ by worker
   - wallet snapshots are stored
4. Verify signals are generated when wallet position deltas are detected.
5. Verify signal decisions include accepted, skipped, or blocked reason codes as thresholds demand.
6. Verify accepted signals create or update paper trades and trade lifecycle events.
7. Verify `mode=live` alone does not enable live execution:
   - set `mode=live`
   - keep `liveEnabled=false`
   - run a monitor
   - confirm audit log shows `polymarket.live_dispatch.blocked`
8. Verify paper mode still runs when `authEnv` is `null` and no Polymarket auth secrets exist in Paperclip secrets storage.
9. Verify clearing only `liveEnabled=true` while `tradingKillSwitch=true` still blocks live dispatch.
10. Verify the desk remains visually separate from the normal backend sidebar and breadcrumb chrome.
11. Verify the `Auth Readiness` panel loads and shows `config_only` validation with safe yes/no statuses for each secret ref.
12. Verify `Check Auth Readiness` records `polymarket.auth_readiness.checked` and never emits secrets in the audit log.
13. Verify `Derive API Credentials` succeeds only when `POLYMARKET_PRIVATE_KEY` is already bound through the Paperclip secret store.
14. Verify even with `mode=live`, `liveEnabled=true`, and `tradingKillSwitch=false`, missing auth bindings produce `polymarket.live_dispatch.blocked` with `auth_readiness_incomplete`.
15. Verify with all five auth bindings present that the audit log records `polymarket.live_dispatch.not_implemented` with `live_execution_not_implemented_v0` instead of placing any order.

## Recommended Next Steps

1. Add historical market mark refreshes for more accurate unrealized PnL.
2. Add a dedicated live executor only after explicit operator approval, stronger exchange-side auth checks, and a separate live go/no-go review.
3. Add richer wallet sourcing beyond leaderboard-only candidate discovery if Polymarket exposes more official wallet discovery surfaces.
