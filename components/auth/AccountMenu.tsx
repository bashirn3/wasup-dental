"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth, useClerk, useOrganizationList, useUser } from "@clerk/nextjs";

type Props = {
  /** Compact avatar for mobile header; slightly larger for desktop sidebar. */
  variant?: "mobile" | "desktop";
  label?: string;
  subLabel?: string;
};

const SUPERADMIN_EMAILS = new Set([
  "bashir@tryrapidscreen.com",
  "arslan@tryrapidscreen.com",
]);

/**
 * Branded account control — Sign out only. Replaces Clerk's UserButton popover
 * (manage account, profile, etc.) with a minimal menu that matches the app.
 */
export default function AccountMenu({ variant = "mobile", label, subLabel }: Props) {
  const { signOut } = useClerk();
  const { orgId } = useAuth();
  const { user, isLoaded } = useUser();
  const { isLoaded: orgListLoaded, setActive, userMemberships } = useOrganizationList({
    userMemberships: { infinite: true },
  });
  const [open, setOpen] = useState(false);
  const [switchingOrgId, setSwitchingOrgId] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const email = user?.primaryEmailAddress?.emailAddress?.toLowerCase() ?? "";
  const memberships = userMemberships?.data ?? [];
  const canSwitchWorkspace = SUPERADMIN_EMAILS.has(email) && memberships.length > 1;
  const initial =
    user?.firstName?.charAt(0) ||
    user?.primaryEmailAddress?.emailAddress?.charAt(0)?.toUpperCase() ||
    "A";

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const signOutNow = async () => {
    close();
    await signOut();
    window.location.assign("/");
  };

  const switchWorkspace = async (organizationId: string) => {
    if (!setActive || switchingOrgId || organizationId === orgId) return;
    setSwitchingOrgId(organizationId);
    try {
      await setActive({ organization: organizationId });
      window.location.assign("/dashboard");
    } catch {
      setSwitchingOrgId("");
    }
  };

  const btnClass = variant === "desktop" ? "acct-trigger dk-acct-trigger" : "acct-trigger mt-acct-trigger";
  const avatar = isLoaded && user?.imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={user.imageUrl} alt="" className="acct-img" />
  ) : (
    <span className="acct-initial">{initial}</span>
  );
  const popover = open && (
    <div className={"acct-pop" + (canSwitchWorkspace ? " has-switcher" : "")} role="menu">
      {canSwitchWorkspace && (
        <div className="acct-switcher">
          <div className="acct-switcher-title">Switch workspace</div>
          {orgListLoaded &&
            memberships.map((membership) => {
              const org = membership.organization;
              const active = org.id === orgId;
              return (
                <button
                  key={org.id}
                  type="button"
                  className={"acct-org" + (active ? " active" : "")}
                  role="menuitem"
                  disabled={active || Boolean(switchingOrgId)}
                  onClick={() => void switchWorkspace(org.id)}
                >
                  <span>{org.name}</span>
                  {switchingOrgId === org.id ? (
                    <span className="acct-org-meta">Opening...</span>
                  ) : active ? (
                    <span className="acct-org-meta">Current</span>
                  ) : null}
                </button>
              );
            })}
        </div>
      )}
      <button type="button" className="acct-signout" role="menuitem" onClick={() => void signOutNow()}>
        Sign out
      </button>
    </div>
  );

  if (variant === "desktop" && (label || subLabel)) {
    return (
      <div className="acct-menu dk-account-menu" ref={rootRef}>
        <button
          type="button"
          className="dk-account-trigger"
          aria-label="Account menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="dk-ava">{avatar}</span>
          <span style={{ minWidth: 0 }}>
            <span className="n">{label ?? "Account"}</span>
            {subLabel && <span className="g">{subLabel}</span>}
          </span>
        </button>
        {popover}
      </div>
    );
  }

  return (
    <div className="acct-menu mt-account-menu" ref={rootRef}>
      <button
        type="button"
        className={btnClass}
        aria-label="Account menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {avatar}
      </button>

      {popover}
    </div>
  );
}
