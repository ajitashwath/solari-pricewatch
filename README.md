# PriceWatch
A competitive price-monitoring agent built on [Solari](https://getsolari.com).

Give it a list of product URLs. Each run it:
1. **Scrapes** current prices *and a screenshot* of each target with a
   **Solari cloud browser** (`@solarisdk/browser`) — optionally through
   stealth + a residential proxy for sites that block datacenter traffic,
   and optionally with session recording on for a full audit trail.
2. **Analyzes** the new prices inside a **Solari sandbox** (`@solarisdk/sdk`),
   using one stateful Python kernel to (a) flag anomalies with a per-target
   **z-score** against historical mean/stdev — not just a flat "%-move"
   threshold — and (b) render a **matplotlib trend sparkline** per target,
   installed and run entirely inside the sandbox.
3. **Renders a dashboard**: a single self-contained `dashboard.html` with
   every screenshot and chart inlined as base64 — open it in a browser, or
   screenshot it for a "here's what I built" post.
4. **Persists** the run to `price-history.json` so the next run has a
   baseline to diff against, and can run **continuously** on an interval.

Both Solari steps run under the same `SOLARI_API_KEY` and bill to the same
balance — a browser and a sandbox composed into one real, statistically
literate pipeline instead of two disconnected quickstarts.

## Why a sandbox for arithmetic?
The z-score itself is simple enough to do in plain TypeScript. It's done in a
Solari sandbox instead because that's where this kind of pipeline actually
goes next — a real pandas-based outlier model, currency normalization,
calling out to a stats package you don't want to reimplement in JS — and
none of that requires a rewrite once the analysis step already lives in a
real, stateful Python kernel. The included chart rendering is the proof: it's
a second `run_code` call against the *same* kernel, sharing state from the
first, with matplotlib pip-installed on the fly since the `base` template
doesn't ship with it preinstalled.

## Setup
```bash
npm install
cp .env.example .env
# edit .env and set SOLARI_API_KEY (get one at console.getsolari.com)
```

Edit `targets.json` with the product pages you actually want to watch:
```json
{
  "id": "competitor-a-widget",
  "label": "Competitor A — Widget Pro",
  "url": "https://competitor-a.example/products/widget-pro",
  "priceSelector": ".product-price"
}
```

`priceSelector` is any CSS selector Playwright's `locator()` accepts. It just
needs to resolve to the element whose text contains the price.

## Run
```bash
npm start
```

```
[2026-08-31T12:00:00.000Z] scraping 3 target(s)...
done. browser session: sess_...
analyzing in a Solari sandbox (z-score + matplotlib trend charts)...

PriceWatch report
=================
   Competitor A — Widget Pro         49.99 ->      44.99    -10.0%   z=-1.85
   Competitor B — Gadget Max        129.00 ->     129.00      0.0%   z=0.02
⚠  Competitor C — Thingamajig        19.99 ->      24.99    +25.1%   z=3.41

1 price move(s) flagged:
  - Competitor C — Thingamajig: 19.99 -> 24.99 (+25.1%) — threshold + z-score

dashboard written to /path/to/solari-pricewatch/dashboard.html
```

Open `dashboard.html` — it's a single self-contained file with every
screenshot and trend chart inlined, ready to view or screenshot.

The first couple of runs won't have enough history for a z-score (needs 3+
prior points) or a trend chart (needs 2+), so early runs will show `z=—` and
skip the sparkline — that's expected, not a bug. Run it a few times, or use
`--interval` below, to build up real history.

### Continuous monitoring

```bash
npm start -- --interval=30
```

Runs the full pipeline every 30 minutes until stopped, re-scraping,
re-analyzing, and rewriting `dashboard.html` each cycle. A failed cycle
(site down, transient network error) logs and retries on the next interval
rather than crashing the process.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `SOLARI_API_KEY` | required — from console.getsolari.com |
| `PRICEWATCH_PROXY_COUNTRY` | optional, e.g. `us` — routes the scrape through stealth + residential proxy egress in that country |
| `PRICEWATCH_ALERT_THRESHOLD` | optional, default `0.05` — fraction move that counts as "flagged" |
| `PRICEWATCH_RECORD` | optional, `true` to record the browser session (download the rrweb replay via `solari.sessions.downloadReplay(sessionId)`) |

## Project layout
```
src/
  scrape.ts      Solari cloud browser: visit targets, capture price + screenshot
  analyze.ts     Solari sandbox: z-score anomaly detection + matplotlib charts,
                 both from one stateful Python kernel
  history.ts     local persistence + per-target time series (sandboxes are ephemeral)
  dashboard.ts   self-contained HTML dashboard, images inlined as base64
  report.ts      console report formatting
  index.ts       orchestrates the above; --interval for continuous runs
targets.json     the products being watched
```

## Extending this
- Swap the console report for an email or Slack webhook when something's
  flagged (`deltas.filter(d => d.flagged)` in `index.ts` is the hook point).
- Add `profileId` to the browser launch options in `scrape.ts` for pricing
  pages that sit behind a login (see the cookbook's `browser-profiles-ts`
  example).
- Bake matplotlib (and pandas, if you want a real outlier model) into a
  custom sandbox template instead of pip-installing it every run — see
  Solari's docs on custom templates.
- Publish `dashboard.html` somewhere with `sandbox.previewUrl()` (see the
  cookbook's `sandbox-port-preview-ts` example) instead of just writing it
  to disk, for a live-updating public URL.
