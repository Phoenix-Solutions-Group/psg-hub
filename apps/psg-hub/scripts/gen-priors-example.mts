// Throwaway generator: renders the priors example doc from a labeled SYNTHETIC
// fixture using the real miner + renderer, so docs/ops/mail/priors/example.md is
// genuine renderer output (not hand-written). Re-run after touching priors.ts.
//   npx tsx apps/psg-hub/scripts/gen-priors-example.mts
import { writeFileSync } from "node:fs";
import { mineSendPriors, renderPriorsSummary, type SendRecord, type OutcomeRecord } from "../src/lib/ops/mail/priors";

// SYNTHETIC fixture (NOT production data) — shaped like the real LA/Ins follow-up
// flow to demonstrate the artifact. Real priors come from the PSG-216a import.
const sends: SendRecord[] = [];
const outcomes: OutcomeRecord[] = [];
let n = 0;
function add(piece: string, region: string, pay: string, repeat: boolean, count: number, hitRate: number) {
  for (let i = 0; i < count; i++) {
    const ro = `RO${n++}`;
    sends.push({ pieceCode: piece, sentDate: "2020-01-15", payType: pay, region, repeatCustomer: repeat, roNumber: ro });
    if (i / count < hitRate) {
      outcomes.push({ roNumber: ro, outcomeDate: "2020-04-01", repeat: false, referral: true, surveyReturned: false });
    }
  }
}
// warranty_letter A/B: 04 vs 04b in LA/Ins/repeat
add("04", "LA", "Ins Pay", true, 100, 0.18);
add("04b", "LA", "Ins Pay", true, 100, 0.27);
// survey follow-up by region
add("07", "LA", "Ins Pay", true, 80, 0.31);
add("07", "TX", "Customer Pay", false, 60, 0.22);
// total-loss thank-you
add("t", "LA", "Ins Pay", false, 40, 0.12);

const rows = mineSendPriors(sends, outcomes, {});
const md = renderPriorsSummary(rows, {
  computedAt: "SYNTHETIC-FIXTURE",
  windowDays: 180,
  sourceLabel: "SYNTHETIC fixture (illustrative — NOT production; real priors land via PSG-216a)",
});
writeFileSync(new URL("../../../docs/ops/mail/priors/example.md", import.meta.url), md);
console.log(`wrote ${rows.length} prior rows`);
