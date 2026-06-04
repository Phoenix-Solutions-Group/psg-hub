"use client";

import { useState } from "react";
import { ShopSwitcher } from "@/components/dashboard/shop-switcher";
import type { UserShop } from "@/lib/shop/context";

type NavItem = { href: string; label: string };

/**
 * Pure presentational panel: the same NAV links as the desktop sidebar plus the
 * <ShopSwitcher> (when the user has >=1 shop). Stateless so its render branches are
 * unit-testable in the node test env (no DOM/Testing-Library dependency).
 */
export function MobileNavPanel({
  nav,
  shops,
  activeShopId,
  onNavigate,
}: {
  nav: NavItem[];
  shops: UserShop[];
  activeShopId: string | null;
  onNavigate?: () => void;
}) {
  return (
    <nav className="fixed inset-x-0 top-16 z-50 border-b border-sidebar-border bg-sidebar text-sidebar-foreground shadow-lg">
      {shops.length > 0 && (
        <div className="border-b border-sidebar-border px-3 py-3">
          <ShopSwitcher shops={shops} activeShopId={activeShopId} />
        </div>
      )}
      <div className="space-y-1 p-3">
        {nav.map((item) => (
          <a
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className="flex items-center rounded-md px-3 py-2 font-heading text-sm font-medium tracking-[0.02em] text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-primary"
          >
            {item.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

/**
 * Mobile-only (`lg:hidden`) disclosure that mirrors the desktop sidebar below the
 * `lg` breakpoint, so an MSO user on a phone can still navigate and switch shops
 * (the sidebar is `lg:flex` only).
 */
export function MobileNav({
  nav,
  shops,
  activeShopId,
}: {
  nav: NavItem[];
  shops: UserShop[];
  activeShopId: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-label="Open navigation menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-ember"
      >
        <svg
          aria-hidden="true"
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        >
          {open ? (
            <>
              <line x1="4" y1="4" x2="16" y2="16" />
              <line x1="16" y1="4" x2="4" y2="16" />
            </>
          ) : (
            <>
              <line x1="3" y1="6" x2="17" y2="6" />
              <line x1="3" y1="10" x2="17" y2="10" />
              <line x1="3" y1="14" x2="17" y2="14" />
            </>
          )}
        </svg>
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close navigation menu"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40"
          />
          <MobileNavPanel
            nav={nav}
            shops={shops}
            activeShopId={activeShopId}
            onNavigate={() => setOpen(false)}
          />
        </>
      )}
    </div>
  );
}
