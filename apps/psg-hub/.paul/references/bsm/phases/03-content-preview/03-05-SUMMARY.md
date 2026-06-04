---
phase: 03-content-preview
plan: 05
subsystem: preview
tags: [agent-skill, firecrawl, html-extraction, template-system, paperclip]

requires:
  - phase: 03-content-preview
    provides: Preview template generator and client approval workflow (plans 03-03, 03-04)
provides:
  - bsm-site-designer agent skill for automated site template extraction
  - Multi-page-type template system with layouts.json
  - 5-agent Paperclip swarm with site-designer running first at onboarding
affects: [04-customer-facing-mvp, content-writer]

tech-stack:
  added: []
  patterns: [page-type layout extraction, layouts.json manifest, platform detection]

key-files:
  created:
    - ~/.claude/skills/bsm-site-designer/SKILL.md
    - preview/templates/tracys-collision-center/layouts.json
  modified:
    - preview/extract-template.js
    - preview/generate-preview.js
    - paperclip.config.json

key-decisions:
  - "Site designer runs on-demand at onboarding, not on recurring schedule"
  - "FA JS/SVG rendering instead of CSS webfonts (fixes file:// CORS)"
  - "Content type mapping with fallback chain for page-type templates"

patterns-established:
  - "layouts.json manifest per shop for page-type template selection"
  - "Platform detection from HTML class patterns (WordPress/Elementor/OceanWP/Divi/etc.)"
  - "Block-level vs inline HTML tag distinction for paragraph wrapping"

duration: 45min
completed: 2026-04-12T23:00:00Z
---

# Phase 3 Plan 05: UI/UX Site Designer Agent Summary

**5th BSM agent that crawls client websites and extracts pixel-accurate HTML templates for content preview, registered in Paperclip swarm to run first at shop onboarding.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~45min |
| Completed | 2026-04-12 |
| Tasks | 4 completed (3 auto + 1 checkpoint) |
| Files modified | 5 |
| Qualify results | 3 PASS, 0 GAP, 0 DRIFT |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Skill produces usable templates from URL | Pass | Skill created with full crawl/extract/save workflow, platform detection, error handling |
| AC-2: Multiple page-type templates extracted and selectable | Pass | layouts.json created, generate-preview.js resolves content_type to layout with fallback |
| AC-3: Agent registered in swarm, runs at onboarding | Pass | paperclip.config.json has 5 agents, site-designer first, content-writer depends on it |

## Accomplishments

- Created bsm-site-designer skill (274 lines) with full site crawl workflow, platform detection for 8 CMS types, collision repair site pattern handling, and manual fallback path
- Built multi-page template system: extract-template.js accepts page-type argument, generates layouts.json with platform metadata and per-type layout info
- Updated generate-preview.js with content_type-to-layout mapping, fallback chain, and fixed paragraph wrapping for inline elements
- Registered 5th agent in Paperclip with on-demand scheduling, $3/month budget, and onboarding trigger

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `~/.claude/skills/bsm-site-designer/SKILL.md` | Created | Agent skill with crawl, extract, save workflow |
| `preview/templates/tracys-collision-center/layouts.json` | Created | Page-type layout manifest |
| `preview/extract-template.js` | Modified | Added page-type arg, layouts.json generation, platform detection |
| `preview/generate-preview.js` | Modified | Added layouts loading, page-type resolution, paragraph fix |
| `paperclip.config.json` | Modified | Added site-designer agent, updated dependencies and budget |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| On-demand scheduling only | Agent runs once per shop + manual refreshes, not recurring | Low budget ($3/mo), triggered by onboarding |
| FA JS/SVG rendering | CSS webfont approach fails on file:// due to CORS | Nav arrows render correctly in local previews |
| Block-level tag whitelist for paragraphs | Inline elements like `<strong>` were skipping `<p>` wrapping | Content renders with proper paragraph spacing |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 1 | Essential fix, no scope creep |
| Deferred | 0 | - |

### Auto-fixed Issues

**1. Paragraph wrapping bug in markdown-to-HTML converter**
- **Found during:** Checkpoint verification
- **Issue:** Lines starting with inline HTML (`<strong>`, `<em>`, `<a>`) were not wrapped in `<p>` tags, causing numbered steps to collapse into one block
- **Fix:** Changed paragraph detection from `!block.startsWith('<')` to a whitelist of block-level HTML tags
- **Verification:** Regenerated preview, confirmed proper paragraph spacing

## Next Phase Readiness

**Ready:**
- Site designer skill available as `/bsm-site-designer` in Claude Code
- Template system supports any shop with page.html source
- Tracy's templates validated and working
- 5-agent swarm documented in paperclip.config.json

**Concerns:**
- Paperclip server has only 4 agents registered at runtime (site-designer needs runtime registration when deploying to persistent server in Phase 4)
- JS-rendered sites (Wix, heavy SPAs) may need screenshot fallback

**Blockers:**
- None

---
*Phase: 03-content-preview, Plan: 05*
*Completed: 2026-04-12*
