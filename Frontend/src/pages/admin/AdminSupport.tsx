import React from 'react';
import { InboxIcon, ReplyIcon, SearchIcon, XIcon } from 'lucide-react';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Textarea } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { notify } from '../../components/ui/Toast';
import { apiRequest, endpoints } from '../../utils/api';
import { Pagination } from '../../components/ui/Pagination';
import { cn } from '../../utils/cn';

const PAGE_SIZE = 10;

interface SupportReply {
  id: string;
  role: 'admin' | 'user';
  body: string;
  createdAt: string;
}

interface SupportTicket {
  id: string;
  phone: string;
  subject: string;
  message: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  replies?: SupportReply[];
}

const STATUS_OPTIONS = ['all', 'open', 'replied', 'closed'];
const PRIORITY_OPTIONS = ['all', 'normal', 'low', 'high', 'urgent'];

function statusTone(status: string): 'emerald' | 'amber' | 'slate' {
  if (status === 'open') return 'emerald';
  if (status === 'replied') return 'amber';
  return 'slate';
}

function priorityTone(priority: string): 'slate' | 'red' | 'indigo' {
  if (priority === 'high' || priority === 'urgent') return 'red';
  if (priority === 'low') return 'slate';
  return 'indigo';
}

export function AdminSupport() {
  const [tickets, setTickets] = React.useState<SupportTicket[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [priorityFilter, setPriorityFilter] = React.useState('all');
  const [search, setSearch] = React.useState('');
  const [selected, setSelected] = React.useState<SupportTicket | null>(null);
  const [replyText, setReplyText] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [page, setPage] = React.useState(1);

  const load = React.useCallback(async () => {
    try {
      const data = await apiRequest<{ tickets: SupportTicket[] }>(endpoints.adminSupportTickets);
      setTickets(data.tickets || []);
    } catch (err) {
      notify.error('Failed', (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const filtered = tickets.filter((t) => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!t.subject.toLowerCase().includes(q) && !t.phone.toLowerCase().includes(q) && !t.message.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const paginated = React.useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );

  const setStatus = (s: string) => { setStatusFilter(s); setPage(1); };
  const setPriority = (p: string) => { setPriorityFilter(p); setPage(1); };
  const setSearchText = (s: string) => { setSearch(s); setPage(1); };

  const openCount = tickets.filter((t) => t.status === 'open').length;
  const repliedCount = tickets.filter((t) => t.status === 'replied').length;
  const highCount = tickets.filter((t) => t.priority === 'high' || t.priority === 'urgent').length;

  const openTicket = async (ticket: SupportTicket) => {
    try {
      const data = await apiRequest<{ ticket: SupportTicket }>(endpoints.adminSupportTicket(ticket.id));
      setSelected(data.ticket || ticket);
    } catch {
      setSelected(ticket);
    }
  };

  const updateTicket = async (id: string, patch: { status?: string; priority?: string }) => {
    try {
      await apiRequest(endpoints.adminSupportTicketUpdate(id), {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
      const updated = { ...selected!, ...patch };
      setSelected(updated);
      setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
      notify.success('Updated', 'Support ticket updated.');
    } catch (err) {
      notify.error('Failed', (err as Error).message);
    }
  };

  const sendReply = async () => {
    if (!selected || !replyText.trim()) {
      notify.error('Error', 'Reply message is required');
      return;
    }
    setSending(true);
    try {
      await apiRequest(endpoints.adminSupportTicketReply(selected.id), {
        method: 'POST',
        body: JSON.stringify({ message: replyText.trim() }),
      });
      notify.success('Reply Sent', 'Your reply has been pushed to the user on WhatsApp.');
      setReplyText('');
      await openTicket({ ...selected });
      await load();
    } catch (err) {
      notify.error('Failed', (err as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <AdminLayout>
      <AdminHeader
        title="Support"
        description="Priority support inbox — view and reply to user tickets."
        action={
          <div className="flex items-center gap-3">
            <Badge tone="emerald">{openCount} open</Badge>
            <Badge tone="amber">{repliedCount} replied</Badge>
            <Badge tone="red">{highCount} high</Badge>
          </div>
        }
      />

      <Card as="section" hoverable={false} className="mb-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-10"
              placeholder="Search by subject, phone or message..."
              value={search}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {STATUS_OPTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-medium capitalize transition-colors',
                  statusFilter === s
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                )}
              >
                {s}
              </button>
            ))}
          </div>
          <select
            value={priorityFilter}
            onChange={(e) => setPriority(e.target.value)}
            className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            aria-label="Filter by priority"
          >
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>{p === 'all' ? 'All priorities' : p}</option>
            ))}
          </select>
        </div>
      </Card>

      {loading ? (
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800/60" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="py-16 text-center">
          <InboxIcon className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-4 text-sm text-slate-500">No support tickets match the current filters.</p>
        </Card>
      ) : (
        <div className="grid gap-4">
          {paginated.map((t) => (
            <Card key={t.id} className="p-5" hoverable>
              <button type="button" onClick={() => openTicket(t)} className="w-full text-left">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-slate-900 dark:text-slate-100">{t.subject}</h3>
                      <Badge tone={statusTone(t.status)}>{t.status}</Badge>
                      <Badge tone={priorityTone(t.priority)}>{t.priority}</Badge>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-sm text-slate-500">{t.message}</p>
                  </div>
                  <div className="text-right text-xs text-slate-400">
                    <div className="font-mono">{t.phone}</div>
                    <div className="mt-1">{new Date(t.createdAt).toLocaleString()}</div>
                    <div className="mt-1">
                      {t.replies?.length ? `${t.replies.length} message${t.replies.length === 1 ? '' : 's'} in thread` : 'No replies yet'}
                    </div>
                  </div>
                </div>
              </button>
            </Card>
          ))}
        </div>
      )}

      <Pagination page={page} total={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.subject || 'Support ticket'}
        description={`${selected?.phone} • ${new Date(selected?.createdAt || '').toLocaleString()}`}
        size="xl"
      >
        {selected && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Status</label>
              <select
                value={selected.status}
                onChange={(e) => updateTicket(selected.id, { status: e.target.value })}
                className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                aria-label="Ticket status"
              >
                {['open', 'replied', 'closed'].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <label className="ml-4 text-sm font-medium text-slate-700 dark:text-slate-300">Priority</label>
              <select
                value={selected.priority}
                onChange={(e) => updateTicket(selected.id, { priority: e.target.value })}
                className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                aria-label="Ticket priority"
              >
                {['normal', 'low', 'high', 'urgent'].map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            <div className="space-y-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">User</p>
                <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{selected.message}</p>
                <p className="mt-2 text-xs text-slate-400">{new Date(selected.createdAt).toLocaleString()}</p>
              </div>
              {(selected.replies || []).map((r) => (
                <div
                  key={r.id}
                  className={cn(
                    'rounded-xl border p-4',
                    r.role === 'admin'
                      ? 'border-indigo-200 bg-indigo-50 dark:border-indigo-500/30 dark:bg-indigo-500/10'
                      : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50'
                  )}
                >
                  <p className={cn('text-xs font-semibold uppercase tracking-wide', r.role === 'admin' ? 'text-indigo-500' : 'text-slate-400')}>
                    {r.role === 'admin' ? 'Admin' : 'User'}
                  </p>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{r.body}</p>
                  <p className="mt-2 text-xs text-slate-400">{new Date(r.createdAt).toLocaleString()}</p>
                </div>
              ))}
              {(selected.replies || []).length === 0 && (
                <p className="text-center text-xs text-slate-400">No replies yet.</p>
              )}
            </div>

            <div>
              <Textarea
                label="Reply to user"
                placeholder="Type your reply. It will be pushed to the user on WhatsApp..."
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                rows={4}
              />
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setSelected(null)}>
                  <XIcon className="h-4 w-4" />
                  Close
                </Button>
                <Button onClick={sendReply} loading={sending}>
                  <ReplyIcon className="h-4 w-4" />
                  Send Reply
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </AdminLayout>
  );
}
