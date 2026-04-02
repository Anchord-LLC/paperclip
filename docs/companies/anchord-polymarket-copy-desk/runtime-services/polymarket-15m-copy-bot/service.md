# Polymarket 15m Copy Bot

## Mission

Run a slower confirmation and refresh pass for watched-wallet changes.

## Inputs

- watched-wallet list
- wallet state
- market state
- recent snapshot history

## Outputs

- raw copy-monitor events
- confirmation and refresh events for normalization
- longer-window watched-wallet change capture

## Non-scope

- risk decisions
- execution authority
- narrative analysis

## Current runtime mapping

- worker key: `polymarket-monitor-15m`
- underlying runtime service registration: `Polymarket 15m Monitor`
