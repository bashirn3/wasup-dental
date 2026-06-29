"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { MIcon } from "./icons";
import { useApp } from "./context";

export type ThreadChat = { leadId: string | null; name: string; plate: string; phone: string };

export function ThreadBar({
  chat,
  onBack,
  onCall,
  onDelete,
  embedded = false,
}: {
  chat: ThreadChat;
  onBack: () => void;
  onCall: () => void;
  onDelete?: () => void;
  embedded?: boolean;
}) {
  return (
    <div className={"thread-bar" + (embedded ? " thread-bar-embedded" : "")}>
      <button className="iconbtn on-dark" onClick={onBack} aria-label="Back">
        <MIcon.back size={21} />
      </button>
      <span className="plate">{chat.plate || "—"}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="t-h3" style={{ color: "var(--on-pine)" }}>
          {chat.name}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--on-pine-2)", marginTop: 2 }}>WhatsApp</div>
      </div>
      <button className="iconbtn on-dark" onClick={onCall} aria-label="Call">
        <MIcon.phone size={19} />
      </button>
      {onDelete && (
        <button className="iconbtn on-dark" onClick={onDelete} aria-label="Delete lead">
          <MIcon.trash size={18} />
        </button>
      )}
    </div>
  );
}

type Msg = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  delivery_status: string | null;
  created_at: string;
};

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, today)) return "Today";
  if (same(d, yest)) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function ThreadScreen({ chat, embedded = false }: { chat: ThreadChat; embedded?: boolean }) {
  const { tenantId, closeChat, toast, deleteLeads } = useApp();
  const [thread, setThread] = useState<Msg[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [typing, setTyping] = useState(false);
  const [call, setCall] = useState<{ closing: boolean } | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const tCall = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tTyping = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastInbound = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!chat.leadId) {
      setLoaded(true);
      return;
    }
    try {
      const res = await fetch(`/api/chats/${chat.leadId}?tenantId=${encodeURIComponent(tenantId)}`, {
        cache: "no-store",
      });
      const data = await res.json();
      const msgs = (data.messages ?? []) as Msg[];
      setThread(msgs);
      setLoaded(true);

      /* typing dots: a fresh inbound message means the agent is composing */
      const inbound = [...msgs].reverse().find((m) => m.direction === "inbound");
      if (inbound && inbound.id !== lastInbound.current) {
        const isFirstLoad = lastInbound.current === null;
        lastInbound.current = inbound.id;
        const last = msgs[msgs.length - 1];
        const fresh = Date.now() - new Date(inbound.created_at).getTime() < 90_000;
        if (!isFirstLoad && last?.direction === "inbound" && fresh) {
          setTyping(true);
          if (tTyping.current) clearTimeout(tTyping.current);
          tTyping.current = setTimeout(() => setTyping(false), 6000);
        }
      }
      if (msgs[msgs.length - 1]?.direction === "outbound") setTyping(false);
    } catch {
      /* keep current thread */
    }
  }, [chat.leadId, tenantId]);

  useEffect(() => {
    const t0 = window.setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), 5000);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
      if (tTyping.current) clearTimeout(tTyping.current);
      if (tCall.current) clearTimeout(tCall.current);
    };
  }, [load]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.length, typing]);

  const closeCall = () => {
    setCall((x) => x && { ...x, closing: true });
    if (tCall.current) clearTimeout(tCall.current);
    tCall.current = setTimeout(() => setCall(null), 330);
  };

  const send = async () => {
    const body = input.trim();
    if (!body || !chat.leadId || sending) return;
    setSending(true);
    setInput("");
    try {
      const res = await fetch(`/api/chats/${chat.leadId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, body }),
      });
      if (!res.ok) toast("Couldn't send — check the WhatsApp connection");
      await load();
    } finally {
      setSending(false);
    }
  };

  /* group consecutive messages by day */
  const items: ({ day: string } | Msg)[] = [];
  let lastDay = "";
  for (const m of thread) {
    const day = dayLabel(m.created_at);
    if (day !== lastDay) {
      items.push({ day });
      lastDay = day;
    }
    items.push(m);
  }

  let firstAgentSeen = false;

  return (
    <>
      {!embedded && (
        <ThreadBar
          chat={chat}
          onBack={closeChat}
          onCall={() => setCall({ closing: false })}
          onDelete={chat.leadId ? () => void deleteLeads([chat.leadId!]) : undefined}
        />
      )}

      <div className="mt-scroll" ref={scrollRef}>
        <div className="thread-scroll">
          {!loaded && (
            <span className="day-pill">
              <MIcon.refresh size={11} s={2.4} className="spin" style={{ display: "inline-block", verticalAlign: "-1px", marginRight: 6 }} />
              Loading
            </span>
          )}
          {loaded && thread.length === 0 && <span className="day-pill">No messages yet</span>}
          {items.map((m, i) => {
            if ("day" in m) {
              return (
                <span key={"d" + i} className="day-pill">
                  {m.day}
                </span>
              );
            }
            const isAgent = m.direction === "outbound";
            const tagBefore = isAgent && !firstAgentSeen;
            if (isAgent) firstAgentSeen = true;
            return (
              <Fragment key={m.id}>
                {tagBefore && <span className="agent-tag">Your agent</span>}
                <div className={"bubble " + (isAgent ? "agent" : "cust")} style={{ animationDelay: Math.min(i * 70, 560) + "ms" }}>
                  {m.body}
                </div>
              </Fragment>
            );
          })}
          {typing && (
            <div className="bubble agent" style={{ padding: "9px 14px" }}>
              <span className="typing">
                <i></i>
                <i></i>
                <i></i>
              </span>
            </div>
          )}
        </div>
      </div>

      {chat.leadId ? (
        <div className="thread-composer">
          <label className="field" style={{ height: 44 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void send()}
              placeholder="Your agent handles replies — type to step in"
            />
          </label>
          <button
            className="iconbtn"
            onClick={() => void send()}
            aria-label="Send"
            style={{ background: "var(--pine)", color: "var(--on-pine)", opacity: input.trim() && !sending ? 1 : 0.4 }}
          >
            <MIcon.send size={18} />
          </button>
        </div>
      ) : (
        <div className="readonly-note">Your agent handles replies</div>
      )}

      {call && <CallSheet c={chat} closing={call.closing} onClose={closeCall} />}
    </>
  );
}

/* ── call options ── */
export function CallSheet({ c, closing, onClose }: { c: ThreadChat; closing: boolean; onClose: () => void }) {
  const tel = (c.phone || "").replace(/\s/g, "");
  const wa = tel.replace("+", "");
  return (
    <>
      <div className={"scrim" + (closing ? " closing" : "")} onClick={onClose}></div>
      <div className={"sheet auto" + (closing ? " closing" : "")}>
        <div className="row-between" style={{ padding: "22px 14px 6px 22px" }}>
          <h2 className="t-h2">Call {c.name.split(" ")[0]}</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Close">
            <MIcon.close size={20} />
          </button>
        </div>
        <div style={{ padding: "0 20px 12px" }}>
          <a className="call-row" href={"tel:" + tel}>
            <span className="call-ic">
              <MIcon.phone size={19} />
            </span>
            <span style={{ flex: 1 }}>
              <span className="lead-name" style={{ display: "block" }}>
                Phone call
              </span>
              <span className="lead-meta">{c.phone || "No number"}</span>
            </span>
          </a>
          <hr className="hair" />
          <a className="call-row" href={"https://wa.me/" + wa} target="_blank" rel="noopener noreferrer">
            <span className="call-ic">
              <MIcon.chat size={19} />
            </span>
            <span style={{ flex: 1 }}>
              <span className="lead-name" style={{ display: "block" }}>
                WhatsApp call
              </span>
              <span className="lead-meta">Opens WhatsApp — tap call there</span>
            </span>
          </a>
        </div>
      </div>
    </>
  );
}
