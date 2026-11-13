---
name: hyperliquid-reader
description: Read-only Hyperliquid perp and spot market data.
source: https://github.com/himself65/finance-skills/blob/main/plugins/data-providers/skills/hyperliquid-reader/SKILL.md
---

# Hyperliquid Reader

Use the `hyperliquid` tool for current data from Hyperliquid's public `POST /info` API. It needs no API key, wallet, or login. It cannot read accounts, place or cancel orders, or transfer funds.

## Actions

- `markets`: perp mark, oracle, and mid prices; 24-hour change and volume; hourly funding and annualized APR; open interest; premium; leverage.
- `spotMarkets`: spot price, 24-hour change and volume, circulating supply, market cap, and canonical status.
- `mids`: current midpoint prices, optionally filtered by symbol substring.
- `book`: L2 bids and asks. Use `depth` from 1 to 20 and optional `nSigFigs` from 2 to 5.
- `candles`: OHLCV and trade count. Intervals are `1m 3m 5m 15m 30m 1h 2h 4h 8h 12h 1d 3d 1w 1M`.
- `fundingHistory`: hourly realized funding, annualized APR, and premium for one perp.
- `fundingCompare`: predicted Hyperliquid, Binance, and Bybit funding as annualized APR, with venue spreads.

Perp symbols are bare names such as `BTC`, `ETH`, `SOL`, and `HYPE`. Spot pairs use names such as `PURR/USDC`. Builder-deployed perps can use a dex prefix such as `xyz:XYZ100`.

For a market overview, sort and cap results to 15-20 rows. For one perp, use `markets` with `coin`. Lead with mark price, 24-hour change, funding APR, and open interest.

Positive funding means longs pay shorts. Funding comparisons are screens, not guaranteed arbitrage; execution, exchange, and transfer costs are excluded. For an order book, calculate and report best bid, best ask, mid, and spread in basis points. For candles, summarize the first and last close, high, low, and direction.

If the API returns an error or omits a field, state what is missing. Never invent market data.
