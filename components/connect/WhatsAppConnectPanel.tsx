"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Frown, Loader2, RefreshCw } from "lucide-react";
import { authFontClassNames } from "@/lib/auth-fonts";
import { INSTANCE_KEY } from "@/lib/wa-sheet-logic";
import { useWaLinkMode, type WaLinkMode } from "@/components/connect/useWaLinkMode";
import { isValidWasupPhone } from "@/lib/wa-tenant";

const LINK_STATUS_POLL_MS = 3000;
/** Pairing codes live ~2 min — never auto-refresh before this. */
const CODE_PAYLOAD_TTL_MS = 120_000;

type Phase = "phone" | "pairing" | "connected" | "error";
type LinkMode = WaLinkMode;

function WhatsAppLogo({ size = 52 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 448 512" aria-hidden>
      <path
        fill="#FFFFFF"
        d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.3-26.4-1.2-2.5-5-3.9-10.5-6.6z"
      />
    </svg>
  );
}

export function CodeBlocks({ code }: { code: string | null }) {
  const loading = !code;
  const clean = (code || "••••••••").replace(/[^a-zA-Z0-9•]/g, "").slice(0, 8);
  const chars = clean.padEnd(8, "•").split("");
  return (
    <div className="flex items-center justify-center gap-1.5">
      {chars.map((char, index) => (
        <span key={`${char}-${index}`} className="flex items-center gap-1.5">
          {index === 4 && <span className="mx-1 h-0.5 w-3 shrink-0 rounded-full bg-white/[0.28]" />}
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

export type WhatsAppConnectPanelProps = {
  tenantId: string;
  garageName?: string;
  initialPhone?: string;
  /** Existing instance — skip phone step and show pairing (QR desktop only). */
  reconnectInstanceId?: string | null;
  /** Always start on phone entry (change number / new link). */
  forcePhoneStep?: boolean;
  /** Lock to one pairing method (no toggle). Omit to auto-pick: QR on desktop, code on mobile. */
  fixedLinkMode?: LinkMode;
  variant?: "page" | "embedded";
  onConnected?: (phone: string | null) => void;
  onBack?: () => void;
  doneHref?: string;
  doneLabel?: string;
};

function linkErrorMessage(linkMode: LinkMode, data: { error?: string; wasupHttpStatus?: number }) {
  if (data.error === "wasup_unavailable" || data.error === "wasup_not_configured") {
    const code = data.wasupHttpStatus ? ` (HTTP ${data.wasupHttpStatus})` : "";
    return `WhatsApp pairing service is unavailable${code}. The Wasup instance API is not responding — your instance may need a reset on the Wasup control plane.`;
  }
  if (data.error === "phone_required") {
    return "Enter the WhatsApp number for this garage to generate a pairing code.";
  }
  return linkMode === "code"
    ? "Couldn't get a pairing code. Check the number and try again."
    : "Couldn't refresh the WhatsApp QR. Start again to generate a fresh code.";
}

export function WhatsAppConnectPanel({
  tenantId,
  garageName = "RapidMOT garage",
  initialPhone = "",
  reconnectInstanceId = null,
  forcePhoneStep = false,
  fixedLinkMode,
  variant = "page",
  onConnected,
  onBack,
  doneHref = "/dashboard",
  doneLabel = "Go to my dashboard",
}: WhatsAppConnectPanelProps) {
  const { mode: autoMode, setMode, isMobile, canToggle } = useWaLinkMode();
  const linkMode = fixedLinkMode ?? autoMode;
  const showModeToggle = canToggle && !fixedLinkMode;

  const skipPhoneForReconnect =
    Boolean(reconnectInstanceId) &&
    !forcePhoneStep &&
    linkMode === "qr" &&
    isValidWasupPhone(initialPhone);
  const [phase, setPhase] = useState<Phase>(skipPhoneForReconnect ? "pairing" : "phone");
  const [phone, setPhone] = useState(initialPhone);
  const phoneEditedRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [linkRefreshing, setLinkRefreshing] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [connectedPhone, setConnectedPhone] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [codeExpired, setCodeExpired] = useState(false);
  const [copied, setCopied] = useState(false);
  const instanceRef = useRef<string | null>(reconnectInstanceId);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollFailures = useRef(0);
  const linkRefreshingRef = useRef(false);
  const pairingCodeLockedRef = useRef(false);
  const bootedRef = useRef(false);
  const codeIssuedAtRef = useRef<number | null>(null);
  const qrPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevLinkModeRef = useRef(linkMode);

  useEffect(() => {
    if (reconnectInstanceId && skipPhoneForReconnect) {
      instanceRef.current = reconnectInstanceId;
      localStorage.setItem(INSTANCE_KEY, reconnectInstanceId);
      setPhase("pairing");
    }
  }, [reconnectInstanceId, skipPhoneForReconnect]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    if (qrPollRef.current) clearInterval(qrPollRef.current);
    qrPollRef.current = null;
  }, []);

  const failLink = useCallback(
    (data: { error?: string; wasupHttpStatus?: number }) => {
      setErrorMsg(linkErrorMessage(linkMode, data));
      setPhase("error");
      stopPolling();
    },
    [linkMode, stopPolling],
  );

  const clearGhostInstance = useCallback(() => {
    stopPolling();
    localStorage.removeItem(INSTANCE_KEY);
    instanceRef.current = null;
    bootedRef.current = false;
    setQrCode(null);
    setPairingCode(null);
    codeIssuedAtRef.current = null;
    setCodeExpired(false);
    pollFailures.current = 0;
  }, [stopPolling]);

  const poll = useCallback(async () => {
    const id = instanceRef.current;
    if (!id) return;
    try {
      const res = await fetch(
        `/api/wasup/status?instanceId=${encodeURIComponent(id)}&tenantId=${encodeURIComponent(tenantId)}&mode=${linkMode}&phone=${encodeURIComponent(phone)}`,
        { cache: "no-store" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "instance_not_found") {
          clearGhostInstance();
          setPhase("phone");
          return;
        }
        if (data.error === "wasup_unavailable" || res.status === 503 || res.status === 502) {
          failLink(data);
          return;
        }
        pollFailures.current += 1;
        if (pollFailures.current >= 3) {
          failLink(data);
        }
        return;
      }
      pollFailures.current = 0;
      if (linkMode === "qr" && data.qrCode) setQrCode(data.qrCode);
      if (linkMode === "code" && data.pairingCode && !pairingCodeLockedRef.current) {
        setPairingCode(data.pairingCode);
        codeIssuedAtRef.current = Date.now();
        setCodeExpired(false);
      }
      if (data.status === "connected") {
        setConnectedPhone(data.phone ?? phone ?? null);
        setPhase("connected");
        stopPolling();
        onConnected?.(data.phone ?? null);
      }
    } catch {
      /* keep polling */
    }
  }, [clearGhostInstance, failLink, linkMode, onConnected, phone, stopPolling, tenantId]);

  const refreshLinkPayload = useCallback(async () => {
    const id = instanceRef.current;
    if (!id || linkRefreshingRef.current) return;
    linkRefreshingRef.current = true;
    setLinkRefreshing(true);
    try {
      const res = await fetch(
        `/api/wasup/status?instanceId=${encodeURIComponent(id)}&tenantId=${encodeURIComponent(tenantId)}&mode=${linkMode}&refresh=1&phone=${encodeURIComponent(phone)}`,
        { cache: "no-store" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "instance_not_found") {
          clearGhostInstance();
          setPhase("phone");
          return;
        }
        if (data.error === "wasup_unavailable" || res.status === 503 || res.status === 502) {
          failLink(data);
        }
        return;
      }
      if (linkMode === "qr" && data.qrCode) setQrCode(data.qrCode);
      if (linkMode === "code" && data.pairingCode && !pairingCodeLockedRef.current) {
        setPairingCode(data.pairingCode);
        codeIssuedAtRef.current = Date.now();
        setCodeExpired(false);
      }
      if (data.status === "connected") {
        setConnectedPhone(data.phone ?? phone ?? null);
        setPhase("connected");
        stopPolling();
        onConnected?.(data.phone ?? null);
      }
    } finally {
      linkRefreshingRef.current = false;
      setLinkRefreshing(false);
    }
  }, [clearGhostInstance, failLink, linkMode, onConnected, phone, stopPolling, tenantId]);

  const fetchQrSnapshot = useCallback(async (): Promise<boolean> => {
    if (linkMode !== "qr") return false;
    const id = instanceRef.current;
    if (!id) return false;
    try {
      const res = await fetch(
        `/api/wasup/status?instanceId=${encodeURIComponent(id)}&tenantId=${encodeURIComponent(tenantId)}&mode=qr&qrOnly=1&phone=${encodeURIComponent(phone)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return false;
      const data = await res.json();
      if (data.qrCode) setQrCode(data.qrCode);
      return Boolean(data.qrCode);
    } catch {
      return false;
    }
  }, [linkMode, phone, tenantId]);

  const skipPairingRefreshRef = useRef(false);

  useEffect(() => {
    if (phase !== "pairing") {
      bootedRef.current = false;
      skipPairingRefreshRef.current = false;
      return;
    }
    if (bootedRef.current) return;
    bootedRef.current = true;
    const skipRefresh = skipPairingRefreshRef.current;
    skipPairingRefreshRef.current = false;
    void (async () => {
      if (!skipRefresh) {
        await refreshLinkPayload();
      } else if (linkMode === "qr") {
        await fetchQrSnapshot();
      }
      await poll();
    })();
  }, [phase, poll, refreshLinkPayload, fetchQrSnapshot, linkMode]);

  useEffect(() => {
    if (phase !== "pairing") {
      prevLinkModeRef.current = linkMode;
      return;
    }
    if (prevLinkModeRef.current === linkMode) return;
    prevLinkModeRef.current = linkMode;
    setQrCode(null);
    setPairingCode(null);
    pairingCodeLockedRef.current = false;
    skipPairingRefreshRef.current = false;
    void (async () => {
      await refreshLinkPayload();
      if (linkMode === "qr") await fetchQrSnapshot();
    })();
  }, [linkMode, phase, refreshLinkPayload, fetchQrSnapshot]);

  useEffect(() => {
    if (phase !== "pairing") return;

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

    if (linkMode === "code") {
      const expiryTimer = window.setTimeout(() => setCodeExpired(true), CODE_PAYLOAD_TTL_MS);
      return () => {
        clearTimeout(expiryTimer);
        stopPolling();
      };
    }

    return () => {
      stopPolling();
    };
  }, [linkMode, phase, poll, fetchQrSnapshot, stopPolling]);

  const resetToPhone = () => {
    stopPolling();
    localStorage.removeItem(INSTANCE_KEY);
    instanceRef.current = null;
    pollFailures.current = 0;
    bootedRef.current = false;
    codeIssuedAtRef.current = null;
    setCodeExpired(false);
    setQrCode(null);
    setPairingCode(null);
    phoneEditedRef.current = false;
    setPhase("phone");
  };

  const phoneValid = isValidWasupPhone(phone);

  const onboard = async () => {
    if (busy) return;
    setBusy(true);
    setErrorMsg(null);
    pairingCodeLockedRef.current = false;
    try {
      setQrCode(null);
      setPairingCode(null);
      setCopied(false);
      bootedRef.current = false;
      const res = await fetch("/api/wasup/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          name: garageName,
          tenantId,
          mode: linkMode,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.instanceId) {
        if (data.error === "wasup_unavailable" || res.status === 502 || res.status === 503) {
          failLink(data);
          return;
        }
        setErrorMsg(
          data.error === "wasup_not_configured"
            ? "WhatsApp service isn't configured yet."
            : data.error === "phone_already_linked"
              ? "That WhatsApp number is already linked to another garage account."
              : linkErrorMessage(linkMode, data),
        );
        setPhase("error");
        return;
      }
      instanceRef.current = data.instanceId;
      localStorage.setItem(INSTANCE_KEY, data.instanceId);
      if (linkMode === "qr" && data.qrCode) setQrCode(data.qrCode);
      if (linkMode === "code" && data.pairingCode) {
        setPairingCode(data.pairingCode);
        pairingCodeLockedRef.current = true;
        codeIssuedAtRef.current = Date.now();
        setCodeExpired(false);
      }
      if (data.status === "connected") {
        setConnectedPhone(data.phone ?? phone ?? null);
        setPhase("connected");
        onConnected?.(data.phone ?? null);
      } else {
        skipPairingRefreshRef.current =
          linkMode === "code" ? Boolean(data.pairingCode) : Boolean(data.qrCode);
        pairingCodeLockedRef.current = linkMode === "code" && Boolean(data.pairingCode);
        bootedRef.current = false;
        setPhase("pairing");
      }
    } catch {
      setErrorMsg("Network hiccup. Try again.");
      setPhase("error");
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

  const shellClass =
    `${authFontClassNames} [font-family:var(--font-instrument-sans),sans-serif] text-[#F2F5EF] ` +
    (variant === "page"
      ? "relative flex min-h-dvh w-full flex-col items-center bg-[linear-gradient(180deg,#0B241C_0%,#0E2E23_100%)] px-6 py-10"
      : "relative flex min-h-0 w-full flex-1 flex-col overflow-y-auto bg-[linear-gradient(180deg,#0B241C_0%,#0E2E23_100%)] px-6 pt-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]");

  return (
    <div className={shellClass}>
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="mb-1 self-start py-1 text-sm text-[#9DB3A7] transition hover:text-white"
        >
          ← Back
        </button>
      )}

      <div className="mx-auto flex w-full max-w-[440px] flex-1 flex-col">
        <AnimatePresence mode="wait">
          {phase === "phone" && (
            <motion.section
              key="phone"
              className="flex flex-1 flex-col items-center justify-center text-center"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="post-signup-pop flex h-[78px] w-[78px] items-center justify-center rounded-3xl bg-[#25D366] shadow-[0_12px_36px_rgba(37,211,102,0.25)]">
                <WhatsAppLogo />
              </div>

              <h1 className="mt-6 text-balance font-[var(--font-space-grotesk)] text-[30px] font-bold leading-tight tracking-[-0.02em] text-white">
                Connect WhatsApp Business
              </h1>
              <p className="mt-3 max-w-sm text-sm leading-relaxed text-[#9DB3A7]">
                Which number should send and receive your lead messages? You&apos;ll link it in the
                next step.
              </p>

              <div className="mt-8 w-full max-w-[400px] text-left">
                <div className="mb-2 text-[13px] font-semibold text-[#9DB3A7]">
                  WhatsApp Business number
                </div>
                <input
                  value={phone}
                  onChange={(e) => {
                    phoneEditedRef.current = true;
                    setPhone(e.target.value);
                  }}
                  onFocus={(e) => e.target.select()}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  autoFocus
                  placeholder="+44 7700 900123"
                  className="h-14 w-full rounded-2xl border border-white/[0.14] bg-white/[0.06] px-5 font-[var(--font-space-grotesk)] text-lg font-semibold tracking-[0.02em] text-white outline-none transition placeholder:font-normal placeholder:text-[#5C7268] focus:border-[#C8F23C] focus:shadow-[0_0_0_3px_rgba(200,242,60,0.18)]"
                />
              </div>

              <button
                type="button"
                onClick={() => void onboard()}
                disabled={busy || !phoneValid}
                className="mt-[18px] flex h-14 w-full max-w-[400px] items-center justify-center gap-2 rounded-2xl bg-[#C8F23C] text-[17px] font-bold text-[#0B241C] transition enabled:hover:bg-[#D6F95C] enabled:active:scale-[0.98] disabled:opacity-40"
              >
                {busy ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                    Connecting…
                  </>
                ) : (
                  <>
                    Connect
                    <ArrowRight className="h-[18px] w-[18px]" />
                  </>
                )}
              </button>
              <p className="mt-4 text-xs text-[#7E948A]">
                {linkMode === "qr"
                  ? "Next: scan a QR code from WhatsApp linked devices."
                  : "Next: enter the pairing code in WhatsApp on that phone."}
              </p>
            </motion.section>
          )}

          {phase === "pairing" && (
            <motion.section
              key="pairing"
              className="flex flex-1 flex-col items-center justify-center text-center"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            >
              <h1 className="font-[var(--font-space-grotesk)] text-[30px] font-bold leading-tight tracking-[-0.02em] text-white">
                Link it in WhatsApp
              </h1>
              <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-[#9DB3A7]">
                On the garage phone: WhatsApp → Linked devices →{" "}
                <span className="text-[#C8F23C]">
                  {linkMode === "qr" ? "Link a device" : "Link with phone number"}
                </span>
              </p>

              {linkMode === "qr" &&
                (qrCode ? (
                  <motion.div
                    initial={{ scale: 0.92, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="mt-7 rounded-3xl bg-white p-4 shadow-[0_18px_50px_rgba(0,0,0,0.35)]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qrCode} alt="WhatsApp QR code" className="h-52 w-52" />
                  </motion.div>
                ) : (
                  <div className="mt-7 h-[216px] w-[216px] rounded-3xl bg-white p-4 shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
                    <div className="skeleton h-[184px] w-[184px] rounded-xl" />
                  </div>
                ))}

              {linkMode === "code" && (
                <>
                  <div className="mt-7 flex w-full max-w-[360px] items-center gap-3.5">
                    <div className="h-px flex-1 bg-white/[0.12]" />
                    <div className="text-xs uppercase tracking-[0.14em] text-[#7E948A]">enter this code</div>
                    <div className="h-px flex-1 bg-white/[0.12]" />
                  </div>
                  <div className="mt-[18px]">
                    <CodeBlocks code={pairingCode} />
                  </div>
                  <div className="mt-4 flex items-center gap-2.5">
                    <button
                      onClick={copyCode}
                      disabled={!pairingCode}
                      className="rounded-full border-[1.5px] border-[#C8F23C]/50 px-5 py-2.5 text-[13px] font-bold text-[#C8F23C] transition hover:border-[#C8F23C] hover:bg-[#C8F23C]/[0.08] active:scale-95 disabled:opacity-40"
                    >
                      {copied ? "Copied ✓" : "Copy code"}
                    </button>
                    {codeExpired && (
                      <button
                        onClick={() => void refreshLinkPayload()}
                        disabled={linkRefreshing}
                        className="flex items-center gap-2 rounded-full border-[1.5px] border-white/15 px-5 py-2.5 text-[13px] font-bold text-[#9DB3A7] transition hover:border-[#C8F23C]/50 hover:text-[#C8F23C] active:scale-95 disabled:opacity-45"
                      >
                        <RefreshCw className={`h-4 w-4 ${linkRefreshing ? "animate-spin" : ""}`} />
                        New code
                      </button>
                    )}
                  </div>
                </>
              )}

              {linkMode === "qr" && (
                <button
                  type="button"
                  onClick={() => void refreshLinkPayload()}
                  disabled={linkRefreshing}
                  className="mt-5 flex items-center gap-2 text-[13px] font-semibold text-[#9DB3A7] transition hover:text-[#C8F23C] disabled:opacity-45"
                >
                  <RefreshCw className={`h-4 w-4 ${linkRefreshing ? "animate-spin" : ""}`} />
                  Refresh QR
                </button>
              )}

              {showModeToggle && (
                <button
                  type="button"
                  onClick={() => setMode(linkMode === "qr" ? "code" : "qr")}
                  className="mt-4 text-sm font-semibold text-[#C8F23C] underline underline-offset-3 transition hover:text-[#D6F95C]"
                >
                  {linkMode === "qr" ? "Use link code instead" : "Scan QR code instead"}
                </button>
              )}

              <div className="mt-9 flex items-center gap-2.5 text-sm text-[#9DB3A7]">
                <span className="post-signup-pulse h-[9px] w-[9px] shrink-0 rounded-full bg-[#C8F23C]" />
                {linkMode === "code" && codeExpired
                  ? "Code expired — tap New code"
                  : "Waiting for the link — updates automatically"}
              </div>

              <button
                onClick={resetToPhone}
                className="mt-[18px] text-sm text-[#7E948A] underline underline-offset-[3px] transition hover:text-white"
              >
                Use a different number
              </button>
            </motion.section>
          )}

          {phase === "connected" && (
            <motion.section
              key="connected"
              className="flex flex-1 flex-col items-center justify-center text-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4 }}
            >
              <div className="post-signup-pop">
                <svg width="104" height="104" viewBox="0 0 96 96" aria-hidden>
                  <circle cx="48" cy="48" r="40" fill="none" stroke="rgba(200,242,60,0.18)" strokeWidth="5" />
                  <circle
                    cx="48"
                    cy="48"
                    r="40"
                    fill="none"
                    stroke="#C8F23C"
                    strokeWidth="5"
                    strokeLinecap="round"
                    transform="rotate(-90 48 48)"
                    className="post-signup-ring"
                  />
                  <path
                    d="M32 49 L44 61 L66 38"
                    fill="none"
                    stroke="#C8F23C"
                    strokeWidth="6.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="post-signup-check"
                  />
                </svg>
              </div>

              <h1 className="post-signup-fade mt-7 font-[var(--font-space-grotesk)] text-[32px] font-bold tracking-[-0.02em] text-white [animation-delay:0.5s]">
                WhatsApp connected
              </h1>
              <p className="post-signup-fade mt-2.5 max-w-sm text-[15px] leading-relaxed text-[#9DB3A7] [animation-delay:0.7s]">
                Your agent is now live on{" "}
                <span className="font-semibold text-white">
                  {connectedPhone ?? phone ?? "your garage number"}
                </span>
                .
              </p>

              <div className="post-signup-fade mt-9 w-full max-w-[380px] [animation-delay:1.1s]">
                {onBack ? (
                  <button
                    type="button"
                    onClick={onBack}
                    className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#C8F23C] text-[17px] font-bold text-[#0B241C] transition hover:bg-[#D6F95C] active:scale-[0.98]"
                  >
                    {doneLabel} <ArrowRight className="h-[18px] w-[18px]" />
                  </button>
                ) : (
                  <Link
                    href={doneHref}
                    className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#C8F23C] text-[17px] font-bold text-[#0B241C] transition hover:bg-[#D6F95C] active:scale-[0.98]"
                  >
                    {doneLabel} <ArrowRight className="h-[18px] w-[18px]" />
                  </Link>
                )}
              </div>
            </motion.section>
          )}

          {phase === "error" && (
            <motion.section
              key="error"
              className="flex flex-1 flex-col items-center justify-center text-center"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              <Frown className="h-12 w-12 text-[#9DB3A7]" strokeWidth={1.5} />
              <h1 className="mt-5 font-[var(--font-space-grotesk)] text-2xl font-bold tracking-tight text-white">
                That didn&apos;t work
              </h1>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-[#9DB3A7]">{errorMsg}</p>
              <button
                onClick={resetToPhone}
                className="mt-8 rounded-2xl bg-[#C8F23C] px-8 py-3.5 text-sm font-bold text-[#0B241C] transition hover:bg-[#D6F95C] active:scale-[0.98]"
              >
                Try again
              </button>
            </motion.section>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
