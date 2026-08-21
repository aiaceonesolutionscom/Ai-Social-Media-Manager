import { FastifyInstance } from 'fastify'
import {
  listUsers,
  listPayments,
  listPackages,
  listPosts,
  listAllTokenTransactions,
  listAllAdCampaigns,
  listAIUsageLogs,
  listAIProviders,
  getAllSupportTickets,
} from '../../store.js'
import { guard } from './middleware.js'

export async function registerAdminReportRoutes(server: FastifyInstance): Promise<void> {

  server.get('/api/admin/reports', guard('reports.view'), async (_req: any, reply: any) => {
    const [users, payments, packages, posts, tokenTransactions, adCampaigns, aiLogs, aiProviders, supportTickets] = await Promise.all([
      listUsers(),
      listPayments(),
      listPackages(),
      listPosts(),
      listAllTokenTransactions(),
      listAllAdCampaigns(),
      listAIUsageLogs(),
      listAIProviders(),
      getAllSupportTickets(),
    ])

    const pkgBySlug = new Map(packages.map((p) => [p.slug, p]))
    const providerById = new Map(aiProviders.map((p) => [p.id, p]))
    const userByPhone = new Map(users.map((u) => [u.phone, u]))

    // Users joined with package + finance info
    const usersJoined = users.map((u) => {
      const pkg = u.packageId ? pkgBySlug.get(u.packageId) : undefined
      const userPayments = payments.filter((p) => p.phone === u.phone)
      const completed = userPayments.filter((p) => p.status === 'completed')
      const lastPayment = userPayments[0]
      return {
        phone: u.phone,
        name: u.name,
        email: u.email,
        packageId: u.packageId,
        packageName: pkg?.name || 'Free',
        packagePriceCents: pkg?.priceCents ?? 0,
        tokensRemaining: u.tokensRemaining,
        tokensUsed: u.tokensUsed,
        active: u.active === 1,
        createdAt: u.createdAt,
        totalSpentCents: completed.reduce((s, p) => s + p.amountCents, 0),
        lastPaymentStatus: lastPayment?.status || '',
        lastPaymentAmountCents: lastPayment?.amountCents || 0,
      }
    })

    // Payments joined with user + package
    const paymentsJoined = payments.map((p) => {
      const user = userByPhone.get(p.phone)
      const pkg = p.packageId ? pkgBySlug.get(p.packageId) : undefined
      return {
        id: p.id,
        phone: p.phone,
        userName: user?.name || '',
        userEmail: user?.email || '',
        packageId: p.packageId,
        packageName: pkg?.name || p.packageId || '—',
        amountCents: p.amountCents,
        tokenCount: p.tokenCount,
        type: p.type,
        status: p.status,
        createdAt: p.createdAt,
      }
    })

    // Packages with buyer counts + revenue
    const packagesJoined = packages.map((p) => {
      const pkgPayments = payments.filter((pm) => pm.packageId === p.slug)
      const completed = pkgPayments.filter((pm) => pm.status === 'completed')
      const buyers = [...new Set(pkgPayments.map((pm) => pm.phone))]
      const buyerNames = buyers.map((phone) => userByPhone.get(phone)?.name || phone)
      return {
        slug: p.slug,
        name: p.name,
        priceCents: p.priceCents,
        includedTokens: p.includedTokens,
        isActive: p.isActive,
        purchaseCount: pkgPayments.length,
        completedCount: completed.length,
        buyerCount: buyers.length,
        buyers: buyerNames,
        revenueCents: completed.reduce((s, pm) => s + pm.amountCents, 0),
      }
    })

    // Posts joined with user name
    const postsJoined = posts.map((post) => ({
      id: post.id,
      phone: post.phone,
      status: post.status,
      createdAt: post.createdAt,
      userName: userByPhone.get(post.phone)?.name || '',
    }))

    const aiUsageJoined = aiLogs.map((l) => ({
      id: l.id,
      phone: l.phone || '',
      userName: (l.phone ? userByPhone.get(l.phone)?.name : '') || '',
      category: l.category,
      provider: providerById.get(l.providerId)?.displayName || l.providerId,
      model: l.model || '',
      tokensInput: l.tokensInput,
      tokensOutput: l.tokensOutput,
      estimatedCostCents: l.estimatedCostCents,
      success: l.success,
      createdAt: l.createdAt,
    }))

    // Summary
    const completedPayments = payments.filter((p) => p.status === 'completed')
    const totalRevenue = completedPayments.reduce((s, p) => s + p.amountCents, 0)
    const now = new Date()
    const today = now.toISOString().split('T')[0]
    const newToday = users.filter((u) => u.createdAt?.startsWith(today)).length
    const newThisMonth = users.filter((u) => {
      const d = new Date(u.createdAt)
      return d.getUTCMonth() === now.getUTCMonth() && d.getUTCFullYear() === now.getUTCFullYear()
    }).length
    const monthRevenue = completedPayments.filter((p) => {
      const d = new Date(p.createdAt)
      return d.getUTCMonth() === now.getUTCMonth() && d.getUTCFullYear() === now.getUTCFullYear()
    }).reduce((s, p) => s + p.amountCents, 0)

    const signupsByDay: { date: string; count: number }[] = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const date = d.toISOString().split('T')[0]
      signupsByDay.push({ date, count: users.filter((u) => u.createdAt?.startsWith(date)).length })
    }

    const revenueByPackage = packagesJoined.map((p) => ({
      package: p.name,
      count: p.completedCount,
      revenueCents: p.revenueCents,
    }))

    return reply.send({
      packages: packagesJoined,
      users: usersJoined,
      payments: paymentsJoined,
      posts: postsJoined,
      tokenTransactions: tokenTransactions.map((t) => ({
        id: t.id,
        phone: t.phone,
        userName: userByPhone.get(t.phone)?.name || '',
        type: t.type,
        amount: t.amount,
        description: t.description,
        createdAt: t.createdAt,
      })),
      adCampaigns: adCampaigns.map((c) => ({
        id: c.id,
        phone: c.phone,
        userName: userByPhone.get(c.phone)?.name || '',
        name: c.name,
        objective: c.objective,
        status: c.status,
        budgetCents: c.budgetCents,
        createdAt: c.createdAt,
      })),
      aiUsage: aiUsageJoined,
      supportTickets: supportTickets.map((t) => ({
        id: t.id,
        phone: t.phone,
        userName: userByPhone.get(t.phone)?.name || '',
        subject: t.subject,
        status: t.status,
        priority: t.priority,
        createdAt: t.createdAt,
      })),
      summary: {
        totalUsers: users.length,
        activeUsers: users.filter((u) => u.active === 1).length,
        newToday,
        newThisMonth,
        totalPayments: payments.length,
        completedPayments: completedPayments.length,
        totalRevenue,
        monthRevenue,
        signupsByDay,
        revenueByPackage,
      },
    })
  })
}
