# Copy-Trading Flow

## End-to-end flow

1. Wallet Selector ranks the candidate wallet universe and publishes the watched-wallet list plus bench list.
2. Polymarket 5m Copy Bot watches watched-wallet state every five minutes and emits raw copy-monitor events.
3. Polymarket 15m Copy Bot runs a slower confirmation and refresh pass over the same watched-wallet set.
4. Signal Normalizer converts watched-wallet move events into normalized copy candidates.
5. Risk Governor deterministically decides accept, skip, or block with explicit reason codes.
6. Execution Engine routes accepted decisions to the active executor.
7. Paper Executor creates paper trades now.
8. Live Executor remains dormant for later explicit enablement.
9. Trading Analyst reviews wallet quality, paper performance, and operator context beside the execution path.

## Architecture summary

Wallet Selector
+ 5m Copy Bot
+ 15m Copy Bot
-> Signal Normalizer
-> Risk Governor
-> Execution Engine
-> Paper Executor now
-> Live Executor later
