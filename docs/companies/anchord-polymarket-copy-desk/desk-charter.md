# Desk Charter

## Purpose

Polymarket Copy Desk exists to copy eligible moves from a curated set of high-quality wallets. It does not invent discretionary trades from scratch.

## Core mission

1. Select high-quality wallets to follow.
2. Monitor watched-wallet position changes on two cadences.
3. Normalize watched-wallet moves into copy candidates.
4. Apply deterministic risk controls.
5. Route accepted decisions into paper trades now.
6. Keep live copying blocked until explicitly enabled later.

## Operating shape

- Wallet Selector curates the watched-wallet roster.
- Polymarket 5m Copy Bot detects fast watched-wallet changes.
- Polymarket 15m Copy Bot runs a slower confirmation and refresh pass.
- Signal normalization, Risk Governor, and Execution Engine are shared deterministic support logic.
- Paper Executor is active now.
- Live Executor stays dormant and blocked.
- Trading Analyst supports operators with analysis but does not own execution or risk authority.

## Non-goals

- discretionary market prediction
- narrative trading calls
- analyst-driven trade approvals
- live order dispatch without explicit future enablement
