import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { notify } from '../components/ui/Toast';
import { apiRequest, endpoints, ApiError } from '../utils/api';

interface SupportTicket {
  id: string
  subject: string
  message: string
  status: string
  priority: string
  createdAt: string
}

export function SupportPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = React.useState(true)
  const [tickets, setTickets] = React.useState<SupportTicket[]>([])
  const [subject, setSubject] = React.useState('')
  const [message, setMessage] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [hasAccess, setHasAccess] = React.useState(true)

  React.useEffect(() => {
    async function fetchTickets() {
      try {
        const data = await apiRequest<{ tickets: SupportTicket[] }>(endpoints.supportTickets)
        setTickets(data.tickets || [])
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          setHasAccess(false)
        }
      } finally {
        setLoading(false)
      }
    }
    fetchTickets()
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!subject.trim() || !message.trim()) {
      notify.error('Error', 'Subject and message are required')
      return
    }
    setSubmitting(true)
    try {
      await apiRequest(endpoints.supportTickets, {
        method: 'POST',
        body: JSON.stringify({ subject, message, priority: 'normal' }),
      })
      notify.success('Ticket Created', 'Our support team will respond within 24 hours.')
      setSubject('')
      setMessage('')
      const data = await apiRequest<{ tickets: SupportTicket[] }>(endpoints.supportTickets)
      setTickets(data.tickets || [])
    } catch (err) {
      notify.error('Failed', (err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (!hasAccess) {
    return (
      <div className="min-h-full w-full bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-4xl px-4 py-10">
          <h1 className="text-2xl font-bold mb-2">Priority Support</h1>
          <p className="text-slate-500 mb-6">Get help from our support team.</p>
          <Card className="text-center py-12">
            <div className="text-4xl mb-4">🔒</div>
            <h2 className="text-xl font-semibold mb-2">Feature Not Included</h2>
            <p className="text-slate-500 mb-6">
              Priority Support is not included in your current package. Please upgrade your subscription to access this feature.
            </p>
            <Button onClick={() => navigate('/packages')}>View Packages</Button>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full w-full bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-2xl font-bold mb-2">Priority Support</h1>
        <p className="text-slate-500 mb-6">Get help from our support team.</p>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <h3 className="text-lg font-semibold mb-4">Create New Ticket</h3>
            <form onSubmit={submit} className="space-y-4">
              <Input
                label="Subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Brief description of your issue"
              />
              <div>
                <label className="block text-sm font-medium mb-1">Message</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Describe your issue in detail..."
                  rows={5}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                />
              </div>
              <Button type="submit" loading={submitting} className="w-full">
                Submit Ticket
              </Button>
            </form>
          </Card>

          <div>
            <h3 className="text-lg font-semibold mb-4">Your Tickets</h3>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-20 rounded-lg bg-slate-100 animate-pulse dark:bg-slate-800" />
                ))}
              </div>
            ) : tickets.length === 0 ? (
              <Card className="text-center py-8">
                <p className="text-slate-500">No support tickets yet.</p>
              </Card>
            ) : (
              <div className="space-y-3">
                {tickets.map((ticket) => (
                  <Card key={ticket.id} className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <h4 className="font-medium">{ticket.subject}</h4>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        ticket.status === 'open' ? 'bg-green-100 text-green-700' :
                        ticket.status === 'closed' ? 'bg-slate-100 text-slate-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {ticket.status}
                      </span>
                    </div>
                    <p className="text-sm text-slate-500 line-clamp-2">{ticket.message}</p>
                    <p className="text-xs text-slate-400 mt-2">
                      {new Date(ticket.createdAt).toLocaleString()}
                    </p>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
