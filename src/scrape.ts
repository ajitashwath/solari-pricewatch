/**
 * scrape.ts — visit every watched product page with a Solari cloud browser
 * and pull out whatever text sits at `priceSelector`.
 *
 * One browser session is reused across all targets (new tab per target)
 * rather than launching a session per URL — cheaper and faster, since a
 * session is billed from launch to close regardless of how many pages you
 * open in it.
 *
 * `stealth` + a residential `proxy` are opt-in via env vars: most product
 * pages don't need them, and pairing a proxy with a non-stealth browser is
 * the combination that gets flagged, per the cookbook's stealth-proxy note.
 *
 * Each target also gets a viewport screenshot at scrape time. It's cheap
 * (one extra call per page) and gives the dashboard something to show a
 * human, plus a fallback record of what the page actually looked like if a
 * selector silently matches the wrong element.
 */
import { Solari } from "@solarisdk/browser"
import type { Target, Observation } from "./types.js"

const PRICE_PATTERN = /-?\d[\d,]*\.?\d*/

function parsePrice(rawText: string): number | null {
  const match = rawText.replace(/\s+/g, " ").match(PRICE_PATTERN)
  if (!match) return null
  const numeric = Number(match[0].replace(/,/g, ""))
  return Number.isFinite(numeric) ? numeric : null
}

export async function scrapeTargets(
  targets: Target[],
  opts: { proxyCountry?: string; record?: boolean } = {},
): Promise<{ observations: Observation[]; sessionId: string; recording: boolean }> {
  const solari = new Solari({ apiKey: process.env.SOLARI_API_KEY! })

  const launchOpts: Record<string, unknown> = {}
  if (opts.proxyCountry) {
    launchOpts.stealth = true
    launchOpts.proxy = opts.proxyCountry
  }
  if (opts.record) launchOpts.recording = true

  const browser = await solari.launch(launchOpts)
  const observations: Observation[] = []

  try {
    for (const target of targets) {
      const page = await browser.newPage()
      try {
        await page.goto(target.url, { waitUntil: "domcontentloaded" })
        const rawText = await page.locator(target.priceSelector).innerText()

        // Best-effort: a screenshot failure shouldn't sink the whole scrape,
        // since the price text is the part that actually matters.
        let screenshot: string | undefined
        try {
          const buf = await page.screenshot({ type: "png" })
          screenshot = `data:image/png;base64,${Buffer.from(buf).toString("base64")}`
        } catch {
          // no screenshot this run; dashboard just omits the thumbnail
        }

        observations.push({
          id: target.id,
          label: target.label,
          url: target.url,
          rawText: rawText.trim(),
          price: parsePrice(rawText),
          scrapedAt: new Date().toISOString(),
          screenshot,
        })
      } catch (err) {
        observations.push({
          id: target.id,
          label: target.label,
          url: target.url,
          rawText: `ERROR: ${(err as Error).message}`,
          price: null,
          scrapedAt: new Date().toISOString(),
        })
      } finally {
        await page.close()
      }
    }
    return { observations, sessionId: browser.id, recording: Boolean(opts.record) }
  } finally {
    await browser.close()
    // Required in Node: the client keeps a loopback proxy open for the
    // connection-retry path, which otherwise keeps the process alive.
    await solari.close()
  }
}
