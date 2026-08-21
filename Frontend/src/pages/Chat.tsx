import React from 'react';
import { useNavigate } from 'react-router-dom';
import { SendIcon, HistoryIcon, PlusIcon } from 'lucide-react';
import { DashboardLayout } from '../components/layout/DashboardLayout';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { RequireFeature } from '../components/RequireFeature';
import { MarkdownLite } from '../components/MarkdownLite';
import { notify } from '../components/ui/Toast';
import { apiRequest, endpoints, API_URL } from '../utils/api';
import { useUserAuth } from '../contexts/UserAuthContext';
import { cn } from '../utils/cn';

interface ChatMessage {
  id: string;
  role: 'user' | 'bot';
  type: string;
  content: string;
  createdAt: string;
}

interface ChatThread {
  id: string;
  title?: string;
  updatedAt: string;
  lastMessage?: { content: string; role: string; createdAt: string };
}

const SUGGESTIONS = [
  'Create a post about my summer sale',
  'Write a post for Ramadan offer',
  'Show my status',
  'Schedule a post for tomorrow 5pm',
];

function parseImageContent(content: string): { src?: string; caption: string } {
  const m = content.match(/^\[image ([^\]]+)\]\s*(.*)$/s);
  if (m) {
    const src = m[1].startsWith('http') ? m[1] : `${API_URL}${m[1]}`;
    return { src, caption: m[2] };
  }
  return { caption: content };
}

function messageTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function hasPendingUserMessage(messages: ChatMessage[]): boolean {
  let lastBotTime = '';
  for (const m of messages) {
    if (m.role === 'bot' && m.createdAt > lastBotTime) lastBotTime = m.createdAt;
  }
  return messages.some((m) => m.role === 'user' && m.createdAt > lastBotTime);
}

export function Chat() {
  const navigate = useNavigate();
  const { user, isAuthenticated, loading: authLoading } = useUserAuth();
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const pollRef = React.useRef<number | null>(null);
  const [threads, setThreads] = React.useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = React.useState<string | null>(null);
  const [showHistory, setShowHistory] = React.useState(false);
  const atBottomRef = React.useRef(true);

  const loadMessages = React.useCallback(async (threadId?: string | null) => {
    try {
      const path = threadId
        ? `${endpoints.chatMessages}?threadId=${encodeURIComponent(threadId)}`
        : endpoints.chatMessages;
      const data = await apiRequest<{ messages: ChatMessage[] }>(path);
      setMessages(data.messages || []);
    } catch {
      // keep previous messages
    } finally {
      setLoading(false);
    }
  }, []);

  const loadThreads = React.useCallback(async () => {
    try {
      const data = await apiRequest<{ threads: ChatThread[] }>(endpoints.chatThreads);
      setThreads(data.threads || []);
    } catch {
      // keep previous threads
    }
  }, []);

  const newChat = React.useCallback(async () => {
    try {
      const data = await apiRequest<{ thread: ChatThread }>(endpoints.chatThreadsCreate, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setActiveThreadId(data.thread.id);
      setMessages([]);
      setShowHistory(false);
      await loadThreads();
    } catch (err: any) {
      notify.error('Could not start a new chat', err?.message || 'Something went wrong');
    }
  }, [loadThreads]);

  const openThread = React.useCallback(async (threadId: string) => {
    setActiveThreadId(threadId);
    setShowHistory(false);
    setLoading(true);
    await loadMessages(threadId);
  }, [loadMessages]);

  React.useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    loadMessages(activeThreadId);
    loadThreads();

    const tick = () => {
      if (!document.hidden) loadMessages(activeThreadId);
    };
    pollRef.current = window.setInterval(tick, 3000);
    const onVisible = () => {
      if (!document.hidden) loadMessages(activeThreadId);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isAuthenticated, authLoading, navigate, loadMessages, loadThreads, activeThreadId]);

  // Auto-scroll to the bottom ONLY when the user is already near the bottom
  // (or a new message arrives while they are). This fixes the "scroll up jumps
  // back down" bug caused by the 3s poll replacing the messages array.
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  React.useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, sending, activeThreadId]);

  const send = async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);
    try {
      await apiRequest(endpoints.chat, {
        method: 'POST',
        body: JSON.stringify({ message: text, threadId: activeThreadId || undefined }),
      });
    } catch (err: any) {
      notify.error('Could not send message', err?.message || 'Something went wrong');
    } finally {
      setSending(false);
      await loadMessages(activeThreadId);
      await loadThreads();
    }
  };

  const awaitingReply = sending || hasPendingUserMessage(messages);

  return (
    <DashboardLayout>
      <RequireFeature phone={user?.phone || ''} feature="web_chat">
        <header className="mb-6 flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">Chat</h1>
            <p className="mt-1 text-sm text-slate-500">Talk to your social media assistant directly from the web.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setShowHistory((v) => !v)}>
              <HistoryIcon className="h-4 w-4" aria-hidden="true" /> History
            </Button>
            <Button size="sm" onClick={newChat}>
              <PlusIcon className="h-4 w-4" aria-hidden="true" /> New Chat
            </Button>
          </div>
        </header>

        <Card as="section" hoverable={false} className="flex h-[calc(100vh-16rem)] min-h-[420px] flex-col">
          <div className="flex items-center gap-2 border-b border-indigo-100 bg-indigo-50/60 px-4 py-2.5 text-xs text-indigo-700 dark:border-indigo-900/40 dark:bg-indigo-950/40 dark:text-indigo-300">
            💡 Tip: Create a post, then type <span className="font-semibold">"schedule for tomorrow at 5pm"</span> to publish it later. The same works for ads.
          </div>
          <div className="flex min-h-0 flex-1">
            {showHistory && (
              <aside className="w-64 shrink-0 overflow-y-auto border-r border-slate-100 bg-slate-50/60 p-2 dark:border-slate-800 dark:bg-slate-900/40">
                <p className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Chat history</p>
                {threads.length === 0 ? (
                  <p className="px-2 py-3 text-xs text-slate-400">No past chats yet.</p>
                ) : (
                  threads.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => openThread(t.id)}
                      className={cn(
                        'mb-1 block w-full rounded-lg px-2 py-2 text-left text-xs transition-colors',
                        activeThreadId === t.id
                          ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200'
                          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                      )}
                    >
                      <span className="block truncate font-medium">
                        {t.title || t.lastMessage?.content || 'New chat'}
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] text-slate-400">
                        {t.lastMessage ? `${t.lastMessage.role === 'user' ? 'You' : 'Bot'}: ${t.lastMessage.content}` : 'No messages yet'}
                      </span>
                    </button>
                  ))
                )}
              </aside>
            )}
          <div ref={scrollRef} onScroll={onScroll} className="flex-1 space-y-3 overflow-y-auto p-4">
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
                <div className="mt-5 flex max-w-md flex-wrap items-center justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="rounded-full border border-indigo-200 bg-white px-3 py-1.5 text-xs text-indigo-700 transition-colors hover:bg-indigo-50 dark:border-indigo-800 dark:bg-slate-900 dark:text-indigo-300 dark:hover:bg-indigo-950"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div
                    className={cn(
                      'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm shadow-sm',
                      m.role === 'user'
                        ? 'rounded-br-md bg-indigo-600 text-white'
                        : 'rounded-bl-md bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100',
                    )}
                  >
                    {m.type === 'image' ? (() => {
                      const { src, caption } = parseImageContent(m.content);
                      return src ? (
                        <div className="max-w-[240px]">
                          <img src={src} alt="AI generated post" className="rounded-lg border border-slate-200 dark:border-slate-700" />
                          {caption && <p className="mt-1.5 whitespace-pre-wrap">{caption}</p>}
                        </div>
                      ) : (
                        <span className="italic opacity-80">🖼️ {m.content}</span>
                      );
                    })() : m.role === 'bot' ? (
                      <MarkdownLite text={m.content} />
                    ) : (
                      <span className="whitespace-pre-wrap">{m.content}</span>
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
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-slate-100 px-4 py-3 shadow-sm dark:bg-slate-800">
                  <span className="inline-flex gap-1">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-indigo-400" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-indigo-400 [animation-delay:150ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-indigo-400 [animation-delay:300ms]" />
                  </span>
                  <span className="text-xs text-slate-400">thinking…</span>
                </div>
              </div>
            )}
          </div>
          </div>

          <div className="flex items-end gap-3 border-t border-slate-100 p-4 dark:border-slate-800">
            <textarea
              ref={inputRef}
              value={input}
              rows={1}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                  if (inputRef.current) inputRef.current.style.height = 'auto';
                }
              }}
              placeholder="Type a message…"
              aria-label="Message"
              className="max-h-[120px] flex-1 resize-none rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
            <Button onClick={() => send()} disabled={sending || input.trim().length === 0} loading={sending} className="h-11">
              <SendIcon className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      </RequireFeature>
    </DashboardLayout>
  );
}