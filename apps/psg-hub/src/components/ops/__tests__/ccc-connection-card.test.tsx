import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CccConnectionCard } from "@/components/ops/ccc-connection-card";
import { CccDataScopePanel } from "@/components/ops/ccc-data-scope-panel";
import {
  CCC_ONE_EXPORT_SCOPE,
  CTA_LABELS,
  type CccDataScope,
} from "@/lib/ccc/connection-state";
import { CCC_CONNECTION_FIXTURES, FIXTURE_NOW } from "@/lib/ccc/fixtures";

const render = (status: keyof typeof CCC_CONNECTION_FIXTURES) =>
  renderToStaticMarkup(
    <CccConnectionCard view={CCC_CONNECTION_FIXTURES[status]} now={FIXTURE_NOW} />,
  );

describe("CccConnectionCard — state matrix (spec §2 / §4 A″)", () => {
  it("renders the CCC Secure Share title in every state", () => {
    for (const status of Object.keys(CCC_CONNECTION_FIXTURES) as Array<
      keyof typeof CCC_CONNECTION_FIXTURES
    >) {
      expect(render(status)).toContain("CCC Secure Share");
    }
  });

  it("not_connected: status label + 'Get connection steps' CTA + scope teaser", () => {
    const html = render("not_connected");
    expect(html).toContain("Not connected");
    expect(html).toContain(CTA_LABELS.get_steps);
    expect(html).toContain("What we"); // "What we'll receive ▸"
    // No other state's primary CTA leaks in.
    expect(html).not.toContain(CTA_LABELS.disconnect);
    expect(html).not.toContain(CTA_LABELS.reconnect);
  });

  it("pending_review: 'Waiting on PSG' + enabled-on line + cancel CTA, no approve/disconnect", () => {
    const html = render("pending_review");
    expect(html).toContain("Waiting on PSG");
    expect(html).toContain("Enabled in CCC on");
    expect(html).toContain(CTA_LABELS.cancel_request);
    expect(html).not.toContain(CTA_LABELS.disconnect);
  });

  it("connected: 'Connected' + 'Last update: Workfile saved · 3 min ago' + view scope + disconnect", () => {
    const html = render("connected");
    expect(html).toContain("Connected");
    // P2#5: "Last update:" (friendlier than "Last event:"), PSG-275 designer pass.
    expect(html).toContain("Last update:");
    expect(html).not.toContain("Last event:");
    expect(html).toContain("Workfile saved · 3 min ago");
    // P2#3: shop-facing copy says "repair orders", never system "events" (PSG-275).
    expect(html).toContain("repair orders");
    expect(html).not.toContain("receiving events");
    expect(html).toContain(CTA_LABELS.view_scope);
    expect(html).toContain(CTA_LABELS.disconnect);
  });

  it("error: 'Connection error' + derived human hint + reconnect + view scope", () => {
    const html = render("error");
    expect(html).toContain("Connection error");
    expect(html).toContain("CCC authorization expired"); // derived from errorReason=auth_expired
    // P2#3: "repair orders" not "events" in the error summary too (PSG-275).
    expect(html).toContain("repair orders");
    expect(html).not.toContain("receiving events");
    expect(html).toContain(CTA_LABELS.reconnect);
    expect(html).toContain(CTA_LABELS.view_scope);
  });

  it("declined: 'Declined' + the PSG reason + 'Request again' CTA + neutral (non-error) badge", () => {
    const html = render("declined");
    expect(html).toContain("Declined");
    expect(html).toContain("could not be matched");
    expect(html).toContain(CTA_LABELS.request_again);
    // P3#6: declined is a recoverable PSG decision, not a system failure → neutral
    // `secondary` badge, not the destructive(red) one `error` uses (PSG-275).
    expect(html).toContain("bg-secondary");
    expect(html).not.toContain("bg-destructive/10");
  });

  it("declined with no reason → graceful fallback line", () => {
    const html = renderToStaticMarkup(
      <CccConnectionCard
        view={{ ...CCC_CONNECTION_FIXTURES.declined, declinedReason: "  " }}
        now={FIXTURE_NOW}
      />,
    );
    expect(html).toContain("No reason was provided.");
  });

  it("connected with no events yet → omits the 'Last event' line entirely", () => {
    const html = renderToStaticMarkup(
      <CccConnectionCard
        view={{
          ...CCC_CONNECTION_FIXTURES.connected,
          lastEventLabel: null,
          lastEventAt: null,
        }}
        now={FIXTURE_NOW}
      />,
    );
    expect(html).not.toContain("Last update:");
  });

  it("collapsed by default: step list and scope panel are not in the initial markup", () => {
    const html = render("not_connected");
    expect(html).not.toContain("Total Repair Platform"); // step list copy
    expect(html).not.toContain("What BSM receives from your CCC ONE"); // scope panel header
  });
});

describe("CccDataScopePanel — data-driven (spec §4 C / surface C)", () => {
  it("renders the documented CCC ONE export scope from the prop (not hardcoded)", () => {
    const html = renderToStaticMarkup(
      <CccDataScopePanel dataScope={CCC_ONE_EXPORT_SCOPE} />,
    );
    expect(html).toContain("What BSM receives from your CCC ONE");
    expect(html).toContain("Customer name &amp; mailing address");
    expect(html).toContain("to send mail");
    expect(html).toContain("Repair $ amount");
    expect(html).toContain("We never receive:");
    expect(html).toContain("banking data");
    expect(html).toContain("encrypted in transit");
  });

  it("softens optional fields per the contract (P3#7): muted+italic for optional, foreground otherwise", () => {
    const html = renderToStaticMarkup(
      <CccDataScopePanel
        dataScope={{
          summary: "Mix of required and optional.",
          received: [
            { label: "Required field" },
            { label: "Optional field", optional: true },
          ],
          excluded: [],
        }}
      />,
    );
    // The optional flag now drives presentation (italic), not just note text.
    expect(html).toContain("italic");
    // The optional label carries the muted/italic class; the required one stays foreground.
    expect(html).toMatch(/text-muted-foreground italic[^>]*>\s*Optional field/);
    expect(html).toMatch(/text-foreground[^>]*>\s*Required field/);
  });

  it("is fully prop-driven: a different scope renders different content", () => {
    const custom: CccDataScope = {
      summary: "Custom grant summary.",
      received: [{ label: "Only VINs", note: "decode only" }],
      excluded: ["everything else"],
    };
    const html = renderToStaticMarkup(<CccDataScopePanel dataScope={custom} />);
    expect(html).toContain("Custom grant summary.");
    expect(html).toContain("Only VINs");
    expect(html).toContain("everything else");
    // None of the fixture's fields bleed through.
    expect(html).not.toContain("Repair $ amount");
  });

  it("omits the exclusions line and assurance when not provided", () => {
    const minimal: CccDataScope = {
      summary: "Minimal.",
      received: [{ label: "Name" }],
      excluded: [],
    };
    const html = renderToStaticMarkup(<CccDataScopePanel dataScope={minimal} />);
    expect(html).not.toContain("We never receive:");
    expect(html).not.toContain("encrypted in transit");
  });
});
