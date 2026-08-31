/**
 * analyze.ts — one Solari sandbox, one stateful Python kernel, two jobs:
 *
 *   1. Diff the newest scrape against history and flag anomalies — not with
 *      a flat "did it move >5%" rule, but a z-score against each target's
 *      own historical mean/stdev, OR'd with the flat threshold as a floor
 *      for targets that don't have enough history yet to have a stdev.
 *   2. Render a small trend sparkline per target with matplotlib, so the
 *      dashboard has something better to show than a table of numbers.
 *
 * Both jobs share one kernel (`createCodeContext`) and one sandbox, so the
 * second `runCode` call still has `previous`/`current`/`history` in scope
 * from the first — that's the actual value of a *stateful* interpreter over
 * a one-shot "run this script" call.
 *
 * matplotlib isn't guaranteed to be on the `base` template, so it's pip
 * installed at the top of the run rather than assumed. That costs a couple
 * of seconds once per sandbox; for a long-lived scheduled agent you'd want
 * a custom template with it baked in instead (see Solari's docs on custom
 * sandbox templates).
 */
import { SolariClient } from "@solarisdk/sdk"
import type { Observation, PriceDelta, AnalysisResult } from "./types.js"

type Series = Record<string, { timestamp: string; price: number | null }[]>

const SETUP_SCRIPT = String.raw`
import json, statistics

previous = json.loads(PREVIOUS_JSON)
current = json.loads(CURRENT_JSON)
series = json.loads(SERIES_JSON)
threshold = ALERT_THRESHOLD

prev_by_id = {o["id"]: o for o in previous}
`.trim()

const DELTA_SCRIPT = String.raw`
deltas = []

for obs in current:
    prev = prev_by_id.get(obs["id"])
    prev_price = prev["price"] if prev else None
    curr_price = obs["price"]

    abs_change = None
    pct_change = None
    z_score = None
    reasons = []

    if prev_price is not None and curr_price is not None:
        abs_change = curr_price - prev_price
        if prev_price != 0:
            pct_change = abs_change / prev_price
            if abs(pct_change) >= threshold:
                reasons.append("threshold")

    history_prices = [p["price"] for p in series.get(obs["id"], []) if p["price"] is not None]
    if curr_price is not None and len(history_prices) >= 3:
        mean = statistics.mean(history_prices)
        stdev = statistics.pstdev(history_prices)
        if stdev > 0:
            z_score = (curr_price - mean) / stdev
            if abs(z_score) >= 2:
                reasons.append("anomaly")

    flag_reason = None
    if len(reasons) == 2:
        flag_reason = "both"
    elif reasons:
        flag_reason = reasons[0]

    deltas.append({
        "id": obs["id"],
        "label": obs["label"],
        "previousPrice": prev_price,
        "currentPrice": curr_price,
        "absoluteChange": abs_change,
        "percentChange": pct_change,
        "zScore": z_score,
        "flagged": bool(reasons),
        "flagReason": flag_reason,
    })

print("__DELTAS__" + json.dumps(deltas))
`.trim()

const CHART_SCRIPT = String.raw`
import base64, io, json

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    HAVE_MPL = True
except ImportError:
    HAVE_MPL = False

charts = {}

if HAVE_MPL:
    for target_id, points in series.items():
        prices = [p["price"] for p in points if p["price"] is not None]
        if len(prices) < 2:
            continue
        fig, ax = plt.subplots(figsize=(4, 1.2), dpi=110)
        xs = range(len(prices))
        ax.plot(xs, prices, color="#2563eb", linewidth=2.2)
        ax.fill_between(xs, prices, min(prices), color="#2563eb", alpha=0.10)
        ax.set_xticks([])
        ax.set_yticks([])
        for spine in ax.spines.values():
            spine.set_visible(False)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", bbox_inches="tight", transparent=True)
        plt.close(fig)
        charts[target_id] = base64.b64encode(buf.getvalue()).decode()

print("__CHARTS__" + json.dumps(charts))
`.trim()

function extractMarked(stdout: string, marker: string): string {
  const idx = stdout.indexOf(marker)
  if (idx === -1) throw new Error(`sandbox output missing ${marker} marker`)
  const rest = stdout.slice(idx + marker.length)
  return rest.split("\n")[0]
}

function stdoutOf(result: { results: { type?: string; text?: string }[] }): string {
  return result.results
    .filter((item) => item.type === "stdout")
    .map((item) => item.text ?? "")
    .join("")
}

export async function analyzeAndChart(
  previous: Observation[],
  current: Observation[],
  series: Series,
  alertThreshold: number,
): Promise<AnalysisResult> {
  const client = new SolariClient({ apiKey: process.env.SOLARI_API_KEY! })

  const sandbox = await client.sandboxes.create({
    template: "base",
    timeoutMs: 3 * 60_000, // rolling idle window, not a hard deadline
  })

  try {
    await sandbox.connect()

    // Quiet, best-effort install — charting still degrades gracefully
    // (CHART_SCRIPT checks HAVE_MPL) if this fails or the template already
    // has it and pip no-ops.
    await sandbox.commands.run("pip", { args: ["install", "--quiet", "matplotlib"] })

    const ctx = await sandbox.createCodeContext("python")

    const setup = [
      `PREVIOUS_JSON = ${JSON.stringify(JSON.stringify(previous))}`,
      `CURRENT_JSON = ${JSON.stringify(JSON.stringify(current))}`,
      `SERIES_JSON = ${JSON.stringify(JSON.stringify(series))}`,
      `ALERT_THRESHOLD = ${alertThreshold}`,
      SETUP_SCRIPT,
    ].join("\n")

    const setupResult = await sandbox.runCode(setup, { contextId: ctx })
    if (setupResult.error) throw new Error(`sandbox setup failed: ${setupResult.error}`)

    // Second call reuses the same kernel — prev_by_id, current, series, and
    // threshold are all still in scope from the call above.
    const deltaResult = await sandbox.runCode(DELTA_SCRIPT, { contextId: ctx })
    if (deltaResult.error) throw new Error(`sandbox delta script failed: ${deltaResult.error}`)
    const deltas = JSON.parse(extractMarked(stdoutOf(deltaResult), "__DELTAS__")) as PriceDelta[]

    const chartResult = await sandbox.runCode(CHART_SCRIPT, { contextId: ctx })
    if (chartResult.error) throw new Error(`sandbox chart script failed: ${chartResult.error}`)
    const charts = JSON.parse(extractMarked(stdoutOf(chartResult), "__CHARTS__")) as Record<string, string>

    return { deltas, charts }
  } finally {
    // Destroys the VM; without this it lingers until the idle timeout.
    await sandbox.kill()
  }
}
