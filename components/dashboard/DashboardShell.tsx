"use client";

import { useEffect, useState } from "react";
import MotApp from "@/components/mot/MotApp";
import DeskApp from "@/components/desk/DeskApp";

const DESKTOP_MQ = "(min-width: 900px)";

/** Renders the desktop prototype shell at 900px+, mobile MotApp below. */
export default function DashboardShell({ tenantId }: { tenantId: string }) {
  const [desktop, setDesktop] = useState<boolean | null>(null);

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_MQ);
    const apply = () => setDesktop(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  if (desktop === null) return <main className="min-h-dvh bg-paper" />;
  if (desktop) return <DeskApp tenantId={tenantId} />;
  return <MotApp tenantId={tenantId} />;
}
