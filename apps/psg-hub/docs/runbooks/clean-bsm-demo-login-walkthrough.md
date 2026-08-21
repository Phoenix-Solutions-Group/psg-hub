# Clean BSM Demo Login Walkthrough

This walkthrough replaces the old board demo with one simple story: PSG creates a demo customer account, then that customer signs in and uses the Body Shop Marketer portal.

## Demo Accounts

Use only these two roles in the demo:

| Role | Purpose | E2E storage state |
| --- | --- | --- |
| BSM demo admin | PSG operator who creates and manages the demo account | `e2e/.auth/ops-staff.json` |
| BSM demo user | Body shop customer who signs in and uses the portal | `e2e/.auth/owner.json` |

Do not introduce extra demo customers, multi-shop accounts, or large-shop examples into the board walkthrough. Those still exist only as regression fixtures for coverage.

## Admin Walkthrough

1. Sign in as the BSM demo admin.
2. Open `/ops`.
3. Confirm the admin can reach Companies, Production, Content Approvals, and Superadmin.
4. Open `/ops/admin/users`.
5. Confirm the admin can invite users, assign shops, save roles, and save tiers.
6. Confirm the page shows the BSM demo admin account.
7. Open `/ops/bsm-content-approvals`.
8. Confirm the admin can pick a shop, create a review title, and see the review library.

The matching automated check is `e2e/superadmin-walkthrough.spec.ts`.

## Demo User Walkthrough

1. Sign in as the BSM demo user.
2. Open `/dashboard`.
3. Confirm the user sees the customer navigation: Analytics, Billing, and Invoices.
4. Open `/dashboard/analytics` and confirm the shop dashboard is visible.
5. Open `/dashboard/settings` and confirm the active shop is `BSM Demo Collision Center`.
6. Open `/dashboard/content` and confirm the reviewable content item opens.
7. Open `/dashboard/ads` and confirm the user can request an ad change.
8. Open `/dashboard/billing` and `/dashboard/invoices`.
9. Open `/dashboard/approvals` and complete the content review loop: comment, request updates, approve, decline, and request restore.
10. Open `/dashboard/reviews` and confirm the review and sentiment view render.

The matching automated check is `e2e/focused-bsm-walkthrough.spec.ts`.

## Approval Gate

Before this becomes the public/customer-facing demo, Nick must approve one board walkthrough using the two roles above. Keep screenshots and demo links private until that approval is recorded.
