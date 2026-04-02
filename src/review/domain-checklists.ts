const DOMAIN_PATTERNS: Record<string, RegExp[]> = {
  auth: [
    /(^|\/)(auth|login|session|oauth|identity|credentials?)(\/|$)/i,
    /(token|jwt|password|signin|sign-in|signon)/i,
  ],
  crypto: [
    /(^|\/)(crypto|cryptography|security|keys?)(\/|$)/i,
    /(encrypt|decrypt|hash|cipher|sign|verify)/i,
  ],
  "data-model": [
    /(^|\/)(model|models|schema|schemas|entity|entities|migration|migrations|domain)(\/|$)/i,
    /(prisma|typeorm|sequelize|data-model|user-model)/i,
  ],
  payment: [
    /(^|\/)(payment|payments|billing|invoice|invoices|checkout)(\/|$)/i,
    /(stripe|paypal|settlement|charge)/i,
  ],
  injection: [
    /(^|\/)(db|database|query|queries|repository|repositories)(\/|$)/i,
    /(sql|nosql|command|statement)/i,
  ],
};

const DEFAULT_CHECKLIST = "business-logic";
const MANDATORY_DOMAINS = new Set(["auth", "crypto", "data-model", "payment"]);
const HOTFIX_DOMAINS = ["auth", "injection"] as const;

function detectDomainsFromPath(path: string) {
  const matches: string[] = [];

  for (const [domain, patterns] of Object.entries(DOMAIN_PATTERNS)) {
    if (patterns.some((pattern) => pattern.test(path))) {
      matches.push(domain);
    }
  }

  return matches;
}

function dedupe(values: string[]) {
  return values.filter((value, index) => values.indexOf(value) === index);
}

export function detectChangedDomains(paths: string[]) {
  const detected = paths.flatMap((path) => detectDomainsFromPath(path));
  return dedupe(detected);
}

export function requiresMandatoryAdversarialReview(input: {
  files: string[];
  changedDomains?: string[];
}) {
  const domains = input.changedDomains?.length
    ? input.changedDomains
    : detectChangedDomains(input.files);

  return domains.some((domain) => MANDATORY_DOMAINS.has(domain));
}

export function isMandatoryReviewDomain(domain: string) {
  return MANDATORY_DOMAINS.has(domain);
}

export function resolveAdversarialChecklists(input: {
  files: string[];
  changedDomains?: string[];
  mode?: string;
}) {
  const detectedDomains = input.changedDomains?.length
    ? dedupe(input.changedDomains)
    : detectChangedDomains(input.files);

  if (input.mode === "--hotfix") {
    const narrowed = HOTFIX_DOMAINS.filter((domain) => detectedDomains.includes(domain));
    return narrowed.length > 0 ? narrowed : [...HOTFIX_DOMAINS];
  }

  if (detectedDomains.length > 0) {
    return detectedDomains;
  }

  return [DEFAULT_CHECKLIST];
}
