#!/usr/bin/env node
// PSG-2683 — scheduled production drift reporter.
//
// Runs the existing ledger and object-parity drift checks. When production drift
// is found, or when the production check is not configured with DB access, this
// script opens one assigned Paperclip issue so the problem is visible outside CI.

import { spawnSync } from 'node:child_process';

const ACTIVE_STATUSES = ['todo', 'in_progress', 'in_review', 'blocked'];

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function runCheck(label, args) {
  const result = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    env: process.env,
  });
  return {
    label,
    code: typeof result.status === 'number' ? result.status : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function summarize(checks) {
  return checks
    .map((check) => {
      const status = check.code === 0 ? 'passed' : check.code === 2 ? 'not configured' : 'failed';
      const output = `${check.stdout}${check.stderr}`.trim();
      return `### ${check.label}: ${status}\n\n\`\`\`\n${output || '(no output)'}\n\`\`\``;
    })
    .join('\n\n');
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function paperclipFetch(path, init = {}) {
  const apiUrl = normalizeBaseUrl(requiredEnv('PAPERCLIP_API_URL'));
  const apiKey = requiredEnv('PAPERCLIP_API_KEY');
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Paperclip API ${response.status}: ${text}`);
  }
  return response.json();
}

async function findExistingIssue(companyId, title, assigneeAgentId) {
  const params = new URLSearchParams({
    status: ACTIVE_STATUSES.join(','),
    assigneeAgentId,
  });
  const data = await paperclipFetch(`/api/companies/${companyId}/issues?${params}`);
  const issues = Array.isArray(data) ? data : data.issues || data.items || [];
  return issues.find((issue) => issue.title === title) || null;
}

async function createOrUpdateIssue({ title, description, comment }) {
  const companyId = requiredEnv('PAPERCLIP_COMPANY_ID');
  const assigneeAgentId = requiredEnv('PAPERCLIP_ASSIGNEE_AGENT_ID');
  const existing = await findExistingIssue(companyId, title, assigneeAgentId);

  if (existing) {
    await paperclipFetch(`/api/issues/${existing.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: existing.status === 'blocked' ? 'blocked' : 'in_progress',
        comment,
      }),
    });
    console.log(`[drift-report] Updated existing Paperclip issue ${existing.identifier || existing.id}.`);
    return;
  }

  const body = {
    title,
    description,
    status: 'todo',
    priority: 'critical',
    assigneeAgentId,
    projectId: process.env.PAPERCLIP_PROJECT_ID || undefined,
    goalId: process.env.PAPERCLIP_GOAL_ID || undefined,
  };
  const created = await paperclipFetch(`/api/companies/${companyId}/issues`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  console.log(`[drift-report] Created Paperclip issue ${created.identifier || created.id}.`);
}

async function main() {
  const migrationArgs = ['scripts/check-migration-drift.mjs'];
  if (process.env.MIGRATION_APPLIED_FILE) {
    migrationArgs.push('--applied-file', process.env.MIGRATION_APPLIED_FILE);
  }
  const schemaArgs = ['scripts/check-schema-drift.mjs'];
  if (process.env.SCHEMA_OBJECTS_FILE) {
    schemaArgs.push('--objects-file', process.env.SCHEMA_OBJECTS_FILE);
  }

  const checks = [
    runCheck('Migration ledger check', migrationArgs),
    runCheck('Schema object check', schemaArgs),
  ];
  const failing = checks.filter((check) => check.code !== 0);
  if (failing.length === 0) {
    console.log('[drift-report] OK — production migration and schema checks passed.');
    return;
  }

  const hasSkipped = failing.some((check) => check.code === 2);
  const title = hasSkipped
    ? 'Production migration drift check is not fully configured'
    : 'Production migration drift needs attention';
  const checkOutput = summarize(checks);
  const description = hasSkipped
    ? `**Bottom line:** the daily production database safety check could not run because it is missing database access. Until this is fixed, PSG can again miss unapplied database changes.\n\nSet the GitHub Actions secret \`SUPABASE_DB_URL\` to a read-only production Postgres connection string, then rerun the Migration drift workflow.\n\n${checkOutput}`
    : `**Bottom line:** the daily production database safety check found that production no longer matches the repository. This can break customer-facing features when the app expects database tables or columns that are not live yet.\n\nFollow \`docs/runbooks/supabase-migration-apply.md\`: take a backup, review and apply missing migrations, then rerun both drift checks until they pass.\n\n${checkOutput}`;
  const comment = hasSkipped
    ? `The scheduled production database safety check still cannot run because the database read-only connection is missing. Please set \`SUPABASE_DB_URL\` in GitHub Actions, then rerun the workflow.\n\n${checkOutput}`
    : `The scheduled production database safety check still finds drift. Apply the missing database changes using the Supabase migration runbook, then rerun the workflow.\n\n${checkOutput}`;

  await createOrUpdateIssue({ title, description, comment });
  process.exit(1);
}

main().catch((error) => {
  console.error(`[drift-report] ${error.message}`);
  process.exit(1);
});
