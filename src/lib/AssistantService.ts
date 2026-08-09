import { listActivePackages, listActiveTopUpBundles, getConfig } from '../store.js'

export interface KbEntry {
  id: string
  title: string
  keywords: string[]
  answer: string
}

export const KNOWLEDGE_BASE: KbEntry[] = [
  {
    id: 'what-is',
    title: 'What is EchoPost?',
    keywords: ['echo', 'echopost', 'app', 'product', 'what', 'about', 'tool', 'platform', 'brand'],
    answer:
      'EchoPost is an AI social media manager. You record a short voice note and our AI turns it into polished posts ' +
      'for Instagram, Facebook and WhatsApp — then you approve and publish them in a few taps. No more staring at a blank screen.',
  },
  {
    id: 'how-it-works',
    title: 'How does it work?',
    keywords: ['how it works', 'how', 'works', 'process', 'steps', 'flow', 'started', 'guide'],
    answer:
      'It is a simple 4-step loop: 1) Speak — record a quick voice note with what you want to say. ' +
      '2) Generate — the AI writes and refines your post. 3) Approve — edit it if you want, then hit publish. ' +
      '4) Publish — it goes live on your connected Instagram, Facebook or WhatsApp. You can also schedule posts for later.',
  },
  {
    id: 'voice-to-post',
    title: 'Voice to post',
    keywords: ['voice', 'record', 'speak', 'audio', 'transcript', 'speech', 'note', 'dictate'],
    answer:
      'Just record a voice note in the chat like you are talking to a friend. The AI transcribes it and expands it into ' +
      'a ready-to-publish social post, matching your brand voice. You can ask it to make it shorter, funnier or more professional at any time.',
  },
  {
    id: 'tokens-explained',
    title: 'How do tokens work?',
    keywords: ['token', 'tokens', 'credit', 'credits', 'balance', 'spend', 'cost', 'consume', 'usage'],
    answer:
      'Tokens are your credits for using the AI. Every action that uses the AI — like generating a post from a voice note, ' +
      'editing a caption or creating an image — spends a small number of tokens. ' +
      'You get tokens with your plan and you can add more anytime with one-time top-up packs. ' +
      'Your current balance is always visible in the dashboard.',
  },
  {
    id: 'packages-live',
    title: 'Packages & pricing',
    keywords: ['package', 'packages', 'plans', 'plan', 'pricing', 'price', 'prices', 'cost', 'subscribe', 'subscription', 'monthly', 'yearly', 'billing', 'tiers', 'which plan'],
    answer: '',
  },
  {
    id: 'topups-live',
    title: 'Top-up token packs',
    keywords: ['top up', 'topup', 'top-ups', 'extra tokens', 'buy tokens', 'more tokens', 'refill', 'bundle', 'bundles', 'add tokens', 'purchase tokens'],
    answer: '',
  },
  {
    id: 'signup',
    title: 'Getting started & sign up',
    keywords: ['sign up', 'signup', 'register', 'create account', 'join', 'free', 'trial', 'start', 'first'],
    answer:
      'Getting started takes under a minute. Click "Start free" on the homepage to create your account — ' +
      'new accounts start with a small free token balance so you can try it out. ' +
      'Then connect your Instagram, Facebook or WhatsApp account and record your first voice note.',
  },
  {
    id: 'platforms',
    title: 'Platforms you can publish to',
    keywords: ['instagram', 'facebook', 'whatsapp', 'platform', 'publish', 'channels', 'connect', 'social', 'accounts'],
    answer:
      'EchoPost publishes to Instagram, Facebook and WhatsApp. You connect each account once from the dashboard ' +
      'and choose where each post goes. Depending on your plan you can use one, two or all three channels.',
  },
  {
    id: 'scheduling',
    title: 'Scheduling posts',
    keywords: ['schedule', 'scheduled', 'scheduling', 'later', 'queue', 'plan ahead', 'time', 'posting times'],
    answer:
      'You can schedule a post for a specific date and time instead of publishing immediately. ' +
      'Scheduled posts sit in your queue until their time comes, and you can edit or cancel them before they go live.',
  },
  {
    id: 'analytics',
    title: 'Analytics & insights',
    keywords: ['analytics', 'stats', 'statistics', 'insights', 'dashboard', 'growth', 'reach', 'engagement', 'performance'],
    answer:
      'The analytics dashboard shows how your posts are performing — reach, engagement and publishing history over time. ' +
      'Use it to see what content your audience likes best and double down on what works.',
  },
  {
    id: 'support',
    title: 'Support & contact',
    keywords: ['support', 'help', 'contact', 'question', 'issue', 'problem', 'ticket', 'refund', 'cancel', 'billing issue'],
    answer:
      'If you need help, open a support ticket from inside the dashboard and our team will get back to you. ' +
      'For billing or refund questions, mention the relevant details in your ticket and we will sort it out.',
  },
  {
    id: 'welcome',
    title: 'Welcome',
    keywords: ['hi', 'hello', 'hey', 'start', 'welcome', 'help'],
    answer:
      'Hi! I am the EchoPost assistant. I can tell you about how the app works, tokens, packages and pricing. ' +
      'Try asking "which packages do you have?" or "how do tokens work?".',
  },
]

function formatMoney(cents: number, currency = 'usd'): string {
  const amount = (cents / 100).toFixed(2)
  switch (currency) {
    case 'inr': return `₹${amount}`
    case 'eur': return `€${amount}`
    case 'gbp': return `£${amount}`
    case 'usd':
    default: return `$${amount}`
  }
}

async function formatPackagesBlock(): Promise<string> {
  const pkgs = await listActivePackages()
  if (pkgs.length === 0) {
    return 'We do not have any plans available right now — please check back soon.'
  }
  const defaultSlug = (await getConfig('default_package')) || ''
  const lines = pkgs.map((p, i) => {
    let price: string
    if (p.billingPeriod === 'yearly') {
      price = `${formatMoney(p.priceCents, p.currency)}/year`
    } else {
      price = `${formatMoney(p.priceCents, p.currency)}/month`
      if (p.yearlyPriceCents && p.yearlyPriceCents > 0) {
        price += ` or ${formatMoney(p.yearlyPriceCents, p.currency)}/year`
      }
    }
    const setup =
      p.setupType === 'standard' ? ' · standard setup' :
      p.setupType === 'premium' ? ' · premium setup' : ''
    const isDefault = p.slug === defaultSlug ? ' ⭐ (current default plan)' : ''
    const desc = p.description ? ` — ${p.description}` : ''
    return `${i + 1}. ${p.name}${isDefault} — ${price} — ${p.includedTokens.toLocaleString()} tokens${setup}${desc}`
  })
  return `Here are our current plans:\n\n${lines.join('\n')}\n\nYou can upgrade or switch plans anytime from the pricing page, and it applies instantly.`
}

async function formatTopUpsBlock(): Promise<string> {
  const bundles = await listActiveTopUpBundles()
  if (bundles.length === 0) {
    return 'There are no top-up packs available right now. Your plan already includes tokens.'
  }
  const lines = bundles.map(
    (b, i) => `${i + 1}. ${b.tokens.toLocaleString()} tokens — ${formatMoney(b.priceCents)}`,
  )
  return `You can add tokens anytime with these top-up packs:\n\n${lines.join('\n')}\n\nA pack is a one-time purchase — it does not renew automatically.`
}

const PUBLIC_TITLES = KNOWLEDGE_BASE.filter((e) => e.id !== 'welcome').map((e) => e.title)

const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'of', 'in', 'on', 'at', 'for', 'and', 'or', 'how', 'do', 'does', 'i', 'can', 'my', 'where', 'what', 'is', 'are', 'me', 'it', 'with', 'from', 'want', 'help', 'please', 'tell', 'about', 'you', 'your', 'have', 'has', 'get', 'does', 'did', 'me',
])

function tokenize(q: string): string[] {
  return q.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !STOPWORDS.has(w))
}

export async function answerQuery(q: string): Promise<AssistantAnswer> {
  const words = tokenize(q)

  if (words.length === 0) {
    return {
      topic: 'welcome',
      answer: KNOWLEDGE_BASE.find((e) => e.id === 'welcome')!.answer,
      suggestions: PUBLIC_TITLES.slice(0, 4),
    }
  }

  // Dynamic answers are built at query time so they always reflect the latest data.
  const dynamicAnswers: Record<string, () => Promise<string>> = {
    'packages-live': formatPackagesBlock,
    'topups-live': formatTopUpsBlock,
  }

  let best: { entry: KbEntry; score: number } | null = null
  for (const entry of KNOWLEDGE_BASE) {
    let score = 0
    for (const w of words) {
      for (const kw of entry.keywords) {
        const kws = kw.split(/\s+/)
        if (kws.length > 1) {
          if (kws.every(k => words.includes(k))) score += 3
        } else if (words.includes(kw)) {
          score += 2
        } else if (kw.length >= 4 && w.startsWith(kw)) {
          score += 2
        } else if (entry.title.toLowerCase().includes(w)) {
          score += 1
        }
      }
    }
    if (!best || score > best.score) {
      best = { entry, score }
    }
  }

  const topic = best && best.score > 0 ? best.entry.id : 'no-match'

  if (!best || best.score <= 0) {
    return {
      topic,
      answer:
        'I am not sure about that one. Here are topics I can help with — pick one below, or try rephrasing your question.',
      suggestions: PUBLIC_TITLES,
    }
  }

  let answer = best.entry.answer
  if (dynamicAnswers[best.entry.id]) {
    answer = await dynamicAnswers[best.entry.id]()
  }

  const related = KNOWLEDGE_BASE
    .filter((e) => e.id !== best!.entry.id && e.id !== 'welcome')
    .slice(0, 3)
    .map((e) => e.title)

  return { topic, answer, suggestions: related }
}

export interface AssistantAnswer {
  topic: string
  answer: string
  suggestions: string[]
}
