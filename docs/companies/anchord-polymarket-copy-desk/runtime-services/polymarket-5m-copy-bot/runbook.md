# Runbook

1. Load the watched-wallet roster.
2. Poll current watched-wallet positions and recent trade state.
3. Detect meaningful changes versus the previous snapshot.
4. Emit raw copy-monitor events for normalization.
5. Record run health, artifacts, and any gaps in source coverage.
