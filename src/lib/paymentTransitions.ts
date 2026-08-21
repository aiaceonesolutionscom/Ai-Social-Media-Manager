// H10 — admin payment status transitions. An admin may only move a payment
// through a small set of legitimate transitions; everything else is rejected.
// Local payments (manual) are the only ones admins may mark "completed".
// Gateway payments are driven by Stripe webhooks, so admins may only mark them
// failed (abandoned checkout) or refunded (matching a Stripe refund).
export type PaymentStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'refunded'

export function paymentStatusTransitionAllowed(
  current: PaymentStatus,
  to: PaymentStatus | undefined,
  isLocal: boolean,
): boolean {
  if (!to || to === current) return false
  if (isLocal) {
    return (current === 'pending' && to === 'completed') || (current === 'completed' && to === 'refunded')
  }
  return (current === 'pending' && to === 'failed') || (current === 'completed' && to === 'refunded')
}