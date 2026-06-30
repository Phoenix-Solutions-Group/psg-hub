import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { InboundLeadForm } from "@/components/leads/inbound-lead-form";

// Static-render smoke test (node env, no jsdom): asserts the form's initial
// (idle) markup. Interactive submit / first-touch persistence run in the browser
// and are covered by the pure first-touch tests + PSG-501 E2E. This guards the
// JSX shape and the security-relevant honeypot wiring.
describe("InboundLeadForm static markup", () => {
  const html = renderToStaticMarkup(<InboundLeadForm />);

  it("renders the visible contact fields", () => {
    expect(html).toContain('id="shopName"');
    expect(html).toContain('id="contactName"');
    expect(html).toContain('id="email"');
    expect(html).toContain('id="phone"');
    expect(html).toContain('id="message"');
  });

  it("renders the honeypot field hidden from humans (aria-hidden, off-screen, untabbable)", () => {
    expect(html).toContain('name="company_website"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("-left-[9999px]");
    // tabIndex -1 keeps real users from ever reaching the trap field.
    expect(html).toContain('tabindex="-1"');
  });

  it("renders the submit button in its idle label", () => {
    expect(html).toContain("Request a demo");
  });
});
