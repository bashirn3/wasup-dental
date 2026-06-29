"use client";

import { createContext, useContext } from "react";
import type { Filter, ScanFinishRow, WaStatus } from "@/components/mot/context";
import type { LeadVM, BookingVM } from "@/components/mot/data";
import type { ThreadChat } from "@/components/mot/ThreadScreen";

export type DeskTab = "leads" | "approve" | "bookings" | "settings";
export type DeskModal = "csv" | "add" | "scan" | "wa" | null;

export type DeskCtx = {
  tenantId: string;
  garageName: string;
  garagePhone: string;
  waStatus: WaStatus;
  tab: DeskTab;
  goTab: (t: DeskTab) => void;
  filter: Filter;
  setFilter: (f: Filter) => void;
  toast: (msg: string) => void;
  leads: LeadVM[];
  pending: LeadVM[];
  loading: boolean;
  reload: () => Promise<void>;
  openChat: (lead: { id?: string | null; leadId?: string | null; name: string; plate: string; phone: string }) => void;
  closeChat: () => void;
  openEdit: (id: string) => void;
  closeEdit: () => void;
  openModal: (kind: NonNullable<DeskModal>) => void;
  closeModal: () => void;
  approve: (ids: string[]) => Promise<void>;
  reject: (ids: string[]) => Promise<void>;
  deleteLeads: (ids: string[]) => Promise<void>;
  updatePending: (
    id: string,
    fields: { plate: string; name: string; phone: string; motDueDate?: string | null; vehicle?: string | null },
  ) => Promise<void>;
  addPending: (f: { plate: string; name: string; phone: string }) => Promise<void>;
  finishScan: (rows: ScanFinishRow[], review?: boolean) => void;
  instanceId: string | null;
};

export const DeskContext = createContext<DeskCtx | null>(null);

export function useDesk(): DeskCtx {
  const ctx = useContext(DeskContext);
  if (!ctx) throw new Error("useDesk outside DeskApp");
  return ctx;
}

export type { ThreadChat, BookingVM };
