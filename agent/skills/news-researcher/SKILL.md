---
name: news-researcher
description: Research current news and events with paid Exa web search and page retrieval.
source: https://exa.ai/docs/pay-with-x402
---

# News Researcher

Use the `exa` tool for current reporting. It pays per request with USDC on Base through x402 and does not use an Exa API key.

## Workflow

1. Search with `action: "search"`. Use `category: "news"` for reporting and publication-date bounds when recency matters.
2. Compare multiple independent sources. Prefer primary documents and direct statements over summaries.
3. Read the most relevant pages with `action: "contents"` before making detailed claims.
4. Cite source URLs and state publication dates. Distinguish the date an article was published from the date an event occurred.

Use `type: "auto"` for normal research, `lite` for quick discovery, `deep-lite` for broader research, and `deep` only when the question warrants its added cost and latency. Search returns at most 10 results. Keep content requests narrow and retrieve only pages needed for the answer.

Separate reported facts, attributed claims, and your analysis. Note material conflicts between sources. If Exa fails, a page is unavailable, or evidence is insufficient, name what is missing and stop. Never invent headlines, quotations, dates, sources, events, or figures.
