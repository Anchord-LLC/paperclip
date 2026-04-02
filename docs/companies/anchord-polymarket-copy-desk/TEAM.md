---
schema: agentcompanies/v1
kind: team
name: Polymarket Copy Desk
slug: polymarket-copy-desk
description: Company-scoped copy-trading operating pack for ANC built around wallet selection, dual-cadence copy bots, and a shared deterministic execution pipeline.
tags:
  - polymarket
  - copy-trading
  - runtime
metadata:
  surface: polymarket_copy
  companyPrefix: ANC
  currentModel:
    directOwner: Craig
    ceoAgent: Grant
    tradingAnalystReportsTo: Grant
  docs:
    charter: desk-charter.md
    roster: roster.md
    approvalBoundaries: approval-boundaries.md
    routingPolicy: routing-policy.md
    paperVsLive: paper-vs-live.md
    copyTradingFlow: copy-trading-flow.md
  supportAgent:
    tradingAnalyst:
      docsRoot: agents/trading-analyst
      entryFile: agent.md
  runtimeMappings:
    walletSelector:
      runtimeKey: wallet_selector
      workerKey: wallet-selector-daily
      serviceName: Polymarket Wallet Selector
      docsRoot: runtime-services/wallet-selector
    copyBot5m:
      runtimeKey: monitor_5m
      workerKey: polymarket-monitor-5m
      serviceName: Polymarket 5m Monitor
      operatingName: Polymarket 5m Copy Bot
      docsRoot: runtime-services/polymarket-5m-copy-bot
    copyBot15m:
      runtimeKey: monitor_15m
      workerKey: polymarket-monitor-15m
      serviceName: Polymarket 15m Monitor
      operatingName: Polymarket 15m Copy Bot
      docsRoot: runtime-services/polymarket-15m-copy-bot
    riskGovernor:
      runtimeKey: risk_governor
      serviceName: Polymarket Risk Governor
      docsRoot: runtime-services/risk-governor
    executionEngine:
      runtimeKey: execution_engine
      serviceName: Polymarket Execution Engine
      docsRoot: runtime-services/execution-engine
---

The Polymarket Copy Desk is a copy-trading operating pack for ANC. It selects wallets, watches their moves, normalizes those moves into copy candidates, applies deterministic risk rules, and routes accepted decisions into the paper executor.

## Operating docs

- [Desk Charter](./desk-charter.md)
- [Roster](./roster.md)
- [Approval Boundaries](./approval-boundaries.md)
- [Routing Policy](./routing-policy.md)
- [Paper vs Live](./paper-vs-live.md)
- [Copy-Trading Flow](./copy-trading-flow.md)

## Support agent

- [Trading Analyst](./agents/trading-analyst/agent.md)

## Runtime service packages

- [Wallet Selector](./runtime-services/wallet-selector/service.md)
- [Polymarket 5m Copy Bot](./runtime-services/polymarket-5m-copy-bot/service.md)
- [Polymarket 15m Copy Bot](./runtime-services/polymarket-15m-copy-bot/service.md)
- [Risk Governor](./runtime-services/risk-governor/service.md)
- [Execution Engine](./runtime-services/execution-engine/service.md)

## Current live model notes

- ANC is the underlying company runtime.
- Craig is the current direct human owner in the model.
- Grant is the current CEO agent and the Trading Analyst reports to Grant.
- The execution path remains deterministic and paper-only.
