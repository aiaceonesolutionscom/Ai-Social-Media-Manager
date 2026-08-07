import { logger } from './logger.js'
import { sendText } from './whatsapp.js'
import { config } from '../config.js'

export type NotificationChannel = 'whatsapp' | 'email' | 'sms'
export type NotificationPriority = 'low' | 'normal' | 'high' | 'critical'

export interface Notification {
  to: string
  title: string
  body: string
  channel: NotificationChannel
  priority?: NotificationPriority
  metadata?: Record<string, unknown>
}

export interface NotificationResult {
  success: boolean
  channel: NotificationChannel
  error?: string
}

class NotificationService {
  async send(notification: Notification): Promise<NotificationResult> {
    switch (notification.channel) {
      case 'whatsapp':
        return this.sendWhatsApp(notification)
      case 'email':
        return this.sendEmail(notification)
      case 'sms':
        return this.sendSMS(notification)
      default:
        return { success: false, channel: notification.channel, error: 'Unknown channel' }
    }
  }

  async sendWhatsApp(notification: Notification): Promise<NotificationResult> {
    try {
      await sendText(notification.to, `${notification.title}\n\n${notification.body}`)
      return { success: true, channel: 'whatsapp' }
    } catch (err) {
      logger.error({ err, to: notification.to }, 'WhatsApp notification failed')
      return { success: false, channel: 'whatsapp', error: (err as Error).message }
    }
  }

  async sendEmail(notification: Notification): Promise<NotificationResult> {
    logger.info({ to: notification.to, title: notification.title }, 'Email notification queued (provider not configured)')
    return { success: false, channel: 'email', error: 'Email provider not configured' }
  }

  async sendSMS(notification: Notification): Promise<NotificationResult> {
    logger.info({ to: notification.to, title: notification.title }, 'SMS notification queued (provider not configured)')
    return { success: false, channel: 'sms', error: 'SMS provider not configured' }
  }

  async notifyAdmin(title: string, body: string): Promise<NotificationResult> {
    if (!config.admin.phone) {
      return { success: false, channel: 'whatsapp', error: 'Admin phone not configured' }
    }
    return this.send({
      to: config.admin.phone,
      title,
      body,
      channel: 'whatsapp',
      priority: 'high',
    })
  }

  async notifyUser(phone: string, title: string, body: string): Promise<NotificationResult> {
    return this.send({
      to: phone,
      title,
      body,
      channel: 'whatsapp',
      priority: 'normal',
    })
  }

  async broadcast(users: Array<{ phone: string }>, title: string, body: string): Promise<NotificationResult[]> {
    const results: NotificationResult[] = []
    for (const user of users) {
      const result = await this.notifyUser(user.phone, title, body)
      results.push(result)
    }
    return results
  }
}

export const notificationService = new NotificationService()
