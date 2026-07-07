#!/usr/bin/env node
// Staging/preview-artifact guard (PSG-778).
//
// Preview builds (e.g. the Tedesco home-page staging page) are a review aid. They
// belong ONLY on their feature branch — never on the production branch `main`, which
// is what Vercel builds the live site from. A stray preview committed to `main` is
// harmless today (the folder is not served) but it is a foot-gun: a future preview
// could slip through and go live by accident.
//
// This check fails if any file under a guarded staging path is tracked by git.
// It is wired into CI to run ONLY on `main` (push + PRs targeting main), so feature
// branches can still keep their previews per convention. See the note in
// apps/psg-hub/AGENTS.md.
//
// Run it locally with:  node scripts/check-staging-guard.mjs
// Exit 0 = clean, exit 1 = staging artifacts found on this branch.

import { execFileSync } from 'node:child_process';

// Guarded pathspecs. Add more app staging dirs here if the monorepo grows.
const GUARDED = ['apps/psg-hub/staging/**'];

function tracked(pathspec) {
  const out = execFileSync('git', ['ls-files', '-z', '--', pathspec], {
    encoding: 'utf8',
  });
  return out.split('\0').filter(Boolean);
}

const offenders = GUARDED.flatMap(tracked);

if (offenders.length > 0) {
  console.error(
    'ERROR: staging/preview artifacts are tracked on this branch — they must NOT reach `main`.\n' +
      'Preview builds live only on their feature branch. Remove them from the production branch:\n'
  );
  for (const f of offenders) console.error(`  git rm --cached "${f}"`);
  console.error(
    `\n${offenders.length} offending file(s). Guarded paths: ${GUARDED.join(', ')}`
  );
  process.exit(1);
}

console.log(
  `OK: no staging/preview artifacts tracked. Guarded paths: ${GUARDED.join(', ')}`
);
process.exit(0);
