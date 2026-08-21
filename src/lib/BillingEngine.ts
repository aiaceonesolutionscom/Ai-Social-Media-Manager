import { sql, eq, and, gte, lte } from 'drizzle-orm'
import { getDb } from '../db.js'
import { payments, aiUsageLogs, users, packages, tokenTransactions } from '../db/schema.js'
import { getAllConfig } from '../store.js'
import { logger } from './logger.js'

export interface BillingSummary {
  totalRevenue: number
  totalAICost: number
  totalFees: number
  totalTax: number
  totalMdr: number
  netProfit: number
  profitMargin: number
  monthlyRevenue: number
  monthlyAICost: number
  monthlyFees: number
  monthlyTax: number
  monthlyMdr: number
  monthlyProfit: number
  perPackage: Array<{
    packageId: string
    packageName: string
    userCount: number
    revenue: number
    aiCost: number
    fees: number
    profit: number
    profitMargin: number
  }>
  perUser: Array<{
    phone: string
    packageName: string
    aiCost: number
    creditsUsed: number
    revenue: number
  }>
  byProvider: Array<{
    providerId: string
    providerName: string
    category: string
    requests: number
    unpricedRequests: number
    totalTokensInput: number
    totalTokensOutput: number
    aiCostCents: number
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

    // H11 — normalize PKR amounts to USD at the configured rate so fee sums
    // never mix currencies. Gateway payments (currency='PKR') store mdr in PKR;
    // everything else stores USD minor units.
    const cfg = await getAllConfig()
    const pkrRate = Number(cfg.payment_local_pkr_rate) || 0
    const rate = pkrRate > 0 ? pkrRate : 1

    const feeUsd = sql`CASE WHEN ${payments.currency} = 'PKR' THEN ROUND((COALESCE(${payments.taxAmount},0) + COALESCE(${payments.mdrAmount},0)) / ${rate}) ELSE COALESCE(${payments.taxAmount},0) + COALESCE(${payments.mdrAmount},0) END`
    const mdrUsd = sql`CASE WHEN ${payments.currency} = 'PKR' THEN ROUND(COALESCE(${payments.mdrAmount},0) / ${rate}) ELSE COALESCE(${payments.mdrAmount},0) END`

    const revenueResult = await db
      .select({ total: sql<number>`COALESCE(SUM(${payments.amountCents}), 0)` })
      .from(payments)
      .where(eq(payments.status, 'completed'))
    const totalRevenue = Number(revenueResult[0]?.total ?? 0)

    const monthlyRevenueResult = await db
      .select({ total: sql<number>`COALESCE(SUM(${payments.amountCents}), 0)` })
      .from(payments)
      .where(sql`${payments.status} = 'completed' AND ${payments.createdAt}::timestamptz >= date_trunc('month', NOW())`)
    const monthlyRevenue = Number(monthlyRevenueResult[0]?.total ?? 0)

    const aiCostResult = await db
      .select({ total: sql<number>`COALESCE(SUM(${aiUsageLogs.estimatedCostCents}), 0)` })
      .from(aiUsageLogs)
    const totalAICost = Number(aiCostResult[0]?.total ?? 0)

    const monthlyAICostResult = await db
      .select({ total: sql<number>`COALESCE(SUM(${aiUsageLogs.estimatedCostCents}), 0)` })
      .from(aiUsageLogs)
      .where(sql`${aiUsageLogs.createdAt}::timestamptz >= date_trunc('month', NOW())`)
    const monthlyAICost = Number(monthlyAICostResult[0]?.total ?? 0)

    // Fees (payment processing + tax) — these reduce profit but are not AI cost
    const totalFeesResult = await db
      .select({ total: sql<number>`COALESCE(SUM(${feeUsd}), 0)` })
      .from(payments)
      .where(eq(payments.status, 'completed'))
    const totalFees = Number(totalFeesResult[0]?.total ?? 0)

    const totalTaxResult = await db
      .select({ total: sql<number>`COALESCE(SUM(${payments.taxAmount}), 0)` })
      .from(payments)
      .where(eq(payments.status, 'completed'))
    const totalTax = Number(totalTaxResult[0]?.total ?? 0)

    const totalMdrResult = await db
      .select({ total: sql<number>`COALESCE(SUM(${mdrUsd}), 0)` })
      .from(payments)
      .where(eq(payments.status, 'completed'))
    const totalMdr = Number(totalMdrResult[0]?.total ?? 0)

    const monthlyFeesResult = await db
      .select({ total: sql<number>`COALESCE(SUM(${feeUsd}), 0)` })
      .from(payments)
      .where(sql`${payments.status} = 'completed' AND ${payments.createdAt}::timestamptz >= date_trunc('month', NOW())`)
    const monthlyFees = Number(monthlyFeesResult[0]?.total ?? 0)

    const monthlyTaxResult = await db
      .select({ total: sql<number>`COALESCE(SUM(${payments.taxAmount}), 0)` })
      .from(payments)
      .where(sql`${payments.status} = 'completed' AND ${payments.createdAt}::timestamptz >= date_trunc('month', NOW())`)
    const monthlyTax = Number(monthlyTaxResult[0]?.total ?? 0)

    const monthlyMdrResult = await db
      .select({ total: sql<number>`COALESCE(SUM(${mdrUsd}), 0)` })
      .from(payments)
      .where(sql`${payments.status} = 'completed' AND ${payments.createdAt}::timestamptz >= date_trunc('month', NOW())`)
    const monthlyMdr = Number(monthlyMdrResult[0]?.total ?? 0)

    // Per-package profitability
    const perPackageResult = await db.execute(sql`
      SELECT
        p.slug AS "packageId",
        p.name AS "packageName",
        COUNT(DISTINCT u.phone) AS "userCount",
        COALESCE(SUM(CASE WHEN pay.status = 'completed' THEN pay.amount_cents ELSE 0 END), 0) AS "revenue",
        COALESCE(SUM(CASE WHEN pay.status = 'completed' THEN pay.tax_amount + pay.mdr_amount ELSE 0 END), 0) AS "fees",
        COALESCE((SELECT SUM(a.estimated_cost_cents) FROM ai_usage_logs a
                   JOIN users u2 ON a.phone = u2.phone
                   WHERE u2.package_id = p.slug AND a.phone != ''), 0) AS "aiCost"
      FROM packages p
      LEFT JOIN users u ON u.package_id = p.slug
      LEFT JOIN payments pay ON pay.phone = u.phone
      GROUP BY p.id, p.slug, p.name
      ORDER BY p.sort_order
    `)

    const perPackage = (perPackageResult.rows as any[]).map((p) => {
      const revenue = Number(p.revenue) || 0
      const aiCost = Number(p.aiCost) || 0
      const fees = Number(p.fees) || 0
      const profit = revenue - aiCost - fees
      const profitMargin = revenue > 0 ? (profit / revenue) * 100 : 0
      return {
        packageId: String(p.packageId),
        packageName: String(p.packageName),
        userCount: Number(p.userCount) || 0,
        revenue,
        aiCost,
        fees,
        profit,
        profitMargin,
      }
    })

    // Per-user AI cost + credits used
    const perUserResult = await db.execute(sql`
      SELECT
        a.phone,
        COALESCE(SUM(a.estimated_cost_cents), 0) AS "aiCost",
        COALESCE((SELECT SUM(ABS(t.amount)) FROM token_transactions t WHERE t.phone = a.phone AND t.type = 'deduct'), 0) AS "creditsUsed",
        COALESCE((SELECT SUM(pay.amount_cents) FROM payments pay WHERE pay.phone = a.phone AND pay.status = 'completed'), 0) AS "revenue"
      FROM ai_usage_logs a
      WHERE a.phone != ''
      GROUP BY a.phone
      ORDER BY SUM(a.estimated_cost_cents) DESC
      LIMIT 20
    `)

    const perUser = (perUserResult.rows as any[]).map(async (u) => {
      const userResult = await db
        .select({ packageId: users.packageId })
        .from(users)
        .where(eq(users.phone, u.phone))
        .limit(1)
      const pkgResult = userResult[0]?.packageId
        ? await db.select({ name: packages.name }).from(packages).where(eq(packages.id, userResult[0].packageId)).limit(1)
        : null
      return {
        phone: String(u.phone),
        packageName: pkgResult?.[0]?.name || 'Free',
        aiCost: Number(u.aiCost) || 0,
        creditsUsed: Number(u.creditsUsed) || 0,
        revenue: Number(u.revenue) || 0,
      }
    })
    const perUserResolved = await Promise.all(perUser)

    // Provider-wise cost
    const byProviderResult = await db.execute(sql`
      SELECT
        a.provider_id AS "providerId",
        COALESCE(ap.display_name, a.provider_id) AS "providerName",
        a.category,
        COUNT(*) AS "requests",
        SUM(CASE WHEN a.unpriced THEN 1 ELSE 0 END) AS "unpricedRequests",
        SUM(a.tokens_input) AS "totalTokensInput",
        SUM(a.tokens_output) AS "totalTokensOutput",
        SUM(a.estimated_cost_cents) AS "aiCostCents"
      FROM ai_usage_logs a
      LEFT JOIN ai_providers ap ON ap.id = a.provider_id
      GROUP BY a.provider_id, ap.display_name, a.category
      ORDER BY SUM(a.estimated_cost_cents) DESC
    `)

    const byProvider = (byProviderResult.rows as any[]).map((r) => ({
      providerId: String(r.providerId),
      providerName: String(r.providerName),
      category: String(r.category),
      requests: Number(r.requests) || 0,
      unpricedRequests: Number(r.unpricedRequests) || 0,
      totalTokensInput: Number(r.totalTokensInput) || 0,
      totalTokensOutput: Number(r.totalTokensOutput) || 0,
      aiCostCents: Number(r.aiCostCents) || 0,
    }))

    // Daily breakdown (last 30 days)
    const dailyResult = await db.execute(sql`
      SELECT
        day::date AS "date",
        COALESCE(SUM(CASE WHEN source = 'revenue' THEN amount ELSE 0 END), 0) AS "revenue",
        COALESCE(SUM(CASE WHEN source = 'aiCost' THEN amount ELSE 0 END), 0) AS "aiCost",
        COALESCE(SUM(CASE WHEN source = 'fees' THEN amount ELSE 0 END), 0) AS "fees"
      FROM (
        SELECT date_trunc('day', created_at::timestamptz)::date AS day,
               amount_cents AS amount, 'revenue' AS source
        FROM payments WHERE status = 'completed'
        UNION ALL
        SELECT date_trunc('day', created_at::timestamptz)::date AS day,
               CASE WHEN currency = 'PKR' THEN ROUND((COALESCE(tax_amount,0) + COALESCE(mdr_amount,0)) / ${rate})
                    ELSE COALESCE(tax_amount,0) + COALESCE(mdr_amount,0) END AS amount,
               'fees' AS source
        FROM payments WHERE status = 'completed'
        UNION ALL
        SELECT date_trunc('day', created_at::timestamptz)::date AS day,
               estimated_cost_cents AS amount, 'aiCost' AS source
        FROM ai_usage_logs
      ) combined
      WHERE day >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY day
      ORDER BY day
    `)

    const daily = (dailyResult.rows as any[]).map((d) => {
      const revenue = Number(d.revenue) || 0
      const aiCost = Number(d.aiCost) || 0
      const fees = Number(d.fees) || 0
      return {
        date: String(d.date),
        revenue,
        aiCost,
        fees,
        profit: revenue - aiCost - fees,
      }
    })

    const netProfit = totalRevenue - totalAICost - totalFees
    const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0
    const monthlyProfit = monthlyRevenue - monthlyAICost - monthlyFees

    return {
      totalRevenue,
      totalAICost,
      totalFees,
      totalTax,
      totalMdr,
      netProfit,
      profitMargin,
      monthlyRevenue,
      monthlyAICost,
      monthlyFees,
      monthlyTax,
      monthlyMdr,
      monthlyProfit,
      perPackage,
      perUser: perUserResolved,
      byProvider,
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
      byProvider[`${log.providerId || 'unknown'}:${log.model || 'unknown'}`] = (byProvider[`${log.providerId || 'unknown'}:${log.model || 'unknown'}`] || 0) + log.estimatedCostCents
    }

    return { totalCost, byCategory, byProvider }
  }
}

export const billingEngine = new BillingEngine()
