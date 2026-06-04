import "server-only";

export type SafetyFlag =
  | "phone_number"
  | "email_address"
  | "url"
  | "admission_of_fault"
  | "insurance_promise"
  | "disparagement";

export type SafetyResult = {
  flags: SafetyFlag[];
  blocked: boolean;
};

const PHONE_RE =
  /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s]+/i;

const ADMISSION_PATTERNS: RegExp[] = [
  /\bwe\s+(?:were|are|have\s+been)\s+(?:at\s+)?(?:fault|wrong)\b/i,
  /\bour\s+(?:mistake|fault|error)\s+caused\b/i,
  /\bwe\s+(?:admit|acknowledge)\s+(?:fault|liability|wrongdoing)\b/i,
  /\bwe\s+(?:caused|damaged)\s+your\b/i,
];

const INSURANCE_PROMISE_PATTERNS: RegExp[] = [
  /\binsurance\s+will\s+cover\b/i,
  /\byour\s+insurer\s+(?:must|will)\s+(?:pay|cover)\b/i,
  /\bwe\s+guarantee\s+(?:coverage|reimbursement)\b/i,
  /\byour\s+claim\s+will\s+be\s+approved\b/i,
];

const DISPARAGEMENT_PATTERNS: RegExp[] = [
  /\b(?:stupid|idiot|dumb|incompetent|useless)\b/i,
  /\bthat\s+(?:shop|insurer|company)\s+is\s+(?:bad|terrible|awful)\b/i,
];

const CRITICAL: SafetyFlag[] = [
  "admission_of_fault",
  "insurance_promise",
  "disparagement",
];

export function checkResponseSafety(body: string): SafetyResult {
  const flags = new Set<SafetyFlag>();

  if (PHONE_RE.test(body)) flags.add("phone_number");
  if (EMAIL_RE.test(body)) flags.add("email_address");
  if (URL_RE.test(body)) flags.add("url");
  if (ADMISSION_PATTERNS.some((r) => r.test(body)))
    flags.add("admission_of_fault");
  if (INSURANCE_PROMISE_PATTERNS.some((r) => r.test(body)))
    flags.add("insurance_promise");
  if (DISPARAGEMENT_PATTERNS.some((r) => r.test(body)))
    flags.add("disparagement");

  const arr = Array.from(flags);
  return {
    flags: arr,
    blocked: arr.some((f) => CRITICAL.includes(f)),
  };
}
