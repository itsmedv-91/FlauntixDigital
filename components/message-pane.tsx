'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Message } from '@/lib/types';
import { cn, formatDate, formatTime, initials } from '@/lib/utils';

export interface ChatPerson {
  id: string;
  name: string;
}

/** Renders a channel's messages and keeps them live over Supabase Realtime. */
export function MessagePane({
  channelId,
  agencyId,
  userId,
  initialMessages,
  people,
}: {
  channelId: string;
  agencyId: string;
  userId: string;
  initialMessages: Message[];
  people: ChatPerson[];
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const names = new Map(people.map((p) => [p.id, p.name]));

  // The page mounts this with key={channelId}, so switching rooms remounts
  // with fresh server messages instead of merging two channels' state.
  useEffect(() => {
    const supabase = createClient();
    const sub = supabase
      .channel(`messages:${channelId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` },
        (payload) => {
          const row = payload.new as Message;
          setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(sub);
    };
  }, [channelId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  async function send() {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    const supabase = createClient();
    const { data, error: err } = await supabase
      .from('messages')
      .insert({ channel_id: channelId, agency_id: agencyId, author_id: userId, body: text.slice(0, 4000) })
      .select('id, channel_id, author_id, body, created_at')
      .single();
    setSending(false);
    if (err) {
      setError(err.message);
      return;
    }
    setBody('');
    const row = data as unknown as Message;
    setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
  }

  return (
    <div className="flex h-[calc(100vh-13rem)] min-h-[420px] flex-col">
      <div className="scrollbar-thin flex-1 space-y-1 overflow-y-auto px-5 py-4">
        {messages.length === 0 && <p className="py-10 text-center text-sm text-zinc-400">No messages yet. Say hello.</p>}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || formatDate(prev.created_at, true) !== formatDate(m.created_at, true);
          // Group consecutive messages from the same author within 5 minutes.
          const grouped =
            !newDay &&
            prev?.author_id === m.author_id &&
            new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60_000;
          const name = names.get(m.author_id ?? '') ?? 'Someone';
          const mine = m.author_id === userId;
          return (
            <div key={m.id}>
              {newDay && (
                <div className="my-3 flex items-center gap-3">
                  <span className="h-px flex-1 bg-zinc-100" />
                  <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">{formatDate(m.created_at, true)}</span>
                  <span className="h-px flex-1 bg-zinc-100" />
                </div>
              )}
              <div className={cn('flex gap-2.5', grouped ? 'mt-0.5' : 'mt-3')}>
                <div className="w-8 shrink-0">
                  {!grouped && (
                    <span
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white"
                      style={{ backgroundColor: `hsl(${[...name].reduce((h, c) => h + c.charCodeAt(0), 0) % 360} 55% 48%)` }}
                      title={name}
                    >
                      {initials(name)}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  {!grouped && (
                    <p className="text-xs">
                      <span className={cn('font-semibold', mine ? 'text-brand-700' : 'text-ink')}>{name}</span>
                      <span className="ml-2 text-zinc-400">{formatTime(m.created_at)}</span>
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words text-sm text-zinc-700">{m.body}</p>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      <div className="border-t border-zinc-100 px-5 py-3">
        {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
        <div className="flex items-end gap-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            maxLength={4000}
            placeholder="Message the team… (Enter to send, Shift+Enter for a new line)"
            className="max-h-32 min-h-[42px] flex-1 resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-ink placeholder:text-zinc-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
          <button
            onClick={() => void send()}
            disabled={sending || !body.trim()}
            className="rounded-lg bg-brand-500 px-3.5 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
