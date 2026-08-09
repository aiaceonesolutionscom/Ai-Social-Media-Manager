import { FastifyInstance } from 'fastify'
import { answerQuery } from '../lib/AssistantService.js'

export async function registerAssistantRoutes(server: FastifyInstance): Promise<void> {
  const handle = async (req: any, reply: any) => {
    const q: string = (req.query?.q || req.body?.q || req.body?.message || '').toString().trim()
    return reply.send(await answerQuery(q))
  }

  server.get('/api/public/assistant', handle)
  server.post('/api/public/assistant', handle)
}
