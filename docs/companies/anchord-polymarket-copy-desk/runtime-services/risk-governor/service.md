# Risk Governor

## Mission

Decide accept, skip, or block for normalized copy candidates.

## Inputs

- normalized signals
- runtime config
- exposure state
- spread and materiality checks

## Outputs

- deterministic copy decisions
- reason codes
- acceptance or rejection state for downstream routing

## Non-scope

- monitoring
- market storytelling
- discretionary judgment

## Current runtime mapping

- underlying runtime service registration: `Polymarket Risk Governor`
