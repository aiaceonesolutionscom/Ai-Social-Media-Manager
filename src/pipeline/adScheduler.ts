import { sql } from 'drizzle-orm'
import { getDb } from '../db.js'
import { adCampaigns } from '../db/schema.js'
import { getUser, recoverStuckAdCampaigns, resolveUserPhone } from '../store.js'
import { logger } from '../lib/logger.js'
import { launchAdCampaign } from './adConversation.js'

let adSchedulerInterval: NodeJS.Timeout | null = null

function startAdSchedulerInternal(): void {
  if (adSchedulerInterval) return
  adSchedulerInterval = setInterval(async () => {
    try {
      const now = new Date().toISOString()
      const db = getDb()
      // P2-21 — unstick campaigns left 'creating' by a crashed launch.
      await recoverStuckAdCampaigns()
      const due = await db.select().from(adCampaigns).where(sql`${adCampaigns.status} = 'scheduled' AND ${adCampaigns.publishAt} <= ${now}`)
      for (const item of due) {
        // P5-1 — a paused package must not launch its scheduled ad campaigns.
        // Resolve the canonical user phone (thread keys map back to owner).
        const user = await getUser(await resolveUserPhone(item.phone))
        if (user?.packageStatus === 'paused') {
          continue
        }
        try {
          await launchAdCampaign(item.id)
        } catch (err) {
          logger.error({ campaignId: item.id, error: (err as Error).message }, 'scheduled ad launch failed')
        }
      }
    } catch (err) {
      logger.error({ err }, 'ad scheduler tick failed')
    }
  }, 60_000)
}

export function startAdScheduler(): void {
  startAdSchedulerInternal()
  logger.info('ad scheduler started')
}
