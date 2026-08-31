export interface Target {
  id: string
  label: string
  url: string
  priceSelector: string
  note?: string
}

export interface Observation {
  id: string
  label: string
  url: string
  rawText: string
  price: number | null
  scrapedAt: string
  /** data: URL, base64 PNG screenshot taken at scrape time */
  screenshot?: string
}

export interface PriceDelta {
  id: string
  label: string
  previousPrice: number | null
  currentPrice: number | null
  absoluteChange: number | null
  percentChange: number | null
  /** z-score of the current price against this target's historical mean/stdev */
  zScore: number | null
  /** true if either the percent-change threshold or the z-score threshold trips */
  flagged: boolean
  flagReason: "threshold" | "anomaly" | "both" | null
}

export interface AnalysisResult {
  deltas: PriceDelta[]
  /** target id -> base64 PNG sparkline of price history, rendered in-sandbox */
  charts: Record<string, string>
}

export interface HistoryFile {
  runs: { timestamp: string; observations: Observation[] }[]
}
