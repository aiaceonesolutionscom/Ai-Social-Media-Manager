import React from 'react';
import { MessageCircleIcon, SendIcon, XIcon, SparklesIcon } from 'lucide-react';
import { apiRequest, endpoints } from '../utils/api';

interface ChatMsg {
  from: 'user' | 'bot';
  text: string;
  suggestions?: string[];
}

const WELCOME: ChatMsg = {
  from: 'bot',
  text: "Hi! I'm the EchoPost assistant. I can tell you about how the app works, tokens, and our latest packages and pricing.",
  suggestions: [
    'Which packages are available?',
    'How do tokens work?',
    'How does voice to post work?',
    'How do I get started?',
  ],
};

export function LandingChat() {
  const [open, setOpen] = React.useState(false);
  const [messages, setMessages] = React.useState<ChatMsg[]>([WELCOME]);
  const [input, setInput] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, open]);

  const ask = async (q: string) => {
    const text = q.trim();
    if (!text || busy) return;
    setInput('');
    setMessages((m) => [...m, { from: 'user', text }]);
    setBusy(true);
    try {
      const data = await apiRequest<{ answer: string; suggestions: string[] }>(
        `${endpoints.assistant}?q=${encodeURIComponent(text)}`,
      );
      setMessages((m) => [
        ...m,
        { from: 'bot', text: data.answer, suggestions: data.suggestions.slice(0, 3) },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          from: 'bot',
          text: 'Sorry, I could not reach the assistant right now. Please try again in a moment.',
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {open && (
        <div className="fixed bottom-24 right-4 z-50 flex h-[28rem] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-200 bg-indigo-600 px-4 py-3 dark:border-slate-700">
            <div className="flex items-center gap-2.5">
              <SparklesIcon className="h-5 w-5 text-white" aria-hidden="true" />
              <div>
                <p className="text-sm font-bold text-white">Assistant</p>
                <p className="text-[11px] text-indigo-100">Answers in a second</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="rounded-lg p-1.5 text-indigo-100 transition-colors hover:bg-indigo-500 hover:text-white">
              <XIcon className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-4 py-4 dark:bg-slate-950">
            {messages.map((msg, i) =>
              msg.from === 'bot' ? (
                <div key={i} className="max-w-[85%]">
                  <div className="rounded-2xl rounded-tl-sm bg-white px-3.5 py-2.5 text-sm text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-200">
                    {msg.text}
                  </div>
                  {msg.suggestions && msg.suggestions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {msg.suggestions.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => ask(s)}
                          className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-300">
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 px-3.5 py-2.5 text-sm text-white">
                  {msg.text}
                </div>
              ),
            )}
            {busy && (
              <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white px-3.5 py-2.5 text-sm text-slate-500 shadow-sm dark:bg-slate-800">
                Typing…
              </div>
            )}
          </div>

          <form
            className="flex items-center gap-2 border-t border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900"
            onSubmit={(e) => { e.preventDefault(); ask(input); }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask me anything…"
              className="h-10 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              aria-label="Send message"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white transition-colors hover:bg-indigo-500 disabled:opacity-50">
              <SendIcon className="h-4 w-4" aria-hidden="true" />
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close assistant' : 'Open assistant'}
        className="fixed bottom-6 right-4 z-50 inline-flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg transition-transform hover:scale-105 hover:bg-indigo-500">
        {open ? <XIcon className="h-6 w-6" aria-hidden="true" /> : <MessageCircleIcon className="h-6 w-6" aria-hidden="true" />}
      </button>
    </>
  );
}
