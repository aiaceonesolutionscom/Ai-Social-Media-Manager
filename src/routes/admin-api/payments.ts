import { FastifyInstance } from 'fastify'
import { listPayments, getPayment, updatePayment } from '../../store.js'

export async function registerAdminPaymentRoutes(server: FastifyInstance): Promise<void> {

  server.get('/api/admin/payments', async (req: any, reply: any) => {
    const phone = (req.query as any)?.phone as string | undefined
    const payments = await listPayments(phone)
    return reply.send({ payments })
  })

  server.get('/api/admin/payments/:id', async (req: any, reply: any) => {
    const { id } = req.params as { id: string }
    const payment = await getPayment(id)
    if (!payment) {
      return reply.status(404).send({ error: 'Payment not found' })
    }
    return reply.send({ payment })
  })

  server.put('/api/admin/payments/:id', async (req: any, reply: any) => {
    const { id } = req.params as { id: string }
    const patch = req.body as Partial<{ status: string }>

    try {
      const payment = await updatePayment(id, patch as any)
      return reply.send({ payment })
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message })
    }
  })

  server.get('/api/admin/payments/stats', async (req: any, reply: any) => {
    const payments = await listPayments()
    const completed = payments.filter(p => p.status === 'completed')
    const totalRevenue = completed.reduce((sum, p) => sum + p.amountCents, 0)
    const thisMonth = completed.filter(p => {
      const d = new Date(p.createdAt)
      const now = new Date()
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    })
    const monthRevenue = thisMonth.reduce((sum, p) => sum + p.amountCents, 0)

    return reply.send({
      totalPayments: payments.length,
      completedPayments: completed.length,
      totalRevenue,
      monthRevenue,
    })
  })
}
