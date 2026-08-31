/**
 * history.ts — keeps a local record of past runs so we always have a
 * "previous" observation to diff the newest scrape against.
 *
 * This lives on disk next to the project rather than in the sandbox: the
 * sandbox is ephemeral (killed at the end of every run), so anything that
 * needs to survive between runs has to live outside it.
 */
import { readFile, writeFile } from "node:fs/promises"
import type { HistoryFile, Observation } from "./types.js"

const HISTORY_PATH = new URL("../price-history.json", import.meta.url)

export async function loadHistory(): Promise<HistoryFile> {
  try {
    const raw = await readFile(HISTORY_PATH, "utf8")
    return JSON.parse(raw) as HistoryFile
  } catch {
    return { runs: [] }
  }
}

export async function appendRun(history: HistoryFile, observations: Observation[]): Promise<void> {
  history.runs.push({ timestamp: new Date().toISOString(), observations })
  // Keep the file from growing unbounded — the analysis only ever needs the
  // most recent run to diff against.
  if (history.runs.length > 50) history.runs.splice(0, history.runs.length - 50)
  await writeFile(HISTORY_PATH, JSON.stringify(history, null, 2))
}

export function previousObservations(history: HistoryFile): Observation[] {
  return history.runs.at(-1)?.observations ?? []
}

/**
 * Full price time series per target id, oldest first, across up to `limit`
 * past runs. Used for both the z-score baseline and the trend chart — a
 * single run's "previous vs current" isn't enough to tell a seasonal dip
 * from a genuine anomaly, so both need the fuller history.
 */
export function seriesByTarget(
  history: HistoryFile,
  limit = 30,
): Record<string, { timestamp: string; price: number | null }[]> {
  const recentRuns = history.runs.slice(-limit)
  const series: Record<string, { timestamp: string; price: number | null }[]> = {}

  for (const run of recentRuns) {
    for (const obs of run.observations) {
      ;(series[obs.id] ??= []).push({ timestamp: run.timestamp, price: obs.price })
    }
  }
  return series
}
