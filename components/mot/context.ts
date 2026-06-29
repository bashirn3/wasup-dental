"use client";

import { createContext, useContext } from "react";
import type { LeadVM } from "./data";

export type Filter = "All" | "Overdue" | "Due soon" | "Booked";

export type WaStatus = "checking" | "connected" | "disconnected";

export type ScanFinishRow = {
  name: string;
  plate: string;
  phone: string;
  pageIndex?: number;
  rowIndex?: number;
};

export type MotCtx = {
  tenantId: string;
  garageName: string;
  garagePhone: string;
  waStatus: WaStatus;
  filter: Filter;
  setFilter: (f: Filter) => void;
  toast: (msg: string) => void;

  leads: LeadVM[];
  pending: LeadVM[];
  loading: boolean;
  reload: () => Promise<void>;

  /* thread */
  openChat: (lead: { id?: string | null; leadId?: string | null; name: string; plate: string; phone: string }) => void;
  closeChat: () => void;

  /* sheets / layers */
  openCsv: () => void;
  openDay: (date: string) => void;
  closeDay: () => void;
  openScan: () => void;
  closeScan: () => void;
  finishScan: (rows: ScanFinishRow[], review: boolean) => void;

  /* approve queue */
  approve: (ids: string[]) => Promise<void>;
  reject: (ids: string[]) => Promise<void>;
  deleteLeads: (ids: string[]) => Promise<void>;
  updatePending: (
    id: string,
    fields: { plate: string; name: string; phone: string; motDueDate?: string | null; vehicle?: string | null },
  ) => Promise<void>;
  addPending: (f: { plate: string; name: string; phone: string }) => Promise<void>;
  openEdit: (id: string) => void;
  closeEdit: (saved?: boolean) => void;
  openAdd: () => void;
  openAgentEdit: () => void;
  closeAgentEdit: () => void;
};

export const AppCtx = createContext<MotCtx | null>(null);

export function useApp(): MotCtx {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp outside MotApp");
  return ctx;
}
