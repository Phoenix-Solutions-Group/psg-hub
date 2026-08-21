"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Building2,
  CreditCard,
  FileCheck2,
  Search,
  Settings2,
  Star,
  X,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FirstLoginValueState } from "@/lib/bsm/first-login-value";
import type {
  DashboardPortfolio,
  DashboardToolId,
  PortfolioTool,
  ToolLocation,
  ToolStatus,
} from "@/lib/dashboard/tools";

const STATUS: Record<
  ToolStatus,
  {
    label: string;
    variant: "success" | "warning" | "secondary" | "destructive";
  }
> = {
  ready: { label: "Ready", variant: "success" },
  partial: { label: "Partially set up", variant: "warning" },
  setup: { label: "Setup needed", variant: "secondary" },
  upgrade: { label: "Upgrade required", variant: "warning" },
  unavailable: { label: "Status unavailable", variant: "destructive" },
};

const TOOL_ICONS: Record<DashboardToolId, LucideIcon> = {
  content: FileCheck2,
  reviews: Star,
  analytics: BarChart3,
  ads: Search,
};

const focusClass =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function filterToolLocations(locations: ToolLocation[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return locations;
  return locations.filter((location) =>
    (location.name || location.id).toLowerCase().includes(normalized),
  );
}

export function portfolioStatusLabel(tool: PortfolioTool): string {
  if (tool.locations.length === 1) {
    return STATUS[tool.locations[0].status].label;
  }

  const parts: string[] = [];
  if (tool.statusCounts.ready) parts.push(`${tool.statusCounts.ready} ready`);
  if (tool.statusCounts.partial)
    parts.push(`${tool.statusCounts.partial} partial`);
  if (tool.statusCounts.setup)
    parts.push(`${tool.statusCounts.setup} need setup`);
  if (tool.statusCounts.upgrade)
    parts.push(`${tool.statusCounts.upgrade} need upgrade`);
  if (tool.statusCounts.unavailable)
    parts.push(`${tool.statusCounts.unavailable} unavailable`);
  return parts.join(" · ") || "No locations";
}

function roleCanSetUp(location: ToolLocation) {
  return location.role === "owner";
}

function SingleLocationAction({
  tool,
  accent = false,
  inverse = false,
}: {
  tool: PortfolioTool;
  accent?: boolean;
  inverse?: boolean;
}) {
  const location = tool.locations[0];
  if (!location) return null;

  if (location.status === "unavailable") {
    return (
      <span
        className={`text-sm ${inverse ? "text-sidebar-foreground" : "text-muted-foreground"}`}
      >
        Try again later
      </span>
    );
  }
  if (location.status === "upgrade" && location.role !== "owner") {
    return (
      <span
        className={`text-sm ${inverse ? "text-sidebar-foreground" : "text-muted-foreground"}`}
      >
        Owner action required
      </span>
    );
  }
  if (location.status === "setup" && !roleCanSetUp(location)) {
    return (
      <span
        className={`text-sm ${inverse ? "text-sidebar-foreground" : "text-muted-foreground"}`}
      >
        Owner action required
      </span>
    );
  }

  const upgrade = location.status === "upgrade";
  const href = upgrade ? "/dashboard/billing#performance" : location.href;
  return (
    <a
      href={href}
      className={`${focusClass} inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-md px-4 py-2 font-heading text-sm font-medium transition-colors ${
        accent
          ? "bg-ember text-primary-foreground hover:bg-destructive"
          : inverse
            ? "border border-background bg-background text-primary hover:bg-secondary"
            : "bg-primary text-primary-foreground hover:bg-sidebar-accent"
      }`}
    >
      {upgrade
        ? "View upgrade"
        : location.status === "setup"
          ? "Set up"
          : "Open"}
      <ArrowRight aria-hidden="true" className="size-4" />
    </a>
  );
}

function ToolAction({
  tool,
  portfolio,
  onChooseLocation,
  onRequestAccess,
  accent = false,
  inverse = false,
}: {
  tool: PortfolioTool;
  portfolio: DashboardPortfolio;
  onChooseLocation: () => void;
  onRequestAccess: () => void;
  accent?: boolean;
  inverse?: boolean;
}) {
  if (tool.locations.length <= 1) {
    return (
      <SingleLocationAction tool={tool} accent={accent} inverse={inverse} />
    );
  }

  const allUpgrade = tool.statusCounts.upgrade === tool.locations.length;
  if (allUpgrade) {
    return portfolio.canRequestPortfolioAccess ? (
      <button
        type="button"
        onClick={onRequestAccess}
        className={`${focusClass} inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-md px-4 py-2 font-heading text-sm font-medium transition-colors ${
          inverse
            ? "border border-background bg-background text-primary hover:bg-secondary"
            : "bg-primary text-primary-foreground hover:bg-sidebar-accent"
        }`}
      >
        Contact PSG
        <ArrowRight aria-hidden="true" className="size-4" />
      </button>
    ) : (
      <span
        className={`text-sm ${inverse ? "text-sidebar-foreground" : "text-muted-foreground"}`}
      >
        Owner or manager action required
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onChooseLocation}
      className={`${focusClass} inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-md px-4 py-2 font-heading text-sm font-medium transition-colors ${
        accent
          ? "bg-ember text-primary-foreground hover:bg-destructive"
          : inverse
            ? "border border-background bg-background text-primary hover:bg-secondary"
            : "bg-primary text-primary-foreground hover:bg-sidebar-accent"
      }`}
    >
      Choose location
      <ArrowRight aria-hidden="true" className="size-4" />
    </button>
  );
}

function LocationPanel({
  tool,
  canRequestPortfolioAccess,
  onClose,
  onRequestAccess,
}: {
  tool: PortfolioTool;
  canRequestPortfolioAccess: boolean;
  onClose: () => void;
  onRequestAccess: () => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [pendingShop, setPendingShop] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locations = useMemo(
    () => filterToolLocations(tool.locations, query),
    [query, tool.locations],
  );

  useEffect(() => searchRef.current?.focus(), []);

  async function openLocation(location: ToolLocation) {
    setError(null);
    setPendingShop(location.id);
    try {
      const response = await fetch("/api/shop/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shop_id: location.id }),
      });
      if (!response.ok) throw new Error("switch failed");
      window.location.assign(location.href);
    } catch {
      setError("That location could not be opened. Please try again.");
      setPendingShop(null);
    }
  }

  return (
    <section
      aria-labelledby="location-panel-title"
      className="border-y border-border bg-secondary px-4 py-6 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-[70rem]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-foreground">Choose a workspace</p>
            <h2 id="location-panel-title" className="mt-1 text-xl font-bold">
              {tool.name} by location
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close location chooser"
            className={`${focusClass} inline-flex size-11 items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors hover:text-foreground`}
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <label className="mt-6 block max-w-md">
          <span className="mb-2 block font-heading text-sm font-medium">
            Find a location
          </span>
          <span className="relative block">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search locations"
              className={`${focusClass} min-h-11 w-full rounded-md border bg-background py-2 pl-10 pr-3 text-base`}
            />
          </span>
        </label>
        <p className="mt-2 text-sm text-foreground" aria-live="polite">
          {locations.length} of {tool.locations.length} locations
        </p>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-md bg-ember-soft p-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        <ul className="mt-6 divide-y border-y border-border">
          {locations.map((location) => {
            const canSetUp = roleCanSetUp(location);
            const needsPortfolioUpgrade = location.status === "upgrade";
            const restricted = location.status === "setup" && !canSetUp;
            return (
              <li
                key={location.id}
                className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate font-heading font-medium">
                    {location.name || location.id}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge variant={STATUS[location.status].variant}>
                      {STATUS[location.status].label}
                    </Badge>
                    {location.statusDetail && (
                      <span className="text-xs text-foreground">
                        {location.statusDetail}
                      </span>
                    )}
                    {location.attentionCount > 0 && tool.attentionLabel && (
                      <span className="text-xs font-medium text-foreground">
                        {location.attentionCount} {tool.attentionLabel}
                      </span>
                    )}
                  </div>
                </div>
                {needsPortfolioUpgrade ? (
                  canRequestPortfolioAccess ? (
                    <button
                      type="button"
                      onClick={onRequestAccess}
                      className={`${focusClass} min-h-11 rounded-md bg-primary px-4 py-2 font-heading text-sm font-medium text-primary-foreground hover:bg-sidebar-accent`}
                    >
                      Contact PSG
                    </button>
                  ) : (
                    <span className="text-sm text-foreground">
                      Owner or manager action required
                    </span>
                  )
                ) : restricted ? (
                  <span className="text-sm text-foreground">
                    Owner action required
                  </span>
                ) : location.status === "unavailable" ? (
                  <span className="text-sm text-foreground">
                    Try again later
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={pendingShop !== null}
                    onClick={() => openLocation(location)}
                    className={`${focusClass} min-h-11 rounded-md bg-primary px-4 py-2 font-heading text-sm font-medium text-primary-foreground hover:bg-sidebar-accent disabled:opacity-50`}
                  >
                    {pendingShop === location.id
                      ? "Opening…"
                      : location.status === "setup"
                        ? "Set up"
                        : "Open"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function PortfolioAccessPanel({
  tool,
  locationCount,
  onClose,
}: {
  tool: PortfolioTool;
  locationCount: number;
  onClose: () => void;
}) {
  const [state, setState] = useState<"idle" | "pending" | "sent" | "error">(
    "idle",
  );

  async function submit() {
    setState("pending");
    try {
      const response = await fetch("/api/dashboard/portfolio-access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tool: tool.id }),
      });
      setState(response.ok ? "sent" : "error");
    } catch {
      setState("error");
    }
  }

  return (
    <section
      aria-labelledby="portfolio-request-title"
      className="border-y border-border bg-secondary px-4 py-6 sm:px-6 lg:px-8"
    >
      <div className="mx-auto flex max-w-[70rem] flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl">
          <p className="text-sm text-foreground">Portfolio access</p>
          <h2 id="portfolio-request-title" className="mt-1 text-xl font-bold">
            Request {tool.name} for your portfolio
          </h2>
          {state === "sent" ? (
            <p role="status" className="mt-3 text-sm text-foreground">
              Request sent. PSG will follow up about access for your{" "}
              {locationCount} locations.
            </p>
          ) : (
            <>
              <p className="mt-3 text-sm text-foreground">
                PSG will receive your account, visible locations, and
                per-location roles. This request does not change your plan or
                begin checkout.
              </p>
              {state === "error" && (
                <p
                  role="alert"
                  className="mt-3 text-sm font-medium text-destructive"
                >
                  The request could not be sent. Please try again.
                </p>
              )}
              <button
                type="button"
                disabled={state === "pending"}
                onClick={submit}
                className={`${focusClass} mt-4 min-h-11 rounded-md bg-primary px-4 py-2 font-heading text-sm font-medium text-primary-foreground hover:bg-sidebar-accent disabled:opacity-50`}
              >
                {state === "pending" ? "Sending…" : "Send request"}
              </button>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close portfolio request"
          className={`${focusClass} inline-flex size-11 items-center justify-center self-end rounded-md border bg-background text-muted-foreground sm:self-start`}
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
    </section>
  );
}

function FeaturedTool({
  tool,
  portfolio,
  onChooseLocation,
  onRequestAccess,
}: {
  tool: PortfolioTool;
  portfolio: DashboardPortfolio;
  onChooseLocation: () => void;
  onRequestAccess: () => void;
}) {
  const Icon = TOOL_ICONS[tool.id];
  return (
    <article
      data-tool={tool.id}
      className="rounded-md border border-border bg-card p-6 shadow-sm sm:p-8"
    >
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-4">
          <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Icon aria-hidden="true" className="size-5" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-xl font-bold">{tool.name}</h3>
              {tool.attentionCount > 0 && tool.attentionLabel && (
                <Badge variant="secondary">
                  {tool.attentionCount} {tool.attentionLabel}
                </Badge>
              )}
            </div>
            <p className="mt-2 max-w-xl text-base leading-7 text-muted-foreground">
              {tool.description}
            </p>
          </div>
        </div>
        <ToolAction
          tool={tool}
          portfolio={portfolio}
          onChooseLocation={onChooseLocation}
          onRequestAccess={onRequestAccess}
          accent
        />
      </div>
      <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4 text-sm">
        <span className="font-heading font-medium">
          {portfolioStatusLabel(tool)}
        </span>
        {tool.locations.length > 1 && (
          <span className="text-muted-foreground">
            Across {tool.locations.length} visible locations
          </span>
        )}
      </div>
    </article>
  );
}

function ToolRow({
  tool,
  portfolio,
  onChooseLocation,
  onRequestAccess,
}: {
  tool: PortfolioTool;
  portfolio: DashboardPortfolio;
  onChooseLocation: () => void;
  onRequestAccess: () => void;
}) {
  const Icon = TOOL_ICONS[tool.id];
  return (
    <article
      data-tool={tool.id}
      className="grid gap-4 border-b border-border py-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
    >
      <div className="flex min-w-0 gap-4">
        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-md border bg-secondary text-primary">
          <Icon aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0">
          <h3 className="font-heading text-base font-medium">{tool.name}</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {tool.description}
          </p>
          <p className="mt-2 text-sm font-medium">
            {portfolioStatusLabel(tool)}
          </p>
        </div>
      </div>
      <ToolAction
        tool={tool}
        portfolio={portfolio}
        onChooseLocation={onChooseLocation}
        onRequestAccess={onRequestAccess}
      />
    </article>
  );
}

function UpgradeTool({
  tool,
  portfolio,
  onChooseLocation,
  onRequestAccess,
}: {
  tool: PortfolioTool;
  portfolio: DashboardPortfolio;
  onChooseLocation: () => void;
  onRequestAccess: () => void;
}) {
  const Icon = TOOL_ICONS[tool.id];
  return (
    <aside
      data-tool={tool.id}
      className="self-start rounded-md border border-primary bg-primary p-6 text-primary-foreground shadow-sm xl:sticky xl:top-6"
    >
      <span className="inline-flex size-11 items-center justify-center rounded-md border border-sidebar-border text-primary-foreground">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <p className="mt-6 text-sm text-sidebar-foreground">Growth opportunity</p>
      <h3 className="mt-2 text-xl font-bold text-primary-foreground">
        {tool.name}
      </h3>
      <p className="mt-2 text-sm leading-6 text-sidebar-foreground">
        {tool.description}
      </p>
      <p className="mt-6 border-t border-sidebar-border pt-4 text-sm font-medium">
        {portfolioStatusLabel(tool)}
      </p>
      <div className="mt-6">
        <ToolAction
          tool={tool}
          portfolio={portfolio}
          onChooseLocation={onChooseLocation}
          onRequestAccess={onRequestAccess}
          inverse
        />
      </div>
    </aside>
  );
}

export function ToolDashboard({
  portfolio,
  firstName,
  firstLoginValue,
}: {
  portfolio: DashboardPortfolio;
  firstName: string;
  firstLoginValue?: FirstLoginValueState | null;
}) {
  const [openToolId, setOpenToolId] = useState<DashboardToolId | null>(null);
  const [requestToolId, setRequestToolId] = useState<DashboardToolId | null>(
    null,
  );
  const featuredTool = portfolio.tools.find((tool) => tool.id === "content");
  const upgradeTool = portfolio.tools.find((tool) => tool.id === "ads");
  const secondaryTools = portfolio.tools.filter(
    (tool) => tool.id !== featuredTool?.id && tool.id !== upgradeTool?.id,
  );
  const openTool = portfolio.tools.find((tool) => tool.id === openToolId);
  const requestTool = portfolio.tools.find((tool) => tool.id === requestToolId);
  const attentionCount = portfolio.tools.reduce(
    (total, tool) => total + tool.attentionCount,
    0,
  );
  const locationLabel = `${portfolio.shops.length} visible ${
    portfolio.shops.length === 1 ? "location" : "locations"
  }`;

  function chooseLocation(toolId: DashboardToolId) {
    setRequestToolId(null);
    setOpenToolId(toolId);
  }

  function requestAccess(toolId: DashboardToolId) {
    setOpenToolId(null);
    setRequestToolId(toolId);
  }

  return (
    <div className="-m-6 bg-background text-foreground">
      <header className="border-b border-border bg-background px-4 py-8 sm:px-8 lg:px-12">
        <div className="mx-auto grid max-w-[70rem] gap-8 lg:grid-cols-[minmax(0,8fr)_minmax(15rem,4fr)] lg:items-end">
          <div>
            <h1 className="max-w-2xl text-3xl font-bold tracking-[-0.02em] text-primary sm:text-4xl">
              Your PSG tools
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              Welcome back, {firstName}.{" "}
              {attentionCount > 0
                ? `Across ${locationLabel}, ${attentionCount} ${
                    attentionCount === 1 ? "item is" : "items are"
                  } waiting for your review.`
                : `Everything currently available across ${locationLabel} starts here.`}
            </p>
          </div>
          <div className="border-t border-border pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
            <p className="font-heading text-sm font-bold text-primary">
              Portfolio view
            </p>
            <p className="mt-2 font-heading text-lg font-bold">
              {locationLabel}
            </p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Availability reflects each shop&apos;s plan, setup, and reporting
              data.
            </p>
          </div>
        </div>
      </header>

      <main>
        {firstLoginValue && (
          <section className="mx-auto max-w-[70rem] px-4 pt-8 sm:px-8 lg:px-12">
            <Card>
              <CardHeader>
                <p className="font-heading text-xs font-medium uppercase tracking-[0.18em] text-ember">
                  {firstLoginValue.eyebrow}
                </p>
                <CardTitle>{firstLoginValue.title}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                  {firstLoginValue.detail}
                </p>
                <Link
                  className={buttonVariants()}
                  href={firstLoginValue.nextStepHref}
                >
                  {firstLoginValue.nextStepLabel}
                </Link>
              </CardContent>
            </Card>
          </section>
        )}
        <section
          aria-labelledby="tools-heading"
          className="mx-auto grid max-w-[70rem] gap-12 px-4 py-12 sm:px-8 lg:px-12 lg:py-16 xl:grid-cols-[minmax(0,8fr)_minmax(18rem,4fr)]"
        >
          <div>
            <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2
                  id="tools-heading"
                  className="text-2xl font-bold tracking-[-0.01em]"
                >
                  Your services
                </h2>
              </div>
              <p className="max-w-xs text-sm text-muted-foreground">
                Open a tool, finish setup, or choose a location.
              </p>
            </div>

            {featuredTool && (
              <FeaturedTool
                tool={featuredTool}
                portfolio={portfolio}
                onChooseLocation={() => chooseLocation(featuredTool.id)}
                onRequestAccess={() => requestAccess(featuredTool.id)}
              />
            )}

            <div className="mt-3 border-t border-border">
              {secondaryTools.map((tool) => (
                <ToolRow
                  key={tool.id}
                  tool={tool}
                  portfolio={portfolio}
                  onChooseLocation={() => chooseLocation(tool.id)}
                  onRequestAccess={() => requestAccess(tool.id)}
                />
              ))}
            </div>
          </div>

          {upgradeTool && (
            <UpgradeTool
              tool={upgradeTool}
              portfolio={portfolio}
              onChooseLocation={() => chooseLocation(upgradeTool.id)}
              onRequestAccess={() => requestAccess(upgradeTool.id)}
            />
          )}
        </section>

        {openTool && (
          <LocationPanel
            key={openTool.id}
            tool={openTool}
            canRequestPortfolioAccess={portfolio.canRequestPortfolioAccess}
            onClose={() => setOpenToolId(null)}
            onRequestAccess={() => requestAccess(openTool.id)}
          />
        )}
        {requestTool && (
          <PortfolioAccessPanel
            key={requestTool.id}
            tool={requestTool}
            locationCount={portfolio.shops.length}
            onClose={() => setRequestToolId(null)}
          />
        )}

        <section
          aria-labelledby="account-heading"
          className="mx-auto max-w-[70rem] px-4 pb-16 sm:px-8 lg:px-12"
        >
          <div className="border-t border-border pt-8">
            <h2
              id="account-heading"
              className="font-heading text-sm font-bold text-primary"
            >
              Account
            </h2>
            <div className="mt-3 flex flex-col gap-1 sm:flex-row sm:gap-8">
              <a
                href="/dashboard/billing"
                className={`${focusClass} inline-flex min-h-11 items-center gap-3 rounded-md px-2 font-heading text-sm font-medium text-primary transition-colors hover:bg-secondary`}
              >
                <CreditCard aria-hidden="true" className="size-4" />
                Plan &amp; Billing
                <ArrowRight aria-hidden="true" className="size-4" />
              </a>
              <a
                href="/dashboard/settings"
                className={`${focusClass} inline-flex min-h-11 items-center gap-3 rounded-md px-2 font-heading text-sm font-medium text-primary transition-colors hover:bg-secondary`}
              >
                <Settings2 aria-hidden="true" className="size-4" />
                Shop Settings
                <ArrowRight aria-hidden="true" className="size-4" />
              </a>
              <span className="inline-flex min-h-11 items-center gap-3 px-2 text-sm text-muted-foreground">
                <Building2 aria-hidden="true" className="size-4" />
                {locationLabel}
              </span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
