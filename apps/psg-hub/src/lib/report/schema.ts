// Phase 12 / 12-02 — Report narrative schema (AI SDK v6 Output.object target).
// One field per report section. Brand rules are injected inline via .describe()
// so they ride with the structured-output contract. The writer references every
// metric by a {{placeholder}} token (NEVER a literal number); report/prompt.ts
// substitutes the real formatted values AFTER generation, so the model cannot
// fabricate a value it never types (the grounding guarantee).

import { z } from "zod";

const BRAND =
  "No em dashes anywhere. No emojis. Active voice, plain direct language. " +
  "No metaphors or cliches. Reference any metric ONLY by its {{placeholder}} token " +
  "(for example {{ga4_sessions}} or {{gsc_clicks_mom}}); never write a literal number.";

/** Per-source one-paragraph performance summary; only present sources are filled. */
const sourceSummary = z
  .string()
  .describe(`A short performance paragraph for this source. ${BRAND}`);

export const reportNarrativeSchema = z.object({
  headline: z
    .string()
    .describe(`A single-sentence headline for the month. ${BRAND}`),
  executiveSummary: z
    .string()
    .describe(`Two to four sentences summarizing the month across all linked sources. ${BRAND}`),
  sourceSummaries: z
    .object({
      ga4: sourceSummary.optional(),
      gsc: sourceSummary.optional(),
      google_ads: sourceSummary.optional(),
      semrush: sourceSummary.optional(),
    })
    .describe("One paragraph per LINKED source; omit sources not present in the data."),
  recommendations: z
    .array(z.string().describe(`A concrete next-step recommendation. ${BRAND}`))
    .describe("Two to four prioritized recommendations grounded in the month's data."),
});

export type ReportNarrative = z.infer<typeof reportNarrativeSchema>;
