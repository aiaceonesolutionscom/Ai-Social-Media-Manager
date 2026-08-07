import { sql, eq, and } from 'drizzle-orm'
import { getDb } from '../db.js'
import { payments, aiUsageLogs, users, packages } from '../db/schema.js'
import { logger } from './logger.js'

export interface BillingSummary {
  totalRevenue: number
  totalAICost: number
  netProfit: number
  profitMargin: number
  monthlyRevenue: number
  monthlyAICost: number
  monthlyProfit: number
  perPackage: Array<{
    packageId: string
    packageName: string
    userCount: number
    revenue: number
    aiCost: number
    profit: number
  }>
  perUser: Array<{
    phone: string
    packageName: string
    aiCost: number
  }>
  daily: Array<{
    date: string
    revenue: number
    aiCost: number
    profit: number
  }>
}

class BillingEngine {
  async getSummary(): Promise<BillingSummary> {
    const db = getDb()

    // Revenue from payments
    const revenueResult = await db
      .select({ total: sql<number>`COALESCE(SUM(${payments.amountCents}), 0)` })
      .from(payments)
      .where(eq(payments.status, 'completed'))
    const totalRevenue = revenueResult[0]?.total ?? 0

    // Monthly revenue
    const monthlyRevenueResult = await db
      .select({ total: sql<number>`COALESCE(SUM(${payments.amountCents}), 0)` })
      .from(payments)
      .where(sql`${payments.status} = 'completed' AND ${payments.createdAt} >= date_trunc('month', NOW())`)
    const monthlyRevenue = monthlyRevenueResult[0]?.total ?? 0

    // AI cost from usage logs
    const aiCostResult = await db
      .select({ total: sql<number>`COALESCE(SUM(${aiUsageLogs.estimatedCostCents}), 0)` })
      .from(aiUsageLogs)
    const totalAICost = aiCostResult[0]?.total ?? 0

    // Monthly AI cost
    const monthlyAICostResult = await db
      .select({ total: sql<number>`COALESCE(SUM(${aiUsageLogs.estimatedCostCents}), 0)` })
      .from(aiUsageLogs)
      .where(sql`${aiUsageLogs.createdAt} >= date_trunc('month', NOW())`)
    const monthlyAICost = monthlyAICostResult[0]?.total ?? 0

    // Per-package profitability
    const perPackageResult = await db
      .select({
        packageId: packages.id,
        packageName: packages.name,
        userCount: sql<number>`COUNT(DISTINCT ${users.phone})`,
        revenue: sql<number>`COALESCE(SUM(${payments.amountCents}), 0)`,
      })
      .from(packages)
      .leftJoin(users, eq(users.packageId, packages.id))
      .leftJoin(payments, and(eq(payments.phone, users.phone), eq(payments.status, 'completed')))
      .groupBy(packages.id, packages.name)

    const perPackage = perPackageResult.map((p) => ({
      packageId: p.packageId,
      packageName: p.packageName,
      userCount: p.userCount,
      revenue: p.revenue,
      aiCost: 0,
      profit: p.revenue,
    }))

    // Per-user AI cost
    const perUserResult = await db
      .select({
        phone: aiUsageLogs.phone,
        aiCost: sql<number>`COALESCE(SUM(${aiUsageLogs.estimatedCostCents}), 0)`,
      })
      .from(aiUsageLogs)
      .where(sql`${aiUsageLogs.phone} != ''`)
      .groupBy(aiUsageLogs.phone)
      .orderBy(sql`SUM(${aiUsageLogs.estimatedCostCents}) DESC`)
      .limit(20)

    const perUser = await Promise.all(
      perUserResult
        .filter((u) => u.phone)
        .map(async (u) => {
          const phone = u.phone as string
          const userResult = await db
            .select({ packageId: users.packageId })
            .from(users)
            .where(eq(users.phone, phone))
            .limit(1)
          const pkgResult = userResult[0]?.packageId
            ? await db.select({ name: packages.name }).from(packages).where(eq(packages.id, userResult[0].packageId)).limit(1)
            : null
          return {
            phone,
            packageName: pkgResult?.[0]?.name || 'Free',
            aiCost: u.aiCost,
          }
        }),
    )

    // Daily breakdown (last 7 days)
    const dailyResult = await db
      .select({
        date: sql<string>`date_trunc('day', to_timestamp(${payments.createdAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"'))::date as day`,
        revenue: sql<number>`COALESCE(SUM(${payments.amountCents}), 0)`,
      })
      .from(payments)
      .where(eq(payments.status, 'completed'))
      .groupBy(sql`day`)
      .orderBy(sql`day`)
      .limit(7)

    const daily = dailyResult.map((d) => ({
      date: String(d.date),
      revenue: d.revenue,
      aiCost: 0,
      profit: d.revenue,
    }))

    const netProfit = totalRevenue - totalAICost
    const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0
    const monthlyProfit = monthlyRevenue - monthlyAICost

    return {
      totalRevenue,
      totalAICost,
      netProfit,
      profitMargin,
      monthlyRevenue,
      monthlyAICost,
      monthlyProfit,
      perPackage,
      perUser,
      daily,
    }
  }

  async getUserCost(phone: string): Promise<{
    totalCost: number
    byCategory: Record<string, number>
    byProvider: Record<string, number>
  }> {
    const db = getDb()

    const logs = await db
      .select()
      .from(aiUsageLogs)
      .where(eq(aiUsageLogs.phone, phone))

    let totalCost = 0
    const byCategory: Record<string, number> = {}
    const byProvider: Record<string, number> = {}

    for (const log of logs) {
      totalCost += log.estimatedCostCents
      byCategory[log.category] = (byCategory[log.category] || 0) + log.estimatedCostCents
      byProvider[log.model || 'unknown'] = (byProvider[log.model || 'unknown'] || 0) + log.estimatedCostCents
    }

    return { totalCost, byCategory, byProvider }
  }
}

export const billingEngine = new BillingEngine()
