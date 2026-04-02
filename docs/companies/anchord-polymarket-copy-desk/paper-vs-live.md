# Paper vs Live

## Current active mode

Paper mode is the only active execution path for this desk.

- `mode=paper`
- `liveEnabled=false`
- `tradingKillSwitch=true`
- accepted copy decisions can create paper trades
- live dispatch remains blocked

## What paper mode means here

- watched-wallet moves can become normalized copy candidates
- deterministic risk logic can accept or block them
- accepted decisions can create paper trades for evaluation
- paper results can be reviewed by operators and Trading Analyst

## What stays blocked

- no real order placement
- no live dispatch from Execution Engine
- no live credential use for real trading
- no bypass of kill-switch safety

## Future live prerequisites

Live copying is a later phase and should require all of the following:

- explicit operator decision
- complete authenticated readiness
- `mode=live`
- `liveEnabled=true`
- `tradingKillSwitch=false`
- a real live executor implementation beyond the current blocked stub
