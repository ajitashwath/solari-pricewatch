/**
 * dashboard.ts — render one self-contained HTML file: no server, no build
 * step, every image inlined as a data: URL. Open it directly in a browser,
 * or take the screenshot you'd actually want for a "here's what I built"
 * post — this is that screenshot.
 */
import { writeFile } from "node:fs/promises"
import type { Observation, PriceDelta } from "./types.js"

function fmtPrice(n: number | null): string {
  return n === null ? "—" : `$${n.toFixed(2)}`
}

function fmtPct(n: number | null): string {
  if (n === null) return "—"
  const sign = n > 0 ? "+" : ""
  return `${sign}${(n * 100).toFixed(1)}%`
}

function badgeClass(d: PriceDelta): string {
  if (!d.flagged) return "badge badge--neutral"
  return (d.percentChange ?? 0) >= 0 ? "badge badge--up" : "badge badge--down"
}

function reasonLabel(reason: PriceDelta["flagReason"]): string {
  switch (reason) {
    case "threshold":
      return "threshold crossed"
    case "anomaly":
      return "statistical anomaly"
    case "both":
      return "threshold + anomaly"
    default:
      return ""
  }
}

export async function writeDashboard(params: {
  outPath: string
  generatedAt: string
  observations: Observation[]
  deltas: PriceDelta[]
  charts: Record<string, string>
  sessionId: string
  recording: boolean
}): Promise<void> {
  const { outPath, generatedAt, observations, deltas, charts, sessionId, recording } = params
  const deltaById = new Map(deltas.map((d) => [d.id, d]))
  const flaggedCount = deltas.filter((d) => d.flagged).length

  const cards = observations
    .map((obs) => {
      const delta = deltaById.get(obs.id)
      const chart = charts[obs.id]
      return `
      <article class="card">
        <header class="card__header">
          <div>
            <h2>${escapeHtml(obs.label)}</h2>
            <a class="card__url" href="${escapeHtml(obs.url)}" target="_blank" rel="noopener">${escapeHtml(
              obs.url,
            )}</a>
          </div>
          ${delta ? `<span class="${badgeClass(delta)}">${fmtPct(delta.percentChange)}</span>` : ""}
        </header>

        <div class="card__body">
          ${obs.screenshot ? `<img class="thumb" src="${obs.screenshot}" alt="Screenshot of ${escapeHtml(obs.label)}" />` : `<div class="thumb thumb--empty">no screenshot</div>`}

          <div class="card__stats">
            <div class="stat">
              <span class="stat__label">Previous</span>
              <span class="stat__value">${fmtPrice(delta?.previousPrice ?? null)}</span>
            </div>
            <div class="stat">
              <span class="stat__label">Current</span>
              <span class="stat__value stat__value--current">${fmtPrice(obs.price)}</span>
            </div>
            <div class="stat">
              <span class="stat__label">z-score</span>
              <span class="stat__value">${delta?.zScore != null ? delta.zScore.toFixed(2) : "—"}</span>
            </div>
          </div>

          ${chart ? `<img class="sparkline" src="data:image/png;base64,${chart}" alt="Price trend for ${escapeHtml(obs.label)}" />` : ""}

          ${delta?.flagged ? `<p class="flag-reason">⚠ Flagged — ${reasonLabel(delta.flagReason)}</p>` : ""}
        </div>
      </article>`
    })
    .join("\n")

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>PriceWatch — ${escapeHtml(generatedAt)}</title>
<style>
  :root {
    --bg: #0b0f19;
    --surface: #131826;
    --border: #232a3d;
    --text: #e6e9f0;
    --muted: #8b93a7;
    --accent: #2563eb;
    --up: #22c55e;
    --down: #ef4444;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
    padding: 40px 24px 64px;
  }
  .wrap { max-width: 960px; margin: 0 auto; }
  .top { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 28px; flex-wrap: wrap; gap: 12px; }
  .top h1 { margin: 0; font-size: 28px; letter-spacing: -0.02em; }
  .top p { margin: 4px 0 0; color: var(--muted); font-size: 14px; }
  .summary {
    display: flex; gap: 10px; align-items: center;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; padding: 10px 16px; font-size: 14px;
  }
  .summary strong { color: ${1 ? "var(--text)" : ""}; }
  .flag-count { color: ${1 ? "#fbbf24" : ""}; font-weight: 600; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 18px; }
  .card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 16px; overflow: hidden; display: flex; flex-direction: column;
  }
  .card__header { display: flex; justify-content: space-between; align-items: flex-start; padding: 16px 18px 0; gap: 10px; }
  .card__header h2 { margin: 0; font-size: 16px; }
  .card__url { color: var(--muted); font-size: 12px; text-decoration: none; word-break: break-all; }
  .card__url:hover { color: var(--accent); }
  .card__body { padding: 14px 18px 18px; display: flex; flex-direction: column; gap: 12px; }
  .thumb { width: 100%; border-radius: 10px; border: 1px solid var(--border); max-height: 160px; object-fit: cover; object-position: top; }
  .thumb--empty { display: flex; align-items: center; justify-content: center; height: 100px; color: var(--muted); font-size: 12px; background: #0e1320; }
  .card__stats { display: flex; gap: 18px; }
  .stat { display: flex; flex-direction: column; gap: 2px; }
  .stat__label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .stat__value { font-size: 15px; font-weight: 600; }
  .stat__value--current { color: var(--accent); }
  .sparkline { width: 100%; height: auto; }
  .badge { font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 999px; white-space: nowrap; }
  .badge--neutral { background: #1c2233; color: var(--muted); }
  .badge--up { background: rgba(34,197,94,0.15); color: var(--up); }
  .badge--down { background: rgba(239,68,68,0.15); color: var(--down); }
  .flag-reason { margin: 0; font-size: 12px; color: #fbbf24; }
  .footer { margin-top: 32px; color: var(--muted); font-size: 12px; }
  .footer code { background: var(--surface); padding: 2px 6px; border-radius: 6px; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <div>
        <h1>PriceWatch</h1>
        <p>Generated ${escapeHtml(generatedAt)} · built on Solari (cloud browser + sandbox)</p>
      </div>
      <div class="summary">
        <span>${observations.length} target(s) watched</span>
        <span>·</span>
        <span class="${flaggedCount > 0 ? "flag-count" : ""}">${flaggedCount} flagged</span>
      </div>
    </div>

    <div class="grid">
      ${cards}
    </div>

    <p class="footer">
      Browser session <code>${escapeHtml(sessionId)}</code>${recording ? " (recorded — replay downloadable via <code>solari.sessions.downloadReplay()</code>)" : ""}.
      Trend charts rendered with matplotlib inside a Solari sandbox from a stateful Python kernel.
    </p>
  </div>
</body>
</html>`

  await writeFile(outPath, html)
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
