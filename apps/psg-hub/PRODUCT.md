# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

PSG Hub has two co-primary audiences that share one operational system through different permissions.

**Collision repair shop owners, managers, and authorized staff** use PSG services across one or many locations. They often arrive between operational interruptions and need to see what is available, what needs attention, and where to go next without learning PSG's internal structure. Their access and actions vary by shop membership, per-shop role, plan, setup, and connected data.

**PSG internal operators and superadmins** use the Hub as the single operational center for PSG. Their job spans all three of these areas:

- Service operations: support customer accounts across shops, monitor service readiness, and move work through PSG workflows.
- Content operations: create, route, review, and publish customer-facing work across accounts.
- Platform administration: manage companies, access, billing, integrations, security, and operational configuration.

Global PSG roles and per-shop customer roles are separate authorization axes. Staff may require cross-account access without a shop membership; customer users remain constrained to authorized shops and actions.

## Product Purpose

PSG Hub unifies the customer workspace and PSG's internal operations in one role-aware, location-aware system. Customers use it to discover and act on PSG services. PSG staff use it to deliver, support, govern, and administer those services across accounts.

The product succeeds when the right person can understand the current state, see the next useful action, and complete or route work without switching among disconnected portals, spreadsheets, reports, and internal tools. Customer clarity and operator control should come from the same underlying account, location, role, status, and service context.

## Positioning

PSG Hub is the **single operational control desk for PSG services**. It is not merely a marketing dashboard, billing portal, content queue, or internal admin console.

Its meaningfully different mechanism is the connection between customer-facing decisions and PSG execution. Content approvals, reputation, analytics, advertising, billing, integrations, access, and administration share the same customer, shop, portfolio, role, and service-readiness context. Each audience sees the tools and actions appropriate to its authority without creating a second operational source of truth.

## Operating Context

Customer users may manage one shop or a multi-shop portfolio. Availability can differ by location because of subscription tier, service setup, connected data sources, reporting health, and the user's role. The landing experience must summarize portfolio state before asking the user to choose a location.

PSG staff work across customer accounts and operational functions. The Hub must support service delivery, content flow, and platform administration as parts of one operating system while keeping cross-account and elevated actions capability-gated and auditable.

Workflows include review and approval, prepared-response handling, marketing and website performance reporting, Google integrations, advertising management, plan and billing administration, shop settings, onboarding, access requests, and future operational modules. Some capabilities are intentionally staged; a planned or visible surface is not evidence that its backing workflow is active.

The Hub is used in both routine and high-consequence contexts. Sending, publishing, spending, billing activation, cross-account access, and production mutation require explicit authority and must not be implied by a navigation link, UI state, test result, or deployment view.

## Capabilities and Constraints

- The product is a responsive authenticated web application built with Next.js and Supabase-backed identity, data, and row-level security.
- Global application roles are `customer`, `psg_internal`, and `psg_superadmin`.
- Customer shop roles such as owner, manager, and viewer are separate from global application roles and determine per-location actions.
- Internal access is capability-gated through security profiles; superadmin authority is broader but still explicit.
- The current customer tool catalog includes Content Approvals, Reviews & Reputation, Marketing Analytics, and Google Ads.
- Plan & Billing and Shop Settings are account utilities, not customer services.
- Customer tool availability must state whether a location is ready, partially set up, needs setup, requires an upgrade, or is temporarily unavailable.
- Multi-location actions must expose the relevant location and role before navigation or mutation.
- Customer users without a shop membership receive onboarding rather than an empty or unauthorized dashboard.
- Internal-only tools and workflows must not appear in the customer landing experience.
- Planned modules must use honest coming-soon or unavailable states and must never query or claim backing systems that do not yet exist.
- Live data, financial actions, outbound sends, publishing, advertising spend, production changes, and destructive administration retain separate authorization and activation gates.
- The Hub must preserve tenant isolation, least privilege, server-side authorization, and auditable state transitions as its operational scope expands.

## Brand Commitments

The product is **PSG Hub**, operated by **Phoenix Solutions Group**.

The official [Phoenix Solutions Group design system](https://github.com/Phoenix-Solutions-Group/design-system) is the binding source for brand assets, logos, typography, colors, and identity rules. Official logo files must be used without recreation, distortion, recoloring, cropping, or appended wording.

The product voice is expert, grounded, responsive, and quietly confident. It should sound like an experienced collision-industry partner: direct about status, specific about responsibility, and free of hype. Use plain outcome-oriented descriptions, honest availability language, and calm error and recovery copy.

`DESIGN.md` owns the visual system and interface rules. This product record owns audience, purpose, operating model, capabilities, constraints, and durable brand commitments.

## Evidence on Hand

The following evidence may support future product and design work:

- Implemented application routes, authorization logic, data contracts, and tests in this repository.
- The customer tool catalog and per-location availability model in `src/lib/dashboard/tools.ts`.
- The role and shop-access model in `src/lib/auth/shop-access.ts` and `src/lib/shop/context.ts`.
- Dashboard component and browser coverage in `src/components/dashboard/__tests__/tool-dashboard.test.tsx` and `e2e/dashboard-tools.spec.ts`.
- The current dashboard reference screenshot in `e2e/screenshots/dashboard-tools-desktop.png`.
- The PSG Hub visual contract in `DESIGN.md` and `.impeccable/design.json`.
- Official PSG brand assets and guidance in the public PSG design-system repository.
- Project plans, completed milestone records, and explicit activation boundaries under `.paul/`.

No customer testimonial, performance benchmark, savings claim, adoption claim, or business result is approved by this record. Future work must use only verified assets and observed evidence and must not fabricate customer proof.

## Product Principles

1. **One operational center.** Customer service use, PSG delivery, content operations, and platform administration belong to one connected product—not parallel portals with conflicting state.
2. **Lead with the next useful action.** Prioritize what the current user can and should do now, not the platform's internal feature inventory.
3. **Make context and authority explicit.** Account, location, role, plan, setup, data health, and action authority must be clear before navigation or mutation.
4. **Represent operational truth.** Distinguish planned, configured, tested, deployed, active, and authorized states. Never turn partial evidence into a completion or availability claim.
5. **Share truth, separate permissions.** Customers and PSG staff should work from the same service state while seeing only the controls and data their roles permit.

## Accessibility & Inclusion

Meet WCAG 2.2 AA for contrast, keyboard access, focus visibility, semantics, target sizes, and error identification. Do not rely on color alone for status. Respect reduced-motion preferences and support text zoom, narrow mobile layouts, and keyboard-only operation without losing information or actions.

Use clear language for roles, access restrictions, setup requirements, unavailable data, and recovery paths. A user should never need platform knowledge to understand why an action is unavailable or who can resolve it.
