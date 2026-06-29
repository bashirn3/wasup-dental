"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, ArrowLeft, Check, Copy, History, Loader2, RefreshCw } from "lucide-react";
import {
  buildSystemPrompt,
  defaultAgentConfig,
  DEFAULT_FIRST_MESSAGE_TEMPLATE,
  sampleFirstMessage,
  type AgentConfig,
} from "@/lib/agent-prompt";
import FirstMessageComposer from "@/components/agent/FirstMessageComposer";
import { useWaLinkMode } from "@/components/connect/useWaLinkMode";
import { authFontClassNames } from "@/lib/auth-fonts";
import {
  ONBOARDING_DRAFT_KEY,
  parseOnboardingDraft,
  TENANT_ID_KEY,
} from "@/lib/onboarding-storage";
import type { AgentTone, OnboardingDraft } from "@/lib/types";
import { isValidWasupPhone } from "@/lib/wa-tenant";

const CONFIG_KEY = "rapidmot.agent.config";
const INSTANCE_KEY = "rapidmot.wasup.instanceId";
const LINK_STATUS_POLL_MS = 3000;

type Msg = { role: "user" | "assistant"; content: string; time: string };
type View = "chat" | "tweak";
type Step = 1 | 2 | 3 | 4;
type AgentVersion = {
  id: string;
  version: number;
  agentName: string;
  customInstructions: string;
  firstMessage: string;
  tone: AgentTone;
  isActive: boolean;
  createdAt: string;
};

const TONES: { id: AgentTone; label: string }[] = [
  { id: "friendly", label: "Friendly" },
  { id: "professional", label: "Professional" },
  { id: "straight-talking", label: "Direct" },
];

function now() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function normalizeAgentConfig(draft: OnboardingDraft, value: unknown): AgentConfig {
  const fallback = defaultAgentConfig(draft);
  if (!value || typeof value !== "object") return fallback;
  const saved = value as Partial<AgentConfig>;
  return {
    agentName: typeof saved.agentName === "string" ? saved.agentName : fallback.agentName,
    tone: TONES.some((tone) => tone.id === saved.tone) ? (saved.tone as AgentTone) : fallback.tone,
    customInstructions:
      typeof saved.customInstructions === "string"
        ? saved.customInstructions
        : fallback.customInstructions,
    firstMessage:
      typeof saved.firstMessage === "string" && saved.firstMessage.trim()
        ? saved.firstMessage
        : DEFAULT_FIRST_MESSAGE_TEMPLATE,
  };
}

function WhatsAppLogo() {
  return (
    <svg width="42" height="42" viewBox="0 0 448 512" className="h-[59px] w-[52px]">
      <path
        fill="#FFFFFF"
        d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.3-26.4-1.2-2.5-5-3.9-10.5-6.6z"
      />
    </svg>
  );
}

function Progress({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-[5px]">
      {[1, 2, 3, 4].map((item) => (
        <div
          key={item}
          className={`h-1 w-5 rounded-sm transition-colors duration-300 ${
            item <= step ? "bg-[#C8F23C]" : "bg-white/[0.14]"
          }`}
        />
      ))}
    </div>
  );
}

function Segmented<T extends string>({
  options,
  current,
  onPick,
}: {
  options: { label: string; value: T }[];
  current: T;
  onPick: (value: T) => void;
}) {
  return (
    <div className="flex w-full gap-1 rounded-full border border-white/[0.08] bg-white/[0.07] p-1">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onPick(option.value)}
          className={`min-w-0 flex-1 rounded-full px-2 py-2.5 text-sm font-semibold transition active:scale-[0.98] ${
            current === option.value ? "bg-[#C8F23C] text-[#0B241C]" : "text-[#9DB3A7]"
          }`}
        >
          <span className="block truncate">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

function CodeBlocks({ code }: { code: string | null }) {
  const loading = !code;
  const clean = (code || "••••••••").replace(/[^a-zA-Z0-9•]/g, "").slice(0, 8);
  const chars = clean.padEnd(8, "•").split("");
  return (
    <div className="flex items-center justify-center gap-1.5">
      {chars.map((char, index) => (
        <span key={`${char}-${index}`} className="flex items-center gap-1.5">
          {index === 4 && (
            <span className="mx-1 h-0.5 w-3 shrink-0 rounded-full bg-white/30" />
          )}
          <span
            className={`flex h-12 w-9 items-center justify-center rounded-[10px] border font-[var(--font-space-grotesk)] text-[22px] font-bold ${
              loading
                ? "skeleton-dark border-transparent text-transparent"
                : "border-white/[0.18] bg-white/[0.07] text-[#C8F23C]"
            }`}
          >
            {char}
          </span>
        </span>
      ))}
    </div>
  );
}

function DeliveryTicks() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 14"
      className="-ml-[1px] inline-block h-[10px] w-[17px] align-[-1px] text-[#53BDEB]"
    >
      <path
        d="M1.5 7.5 5.1 11 12 2.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.2 7.5 11.8 11 21.5 1.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export type AgentBuilderProps = {
  /** Onboarding flow (default) or settings edit overlay */
  variant?: "onboarding" | "edit";
  editTenantId?: string;
  onClose?: () => void;
  onSaved?: () => void;
};

export default function AgentBuilder({
  variant = "onboarding",
  editTenantId,
  onClose,
  onSaved,
}: AgentBuilderProps = {}) {
  const isEdit = variant === "edit";
  const { mode: linkMode, setMode: setLinkMode, canToggle } = useWaLinkMode();
  const [draft, setDraft] = useState<OnboardingDraft | null>(null);
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [step, setStep] = useState<Step>(1);
  const [view, setView] = useState<View>("chat");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [waNumber, setWaNumber] = useState("+44 7700 900123");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [connectedPhone, setConnectedPhone] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [linkRefreshing, setLinkRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyVersions, setHistoryVersions] = useState<AgentVersion[]>([]);
  const [editLoaded, setEditLoaded] = useState(!isEdit);
  const chatRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollFailures = useRef(0);
  const linkRefreshingRef = useRef(false);
  const qrFetchingRef = useRef(false);
  const pairingBootedRef = useRef(false);
  const pairingSkipRefreshRef = useRef(false);
  const pairingCodeLockedRef = useRef(false);
  const qrPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevLinkModeRef = useRef(linkMode);

  const resetChat = useCallback((d: OnboardingDraft, c: AgentConfig) => {
    setTyping(false);
    setMessages([{ role: "assistant", content: sampleFirstMessage(d, c), time: now() }]);
  }, []);

  useEffect(() => {
    if (isEdit) return;
    try {
      const d = parseOnboardingDraft(localStorage.getItem(ONBOARDING_DRAFT_KEY));
      if (!d?.place) return;
      setDraft(d);
      if (d.place.phone) setWaNumber(d.place.phone);
      const savedConfig = localStorage.getItem(CONFIG_KEY);
      const c = savedConfig
        ? normalizeAgentConfig(d, JSON.parse(savedConfig))
        : defaultAgentConfig(d);
      setConfig(c);
      setMessages([{ role: "assistant", content: sampleFirstMessage(d, c), time: now() }]);
    } catch {
      /* no draft yet */
    }
  }, [isEdit]);

  useEffect(() => {
    if (!isEdit || !editTenantId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/tenant/profile?tenantId=${encodeURIComponent(editTenantId)}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (cancelled || !data.draft) return;
        const d = data.draft as OnboardingDraft;
        const base = defaultAgentConfig(d);
        const c: AgentConfig = data.config
          ? {
              agentName: data.config.agentName || base.agentName,
              tone: TONES.some((t) => t.id === data.config.tone) ? data.config.tone : base.tone,
              customInstructions: data.config.customInstructions ?? "",
              firstMessage: data.config.firstMessage?.trim() || base.firstMessage,
            }
          : base;
        setDraft(d);
        setConfig(c);
        if (d.place?.phone) setWaNumber(d.place.phone);
        resetChat(d, c);
      } finally {
        if (!cancelled) setEditLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editTenantId, isEdit, resetChat]);

  useEffect(() => {
    if (isEdit || !config) return;
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  }, [config, isEdit]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typing]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    if (qrPollRef.current) clearInterval(qrPollRef.current);
    qrPollRef.current = null;
  }, []);

  const loadHistory = useCallback(async () => {
    const tenantId = isEdit ? editTenantId : localStorage.getItem(TENANT_ID_KEY);
    if (!tenantId) {
      setHistoryVersions([]);
      return;
    }

    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/agent/save?tenantId=${encodeURIComponent(tenantId)}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.versions)) {
        setHistoryVersions(
          data.versions.filter((item: AgentVersion) =>
            TONES.some((tone) => tone.id === item.tone),
          ),
        );
      }
    } finally {
      setHistoryLoading(false);
    }
  }, [editTenantId, isEdit]);

  const saveAgentConfig = useCallback(async () => {
    if (!draft || !config) return false;
    const tenantId = isEdit ? editTenantId : localStorage.getItem(TENANT_ID_KEY);
    if (!tenantId) return false;
    const res = await fetch("/api/agent/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        agentName: config.agentName,
        tone: config.tone,
        customInstructions: config.customInstructions,
        firstMessage: sampleFirstMessage(draft, config),
        systemPrompt: buildSystemPrompt(draft, config),
      }),
      keepalive: !isEdit,
    }).catch(() => undefined);
    if (!res?.ok) return false;
    if (historyOpen) await loadHistory();
    onSaved?.();
    return true;
  }, [config, draft, editTenantId, historyOpen, isEdit, loadHistory, onSaved]);

  const restoreVersion = (version: AgentVersion) => {
    if (!config) return;
    setConfig({
      ...config,
      agentName: version.agentName || config.agentName,
      tone: version.tone,
      customInstructions: version.customInstructions,
      firstMessage: version.firstMessage,
    });
    setHistoryOpen(false);
  };

  const poll = useCallback(async () => {
    const id = instanceRef.current;
    if (!id) return;
    try {
      const tenantId = localStorage.getItem(TENANT_ID_KEY) ?? "";
      const res = await fetch(
        `/api/wasup/status?instanceId=${encodeURIComponent(id)}&tenantId=${encodeURIComponent(tenantId)}&mode=${linkMode}&phone=${encodeURIComponent(waNumber)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        pollFailures.current += 1;
        if (pollFailures.current >= 3) {
          setErrorMsg(
            linkMode === "code"
              ? "Couldn't refresh the pairing code. Start again to generate a new one."
              : "Couldn't refresh the WhatsApp link. Start again to generate a fresh QR.",
          );
          setStep(2);
          stopPolling();
        }
        return;
      }
      pollFailures.current = 0;
      const data = await res.json();
      if (linkMode === "qr" && data.qrCode) setQrCode(data.qrCode);
      if (linkMode === "code" && data.pairingCode && !pairingCodeLockedRef.current) setPairingCode(data.pairingCode);
      if (data.status === "connected") {
        setConnectedPhone(data.phone ?? waNumber);
        setStep(4);
        stopPolling();
      }
    } catch {
      /* keep polling */
    }
  }, [linkMode, stopPolling, waNumber]);

  const refreshLinkPayload = useCallback(async () => {
    const id = instanceRef.current;
    if (!id || linkRefreshingRef.current) return;
    linkRefreshingRef.current = true;
    setLinkRefreshing(true);
    try {
      const tenantId = localStorage.getItem(TENANT_ID_KEY) ?? "";
      const res = await fetch(
        `/api/wasup/status?instanceId=${encodeURIComponent(id)}&tenantId=${encodeURIComponent(tenantId)}&mode=${linkMode}&refresh=1&phone=${encodeURIComponent(waNumber)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const data = await res.json();
      if (linkMode === "qr" && data.qrCode) setQrCode(data.qrCode);
      if (linkMode === "code" && data.pairingCode && !pairingCodeLockedRef.current) setPairingCode(data.pairingCode);
      if (data.status === "connected") {
        setConnectedPhone(data.phone ?? waNumber);
        setStep(4);
        stopPolling();
      }
    } finally {
      linkRefreshingRef.current = false;
      setLinkRefreshing(false);
    }
  }, [linkMode, stopPolling, waNumber]);

  const fetchQrSnapshot = useCallback(async () => {
    if (linkMode !== "qr") return false;
    const id = instanceRef.current;
    if (!id || qrFetchingRef.current) return false;
    qrFetchingRef.current = true;
    try {
      const tenantId = localStorage.getItem(TENANT_ID_KEY) ?? "";
      const res = await fetch(
        `/api/wasup/status?instanceId=${encodeURIComponent(id)}&tenantId=${encodeURIComponent(tenantId)}&mode=qr&qrOnly=1&phone=${encodeURIComponent(waNumber)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return false;
      const data = await res.json();
      if (data.qrCode) setQrCode(data.qrCode);
      return Boolean(data.qrCode);
    } catch {
      return false;
    } finally {
      qrFetchingRef.current = false;
    }
  }, [linkMode, waNumber]);

  useEffect(() => {
    if (step !== 3) {
      pairingBootedRef.current = false;
      pairingSkipRefreshRef.current = false;
      pairingCodeLockedRef.current = false;
      stopPolling();
      return;
    }
    if (pairingBootedRef.current) return;
    const skipRefresh = pairingSkipRefreshRef.current;
    pairingSkipRefreshRef.current = false;
    pairingBootedRef.current = true;

    void (async () => {
      if (!skipRefresh) {
        await refreshLinkPayload();
      } else if (linkMode === "qr") {
        await fetchQrSnapshot();
      }
      await poll();
    })();
    pollRef.current = setInterval(() => void poll(), LINK_STATUS_POLL_MS);
    if (linkMode === "qr") {
      qrPollRef.current = setInterval(() => {
        void fetchQrSnapshot().then((hasQr) => {
          if (hasQr && qrPollRef.current) {
            clearInterval(qrPollRef.current);
            qrPollRef.current = null;
          }
        });
      }, 1200);
    }
    return () => stopPolling();
  }, [step, linkMode, poll, refreshLinkPayload, fetchQrSnapshot, stopPolling]);

  useEffect(() => {
    if (step !== 3) {
      prevLinkModeRef.current = linkMode;
      return;
    }
    if (prevLinkModeRef.current === linkMode) return;
    prevLinkModeRef.current = linkMode;
    setQrCode(null);
    setPairingCode(null);
    pairingCodeLockedRef.current = false;
    pairingSkipRefreshRef.current = false;
    void (async () => {
      await refreshLinkPayload();
      if (linkMode === "qr") await fetchQrSnapshot();
    })();
  }, [step, linkMode, refreshLinkPayload, fetchQrSnapshot]);

  const send = async () => {
    const text = input.trim();
    if (!text || !draft || !config || typing) return;
    const next: Msg[] = [...messages, { role: "user", content: text, time: now() }];
    setMessages(next);
    setInput("");
    setTyping(true);
    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt: buildSystemPrompt(draft, config),
          messages: next.map((message) => ({ role: message.role, content: message.content })),
        }),
      });
      const data = await res.json();
      setDemoMode(data.mode === "demo");
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: data.reply ?? "Sorry, I had a hiccup. Could you say that again?",
          time: now(),
        },
      ]);
    } catch {
      setMessages((current) => [
        ...current,
        { role: "assistant", content: "Sorry, I had a hiccup. Try again.", time: now() },
      ]);
    } finally {
      setTyping(false);
    }
  };

  const startConnect = async () => {
    if (busy) return;
    setBusy(true);
    setErrorMsg(null);
    setQrCode(null);
    setPairingCode(null);
    pairingCodeLockedRef.current = false;
    try {
      const tenantId = localStorage.getItem(TENANT_ID_KEY);
      const [, res] = await Promise.all([
        saveAgentConfig(),
        fetch("/api/wasup/onboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: waNumber,
            name: draft?.place?.name || "Dental practice",
            tenantId,
            mode: linkMode,
          }),
        }),
      ]);
      const data = await res.json();
      if (!res.ok || !data.instanceId) {
        setErrorMsg(
          data.error === "wasup_not_configured"
            ? "WhatsApp service isn't configured yet."
            : data.error === "wasup_unavailable" || res.status === 502 || res.status === 503
              ? "WhatsApp service is busy right now. Wait a moment and try again."
              : data.error === "phone_already_linked"
                ? "That WhatsApp number is already linked to another practice account."
                : "Couldn't start the connection. Check the number and try again.",
        );
        return;
      }
      instanceRef.current = data.instanceId;
      localStorage.setItem(INSTANCE_KEY, data.instanceId);
      if (linkMode === "qr" && data.qrCode) setQrCode(data.qrCode);
      if (linkMode === "code" && data.pairingCode) {
        setPairingCode(data.pairingCode);
        pairingCodeLockedRef.current = true;
      }
      if (data.status === "connected") {
        setConnectedPhone(data.phone ?? waNumber);
        setStep(4);
      } else {
        pairingSkipRefreshRef.current =
          linkMode === "code" ? Boolean(data.pairingCode) : Boolean(data.qrCode);
        pairingCodeLockedRef.current = linkMode === "code" && Boolean(data.pairingCode);
        setStep(3);
      }
    } catch {
      setErrorMsg("Network hiccup. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const copyCode = () => {
    if (!pairingCode) return;
    void navigator.clipboard?.writeText(pairingCode).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  if (!editLoaded) {
    return (
      <main className="flex h-dvh flex-col items-center justify-center bg-[linear-gradient(180deg,#0B241C_0%,#0E2E23_100%)] text-[#9DB3A7] [font-family:var(--font-instrument-sans),sans-serif]">
        Loading agent…
      </main>
    );
  }

  if (!draft || !config) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-[#0B241C] px-6 text-center text-[#F2F5EF]">
        <h1 className="max-w-md text-balance font-[var(--font-space-grotesk)] text-3xl font-bold tracking-tight">
          Set up your practice first
        </h1>
        <p className="mt-3 max-w-sm text-sm text-[#9DB3A7]">
          The assistant is built from your practice profile.
        </p>
        {isEdit && onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="mt-8 inline-flex items-center gap-2 rounded-2xl border border-white/15 px-8 py-3.5 text-sm font-bold text-white transition hover:bg-white/[0.06] active:scale-[0.98]"
          >
            Back to settings
          </button>
        ) : (
          <Link
            href="/start"
            className="mt-8 inline-flex items-center gap-2 rounded-2xl bg-[#C8F23C] px-8 py-3.5 text-sm font-bold text-[#0B241C] transition hover:bg-[#D6F95C] active:scale-[0.98]"
          >
            Start setup <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </main>
    );
  }

  return (
    <main
      className={`${authFontClassNames} flex h-dvh overflow-hidden flex-col items-center bg-[linear-gradient(180deg,#0B241C_0%,#0E2E23_100%)] text-[#F2F5EF] [font-family:var(--font-instrument-sans),sans-serif]`}
    >
      <div className="relative box-border flex w-full max-w-[580px] shrink-0 items-center justify-center px-6 pt-[22px]">
        {isEdit && onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Back to settings"
            className="absolute left-5 flex h-9 w-9 items-center justify-center rounded-full text-[#9DB3A7] transition hover:bg-white/[0.06] hover:text-white active:scale-95"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        ) : null}
        <div className="font-[var(--font-space-grotesk)] text-lg font-bold tracking-[-0.01em]">
          Wasup<span className="text-[#C8F23C]">Dental</span>
        </div>
        {!isEdit ? (
          <div className="absolute right-6">
            <Progress step={step} />
          </div>
        ) : null}
      </div>

      <div className="box-border flex min-h-0 w-full max-w-[580px] flex-1 flex-col px-5 pb-4 pt-3 sm:px-6">
        {(step === 1 || isEdit) && (
          <motion.section
            data-screen-label="Step 1 - Test agent"
            className="flex min-h-0 flex-1 flex-col"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="mb-2.5">
              <Segmented
                options={[
                  { label: "Chat", value: "chat" },
                  { label: "Tweak", value: "tweak" },
                ]}
                current={view}
                onPick={setView}
              />
            </div>

            {view === "chat" ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[22px] border border-white/[0.09] bg-white/[0.04]">
                  <div className="flex items-center gap-3 bg-[#11342B] px-3.5 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold text-white">
                        {draft.place?.name ?? config.agentName}
                      </div>
                      <div className="text-xs text-[#9DB3A7]">
                        {typing ? "typing..." : "online"}
                        {demoMode && " · demo"}
                      </div>
                    </div>
                  </div>
                  <div
                    ref={chatRef}
                    className="flex flex-1 flex-col gap-1.5 overflow-y-auto bg-[#EFE7DC] bg-[url('/whatsapp-chat-bg.jpg')] bg-[length:380px_auto] px-3.5 py-4"
                  >
                    {messages.map((message, index) => (
                      <motion.div
                        key={`${message.role}-${index}`}
                        initial={{ opacity: 0, y: 8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[80%] px-3 pb-1.5 pt-2 text-left text-[15px] leading-[1.42] text-[#111B21] shadow-[0_1px_1px_rgba(0,0,0,0.10)] ${
                            message.role === "user"
                              ? "rounded-[10px] rounded-tr-[3px] bg-[#D9FDD3]"
                              : "rounded-[10px] rounded-tl-[3px] bg-white"
                          }`}
                        >
                          {message.content}
                          <div className="mt-0.5 flex items-center justify-end gap-[1px] text-[11px] leading-none text-[#667781]">
                            <span>{message.time}</span>
                            {message.role === "user" && <DeliveryTicks />}
                          </div>
                        </div>
                      </motion.div>
                    ))}
                    {typing && (
                      <div className="flex justify-start">
                        <div className="flex items-center gap-1 rounded-[10px] rounded-tl-[3px] bg-white px-4 py-3.5 shadow-[0_1px_1px_rgba(0,0,0,0.10)]">
                          {[0, 1, 2].map((item) => (
                            <span
                              key={item}
                              className="post-signup-dot h-[7px] w-[7px] rounded-full bg-[#7E948A]"
                              style={{ animationDelay: `${item * 0.15}s` }}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 bg-[#F0F2F5] px-3 py-2.5">
                    <input
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                      onKeyDown={(event) => event.key === "Enter" && send()}
                      placeholder="Reply as the customer..."
                      className="h-11 min-w-0 flex-1 rounded-full border-0 bg-white px-[18px] text-[15px] text-[#111B21] shadow-[0_1px_1px_rgba(0,0,0,0.06)] outline-none placeholder:text-[#5C7268]"
                    />
                    <button
                      onClick={send}
                      disabled={!input.trim() || typing}
                      className="box-border flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#25D366] pl-1 text-[17px] text-white transition enabled:hover:bg-[#2BE173] enabled:active:scale-[0.92] disabled:opacity-40"
                    >
                      ➤
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex shrink-0 flex-col gap-[9px]">
                  <div className="text-center text-[13px] text-[#7E948A]">
                    {isEdit ? "Reply as a customer to test your agent" : "Happy with your agent?"}
                  </div>
                  {isEdit ? (
                    <button
                      onClick={() => setView("tweak")}
                      className="flex h-14 items-center justify-center gap-[9px] rounded-2xl bg-[#C8F23C] text-base font-bold text-[#0B241C] transition hover:bg-[#D6F95C] active:scale-[0.98]"
                    >
                      Edit tone &amp; messages <ArrowRight className="h-[18px] w-[18px]" />
                    </button>
                  ) : (
                    <button
                      onClick={async () => {
                        await saveAgentConfig();
                        setStep(2);
                      }}
                      className="flex h-14 items-center justify-center gap-[9px] rounded-2xl bg-[#C8F23C] text-base font-bold text-[#0B241C] transition hover:bg-[#D6F95C] active:scale-[0.98]"
                    >
                      Connect WhatsApp <span className="text-[17px] leading-none">→</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-3">
                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
                  <div className="rounded-[18px] border border-white/[0.09] bg-white/[0.05] px-[18px] py-4">
                    <div className="mb-2.5 flex items-center justify-between gap-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7E948A]">
                        Extra instructions
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          const next = !historyOpen;
                          setHistoryOpen(next);
                          if (next) await loadHistory();
                        }}
                        className={`flex h-8 w-8 items-center justify-center rounded-full border transition active:scale-95 ${
                          historyOpen
                            ? "border-[#C8F23C]/60 bg-[#C8F23C] text-[#0B241C]"
                            : "border-white/[0.12] bg-white/[0.06] text-[#9DB3A7] hover:text-white"
                        }`}
                        aria-label="Show tweak history"
                      >
                        <History className="h-4 w-4" />
                      </button>
                    </div>
                    <textarea
                      value={config.customInstructions}
                      onChange={(event) =>
                        setConfig({ ...config, customInstructions: event.target.value })
                      }
                      rows={2}
                      placeholder="e.g. We're closed bank holidays. Mention free local pickup for bookings before 9am."
                      className="min-h-[76px] w-full resize-none rounded-xl border border-white/[0.12] bg-white/[0.06] px-4 py-3 text-sm leading-[1.5] text-white outline-none placeholder:text-[#5C7268] focus:border-[#C8F23C]"
                    />
                  </div>
                  {historyOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="rounded-[18px] border border-[#C8F23C]/20 bg-[#071F18]/70 p-3"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-xs font-semibold text-[#C8F23C]">Tweak history</p>
                        {historyLoading && <span className="text-xs text-[#7E948A]">Loading...</span>}
                      </div>
                      <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
                        {!historyLoading && historyVersions.length === 0 && (
                          <p className="px-1 py-2 text-xs text-[#7E948A]">
                            No saved versions yet. Hit Apply to save this setup.
                          </p>
                        )}
                        {historyVersions.map((version) => (
                          <button
                            key={version.id}
                            type="button"
                            onClick={() => restoreVersion(version)}
                            className="block w-full rounded-xl border border-white/[0.08] bg-white/[0.05] px-3 py-2 text-left transition hover:border-[#C8F23C]/40 hover:bg-white/[0.08]"
                          >
                            <span className="flex items-center justify-between gap-2">
                              <span className="text-sm font-semibold text-white">
                                Version {version.version}
                                {version.isActive && (
                                  <span className="ml-2 text-[11px] font-semibold text-[#C8F23C]">
                                    active
                                  </span>
                                )}
                              </span>
                              <span className="shrink-0 text-[11px] text-[#7E948A]">
                                {new Date(version.createdAt).toLocaleDateString([], {
                                  month: "short",
                                  day: "numeric",
                                })}
                              </span>
                            </span>
                            <span className="mt-1 block truncate text-xs text-[#9DB3A7]">
                              {version.firstMessage || "No first message saved"}
                            </span>
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                  <div className="rounded-[18px] border border-white/[0.09] bg-white/[0.05] px-[18px] py-4">
                    <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7E948A]">
                      Tone
                    </div>
                    <Segmented options={TONES.map(({ label, id }) => ({ label, value: id }))} current={config.tone} onPick={(tone) => setConfig({ ...config, tone })} />
                  </div>
                  <div className="rounded-[18px] border border-white/[0.09] bg-white/[0.05] px-[18px] py-4">
                    <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7E948A]">
                      First message
                    </div>
                    <FirstMessageComposer
                      tweakLayout
                      value={config.firstMessage}
                      onChange={(template) => setConfig({ ...config, firstMessage: template })}
                    />
                    <div className="mt-2.5 text-[11px] text-[#7E948A]">
                      Preview: <span className="text-[#C8D8CC]">{sampleFirstMessage(draft, config)}</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={async () => {
                    const ok = await saveAgentConfig();
                    if (!ok) return;
                    resetChat(draft, config);
                    setView("chat");
                  }}
                  className="flex h-[54px] shrink-0 items-center justify-center gap-2 rounded-[14px] bg-[#C8F23C] text-base font-bold text-[#0B241C] transition hover:bg-[#D6F95C] active:scale-[0.98]"
                >
                  {isEdit ? (
                    <>Save &amp; preview chat <ArrowRight className="h-[18px] w-[18px]" /></>
                  ) : (
                    <>Apply &amp; restart chat <span className="text-[17px] leading-none">→</span></>
                  )}
                </button>
              </div>
            )}
          </motion.section>
        )}

        {!isEdit && step === 2 && (
          <motion.section
            data-screen-label="Step 2 - Connect WhatsApp"
            className="flex flex-1 flex-col"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <button
              onClick={() => setStep(1)}
              className="self-start py-1 text-sm text-[#9DB3A7] transition hover:text-white"
            >
              ← Back to your agent
            </button>
            <div className="relative flex flex-1 flex-col items-center justify-center px-0 py-6 text-center">
              <div className="post-signup-pop flex h-[78px] w-[78px] items-center justify-center rounded-3xl bg-[#25D366] shadow-[0_12px_36px_rgba(37,211,102,0.25)]">
                <WhatsAppLogo />
              </div>
              <div className="mt-6 h-[90px] w-[318px] font-[var(--font-space-grotesk)] text-[32px] font-bold tracking-[-0.02em] text-white">
                Connect <div>WhatsApp Business</div>
              </div>
              <div className="mt-4 text-[13px] text-[#7E948A]">
                No WhatsApp Business yet?{" "}
                <span className="cursor-pointer text-[#C8F23C] underline underline-offset-3">
                  Set it up free in 5 minutes
                </span>
              </div>
              <label className="mt-8 flex w-full max-w-[400px] flex-col gap-2 py-2.5 text-left">
                <span className="text-[13px] font-semibold text-[#9DB3A7]">
                  WhatsApp Business number
                </span>
                <input
                  value={waNumber}
                  onChange={(event) => setWaNumber(event.target.value)}
                  className="h-14 w-full rounded-2xl border border-white/[0.14] bg-white/[0.06] px-5 font-[var(--font-space-grotesk)] text-lg font-semibold tracking-[0.02em] text-white outline-none focus:border-[#C8F23C] focus:shadow-[0_0_0_3px_rgba(200,242,60,0.18)]"
                />
              </label>
              {errorMsg && <p className="mt-2 max-w-sm text-sm text-red-200">{errorMsg}</p>}
              <button
                onClick={startConnect}
                disabled={busy || !isValidWasupPhone(waNumber)}
                className="mt-[18px] flex h-[42px] w-full max-w-[400px] items-center justify-center gap-2 rounded-2xl bg-[#C8F23C] text-[17px] font-bold text-[#0B241C] transition enabled:hover:bg-[#D6F95C] enabled:active:scale-[0.98] disabled:opacity-45"
              >
                {busy ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                    Connecting…
                  </>
                ) : (
                  <>
                    Connect <span className="text-lg leading-none">→</span>
                  </>
                )}
              </button>
            </div>
          </motion.section>
        )}

        {!isEdit && step === 3 && (
          <motion.section
            data-screen-label="Step 3 - Link your WhatsApp Business App"
            className="flex flex-1 flex-col items-center justify-center px-0 pb-8 pt-3 text-center"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="font-[var(--font-space-grotesk)] text-3xl font-bold tracking-[-0.02em] text-white">
              Link your WhatsApp Business App
            </div>
            <div className="mt-3 max-w-sm text-[15px] text-[#9DB3A7]">
              {linkMode === "qr"
                ? "On the practice phone: WhatsApp > Linked devices > Link a device, then scan this QR."
                : "On the practice phone: WhatsApp > Linked devices > Link with phone number, then enter the code below."}
            </div>
            {linkMode === "qr" && (
              <div className="mt-5 w-[232px] rounded-3xl bg-white p-4 shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
                {qrCode ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qrCode} alt="WhatsApp QR code" className="h-[200px] w-[200px]" />
                ) : (
                  <div className="skeleton h-[200px] w-[200px] rounded-xl" />
                )}
              </div>
            )}

            {linkMode === "code" && (
              <>
                <div className="mt-5 flex w-full max-w-[360px] items-center gap-3.5">
                  <div className="h-px flex-1 bg-white/[0.12]" />
                  <div className="text-xs uppercase tracking-[0.14em] text-[#7E948A]">enter this code</div>
                  <div className="h-px flex-1 bg-white/[0.12]" />
                </div>
                <div className="mt-5">
                  <CodeBlocks code={pairingCode} />
                </div>
                <div className="mt-4 flex items-center justify-center gap-3">
                  <div className="relative">
                    {copied && (
                      <span className="absolute -top-9 left-1/2 -translate-x-1/2 rounded-full bg-[#C8F23C] px-3 py-1 text-xs font-bold text-[#0B241C] shadow-lg">
                        Copied
                      </span>
                    )}
                    <button
                      onClick={copyCode}
                      disabled={!pairingCode}
                      className="flex h-12 w-12 items-center justify-center rounded-full border-[1.5px] border-[#C8F23C]/50 text-[#C8F23C] transition hover:border-[#C8F23C] hover:bg-[#C8F23C]/[0.08] active:scale-95 disabled:opacity-40"
                      aria-label="Copy pairing code"
                    >
                      {copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                    </button>
                  </div>
                </div>
              </>
            )}

            {linkMode === "qr" && (
              <button
                onClick={() => void refreshLinkPayload()}
                disabled={linkRefreshing}
                className="mt-4 flex items-center gap-2 text-sm font-semibold text-[#9DB3A7] transition hover:text-[#C8F23C] disabled:opacity-45"
              >
                <RefreshCw className={`h-4 w-4 ${linkRefreshing ? "animate-spin" : ""}`} />
                Refresh QR
              </button>
            )}

            {canToggle && (
              <button
                type="button"
                onClick={() => setLinkMode(linkMode === "qr" ? "code" : "qr")}
                className="mt-4 text-sm font-semibold text-[#C8F23C] underline underline-offset-3 transition hover:text-[#D6F95C]"
              >
                {linkMode === "qr" ? "Use link code instead" : "Scan QR code instead"}
              </button>
            )}
            <div className="mt-9 flex items-center gap-[9px] text-sm text-[#9DB3A7]">
              <RefreshCw className="h-4 w-4 animate-spin text-[#C8F23C]" />
              Waiting for connection
            </div>
            <button
              onClick={() => {
                stopPolling();
                localStorage.removeItem(INSTANCE_KEY);
                instanceRef.current = null;
                pollFailures.current = 0;
                setQrCode(null);
                setPairingCode(null);
                setStep(2);
              }}
              className="mt-[18px] text-sm text-[#7E948A] underline underline-offset-3 transition hover:text-white"
            >
              Use a different number
            </button>
          </motion.section>
        )}

        {!isEdit && step === 4 && (
          <motion.section
            data-screen-label="Step 4 - Connected"
            className="flex flex-1 flex-col items-center justify-center text-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
          >
            <div className="post-signup-pop">
              <svg width="104" height="104" viewBox="0 0 96 96">
                <circle cx="48" cy="48" r="40" fill="none" stroke="rgba(200,242,60,0.18)" strokeWidth="5" />
                <circle className="post-signup-ring" cx="48" cy="48" r="40" fill="none" stroke="#C8F23C" strokeWidth="5" strokeLinecap="round" transform="rotate(-90 48 48)" />
                <path className="post-signup-check" d="M32 49 L44 61 L66 38" fill="none" stroke="#C8F23C" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="post-signup-fade mt-[26px] font-[var(--font-space-grotesk)] text-[34px] font-bold tracking-[-0.02em] text-white">
              WhatsApp connected
            </div>
            <div className="post-signup-fade mt-2.5 max-w-[360px] text-base leading-normal text-[#9DB3A7] [animation-delay:0.2s]">
              {config.agentName} is now live on{" "}
              <span className="font-semibold text-white">{connectedPhone ?? waNumber}</span>.
            </div>
            <Link
              href="/dashboard"
              className="post-signup-fade mt-9 flex h-14 w-full max-w-[380px] items-center justify-center gap-2 rounded-2xl bg-[#C8F23C] text-[17px] font-bold text-[#0B241C] transition hover:bg-[#D6F95C] active:scale-[0.98] [animation-delay:0.7s]"
            >
              Let&apos;s go <span className="text-lg leading-none">→</span>
            </Link>
          </motion.section>
        )}
      </div>
    </main>
  );
}
