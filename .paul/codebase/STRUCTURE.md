# STRUCTURE

*Last mapped: 2026-05-28*

## Workspace Layout

```
/Users/schoolcraft_mbpro/apps/psg/
├── .paul/                        ← this PAUL workspace (just created)
├── .vercel/                      ← root-level Vercel link
├── projects/
│   └── psg-hub/                  ← SEED ideation target (newly created, empty)
│
├── ACTIVE NEXT.JS APPS
│   ├── psg-advantage-portal/     ← ⭐ ANCHOR: Next 15 + Supabase, dashboards, auth, 27 tests
│   └── psg-import/               ← Next 16, PAUL-managed, file preprocessor tool
│
├── ACTIVE BACKEND / ETL
│   └── psg-data-lake/            ← Python ETL → Supabase (30+ scripts)
│
├── LEGACY / PHP / WORDPRESS
│   ├── api-psghub/               ← PHP grab-bag (has Google Ads dashboard prototype in ads-dash/)
│   ├── dashboard-psgdigital/     ← PHP about.php only
│   ├── invoice-psgdigital/       ← WordPress wp-content/
│   └── shop-theacrb/             ← WordPress wp-content/
│
├── STUB / EMPTY / NON-CODE
│   ├── invoice/                  ← empty
│   ├── portal/                   ← stub, only HANDOFF-psg-data-lake.md
│   ├── sst-psgdigital/           ← git repo with only .gitignore
│   ├── web-dev-skills/           ← empty projects/ dir
│   ├── psg/                      ← Obsidian vault
│   ├── pipedrive/                ← xlsx/docx audit artifacts only
│   └── local-reach-content/      ← content/skills folder, not an app
│
└── psg-agentic-os-dev-packet.docx
```

## `psg-advantage-portal/` — Detail

```
psg-advantage-portal/
├── src/
│   ├── app/
│   │   ├── (auth)/               ← route group: login, reset-password, update-password
│   │   ├── (dashboard)/          ← route group: 7 dashboard pages
│   │   │   ├── page.tsx          ← home
│   │   │   ├── shops/page.tsx + [shopName]/page.tsx
│   │   │   ├── customer-geography/
│   │   │   ├── flower-hill/
│   │   │   ├── market-map/
│   │   │   ├── marketing-intelligence/
│   │   │   └── market-command/
│   │   ├── auth/callback/route.ts
│   │   └── api/                  ← REST endpoints: health, shops, markets, network, customer-geography, market-map, flower-hill
│   ├── components/
│   │   ├── ui/                   ← primitives: Button, Input, Badge, Panel, Metric, ScoreBar, ShopTable, etc.
│   │   ├── charts/               ← Recharts wrappers: EmiTrendChart, ScoreBreakdownChart, YearOverYearChart
│   │   ├── auth/
│   │   ├── *Dashboard.tsx        ← top-level dashboard components
│   │   └── AlertPanel, CommentsFeed, CompetitorOverlay, DateRangePicker, EmptyState, TrendBadge
│   ├── lib/
│   │   ├── supabase/             ← SSR + browser clients
│   │   └── postgres/             ← direct pg pool
│   ├── store/                    ← Zustand
│   └── types/
├── supabase/
│   ├── migrations/               ← 30+ SQL files (2026-04-28 → 2026-04-29)
│   └── email-templates/
├── tests/                        ← 27 test files: auth, components, lib, api, helpers, store
├── public/brand/                 ← fonts + assets
├── scripts/                      ← start-standalone, verify-customer-geography-parity, build-supabase-email-config
├── docs/                         ← session-handoff-2026-04-24.md
├── middleware.ts
├── next.config.ts
├── eslint.config.mjs
├── DESIGN-SYSTEM.md              ← 8.9KB design system doc
├── .impeccable.md
├── Dockerfile + docker-compose.yml
└── Master Project Plan_ PSG Agentic Market Intelligence Platform.md
```

## `psg-import/` — Detail

```
psg-import/
├── .paul/                        ← existing PAUL setup, milestones, phases, handoffs
│   ├── PROJECT.md
│   ├── ROADMAP.md
│   ├── STATE.md
│   └── phases/ (02-column-mapping-shop-resolver, 04-export-settings, 08-billing-preview, 12-scan-template-editor, ...)
├── src/{app,components,lib,stores}/
├── filemaker/                    ← FileMaker-specific assets
├── scripts/                      ← refresh-invoiced-customers
├── data/2025-07-15/
├── docs/, reports/
├── PLANNING.md (30KB)
├── PRD_PSG_Advantage_RC_Import_API.md (30KB)
├── PSG_Import_Preprocessor_PRD.md (33KB)
└── README.md (9KB)
```

## `psg-data-lake/` — Detail

```
psg-data-lake/
├── *.py                          ← ~30 ETL scripts, flat layout
├── Export/                       ← vendor xlsx (Advantage repair/survey responses, vehicles)
├── .planning/                    ← MILESTONES.md + milestones/
├── .venv/                        ← Python venv
├── config.py                     ← shared config
└── requirements.txt
```

## `api-psghub/` — Detail (legacy, mine for content)

```
api-psghub/
├── ads-dash/                     ← Google Ads dashboard prototype (HTML/JS/CSS) — KEEP AS REFERENCE
│   ├── Google Ads/               ← Century Collision proposal, ad mockups, RSA CSVs, synthetic data
│   ├── src/, scripts/, docs/, dist/, logos/
│   └── *.html (index, campaigns, adgroups, intelligence, localseo)
├── psg-insight-hub/              ← PHP insight hub: api/, pages/, templates/, includes/, index.php
├── address-validator/, address-validator-v2/
├── discovery2/, parser_v0/, parser_v3/
├── n8n/                          ← n8n workflow exports
├── timezone-converter/
├── apps/, assets/
├── chatkit_session.php, info.php, index.html
└── apikey.postman_environment.json
```

## Key Locations for `psg-hub` Planning

| Concern | Source to harvest |
|---------|-------------------|
| App skeleton (Next 15 + Supabase + auth) | `psg-advantage-portal/` (fork or extend in place) |
| Dashboard components | `psg-advantage-portal/src/components/charts/`, `ui/` |
| Supabase schema | `psg-advantage-portal/supabase/migrations/` |
| Marketing analytics UI patterns | `api-psghub/ads-dash/` |
| Google Ads data model | `api-psghub/ads-dash/Google Ads/century_marketing_data_dictionary.md` |
| File import flow | `psg-import/` (link to from hub; don't absorb) |
| Customer/shop data backbone | `psg-data-lake/` (keep as ETL feeder) |
| Customer geography | `psg-advantage-portal/src/app/(dashboard)/customer-geography/` |
| Design system | `psg-advantage-portal/DESIGN-SYSTEM.md` |
