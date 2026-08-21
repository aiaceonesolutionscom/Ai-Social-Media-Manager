import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'
import { chatJson } from '../lib/llm.js'
import { fetchWithRetry } from '../lib/http.js'
import { logger } from '../lib/logger.js'

// H16 — block fetching private/internal/loopback addresses (SSRF protection).
// Covers RFC1918, loopback, link-local (incl. 169.254.169.254 cloud metadata),
// CGNAT, documentation ranges, multicast and IPv6 equivalents.
function isPrivateIp(ip: string): boolean {
  if (ip.includes(':')) {
    const lower = ip.toLowerCase()
    if (lower === '::1' || lower === '::') return true
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true
    return false
  }
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true
  const [a, b, c] = parts
  if (a === 0) return true
  if (a === 10) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true
  if (a === 198 && b === 51 && c === 100) return true
  if (a === 203 && b === 0 && c === 113) return true
  if (a >= 224) return true
  return false
}

async function assertPublicUrl(url: string): Promise<void> {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    throw new Error('Invalid URL')
  }
  if (isIP(host) !== 0) {
    if (isPrivateIp(host)) throw new Error('Private/internal addresses are not allowed')
    return
  }
  const addresses = await lookup(host, { all: true })
  if (addresses.length === 0) throw new Error('Unable to resolve host')
  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new Error(`Blocked: ${host} resolves to a private/internal address (${address})`)
    }
  }
}

export interface WebsiteAnalysis {
  businessName: string
  businessType: string
  services: string[]
  products: string[]
  brandTone: string
  targetAudience: string
  colorScheme: string
  keyMessages: string[]
  websiteUrl: string
}

const SYSTEM_ANALYZE_WEBSITE = `You are a business analyst. Given website content, extract key business information.

Analyze the text and return:
- businessName: the name of the business
- businessType: type of business (e.g., clinic, restaurant, e-commerce, agency)
- services: array of main services offered (3-5 items)
- products: array of main products if any (3-5 items, empty array if none)
- brandTone: the brand's tone (e.g., professional, casual, luxury, friendly)
- targetAudience: who their target audience is
- colorScheme: dominant colors mentioned or implied (e.g., "blue and white", "warm earth tones")
- keyMessages: 2-3 key marketing messages or taglines found on the site

Return ONLY a valid JSON object with these keys.`

export async function analyzeWebsite(url: string): Promise<WebsiteAnalysis> {
  try {
    const html = await fetchWebsiteContent(url)
    const textContent = extractTextFromHtml(html)

    const messages = [
      { role: 'system' as const, content: SYSTEM_ANALYZE_WEBSITE },
      { role: 'user' as const, content: `Website URL: ${url}\n\nContent:\n${textContent.slice(0, 4000)}` },
    ]

    const analysis = await chatJson<WebsiteAnalysis>(messages, { temperature: 0.5 })
    return { ...analysis, websiteUrl: url }
  } catch (err) {
    logger.error({ url, error: (err as Error).message }, 'website analysis failed')
    return {
      businessName: 'Unknown Business',
      businessType: 'business',
      services: [],
      products: [],
      brandTone: 'professional',
      targetAudience: 'general audience',
      colorScheme: 'modern colors',
      keyMessages: [],
      websiteUrl: url,
    }
  }
}

async function fetchWebsiteContent(url: string): Promise<string> {
  // H16 — SSRF guard before any network call.
  await assertPublicUrl(url)
  const res = await fetchWithRetry(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ContentAnalyzer/1.0)',
    },
  })
  return res.text()
}

function extractTextFromHtml(html: string): string {
  // Remove scripts and styles
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, '')
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '')

  // Extract meta tags content
  const metaDesc = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/i)
  const ogTitle = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"/i)
  const ogDesc = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"/i)

  const metaContent = [
    metaDesc?.[1] || '',
    ogTitle?.[1] || '',
    ogDesc?.[1] || '',
  ].filter(Boolean).join('\n')

  // Extract visible text
  text = text.replace(/<[^>]+>/g, ' ')
  text = text.replace(/\s+/g, ' ').trim()

  // Combine meta + visible text
  return `${metaContent}\n\n${text}`.slice(0, 5000)
}

export function isUrl(text: string): boolean {
  const urlPattern = /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/i
  return urlPattern.test(text.trim())
}

export function normalizeUrl(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed
  }
  return `https://${trimmed}`
}

export function isValidImageUrl(url: string): boolean {
  if (!url) return false
  if (!/^https?:\/\//i.test(url)) return false
  // H16 — block literal private/loopback addresses before the URL is downloaded.
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host === 'localhost') return false
    const ip = host.includes(':') ? host : host.split('.')
    if (Array.isArray(ip)) {
      if (ip.length === 4 && ip.every((n) => /^\d+$/.test(n))) {
        const [a, b] = ip.map(Number)
        if (a === 10 || a === 127 || a === 0) return false
        if (a === 169 && b === 254) return false
        if (a === 172 && b >= 16 && b <= 31) return false
        if (a === 192 && b === 168) return false
        if (a === 100 && b >= 64 && b <= 127) return false
        if (a >= 224) return false
      }
    } else if (host === '::1' || host.startsWith('fc') || host.startsWith('fd')) {
      return false
    }
  } catch {
    return false
  }
  if (url.includes('example.com')) return false
  return true
}
