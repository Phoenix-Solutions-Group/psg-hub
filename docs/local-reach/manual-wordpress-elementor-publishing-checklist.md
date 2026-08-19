# Local Reach Manual WordPress/Elementor Publishing Checklist

Issue: PSG-2044  
Date: 2026-07-17  
Owner: Ada  
Status: Pilot operations checklist

## Bottom Line

Use this checklist when PSG manually publishes an approved Local Reach recommendation to a customer's WordPress/Elementor site.

Manual publishing is the pilot path. It keeps customer websites safe while Local Reach proves that its recommendations, evidence, and approval workflow are reliable. Do not automate WordPress, Elementor, SendTIO, or Astro publishing from this checklist.

## When To Use This

Use this checklist only when all of these are true:

- The Local Reach recommendation exists in Body Shop Marketer (BSM).
- The draft passed BSM's claim check, meaning the system found support for the claims in the draft.
- The customer or authorized PSG approver approved the exact content in BSM.
- The target site is WordPress with Elementor, or WordPress content can be edited without breaking the Elementor layout.
- PSG has a safe way to access the customer's WordPress admin account for this job.

Stop and escalate to Nick if:

- The change is public or customer-facing and Nick has not approved the deliverable when required by PSG review policy.
- The customer approval is missing, unclear, or does not match the content being published.
- The operator needs a WordPress password, plugin license, hosting login, domain access, or another vendor-console action that agents cannot safely perform.
- Publishing would require changing site structure, theme files, plugins, tracking scripts, redirects, DNS, or forms.
- The live preview looks broken or the operator cannot confidently undo the change.

## Inputs Required Before Publishing

Record these values in the Local Reach publish log before opening WordPress:

| Field | Required value |
| --- | --- |
| Customer/shop | Customer name and BSM shop id if available |
| Recommendation | Local Reach recommendation id or title |
| Approval record | BSM approval item id or direct approval link |
| Approved content | Final approved copy, headings, calls to action, and notes |
| Evidence | Source links that support factual claims |
| Target page | Existing page URL or proposed new page path |
| Publish type | New page, update existing page, blog post, service page, location page, or FAQ update |
| SEO fields | Meta title, meta description, and slug if approved |
| Schema fields | Approved structured data, if required for the page type |
| Images | Approved image files, alt text, and source/usage rights |
| Rollback note | What to restore if the publish fails |

Do not publish if any required input is missing.

## Pre-Publish Safety Check

1. Confirm the site URL and WordPress admin URL.
2. Confirm the operator is using the correct customer account.
3. Confirm the page being edited is the intended page.
4. Confirm the content in hand exactly matches the approved BSM version.
5. Confirm every factual claim is supported by the evidence links or verified customer facts.
6. Confirm no competitor content has been copied.
7. Confirm no personal data from reviews, forums, or private customer records is being added.
8. Confirm images are approved for this customer's website.
9. Confirm the current page can be restored:
   - For an existing page, note the last revision date/time in WordPress.
   - If possible, duplicate the page or save a draft before editing.
10. Confirm the change does not require a new public URL to go live without Nick/customer approval.

## WordPress/Elementor Publishing Steps

### Existing Elementor Page

1. Log in to WordPress admin.
2. Go to `Pages`.
3. Find the approved target page.
4. Open `Edit with Elementor`.
5. Wait for Elementor to fully load before changing content.
6. Update only the approved sections.
7. Keep the page's existing design structure unless the approval explicitly covers layout changes.
8. Paste text as plain text first, then apply the page's existing heading, paragraph, button, and list styles.
9. Replace images only with approved images and approved alt text.
10. Check mobile and desktop previews in Elementor.
11. Click `Preview Changes`.
12. Review the preview against the final QA checklist below.
13. If clean, click `Update`.
14. Open the live page in a private browser window and confirm the public page updated correctly.

### New Elementor Page

1. Log in to WordPress admin.
2. Go to `Pages`.
3. Create a new draft page with the approved title.
4. Set the approved URL slug.
5. If the site has a matching page template, duplicate that template or use the site's existing Elementor template.
6. Add the approved content without changing global site styles.
7. Add approved images and alt text.
8. Set SEO fields if the site has an SEO plugin.
9. Save as draft.
10. Preview on desktop and mobile.
11. If this is customer-facing and not already approved for public launch, stop here and route for Nick/customer review.
12. If public launch is approved, publish.
13. Open the live URL in a private browser window and confirm the page is public and correct.

### Standard WordPress Post Or Page Editor

Use this path only when the content is not controlled by Elementor.

1. Log in to WordPress admin.
2. Open the approved post or page.
3. Save a draft or confirm revision history is available.
4. Paste the approved content into the editor.
5. Apply the site's existing heading and list styles.
6. Add approved images and alt text.
7. Set the approved slug, category, tags, and featured image if needed.
8. Set SEO fields if the site has an SEO plugin.
9. Preview the page.
10. If clean and approved for public launch, publish or update.
11. Open the live URL in a private browser window and confirm the page is public and correct.

## SEO And Schema Checklist

Only add fields that were approved in the BSM record.

- Meta title fits the site's SEO plugin limits and names the shop/service accurately.
- Meta description is plain language, accurate, and not stuffed with keywords.
- URL slug is short, readable, and matches the approved target path.
- Internal links point to live pages on the same customer site.
- External links, if any, are approved and open correctly.
- LocalBusiness, FAQ, Service, or Article schema is added only when the page content supports it.
- Schema does not claim certifications, locations, guarantees, hours, services, or ratings that are not verified.
- No hidden text, doorway-page pattern, copied competitor copy, or misleading location claim is added.

## Final QA Checklist

Check the live page after publishing:

- The live URL loads without an error.
- The page title and visible headings match the approved content.
- Body copy matches the approved content, except for harmless formatting differences.
- Phone numbers, addresses, hours, service names, and certifications are accurate.
- Buttons and forms still work.
- Images load and have approved alt text.
- Desktop layout is not broken.
- Mobile layout is not broken.
- The page does not show draft notes, internal comments, copied source text, or placeholders.
- The SEO title and description are present when the site has an SEO plugin.
- Schema validates enough for pilot use if schema was added.
- The page does not introduce unapproved claims, unsafe guarantees, or unsupported statements.

If any check fails, do not mark the item published. Restore the previous version or leave the page in draft, then record the failure and next action.

## Record Back In BSM

After a clean publish, record:

- Final live URL.
- Date and time published.
- Publisher name.
- WordPress page/post id if visible.
- Approval record used.
- Short summary of what changed.
- Screenshot or preview evidence if the workflow supports it.
- Final QA result.
- Any follow-up needed.

The Local Reach recommendation status should move to `published` only after the live page passes the final QA checklist.

## Rollback Procedure

Use rollback if the live page is wrong, broken, or unapproved content went public.

1. Return to the WordPress page/post.
2. Restore the previous revision, duplicated backup, or draft version.
3. Confirm the live URL shows the previous safe content.
4. Record the rollback in BSM with:
   - what was rolled back
   - why it was rolled back
   - who performed the rollback
   - live URL after rollback
   - next owner and action
5. If customer-visible incorrect content was live, notify Ada and create a customer-facing review task before trying again.

## Operator Subtask Template

Use this when a human operator must perform the WordPress/Elementor publish because credentials or customer-site access are required.

```markdown
## Operator action: Publish approved Local Reach content in WordPress/Elementor

**Goal:** Publish one customer-approved website update for Local Reach and record the live result back in Body Shop Marketer.
**Estimated time:** 20-40 minutes.
**You'll need:** WordPress admin access for <customer site> and the approved BSM content record.

### Steps
1. Open the approved BSM content record: <approval link>.
2. Confirm the approved target page is: <target URL or page name>.
3. Log in to WordPress: <admin URL>.
4. Open the target page and edit with Elementor.
5. Save a draft or confirm page revision history is available.
6. Apply only the approved content from BSM.
7. Preview desktop and mobile.
8. If the preview matches the approved content and looks correct, publish/update the page.
9. Open the live page in a private browser window.
10. Run the final QA checklist from `docs/local-reach/manual-wordpress-elementor-publishing-checklist.md`.

### Verify
- The live URL loads.
- The approved content is visible.
- The page layout is not broken on desktop or mobile.
- No unapproved claims or placeholder text are visible.

### When done
- Paste the live URL, publish time, and final QA result back into the parent issue.

### If something looks wrong
- Do not publish. If already published, restore the previous page revision and report what failed.
```

## Governance Notes

- Relevant PSG policies: Board Communication Standard, Board Escalation & Review Standard, Operator Task Protocol, and Graphify code-navigation rule.
- Manual WordPress/Elementor publishing is a controlled pilot step, not a product automation feature.
- Any future automated publishing must require a separate task, customer approval gate, credential storage review, and security review before implementation.

## Sources Checked

- `Reference.md`
- `docs/runbooks/graphify-codebase-graph.md`
- `docs/runbooks/operator-task-protocol.md`
- `docs/local-reach/technical-feasibility.md`
- `apps/psg-ads-mutations/ops/wallace/GTM-SETUP.md`
- WordPress revisions documentation: https://wordpress.org/documentation/article/revisions/
- WordPress post/page preview and publish support: https://wordpress.com/support/posts/
- Elementor preview and publish documentation: https://elementor.com/help/preview-publish-your-page/
- Elementor revision history documentation: https://elementor.com/help/revision-history-undo-and-redo/
- Elementor changes-not-live troubleshooting: https://elementor.com/help/changes-dont-appear-online/

The PSG knowledge-base environment variables were present, but no gbrain MCP resource was available in this runtime. No knowledge-base-only claim is used in this checklist.
