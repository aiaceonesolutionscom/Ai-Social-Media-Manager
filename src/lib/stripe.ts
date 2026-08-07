import { config } from '../config.js'
import { logger } from './logger.js'

let stripeClient: any = null

async function getStripe() {
  if (stripeClient) return stripeClient
  if (!config.stripe.secretKey) {
    throw new Error('STRIPE_SECRET_KEY is not set')
  }

  const { default: Stripe } = await import('stripe')
  stripeClient = new Stripe(config.stripe.secretKey, {
    apiVersion: '2024-06-20' as any,
  })
  return stripeClient
}

export async function createCheckoutSession(params: {
  packageId: string
  packageName: string
  priceCents: number
  phone: string
  successUrl: string
  cancelUrl: string
}): Promise<{ sessionId: string; url: string }> {
  const stripe = await getStripe()

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: params.packageName,
          metadata: { packageId: params.packageId },
        },
        unit_amount: params.priceCents,
      },
      quantity: 1,
    }],
    mode: 'payment',
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: {
      phone: params.phone,
      packageId: params.packageId,
    },
  })

  return { sessionId: session.id, url: session.url }
}

export async function getCheckoutSession(sessionId: string): Promise<any> {
  const stripe = await getStripe()
  return stripe.checkout.sessions.retrieve(sessionId)
}

export async function createCustomer(email: string, name: string): Promise<any> {
  const stripe = await getStripe()
  return stripe.customers.create({ email, name })
}

export async function cancelSubscription(subscriptionId: string): Promise<void> {
  const stripe = await getStripe()
  await stripe.subscriptions.cancel(subscriptionId)
}

export async function getSubscription(subscriptionId: string): Promise<any> {
  const stripe = await getStripe()
  return stripe.subscriptions.retrieve(subscriptionId)
}

export async function constructWebhookEvent(payload: string | Buffer, signature: string): Promise<any> {
  const stripe = await getStripe()
  return stripe.webhooks.constructEvent(
    payload,
    signature,
    config.stripe.webhookSecret
  )
}

export async function testStripeConnection(): Promise<{ success: boolean; error?: string }> {
  try {
    const stripe = await getStripe()
    await stripe.balance.retrieve()
    return { success: true }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}
