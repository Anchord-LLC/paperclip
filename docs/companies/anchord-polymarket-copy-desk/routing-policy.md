# Routing Policy

## Component routing

- Wallet universe scoring or watched-wallet refresh requests go to Wallet Selector.
- Fast watched-wallet move detection goes to Polymarket 5m Copy Bot.
- Confirmation, refresh, and longer-window watched-wallet review goes to Polymarket 15m Copy Bot.
- Signal shaping and copy-candidate normalization go through Signal Normalizer.
- Accept, skip, and block decisions go to Risk Governor.
- Accepted copy decisions go to Execution Engine.
- Paper-trade creation goes to the Paper Executor path behind Execution Engine.
- Live-trade requests stay blocked unless the future live path is explicitly enabled.
- Explanations, summaries, wallet-quality reviews, and performance commentary go to Trading Analyst.

## Escalation routing

- Missing watched wallets or poor roster quality: Wallet Selector first, Trading Analyst second.
- Missing or stale copy events: affected copy bot first, then Signal Normalizer.
- Excess exposure or unsafe copy candidates: Risk Governor.
- Paper trade misrouting or executor mismatch: Execution Engine.
- Secret setup, readiness, or credential derivation issues: operator plus Auth Readiness flow.
