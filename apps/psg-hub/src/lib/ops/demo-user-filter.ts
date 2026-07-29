type DemoUserCandidate = {
  displayName: string;
  email: string | null;
  isDeleted?: boolean;
};

const TEST_EMAIL_PATTERNS = [
  /^qa-test-/i,
  /^qa[-_.+]/i,
  /^psg\d+(?:-|@)/i,
  /\bpsg\d+\b.*qa/i,
  /\bqa\b.*\bpsg\d+\b/i,
  /^[a-z0-9._%+-]*test[a-z0-9._%+-]*@example\.com$/i,
  /^psg\d+-[a-z0-9._%+-]*@example\.com$/i,
  /^setup@psghub\.me$/i,
  /@e2e\.test$/i,
];

const TEST_NAME_PATTERNS = [
  /^qa\b/i,
  /^tess qa\b/i,
  /\bpsg\d+\b.*test/i,
  /\bqa mail-artwork\b/i,
  /\bmail-artwork\b/i,
  /\be2e\b/i,
];

export function isInternalDemoUser(user: DemoUserCandidate) {
  const email = user.email?.trim() ?? "";
  const name = user.displayName.trim();

  return (
    user.isDeleted === true ||
    TEST_EMAIL_PATTERNS.some((pattern) => pattern.test(email)) ||
    TEST_NAME_PATTERNS.some((pattern) => pattern.test(name))
  );
}

export function filterInternalDemoUsers<T extends DemoUserCandidate>(users: T[]) {
  return users.filter((user) => !isInternalDemoUser(user));
}
