/**
 * index.ts — PriceWatch.
 *
 *   Solari cloud browser  -->  scrape prices + screenshots
 *   Solari sandbox        -->  z-score anomaly detection + matplotlib charts
 *   local disk            -->  history.json (state) + dashboard.html (output)
 *
 * One SOLARI_API_KEY drives both Solari calls, billed to the same balance.
 *
 * Usage:
 *   npm start                    # single run
 *   npm start -- --interval=30   # run every 30 minutes until killed
 */
import "dotenv/config"
import { readFile } from "node:fs/promises"
import { scrapeTargets } from "./scrape.js"
import { analyzeAndChart } from "./analyze.js"
import { loadHistory, appendRun, previousObservations, seriesByTarget } from "./history.js"
import { printReport } from "./report.js"
import { writeDashboard } from "./dashboard.js"
import type { Target } from "./types.js"

function parseIntervalMinutes(argv: string[]): number | null {
  const flag = argv.find((a) => a.startsWith("--interval="))
  if (!flag) return null
  const minutes = Number(flag.split("=")[1])
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null
}

async function runOnce(): Promise<void> {
  const targets: Target[] = JSON.parse(
    await readFile(new URL("../targets.json", import.meta.url), "utf8"),
  )

  const proxyCountry = process.env.PRICEWATCH_PROXY_COUNTRY?.trim() || undefined
  const alertThreshold = Number(process.env.PRICEWATCH_ALERT_THRESHOLD ?? "0.05")

  console.log(`\n[${new Date().toISOString()}] scraping ${targets.length} target(s)${proxyCountry ? ` via ${proxyCountry} proxy` : ""}...`)
  const { observations, sessionId, recording } = await scrapeTargets(targets, {
    proxyCountry,
    record: process.env.PRICEWATCH_RECORD === "true",
  })
  console.log(`done. browser session: ${sessionId}${recording ? " (recorded)" : ""}`)

  const history = await loadHistory()
  const previous = previousObservations(history)

  // Series *before* this run is appended — the chart/z-score baseline should
  // be "everything up to but not including now", so today's price can
  // actually register as an outlier against it.
  const series = seriesByTarget(history)

  console.log("analyzing in a Solari sandbox (z-score + matplotlib trend charts)...")
  const { deltas, charts } = await analyzeAndChart(previous, observations, series, alertThreshold)

  printReport(deltas)

  const generatedAt = new Date().toISOString()
  const dashboardPath = new URL("../dashboard.html", import.meta.url).pathname
  await writeDashboard({
    outPath: dashboardPath,
    generatedAt,
    observations,
    deltas,
    charts,
    sessionId,
    recording,
  })
  console.log(`dashboard written to ${dashboardPath}`)

  await appendRun(history, observations)
}

async function main(): Promise<void> {
  if (!process.env.SOLARI_API_KEY) {
    console.error("SOLARI_API_KEY is not set. Copy .env.example to .env and add your key.")
    process.exitCode = 1
    return
  }

  const intervalMinutes = parseIntervalMinutes(process.argv.slice(2))

  if (!intervalMinutes) {
    await runOnce()
    return
  }

  console.log(`Running continuously every ${intervalMinutes} minute(s). Ctrl+C to stop.`)
  // A plain loop rather than setInterval: this way a slow run (proxy egress,
  // a cold sandbox) can never overlap with the next one.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await runOnce()
    } catch (err) {
      console.error("run failed, will retry next cycle:", err)
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMinutes * 60_000))
  }
}

main().catch((err) => {
  console.error("PriceWatch failed:", err)
  process.exitCode = 1
})
