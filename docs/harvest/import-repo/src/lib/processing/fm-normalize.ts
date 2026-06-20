/**
 * FileMaker Auto-Enter normalization logic.
 * Replicates FM calculated field behavior for insurance companies,
 * payment types, referral categorization, and field cleanup.
 */
import type { Row } from "./types";

// ---------------------------------------------------------------------------
// Insurance Company mappings (433 entries, lowercase key -> canonical value)
// ---------------------------------------------------------------------------
const INSURANCE_MAP: Record<string, string> = {
  "-": "Allstate",
  "? - accuity ins. co.": "Acuity",
  "acuity mutual.": "Acuity",
  "acuity insurance": "Acuity",
  "acuity, a mutual insurance company": "Acuity",
  "ace usa": "Ace Usa, Inc.",
  "ace review for towne park": "Ace Review",
  "access general": "Access General Insurance",
  "aaa auto insurance": "AAA",
  "aaa ncnu insurance exchange": "AAA",
  "aaa ins.": "AAA",
  "aaa northern california, neveda & u": "AAA",
  "aaa northern california, nevada & u": "AAA",
  "aaa insurance": "AAA",
  "allied/nationwide insurance.": "Allied Insurance",
  "allied": "Allied Insurance",
  "allied group insurance": "Allied Insurance",
  "allied ins": "Allied Insurance",
  "allied property & casualty in": "Allied Property",
  "allied property & casualty ins": "Allied Property & Casualty",
  "aig casualty company": "AIG",
  "alpha insurance companies": "Alpha Insuranace",
  "allstate insurance company": "Allstate",
  "allstate indemnity company": "Allstate",
  "allstate ins": "Allstate",
  "allstate insurance": "Allstate",
  "allstate insurance companies": "Allstate",
  "allstate kennewick": "Allstate",
  "allstate assignment company": "Allstate",
  "allstate - drp/pro": "Allstate",
  "allstate insurance - drp/pro": "Allstate",
  "allstate safelite": "Allstate",
  "allstate indemnity": "Allstate",
  "allstate auto division": "Allstate",
  "allstate northbrook indemnity compan": "Allstate",
  "allstate fire & casualty ins co": "Allstate",
  "alaska national insurance co": "Alaskan National",
  "american commerce insurance company": "American Commerce",
  "21st century insurance": "21st Century",
  "21st insurance company": "21st Century",
  "21st century insurance company": "21st Century",
  "? - affirmative insurance company": "Affirmative Insurance",
  "am fam": "American Family",
  "am fam - joe bender": "American Family",
  "american family - fast start": "American Family",
  "american family insurance": "American Family",
  "american family insurance comp": "American Family",
  "american family ins.": "American Family",
  "american family ins co": "American Family",
  "american country insurance company": "American Country Insurance",
  "american national property & casualt": "American National",
  "american national prop & cas": "American National",
  "amco insurance company": "Amco",
  "? - amica": "Amica",
  "amica insurance": "Amica",
  "amica mutual insurance": "Amica",
  "amico mutual insurance company": "Amica",
  "amica mutual insurance companies": "Amica",
  "amica mutual insurance company": "Amica",
  "american national property & casual": "American National",
  "ameriprise insurance": "Ameriprise",
  "ameriprise auto and home": "Ameriprise",
  "ameriprise auto & home insurance": "Ameriprise",
  "ameriprise auto ins.": "Ameriprise",
  "ameriprise auto & homes ins.": "Ameriprise",
  "ameriprise auto_home ins.": "Ameriprise",
  "? - amica mutual insurance company": "Amica Mutual",
  "anpac insurance": "Anpac",
  "austin mutual insurance company": "Austin Mutual",
  "? - auto club insurance association": "Auto Club",
  "auto club insurance assocaition": "Auto Club",
  "auto club insurance assoc .": "Auto Club",
  "auto club insurance associati": "Auto Club",
  "auto club insurance": "Auto Club",
  "auto club insurance associatio": "Auto Club",
  "auto club insurance association": "Auto Club",
  "? - auto owners": "Auto Owners",
  "auto owners insurance": "Auto Owners",
  "? - auto owners insurance": "Auto Owners",
  "bear river": "Bear River Mutual",
  "bristol west insurance": "Bristol West",
  "bristol west casualty insurance comp": "Bristol West",
  "brotherhood mutual insurance company": "Brotherhood Mutual",
  "capital insurance group": "Capital Insurance",
  "? - cei auto claims management": "C.E.I.",
  "? - central insurance company": "Central Insurance Comapny",
  "? - century national insurance": "Century",
  "central insurance company": "Central Insurance",
  "central mutual insurance company": "Central Mutual",
  "central mutual ins": "Central Mutual",
  "chartis private client group": "Chartis",
  "chubb & son insurance": "Chubb",
  "chubb insurance": "Chubb",
  "chubb and son inc.": "Chubb",
  "chubb group *": "Chubb",
  "cincinnati ins": "Cincinnati Insurance",
  "cincinnati insurance co.": "Cincinnati Insurance",
  "cincinnati insurance company": "Cincinnati Insurance",
  "cincinnati": "Cincinnati Insurance",
  "cincinnati ins. co.": "Cincinnati Insurance",
  "cincinnati ins co": "Cincinnati Insurance",
  "citizens insurance": "Citizens",
  "crawford & co.": "Crawford & Company",
  "commerce west": "Commerce West Insurance",
  "? - country insurance": "Country Insurance",
  "? - country mutual ins.": "Country Insurance",
  "country": "Country Insurance",
  "countrywide": "Countrywide Insurance",
  "columbia ins": "Columbia Insurance",
  "columbia insurance group": "Columbia Insurance",
  "colorado spgs": "Colorado Springs",
  "colorado spring": "Colorado Springs",
  "cospgs": "Colorado Springs",
  "cspg": "Colorado Springs",
  "coast national insurance company": "Coast National",
  "companion property & casualty": "Cornerstone National",
  "cornerstone ins": "Companion",
  "csaa le": "CSAA",
  "csaa insurance group": "CSAA",
  "delos ins": "Delos Insurance",
  "direct deneral group": "Direct General",
  "depositors insurance company": "Depositors Insurance",
  "elco fleet services": "Elco",
  "encompass insurance": "Encompass",
  "encompass indemnity company": "Encompass",
  "encompass insurance company of ameri": "Encompass",
  "? - esis": "Esis Insurance",
  "? - esurance": "Esurance",
  "? - esurance - repair resolution claim": "Esurance",
  "esurance atlanta claim rep unit": "Esurance",
  "erie insurance group": "Erie Insurance",
  "erie insurance group*": "Erie Insurance",
  "erie": "Erie Insurance",
  "enterprise": "Enterprise Fleet",
  "emc insurance company": "EMC",
  "emc insurance companies": "EMC",
  "emc insurance co - des moines": "EMC",
  "? - fireman's fund insurance companies": "Firemans Fund",
  "fireman funds ins": "Firemans Fund",
  "fireman fund": "Firemans Fund",
  "firemans fund ins": "Firemans Fund",
  "fireman's fund insurance companies": "Firemans Fund",
  "fireman's fund ins.": "Firemans Fund",
  "? - first insurance": "First",
  "first insurance": "First",
  "first insurance co. of hawaii": "First",
  "first insurance co": "First",
  "first chicago insurance company": "First Chicago",
  "first national ins. co. of ame": "First National",
  "? - fleet financial corp": "Fleet Financial",
  "96suzzfarmbur": "Farm Bureau",
  "96hyzfarmbur": "Farm Bureau",
  "farm bureau insurance": "Farm Bureau",
  "farmers burea": "Farm Bureau",
  "? - farmers insurance hawaii inc.": "Farmers Insurance",
  "farmers ins exchange": "Farmers Insurance",
  "farmers insurance hawaii inc.": "Farmers Insurance",
  "farmers": "Farmers Insurance",
  "farmers hawaii": "Farmers Insurance",
  "farmers ins group": "Farmers Insurance",
  "farmers insurance exchange": "Farmers Insurance",
  "farmers insurance group": "Farmers Insurance",
  "farmers hotline": "Farmers Insurance",
  "farmers - mickley": "Farmers Insurance",
  "farmers non drp": "Farmers Insurance",
  "farmers ins. group": "Farmers Insurance",
  "farmers ins": "Farmers Insurance",
  "farmers insurance company, inc.": "Farmers Insurance",
  "farmers-austin": "Farmers Insurance",
  "farmers new century ins co": "Farmers New Century Insurance",
  "farmers mutual insurance": "Farmers Mutual",
  "federated mutual insurance company": "Federated Mutual",
  "foremost insursance co.": "Foremost Insurance",
  "fred loya": "Fred Loya Insurance",
  "gallagher-bassett": "Gallagher Bassett",
  "ga farm bureau": "Fam Bureau",
  "geico insurance": "Geico",
  "96cvzzgeico": "Geico",
  "96hyzgeico": "Geico",
  "geico insurance company": "Geico",
  "geico insurance - drp": "Geico",
  "geico rx": "Geico",
  "geico express": "Geico",
  "geico": "Geico",
  "geico casualty company": "Geico",
  "geico xd": "Geico",
  "geico regular (fi)": "Geico",
  "geico-v": "Geico",
  "geico xf": "Geico",
  "geico ins company": "Geico",
  "georgia farm bureau insurance": "Georgia Farm Bureau",
  "german mutual": "German Mutual Insurance",
  "general ins co": "General",
  "general casualty company of wisconsi": "General Casualty",
  "grange": "Grange Mutual",
  "grange insurance companies": "Grange Insurance",
  "grange insurance group": "Grange Insurance",
  "great west casualty company": "Great West Casualty",
  "guideone insurnace": "Guide One",
  "guide one insurance": "Guide One",
  "? - hanover insurance company": "Hanover Insurance Company",
  "96cvzzhanover": "Hanover Insurance Company",
  "hanover": "Hanover Insurance Company",
  "the hanover ins. group": "Hanover Insurance Company",
  "hanover insurance": "Hanover Insurance Company",
  "the hanover insurance group": "Hanover Insurance Company",
  "the hanover insurance company": "Hanover Insurance Company",
  "hanover ins": "Hanover Insurance Company",
  "hanover lloyds insurance company": "Hanover Lloyds Insurance",
  "hanover lloyds": "Hanover Lloyds Insurance",
  "the hartford": "Hartford",
  "hartford insurance": "Hartford",
  "? - hardford mutual insurance co.": "Hartford",
  "hartford insurance group": "Hartford",
  "hartford casualty insurance co": "Hartford",
  "hartford, the": "Hartford",
  "haulers insurance co.": "Haulers",
  "hochheim": "Hocheim Prairie Insurance",
  "? - hastings mutual insurance": "Hastings Mutual",
  "hastings mutual insurance": "Hastings Mutual",
  "kemper.": "Kemper Insurance",
  "kemper auto and home group.": "Kemper Insurance",
  "kemper preferred": "Kemper Insurance",
  "? - hortica": "Hortica",
  "high point": "Highpoint",
  "hp": "Highpoint",
  "? - horace mann": "Horace Mann Insurance",
  "horace mann": "Horace Mann Insurance",
  "horace mann property & casualty ins": "Horace Mann Insurance",
  "hybrid claims": "Hybrid Claims Group",
  "? - indiana insurance": "Indiana Insurance",
  "indiana farm bureau insurance": "Indiana Farm Bureau",
  "illinois farmers insurance company": "Illinois Farmers Insurance",
  "imperial fire & casualty": "Imperial Insurance",
  "imt ins group": "IMT Insurance",
  "imt insurance": "IMT Insurance",
  "iowa mutual insurance": "Iowa Mutual",
  "insurad": "Customer Insurance",
  "ins": "Ins Pay (which party unknown)",
  "island insurance companies": "Island Insurance",
  "liberty mutual insurance": "Liberty Mutual",
  "liberty mutual insurance company": "Liberty Mutual",
  "liberty mutual / northwest": "Liberty Mutual",
  "liberty mutual personal insurance c": "Liberty Mutual",
  "liberty mutual insurance co.*": "Liberty Mutual",
  "lib mutall": "Liberty Mutual",
  "liberty mutual agency market": "Liberty Mutual",
  "lm": "Liberty Mutual",
  "? - lancer insurance": "Lancer",
  "? - lincoln general": "Lincoln General",
  "lynx services": "Lynx Insurance",
  "lease plan usa": "Lease Plan",
  "leaseplan risk mgt": "Lease Plan",
  "lemars": "Le Mars Insurance Company",
  "le mars ins": "Le Mars Insurance Company",
  "loya casualty insurance company": "Loya",
  "mei": "Mei Insurance Services",
  "mercury": "Mercury Insurance",
  "mercury ins co of ca": "Mercury Insurance",
  "merc.": "Mercury Insurance",
  "mercury insurance group": "Mercury Insurance",
  "mercury insurance company": "Mercury Insurance",
  "metlife- clara suttles": "Met Life",
  "metlife auto & home": "Met Life",
  "metlife auto and home": "Met Life",
  "met life auto": "Met Life",
  "metlife": "Met Life",
  "metropolitan p&c": "Metropolitan Property & Casualty",
  "? - motorists insurance company": "Motorists Mutual",
  "midwest family": "Midwest Family Mutual",
  "mid-century insurance company": "Mid Century",
  "mutual of enumclaw kennewick": "Mututal of Enumclaw",
  "mutual benefit insurance company*": "Mutual Benefit",
  "? - nat union fire ins co of pitt": "National Union Fire",
  "national general insurance": "National General",
  "njm": "NJM",
  "nationwide": "Nationwide Insurance",
  "nationwide mutual": "Nationwide Insurance",
  "nationwide mutual ins co": "Nationwide Insurance",
  "nationwide insurance*": "Nationwide Insurance",
  "nationwide ins. co. of america": "Nationwide Insurance",
  "nationwide ins": "Nationwide Insurance",
  "nationwide property and casualty com": "Nationwide Insurance",
  "nationwide affinity insurance compan": "Nationwide Affinity Insurance",
  "nationwide affinity ins comp": "Nationwide Affinity Insurance",
  "nationwide agri-business ins": "Nationwide Agribusiness",
  "north american claims solution": "North American",
  "north star general insurance co": "North Star",
  "ohio casualty": "Ohio Casualty Insurance",
  "the ohio casualty insurance company": "Ohio Casualty Insurance",
  "? - pekin ins.": "Pekin Insurance Company",
  "? - pekin insurance company": "Pekin Insurance Company",
  "pekin insurance": "Pekin Insurance Company",
  "permanent general claims service": "Permanent General",
  "? - pharmacists mutual": "Pharmacists Mutual",
  "phh arval": "PHH",
  "phh fleet": "PHH",
  "philadelphia insurance co": "Philadelphia Insurance",
  "pemco insurance": "Pemco",
  "progressive": "Progressive Insurance",
  "progressive ": "Progressive Insurance",
  "progressive casualty ins co": "Progressive Insurance",
  "progressive insurance companies": "Progressive Insurance",
  "progressive insurance co.*": "Progressive Insurance",
  "progressive insurance co": "Progressive Insurance",
  "progressive ins": "Progressive Insurance",
  "progressive canada": "Progressive Insurance",
  "pure insurance": "Pure",
  "? - property casualty insurance co": "Property Casual Insurance",
  "? - q/a insurance": "Q/A Insurance",
  "rural mutual insurance": "Rural Mutual",
  "safeco insurance": "Safeco",
  "safeco insurance company": "Safeco",
  "safeco property & casualty inc": "Safeco",
  "safeco insurance company of indiana": "Safeco",
  "safeco insurance company of oregon": "Safeco",
  "safeco insurance company of illinois": "Safeco",
  "safe auto insurance": "Safe Auto",
  "safeway insurance group": "Safeway",
  "? - sedgwick claims-lewisville tx": "Sedwick Claims",
  "sedgwick claims": "Sedwick Claims",
  "secura insurance": "Secura",
  "secura insurance company": "Secura",
  "? - selective insurance company": "Selective",
  "selective insurance company": "Selective",
  "selective insurance co.": "Selective",
  "selective insurance": "Selective",
  "selective ins.": "Selective",
  "sedgwick claims management services": "Sedgewick Claims",
  "sentry": "Sentry Insurance",
  "sentry ins": "Sentry Insurance",
  "sentry insurance co": "Sentry Insurance",
  "shelter insurance company": "Shelter",
  "shelter ins": "Shelter",
  "? - standard mutual": "Standard Mutual Insurance",
  "? - state auto": "State Auto",
  "? - state auto ins co": "State Auto",
  "? - state auto insurance companies": "State Auto",
  "? - state auto insurance company": "State Auto",
  "state auto insurance co": "State Auto",
  "state auto insurance company": "State Auto",
  "state auto insurance companies": "State Auto",
  "state auto inc. co.": "State Auto",
  "st pauls travlers": "St. Paul Insurance",
  "state farm insurance": "State Farm",
  "state farm mutual automobile ins co": "State Farm",
  "state farm ins spfld claims": "State Farm",
  "state farm/select sevice - s": "State Farm",
  "s farm": "State Farm",
  "state farm metro claims": "State Farm",
  "state farm sf vir": "State Farm",
  "state farm insurance comp": "State Farm",
  "state farm insurance companies": "State Farm",
  "state farm select service": "State Farm",
  "state farm north": "State Farm",
  "state farm direct": "State Farm",
  "state farm ss": "State Farm",
  "state farm $": "State Farm",
  "state farm insurance co": "State Farm",
  "state farm service first 82": "State Farm",
  "state farm dupont": "State Farm",
  "state farm claims": "State Farm",
  "state farm insurance companies*": "State Farm",
  "state farm not select services": "State Farm",
  "state farm not select service": "State Farm",
  "state fram service first": "State Farm",
  "state farm ins": "State Farm",
  "state farm in": "State Farm",
  "state farm/auto claims central": "State Farm",
  "statefarm": "State Farm",
  "st farm": "State Farm",
  "standard mutual": "Standard Mutual Insurance",
  "sterling casualty insurance company": "Sterling Casualty",
  "tennessee farmers mutual insurance ": "Tennessee Farmers Mutual",
  "tennessee farmers mutual insurance c": "Tennessee Farmers Mutual",
  "tennessee farmers mutual insurance c ": "Tennessee Farmers Mutual",
  "texas farm b": "Texas Farm Bureau",
  "town and country": "Town & Country",
  "travelers": "Travelers Insurance",
  "travelers property casualty company": "Travelers Insurance",
  "travelers ": "Travelers Insurance",
  "? - travlers": "Travelers Insurance",
  "travelers insurance company limited": "Travelers Insurance",
  "travelers-san antonio cl": "Travelers Insurance",
  "travelers property casualty co*": "Travelers Insurance",
  "21st century north american ins. co.": "21st Century",
  "tx municipal league": "Texas Municipal League Insurance",
  "usaa": "U S A A",
  "usaa insurance": "U S A A",
  "usaa drive in": "U S A A",
  "usaa insurance co": "U S A A",
  "usaa-unit7777": "U S A A",
  "usaa-usaa": "U S A A",
  "united fire & cas": "United Fire & Casualty",
  "united automobile": "United Automobile Insurance",
  "vision insurance company": "Vision Auto Insurance",
  "qbe insurance corporation": "QBE Insurance",
  "qbe holdings inc.": "QBE Insurance",
  "oregon mutual insurance": "Oregon Mutual",
  "wadena": "Wadena Insurance",
  "west american insurance company": "West American",
  "west bend insurance": "West Bend Mutual",
  "westbend insurance": "West Bend Mutual",
  "western national insurance": "West Bend Mutual",
  "west bend mutual insurance company": "West Bend Mutual",
  "west bend mutual insurance com": "West Bend Mutual",
  "west bend mutual insurance": "West Bend Mutual",
  "wheels inc.": "Wheels",
  "wheels inc": "Wheels",
  "? - western reserve group": "Western Reserve",
  "western national mutual insurance": "Western National",
  "western reserve group": "Western Reserve",
  "? - westfield companies": "Westfield Insurance",
  "? - westfield ins co": "Westfield Insurance",
  "westfield companies": "Westfield Insurance",
  "wilson mutual insurance": "Wilson Mutual",
  "wilson mutual insurance company": "Wilson Mutual",
  "? - york claims service": "York",
  "? - zurich north america": "Zurich Insurance",
  "zurich american insurance company": "Zurich Insurance",
  "zurich north american": "Zurich Insurance",
  "zurich north america": "Zurich Insurance",
};

// ---------------------------------------------------------------------------
// Payment Type mappings (43 entries, lowercase key -> canonical value)
// ---------------------------------------------------------------------------
const PAYMENT_TYPE_MAP: Record<string, string> = {
  "insured": "Customer Insurance",
  "insured ": "Customer Insurance",
  "ins": "Customer Insurance",
  "i": "Customer Insurance",
  " i": "Customer Insurance",
  "cust ins": "Customer Insurance",
  "customer ins.": "Customer Insurance",
  "direct repair program": "Customer Insurance",
  "coll": "Customer Insurance",
  "insurancepay": "Customer Insurance",
  "insurance": "Customer Insurance",
  "insd": "Customer Insurance",
  "c/p": "Customer Pay",
  "c/pay": "Customer Pay",
  "cust pay": "Customer Pay",
  "s": "Customer Pay",
  "customer": "Customer Pay",
  "cash pay": "Customer Pay",
  "c/p ": "Customer Pay",
  "customerpay ": "Customer Pay",
  "customer pay ": "Customer Pay",
  "owner pay": "Customer Pay",
  "cp": "Customer Pay",
  "claimant": "Claimant (Other Insurance)",
  "c": "Claimant (Other Insurance)",
  "clmt": "Claimant (Other Insurance)",
  "clm": "Claimant (Other Insurance)",
  "liab": "Claimant (Other Insurance)",
  "claimant ": "Claimant (Other Insurance)",
  "none": "No Data Supplied",
  "insurance pay": "Customer Insurance",
};

// ---------------------------------------------------------------------------
// Referral type keywords (order matters: first match wins)
// ---------------------------------------------------------------------------
const REFERRAL_KEYWORDS: [string, string][] = [
  ["agent", "Agent"],
  ["dealer", "Dealership"],
  ["insurance", "Insurance Company"],
  ["fleet", "Fleet"],
  ["repeat", "Repeat"],
  ["company", "Company/Business"],
  ["business", "Company/Business"],
  ["individual", "Individual"],
  ["combination", "Combination"],
];

const REFERRAL_YES_TYPES = new Set([
  "Individual",
  "Dealership",
  "Agent",
  "Insurance Company",
  "Fleet",
  "Company/Business",
  "Repeat",
  "Combination",
  "Other",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeInsurance(value: string | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  // N/A variants -> empty
  if (trimmed.toLowerCase() === "n/a" || trimmed.toLowerCase() === "na") return "";
  const canonical = INSURANCE_MAP[trimmed.toLowerCase()];
  return canonical ?? trimmed;
}

function normalizePaymentType(value: string | undefined): string {
  if (!value || !value.trim()) return "No Data Supplied";
  const trimmed = value.trim();
  const canonical = PAYMENT_TYPE_MAP[trimmed.toLowerCase()];
  return canonical ?? trimmed;
}

function categorizeReferralType(referralSource: string | undefined): string {
  if (!referralSource || !referralSource.trim()) return "Unknown";
  const lower = referralSource.trim().toLowerCase();
  if (lower === "not provided by shop") return "Not provided by shop";
  for (const [keyword, category] of REFERRAL_KEYWORDS) {
    if (lower.includes(keyword)) return category;
  }
  return "Other";
}

function normalizeTotalLoss(value: string | undefined): string {
  if (!value || !value.trim()) return "No";
  const v = value.trim().toUpperCase();
  if (v === "TRUE" || v === "1") return "Yes";
  if (v === "FALSE" || v === "0" || v === "") return "No";
  return value;
}

function cleanNA(value: string | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (lower === "n/a" || lower === "na") return "";
  return trimmed;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function applyFMNormalization(rows: Row[]): Row[] {
  return rows.map((row) => {
    const out: Row = { ...row };

    // 1. Insurance Company
    out.InsuranceCompany = normalizeInsurance(row.InsuranceCompany);

    // 2. Payment / Claim Type
    out.ClaimType = normalizePaymentType(row.ClaimType);

    // 3. Referral Source cleanup
    if (row.ReferralSourceName?.trim() === "Why did you choose us?") {
      out.ReferralSourceName = "Unknown";
    }

    // 4. Referral Type categorization
    const refType = categorizeReferralType(out.ReferralSourceName);
    out._referedType = refType;

    // 5. Referral Yes/No
    out._referralYesNo = REFERRAL_YES_TYPES.has(refType) ? "Y" : "N";

    // 6. Repeat Yes/No
    out._repeatYesNo = refType === "Repeat" ? "Y" : "N";

    // 7. Total Loss Flag
    out.Total_Loss = normalizeTotalLoss(row.Total_Loss);

    // 8. Company Name cleanup
    out.OwnerCompanyName = cleanNA(row.OwnerCompanyName);

    // 9. Address2 cleanup
    if (row.OwnerAddress2) {
      const addr2 = row.OwnerAddress2.trim().toUpperCase();
      if (addr2 === "<NONE>" || addr2 === "NONE") {
        out.OwnerAddress2 = "";
      }
    }

    // 10. Agent Name cleanup
    if (row.InsuranceAgentName) {
      const agent = row.InsuranceAgentName.trim();
      const agentLower = agent.toLowerCase();
      if (agent === "Unknown Unknown" || agentLower === "n/a") {
        out.InsuranceAgentName = "";
      }
    }

    // 11. Static fields
    out._crmPackage = "Advantage Program Package";
    out._importStyle = "Imported";

    return out;
  });
}
