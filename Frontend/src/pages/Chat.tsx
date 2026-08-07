import React from 'react';
import { useNavigate } from 'react-router-dom';
import { SendIcon } from 'lucide-react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { RequireFeature } from '../components/RequireFeature';
import { notify } from '../components/ui/Toast';
import { apiRequest, endpoints } from '../utils/api';
import { useUserAuth } from '../contexts/UserAuthContext';
import { cn } from '../utils/cn';

interface ChatMessage {
  id: string;
  role: 'user' | 'bot';
  type: string;
  content: string;
  createdAt: string;
}

function messageTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function Chat() {
  const navigate = useNavigate();
  const { user, isAuthenticated, loading: authLoading } = useUserAuth();
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [tokens, setTokens] = React.useState(0);
  const [totalTokens, setTotalTokens] = React.useState(0);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (user) {
      setTokens(user.tokensRemaining);
      setTotalTokens(user.tokensRemaining + user.tokensUsed);
    }
  }, [user]);

  const loadMessages = React.useCallback(async () => {
    try {
      const data = await apiRequest<{ messages: ChatMessage[] }>(endpoints.chatMessages);
      setMessages(data.messages || []);
    } catch {
      // keep previous messages
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    loadMessages();
    const interval = setInterval(loadMessages, 3000);
    return () => clearInterval(interval);
  }, [isAuthenticated, authLoading, navigate, loadMessages]);

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);
    try {
      await apiRequest(endpoints.chat, { method: 'POST', body: JSON.stringify({ message: text }) });
    } catch (err: any) {
      notify.error('Could not send message', err?.message || 'Something went wrong');
    } finally {
      setSending(false);
      await loadMessages();
    }
  };

  const awaitingReply = sending || (messages.length > 0 && messages[messages.length - 1].role === 'user');

  return (
    <DashboardLayout tokens={tokens} totalTokens={totalTokens}>
      <RequireFeature phone={user?.phone || ''} feature="web_chat">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">Chat</h1>
          <p className="mt-1 text-sm text-slate-500">Talk to your social media assistant directly from the web.</p>
        </header>

        <Card as="section" hoverable={false} className="flex h-[calc(100vh-16rem)] min-h-[420px] flex-col">
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-10 w-2/3 rounded-xl bg-slate-100 animate-pulse" />
                ))}
              </div>
            ) : messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <p className="text-lg font-semibold text-slate-700 dark:text-slate-300">Let&apos;s get started 👋</p>
                <p className="mt-2 max-w-sm text-sm text-slate-500">
                  Tell me what you want to post about — I&apos;ll turn it into a ready-to-publish social media post.
                </p>
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div
                    className={cn(
                      'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm shadow-sm whitespace-pre-wrap',
                      m.role === 'user'
                        ? 'rounded-br-md bg-indigo-600 text-white'
                        : 'rounded-bl-md bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100',
                    )}
                  >
                    {m.type === 'image' ? (
                      <span className="italic opacity-80">🖼️ {m.content}</span>
                    ) : (
                      m.content
                    )}
                    <div
                      className={cn(
                        'mt-1 text-[10px]',
                        m.role === 'user' ? 'text-indigo-200' : 'text-slate-400',
                      )}
                    >
                      {messageTime(m.createdAt)}
                    </div>
                  </div>
                </div>
              ))
            )}

            {awaitingReply && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-md bg-slate-100 px-4 py-3 shadow-sm dark:bg-slate-800">
                  <span className="inline-flex gap-1">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:150ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:300ms]" />
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 border-t border-slate-100 p-4 dark:border-slate-800">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Type a message…"
              aria-label="Message"
              className="flex-1 h-11 rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
            <Button onClick={send} disabled={sending || input.trim().length === 0} loading={sending}>
              <SendIcon className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      </RequireFeature>
    </DashboardLayout>
  );
}
