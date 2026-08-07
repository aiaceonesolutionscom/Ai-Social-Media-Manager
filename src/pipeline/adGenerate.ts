import { chatJson } from '../lib/llm.js'
import type { AdContent, AdTargeting, Intent } from '../types.js'

const SYSTEM_AD_CONTENT = `You are a Meta Ads copywriter. Given a topic and intent, create compelling ad content for Facebook/Instagram ads.

Rules:
- Headline: punchy, 5-10 words, grabs attention immediately.
- Primary Text: 1-3 sentences, compelling, speaks to the audience's pain point or desire.
- Description: 1 sentence, supporting detail or value proposition.
- Call to Action: choose the most appropriate from: Learn More, Sign Up, Shop Now, Book Now, Contact Us, Get Offer.

Return ONLY a valid JSON object with keys: headline, primaryText, description, callToAction.`

const SYSTEM_AD_TARGETING = `You are a Meta Ads targeting expert. Given a topic and audience description, suggest targeting parameters.

Rules:
- ageMin: minimum age (18-65)
- ageMax: maximum age (18-65, must be > ageMin)
- genders: array of "all", "male", "female"
- locations: 1-3 relevant countries or cities
- interests: 3-5 relevant interest categories

Return ONLY a valid JSON object with keys: ageMin, ageMax, genders, locations, interests.`

const SYSTEM_AD_OBJECTIVE = `You are a Meta Ads campaign strategist. Given a topic and goal, suggest the best campaign objective.

Available objectives:
- OUTCOME_AWARENESS: for brand awareness
- OUTCOME_ENGAGEMENT: for likes, comments, shares
- OUTCOME_LEADS: for lead generation
- OUTCOME_SALES: for conversions/sales
- OUTCOME_TRAFFIC: for website traffic

Return ONLY the objective string (e.g. "OUTCOME_ENGAGEMENT").`

export async function generateAdContent(topic: string, intent: Intent): Promise<AdContent> {
  const messages = [
    { role: 'system' as const, content: SYSTEM_AD_CONTENT },
    { role: 'user' as const, content: `Topic: ${topic}\nAudience: ${intent.audience}\nTone: ${intent.tone}\nGoal: ${intent.goal}` },
  ]
  return chatJson<AdContent>(messages, { temperature: 0.7 })
}

export async function generateAdTargeting(topic: string, audience: string): Promise<AdTargeting> {
  const messages = [
    { role: 'system' as const, content: SYSTEM_AD_TARGETING },
    { role: 'user' as const, content: `Topic: ${topic}\nTarget audience: ${audience}` },
  ]
  return chatJson<AdTargeting>(messages, { temperature: 0.6 })
}

export async function suggestAdObjective(topic: string, goal: string): Promise<string> {
  const messages = [
    { role: 'system' as const, content: SYSTEM_AD_OBJECTIVE },
    { role: 'user' as const, content: `Topic: ${topic}\nGoal: ${goal}` },
  ]
  const result = await chatJson<string>(messages, { temperature: 0.5 })
  return result || 'OUTCOME_ENGAGEMENT'
}
