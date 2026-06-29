"use client";

import { useCallback, useEffect, useState } from "react";

export type WaLinkMode = "qr" | "code";

const MOBILE_MQ = "(max-width: 768px)";

/** Desktop defaults to QR scan; mobile defaults to link code (mutually exclusive on Wasup). */
export function useWaLinkMode() {
  const [isMobile, setIsMobile] = useState(false);
  const [mode, setModeState] = useState<WaLinkMode>("qr");
  const [userPicked, setUserPicked] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (userPicked) return;
    setModeState(isMobile ? "code" : "qr");
  }, [isMobile, userPicked]);

  const setMode = useCallback((next: WaLinkMode) => {
    setUserPicked(true);
    setModeState(next);
  }, []);

  const resetMode = useCallback(() => {
    setUserPicked(false);
  }, []);

  return { mode, setMode, resetMode, isMobile, canToggle: !isMobile };
}
