import { FastifyInstance } from 'fastify'
import { listUsers, listPayments, listPosts } from '../../store.js'

export async function registerAdminStatsRoutes(server: FastifyInstance): Promise<void> {

  server.get('/api/admin/stats', async (req: any, reply: any) => {
    const users = await listUsers()
    const payments = await listPayments()
    const posts = await listPosts()

    const activeUsers = users.filter(u => u.active === 1)
    const completedPayments = payments.filter(p => p.status === 'completed')
    const totalRevenue = completedPayments.reduce((sum, p) => sum + p.amountCents, 0)

    const thisMonth = completedPayments.filter(p => {
      const d = new Date(p.createdAt)
      const now = new Date()
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    })
    const monthRevenue = thisMonth.reduce((sum, p) => sum + p.amountCents, 0)

    const totalTokensUsed = users.reduce((sum, u) => sum + u.tokensUsed, 0)
    const totalTokensRemaining = users.reduce((sum, u) => sum + u.tokensRemaining, 0)

    return reply.send({
      totalUsers: users.length,
      activeUsers: activeUsers.length,
      totalPosts: posts.length,
      publishedPosts: posts.filter(p => p.status === 'DONE').length,
      totalPayments: payments.length,
      completedPayments: completedPayments.length,
      totalRevenue,
      monthRevenue,
      totalTokensUsed,
      totalTokensRemaining,
    })
  })

  server.get('/api/admin/stats/chart', async (req: any, reply: any) => {
    const payments = await listPayments()
    const completedPayments = payments.filter(p => p.status === 'completed')

    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - i)
      return d.toISOString().split('T')[0]
    }).reverse()

    const dailyRevenue = last7Days.map(date => {
      const dayPayments = completedPayments.filter(p => {
        return p.createdAt.startsWith(date)
      })
      return {
        date,
        revenue: dayPayments.reduce((sum, p) => sum + p.amountCents, 0),
        count: dayPayments.length,
      }
    })

    return reply.send({ chart: dailyRevenue })
  })
}
