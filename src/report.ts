import type { PriceDelta } from "./types.js"

function fmtPrice(n: number | null): string {
  return n === null ? "—" : n.toFixed(2)
}

function fmtPct(n: number | null): string {
  if (n === null) return "—"
  const sign = n > 0 ? "+" : ""
  return `${sign}${(n * 100).toFixed(1)}%`
}

function fmtReason(reason: PriceDelta["flagReason"]): string {
  switch (reason) {
    case "threshold":
      return "threshold"
    case "anomaly":
      return "z-score anomaly"
    case "both":
      return "threshold + z-score"
    default:
      return ""
  }
}

export function printReport(deltas: PriceDelta[]): void {
  console.log("\nPriceWatch report")
  console.log("=================")

  if (deltas.length === 0) {
    console.log("No targets configured.")
    return
  }

  for (const d of deltas) {
    const marker = d.flagged ? "⚠ " : "  "
    console.log(
      `${marker}${d.label.padEnd(28)} ${fmtPrice(d.previousPrice).padStart(10)} -> ${fmtPrice(
        d.currentPrice,
      ).padStart(10)}   ${fmtPct(d.percentChange).padStart(8)}   z=${
        d.zScore != null ? d.zScore.toFixed(2) : "—"
      }`,
    )
  }

  const flagged = deltas.filter((d) => d.flagged)
  if (flagged.length > 0) {
    console.log(`\n${flagged.length} price move(s) flagged:`)
    for (const d of flagged) {
      console.log(
        `  - ${d.label}: ${fmtPrice(d.previousPrice)} -> ${fmtPrice(d.currentPrice)} (${fmtPct(
          d.percentChange,
        )}) — ${fmtReason(d.flagReason)}`,
      )
    }
  } else {
    console.log("\nNothing flagged this run.")
  }
}
