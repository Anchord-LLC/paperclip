# Polymarket 5m Copy Bot

## Mission

Quickly detect watched-wallet changes and emit copy candidates.

## Inputs

- watched-wallet list
- wallet state
- market state
- recent snapshot history

## Outputs

- raw copy-monitor events
- watched-wallet snapshots
- freshness-oriented copy candidates for normalization

## Non-scope

- risk decisions
- execution authority
- narrative analysis

## Current runtime mapping

- worker key: `polymarket-monitor-5m`
- underlying runtime service registration: `Polymarket 5m Monitor`
