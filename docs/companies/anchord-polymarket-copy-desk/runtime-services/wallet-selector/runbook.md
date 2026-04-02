# Runbook

1. Pull the candidate wallet universe.
2. Score candidates using the configured weighting model.
3. Keep the strongest watched wallets that still pass eligibility.
4. Use the bench list for controlled replacements when score deltas justify change.
5. Write the watched-wallet and bench outputs for downstream copy bots.
