# Wallet Selector

## Mission

Rank and select the watched wallets to copy.

## Inputs

- candidate wallet universe
- wallet scoring factors
- runtime selection thresholds
- watched-wallet replacement policy

## Outputs

- active watched-wallet list
- bench list
- replacement decisions and rationale

## Non-scope

- trade execution
- discretionary trade calls
- narrative market analysis

## Current runtime mapping

- worker key: `wallet-selector-daily`
- underlying runtime service registration: `Polymarket Wallet Selector`
