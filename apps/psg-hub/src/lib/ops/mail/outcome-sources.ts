// W0 / PSG-224 (PSG-115e) — normalize the FileMaker OUTCOME exports into the
// OutcomeRecord shape the priors miner joins against. Spec §5.
//
// Two present sources (docs/psg/filemaker/exports/, 2018–2022):
//   - Repair Customer Export (RC_* columns) → repeat / referral / RO$ outcomes.
//   - Survey Export          (S_*/SQ_* cols) → returned-survey + EMI outcomes.
//
// The repair-customer + survey rows already carry RO numbers (RC_SerialNum /
// S_RC_RONumber), which is the strongest join key, so most matching needs no
// PII. The salted household/recipient hashes are only a fallback for rows with no
// RO number. To keep this module free of any hard dependency on the salted-hash
// implementation (../mail/household.ts, owned by PSG-221) and free of secrets in
// unit tests, the hashers are INJECTED. The real miner run wires in
// household.householdKey / household.recipientHash; tests pass stubs (or omit
// them, in which case only the RO-number join is used).

import type { OutcomeRecord } from "./priors";

export type AddressLike = {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

export type OutcomeHashers = {
  householdKey: (addr: AddressLike) => string;
  recipientHash: (name: string, addr: AddressLike) => string;
};

function yes(raw: unknown): boolean {
  return String(raw ?? "").trim().toLowerCase() === "yes";
}

function nonEmpty(raw: unknown): boolean {
  return String(raw ?? "").trim() !== "";
}

/** Strip a FileMaker datetime ("2018-01-02 00:00:00") to an ISO date. */
function isoDate(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (s === "") return "";
  return s.slice(0, 10);
}

/** A raw Repair Customer Export row (RC_* columns), as parsed from the source. */
export type RepairCustomerRow = Record<string, unknown> & {
  RC_SerialNum?: unknown;
  RC_Date_Out?: unknown;
  RC_Repeat_Yes_No?: unknown;
  RC_Referral_Yes_No?: unknown;
};

/** A raw Survey Export row (S_ / SQ_ columns). */
export type SurveyRow = Record<string, unknown> & {
  S_RC_RONumber?: unknown;
  S_CreationDate?: unknown;
  S_RC_Repeat?: unknown;
  S_RC_Referral?: unknown;
};

function buildKeys(
  row: Record<string, unknown>,
  cols: { first: string; last: string; line1: string; line2: string; city: string; state: string; zip: string },
  hashers?: OutcomeHashers
): { recipientHash?: string; householdKey?: string } {
  if (!hashers) return {};
  const addr: AddressLike = {
    line1: (row[cols.line1] as string) ?? null,
    line2: (row[cols.line2] as string) ?? null,
    city: (row[cols.city] as string) ?? null,
    state: (row[cols.state] as string) ?? null,
    zip: (row[cols.zip] as string) ?? null,
  };
  const name = `${String(row[cols.first] ?? "")} ${String(row[cols.last] ?? "")}`.trim();
  return {
    householdKey: hashers.householdKey(addr) || undefined,
    recipientHash: hashers.recipientHash(name, addr) || undefined,
  };
}

/**
 * Repair-customer row → OutcomeRecord. repeat/referral are the RC_*_Yes_No flags;
 * surveyReturned is false (that signal lives in the survey export); subsequentRo
 * is true when the row carries a repair (RO number present) — a repair-customer
 * row IS a completed RO, so a row dated after a send is itself a subsequent RO.
 */
export function repairCustomerToOutcome(
  row: RepairCustomerRow,
  hashers?: OutcomeHashers
): OutcomeRecord {
  return {
    roNumber: nonEmpty(row.RC_SerialNum) ? String(row.RC_SerialNum).trim() : null,
    outcomeDate: isoDate(row.RC_Date_Out) || isoDate(row.RC_CreationDate),
    repeat: yes(row.RC_Repeat_Yes_No),
    referral: yes(row.RC_Referral_Yes_No),
    surveyReturned: false,
    subsequentRo: nonEmpty(row.RC_SerialNum),
    ...buildKeys(
      row,
      {
        first: "RC_Cust_First",
        last: "RC_Cust_Last",
        line1: "RC_Cust_Address1",
        line2: "RC_Cust_Address2",
        city: "RC_Cust_City",
        state: "RC_Cust_State",
        zip: "RC_Cust_Zip",
      },
      hashers
    ),
  };
}

/**
 * Survey row → OutcomeRecord. A survey row's mere existence IS a returned survey,
 * so surveyReturned is true. repeat/referral mirror the carried RC fields.
 */
export function surveyToOutcome(row: SurveyRow, hashers?: OutcomeHashers): OutcomeRecord {
  return {
    roNumber: nonEmpty(row.S_RC_RONumber) ? String(row.S_RC_RONumber).trim() : null,
    outcomeDate: isoDate(row.S_CreationDate) || isoDate(row.S_RC_Date_Out),
    repeat: yes(row.S_RC_Repeat),
    referral: yes(row.S_RC_Referral),
    surveyReturned: true,
    subsequentRo: false,
    ...buildKeys(
      row,
      {
        first: "S_RC_Cust_Name_First",
        last: "S_RC_Cust_Name_Last",
        line1: "S_RC_Cust_Address",
        line2: "S_RC_Cust_Address2",
        city: "S_RC_Cust_City",
        state: "S_RC_Cust_State",
        zip: "S_RC_Cust_Zip",
      },
      hashers
    ),
  };
}

/** Normalize both export kinds into one outcome stream for the miner. */
export function buildOutcomeStream(
  repairCustomers: RepairCustomerRow[],
  surveys: SurveyRow[],
  hashers?: OutcomeHashers
): OutcomeRecord[] {
  return [
    ...repairCustomers.map((r) => repairCustomerToOutcome(r, hashers)),
    ...surveys.map((s) => surveyToOutcome(s, hashers)),
  ].filter((o) => o.outcomeDate !== "");
}
