import { randomUUID } from 'node:crypto'
import { logger } from '../logger.js'

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'retrying'
export type JobPriority = 'low' | 'normal' | 'high' | 'critical'

export type JobType =
  | 'voice_transcription'
  | 'ai_generation'
  | 'image_generation'
  | 'facebook_publish'
  | 'instagram_publish'
  | 'meta_ads'
  | 'whatsapp_broadcast'
  | 'scheduled_post'
  | 'analytics_processing'

export interface Job<T = Record<string, unknown>> {
  id: string
  type: JobType
  status: JobStatus
  priority: JobPriority
  phone: string
  data: T
  result?: unknown
  error?: string
  attempts: number
  maxAttempts: number
  progress: number
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
  retryAfter?: string
}

export interface JobHandler<T = Record<string, unknown>> {
  (job: Job<T>): Promise<unknown>
}

interface QueueOptions {
  concurrency?: number
  retryDelayMs?: number
  maxRetries?: number
  pollIntervalMs?: number
}

const PRIORITY_WEIGHT: Record<JobPriority, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
}

class JobQueue {
  private jobs = new Map<string, Job>()
  private handlers = new Map<JobType, JobHandler>()
  private processing = new Set<string>()
  private options: Required<QueueOptions>
  private pollTimer: NodeJS.Timeout | null = null
  private running = false

  constructor(options: QueueOptions = {}) {
    this.options = {
      concurrency: options.concurrency ?? 3,
      retryDelayMs: options.retryDelayMs ?? 5000,
      maxRetries: options.maxRetries ?? 3,
      pollIntervalMs: options.pollIntervalMs ?? 1000,
    }
  }

  registerHandler<T>(type: JobType, handler: JobHandler<T>): void {
    this.handlers.set(type, handler as JobHandler)
    logger.info({ type }, 'job handler registered')
  }

  async enqueue<T>(type: JobType, phone: string, data: T, priority: JobPriority = 'normal'): Promise<Job<T>> {
    const now = new Date().toISOString()
    const job: Job<T> = {
      id: randomUUID(),
      type,
      status: 'pending',
      priority,
      phone,
      data,
      attempts: 0,
      maxAttempts: this.options.maxRetries,
      progress: 0,
      createdAt: now,
      updatedAt: now,
    }
    this.jobs.set(job.id, job as Job)
    logger.info({ jobId: job.id, type, phone }, 'job enqueued')
    this.processNext()
    return job
  }

  getJob(id: string): Job | undefined {
    return this.jobs.get(id)
  }

  getJobsByPhone(phone: string): Job[] {
    return Array.from(this.jobs.values()).filter((j) => j.phone === phone)
  }

  getJobsByStatus(status: JobStatus): Job[] {
    return Array.from(this.jobs.values()).filter((j) => j.status === status)
  }

  getPendingCount(): number {
    return this.getJobsByStatus('pending').length
  }

  getProcessingCount(): number {
    return this.getJobsByStatus('processing').length
  }

  getFailedCount(): number {
    return this.getJobsByStatus('failed').length
  }

  getStats(): {
    pending: number
    processing: number
    completed: number
    failed: number
    total: number
  } {
    const jobs = Array.from(this.jobs.values())
    return {
      pending: jobs.filter((j) => j.status === 'pending').length,
      processing: jobs.filter((j) => j.status === 'processing').length,
      completed: jobs.filter((j) => j.status === 'completed').length,
      failed: jobs.filter((j) => j.status === 'failed').length,
      total: jobs.length,
    }
  }

  async retry(id: string): Promise<boolean> {
    const job = this.jobs.get(id)
    if (!job || job.status !== 'failed') return false
    job.status = 'pending'
    job.attempts = 0
    job.error = undefined
    job.updatedAt = new Date().toISOString()
    logger.info({ jobId: id }, 'job retry initiated')
    this.processNext()
    return true
  }

  async cancel(id: string): Promise<boolean> {
    const job = this.jobs.get(id)
    if (!job || job.status === 'processing' || job.status === 'completed') return false
    job.status = 'failed'
    job.error = 'Cancelled by user'
    job.updatedAt = new Date().toISOString()
    return true
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.pollTimer = setInterval(() => {
      this.processNext()
    }, this.options.pollIntervalMs)
    logger.info({ concurrency: this.options.concurrency }, 'job queue started')
  }

  stop(): void {
    this.running = false
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    logger.info('job queue stopped')
  }

  private async processNext(): Promise<void> {
    if (!this.running) return
    if (this.processing.size >= this.options.concurrency) return

    const pending = Array.from(this.jobs.values())
      .filter((j) => j.status === 'pending')
      .sort((a, b) => {
        const p = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]
        if (p !== 0) return p
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      })

    for (const job of pending) {
      if (this.processing.size >= this.options.concurrency) break
      this.processing.add(job.id)
      void this.executeJob(job)
    }
  }

  private async executeJob(job: Job): Promise<void> {
    const handler = this.handlers.get(job.type)
    if (!handler) {
      job.status = 'failed'
      job.error = `No handler registered for type: ${job.type}`
      job.updatedAt = new Date().toISOString()
      this.processing.delete(job.id)
      return
    }

    job.status = 'processing'
    job.startedAt = new Date().toISOString()
    job.attempts++
    job.updatedAt = job.startedAt

    try {
      logger.info({ jobId: job.id, type: job.type, attempt: job.attempts }, 'job processing')
      const result = await handler(job)
      job.result = result
      job.status = 'completed'
      job.progress = 100
      job.completedAt = new Date().toISOString()
      job.updatedAt = job.completedAt
      logger.info({ jobId: job.id, type: job.type }, 'job completed')
    } catch (err) {
      const message = (err as Error).message
      job.error = message
      logger.error({ jobId: job.id, type: job.type, attempt: job.attempts, error: message }, 'job failed')

      if (job.attempts < job.maxAttempts) {
        job.status = 'retrying'
        job.retryAfter = new Date(Date.now() + this.options.retryDelayMs * job.attempts).toISOString()
        job.updatedAt = new Date().toISOString()
        logger.info({ jobId: job.id, retryAfter: job.retryAfter }, 'job scheduled for retry')
        setTimeout(() => {
          if (job.status === 'retrying') {
            job.status = 'pending'
            this.processNext()
          }
        }, this.options.retryDelayMs * job.attempts)
      } else {
        job.status = 'failed'
        job.updatedAt = new Date().toISOString()
      }
    } finally {
      this.processing.delete(job.id)
      if (this.running) {
        this.processNext()
      }
    }
  }
}

export const jobQueue = new JobQueue({ concurrency: 3, maxRetries: 3, retryDelayMs: 5000 })
