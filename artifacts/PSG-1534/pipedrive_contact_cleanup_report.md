# PSG-1534 Pipedrive Contact Cleanup Dry Run

Generated: 2026-07-15T16:35:00.819Z

## Bottom Line

This is a dry-run report only. It read Pipedrive organizations and PSG-owned Supabase shop data, then produced proposed fills for blank address, phone, and website fields. No Pipedrive records were modified.

## Counts

| Metric | Count |
| --- | ---: |
| Pipedrive organizations read | 2492 |
| Supabase body shop directory rows read | 36285 |
| Internal company rows read | 4 |
| Organizations missing address | 171 |
| Organizations missing phone | 230 |
| Organizations missing website | 1028 |
| Matched organizations | 1200 |
| Unmatched organizations | 1292 |
| Safe proposed fills | 1 |
| Review proposed fills | 87 |
| Name differences held for review | 437 |
| Existing conflicts for review | 244 |

## Match Rules

- Proposed update: one unique source match by exact 10-digit phone, exact normalized name plus verified postal ZIP, or exact normalized name plus street key, and the Pipedrive shop name must exactly match the source shop name after trimming extra spaces.
- Name review: any Pipedrive/source shop-name difference, including punctuation, spacing, suffix, or word-boundary differences. These are held even when phone, ZIP, or normalized name evidence looks strong.
- Review: one unique source match by exact normalized name plus state, or exact normalized name only.
- Conflict: more than one possible source match, weak name evidence on a phone match, unverified postal evidence, or Pipedrive already has a different value.
- Unmatched: no usable corroborating source row.

## Files

- `pipedrive_contact_cleanup_summary.json`: machine-readable counts and run metadata.
- `pipedrive_contact_cleanup_proposed_updates.csv`: proposed fills that are safe candidates for QA sampling.
- `pipedrive_contact_cleanup_name_review.csv`: all rows where the Pipedrive shop name and source shop name are not an exact display-name match.
- `pipedrive_contact_cleanup_review_items.csv`: lower-confidence fills, conflicts, and unmatched organizations for manual review.
- `pipedrive_contact_cleanup_url_cleanup_examples.csv`: website examples that show URL normalization/cleanup cases for QA.
- `pipedrive_contact_cleanup_all_rows.csv`: all proposed/review rows in one file.

## QA Sample Guidance

Tess should sample-check proposed update rows by confirming the proposed value against the linked Supabase source row and the public shop website or Google listing when needed. Name-review rows and other review rows should not be auto-filled until Nick approves the specific shop match or a written normalization rule.

## Proposed Update Sample

- Org 1213 (Latuff Brothers Auto Body) website: http://www.latuffbrothers.com/ — exact_phone; same 10-digit phone; same ZIP 55104; same normalized name

## Name Review Sample

- Org 838 (Advanced Collision Incorporated) vs Auto Collision & Glass: Pipedrive name differs from source name; hold for manual review before considering the website conflict (Advanced Collision Incorporated vs Auto Collision & Glass)
- Org 853 (American Auto Body - MT) vs Crash Champions Collision Repair Billings 20th: Pipedrive name differs from source name; hold for manual review (American Auto Body - MT vs Crash Champions Collision Repair Billings 20th)
- Org 865 (Artistic Auto Body) vs Crash Champions LUXE | EV Certified Repair Tigard: Pipedrive name differs from source name; hold for manual review before considering the website conflict (Artistic Auto Body vs Crash Champions LUXE | EV Certified Repair Tigard)
- Org 876 (Auto Body Concepts [Main]) vs Auto Body Concepts of Millard: Pipedrive name differs from source name; hold for manual review before considering the website conflict (Auto Body Concepts [Main] vs Auto Body Concepts of Millard)
- Org 881 (Auto Body Techniques) vs Auto Body Techniques, Inc.: Pipedrive name differs from source name; hold for manual review before considering the phone conflict (Auto Body Techniques vs Auto Body Techniques, Inc.)
- Org 883 (Auto Collision Experts - Lincoln) vs Crash Champions Collision Repair Ft Collins Lincoln: Pipedrive name differs from source name; hold for manual review (Auto Collision Experts - Lincoln vs Crash Champions Collision Repair Ft Collins Lincoln)
- Org 912 (Axiom Collision Repair - Loveland) vs CARSTAR Axiom Collision Repair - Loveland: Pipedrive name differs from source name; hold for manual review before considering the website conflict (Axiom Collision Repair - Loveland vs CARSTAR Axiom Collision Repair - Loveland)
- Org 922 (Babb's Body Shop) vs Babb's Body Shop 24 Hour Wrecker Service: Pipedrive name differs from source name; hold for manual review before considering the website conflict (Babb's Body Shop vs Babb's Body Shop 24 Hour Wrecker Service)
- Org 945 (Coachman Auto Body) vs Crash Champions Collision Repair Coeur D'alene: Pipedrive name differs from source name; hold for manual review before considering the website conflict (Coachman Auto Body vs Crash Champions Collision Repair Coeur D'alene)
- Org 964 (Complete Auto Body and Repair - North Lindbergh) vs Complete Auto Body & Repair: Pipedrive name differs from source name; hold for manual review before considering the website conflict (Complete Auto Body and Repair - North Lindbergh vs Complete Auto Body & Repair)

## Review Item Sample

- Org 838 (Advanced Collision Incorporated) name_review: Pipedrive name differs from source name; hold for manual review before considering the website conflict (Advanced Collision Incorporated vs Auto Collision & Glass)
- Org 839 (Advanced Collision Repair) existing_conflict: Pipedrive already has a different phone; review before any overwrite
- Org 839 (Advanced Collision Repair) existing_conflict: Pipedrive already has a different website; review before any overwrite
- Org 852 (America's Auto Body) existing_conflict: Pipedrive already has a different website; review before any overwrite
- Org 853 (American Auto Body - MT) name_review: Pipedrive name differs from source name; hold for manual review (American Auto Body - MT vs Crash Champions Collision Repair Billings 20th)
- Org 865 (Artistic Auto Body) name_review: Pipedrive name differs from source name; hold for manual review before considering the website conflict (Artistic Auto Body vs Crash Champions LUXE | EV Certified Repair Tigard)
- Org 876 (Auto Body Concepts [Main]) name_review: Pipedrive name differs from source name; hold for manual review before considering the website conflict (Auto Body Concepts [Main] vs Auto Body Concepts of Millard)
- Org 881 (Auto Body Techniques) name_review: Pipedrive name differs from source name; hold for manual review before considering the phone conflict (Auto Body Techniques vs Auto Body Techniques, Inc.)
- Org 883 (Auto Collision Experts - Lincoln) name_review: Pipedrive name differs from source name; hold for manual review (Auto Collision Experts - Lincoln vs Crash Champions Collision Repair Ft Collins Lincoln)
- Org 912 (Axiom Collision Repair - Loveland) name_review: Pipedrive name differs from source name; hold for manual review before considering the website conflict (Axiom Collision Repair - Loveland vs CARSTAR Axiom Collision Repair - Loveland)

## URL Cleanup Example Sample

- Org 838 (Advanced Collision Incorporated) scheme-www-or-trailing-slash-normalization: http://www.autocollisionwny.com/ -> autocollisionwny.com
- Org 839 (Advanced Collision Repair) scheme-www-or-trailing-slash-normalization: https://www.advancedcollisionrepairca.com/ -> advancedcollisionrepairca.com
- Org 852 (America's Auto Body) tracking-or-encoded-url: https://americasautobody.com/%3Fy_source%3D1_MTMzMjg2MzUtNzE1LWxvY2F0aW9uLndlYnNpdGU%253D -> americasautobody.com/%3fy_source%3d1_mtmzmjg2mzutnze1lwxvy2f0aw9ulndlynnpdgu%253d
- Org 853 (American Auto Body - MT) scheme-www-or-trailing-slash-normalization: https://crashchampions.com/locations/crash-champions-billings-20th -> crashchampions.com/locations/crash-champions-billings-20th
- Org 865 (Artistic Auto Body) scheme-www-or-trailing-slash-normalization: https://crashchampions.com/locations/crash-champions-tigard -> crashchampions.com/locations/crash-champions-tigard
- Org 876 (Auto Body Concepts [Main]) tracking-or-encoded-url: https://www.autobodyconceptsinc.com/%3Fy_source%3D1_NjU1ODM3ODktNzE1LWxvY2F0aW9uLndlYnNpdGU%253D -> autobodyconceptsinc.com/%3fy_source%3d1_nju1odm3odktnze1lwxvy2f0aw9ulndlynnpdgu%253d
- Org 883 (Auto Collision Experts - Lincoln) scheme-www-or-trailing-slash-normalization: https://crashchampions.com/locations/crash-champions-ft-collins-lincoln -> crashchampions.com/locations/crash-champions-ft-collins-lincoln
- Org 912 (Axiom Collision Repair - Loveland) scheme-www-or-trailing-slash-normalization: https://www.carstar.com/locations/co/loveland-15778/ -> carstar.com/locations/co/loveland-15778
- Org 922 (Babb's Body Shop) scheme-www-or-trailing-slash-normalization: http://www.babbsbodyshop.com/ -> babbsbodyshop.com
- Org 924 (Kevin Ball Auto Body) scheme-www-or-trailing-slash-normalization: https://www.autobody-review.com/shop/4800/kevin-ball-auto-body -> autobody-review.com/shop/4800/kevin-ball-auto-body
