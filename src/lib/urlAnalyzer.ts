import { chatJson } from '../lib/llm.js'
import { fetchWithRetry } from '../lib/http.js'
import { logger } from '../lib/logger.js'

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
