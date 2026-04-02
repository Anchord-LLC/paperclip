# Approval Boundaries

## Human operator authority

Only board/operator actions may:

- store or rotate Polymarket secrets
- bind or unbind secret refs
- derive API credentials from the private key
- change runtime thresholds
- toggle paper/live mode fields
- clear the kill switch for any future live implementation

## Deterministic runtime authority

Risk Governor may:

- accept
- skip
- block

It does so deterministically from normalized signals and runtime config. It does not exercise narrative or discretionary judgment.

Execution Engine may:

- route accepted decisions to the active executor
- create paper trades now
- refuse live dispatch while live remains blocked

## Support-agent boundary

Trading Analyst may:

- evaluate wallet quality
- summarize market context
- review paper performance
- explain desk behavior to operators

Trading Analyst may not:

- approve trades
- bypass Risk Governor
- change runtime config
- execute paper or live trades
