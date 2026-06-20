import type { Row } from "./types";
import { CAR_DATA } from "./car-data";

// BMS abbreviation -> full make name (80+ mappings)
const VEHICLE_MAKE_TABLE: Record<string, string> = {
  // Domestic
  CHEV: "Chevrolet", CHEVROLET: "Chevrolet", CHEVY: "Chevrolet",
  FORD: "Ford", LINC: "Lincoln", LINCOLN: "Lincoln",
  DODG: "Dodge", DODGE: "Dodge", CHRY: "Chrysler", CHRYSLER: "Chrysler",
  JEEP: "Jeep", RAM: "Ram", BUIC: "Buick", BUICK: "Buick",
  CADI: "Cadillac", CADILLAC: "Cadillac", GMC: "GMC",
  PONT: "Pontiac", PONTIAC: "Pontiac", OLDS: "Oldsmobile",
  SATU: "Saturn", SATURN: "Saturn", HUMMER: "Hummer", HUMM: "Hummer",
  TESL: "Tesla", TESLA: "Tesla",

  // Japanese
  TOYT: "Toyota", TOYOTA: "Toyota", HOND: "Honda", HONDA: "Honda",
  NISS: "Nissan", NISSAN: "Nissan", DATS: "Datsun",
  MAZD: "Mazda", MAZDA: "Mazda", MITS: "Mitsubishi", MITSUBISHI: "Mitsubishi",
  SUBA: "Subaru", SUBARU: "Subaru", SUZI: "Suzuki", SUZUKI: "Suzuki",
  INFI: "Infiniti", INFINITI: "Infiniti", ACUR: "Acura", ACURA: "Acura",
  LEXS: "Lexus", LEXUS: "Lexus", SCIO: "Scion", SCION: "Scion",
  ISUZ: "Isuzu", ISUZU: "Isuzu",

  // European
  BMW: "BMW", MERZ: "Mercedes-Benz", MERCEDES: "Mercedes-Benz", "MERCEDES-BENZ": "Mercedes-Benz",
  MERC: "Mercedes-Benz", BENZ: "Mercedes-Benz",
  AUDI: "Audi", VOLK: "Volkswagen", VOLKSWAGEN: "Volkswagen", VW: "Volkswagen",
  VOLV: "Volvo", VOLVO: "Volvo", SAAB: "Saab",
  PORS: "Porsche", PORSCHE: "Porsche", JAGU: "Jaguar", JAGUAR: "Jaguar",
  LNDR: "Land Rover", "LAND ROVER": "Land Rover", LANDROVER: "Land Rover",
  RANG: "Range Rover",
  MINI: "Mini", FIAT: "Fiat", ALFA: "Alfa Romeo", "ALFA ROMEO": "Alfa Romeo",
  MASE: "Maserati", MASERATI: "Maserati", FERR: "Ferrari", FERRARI: "Ferrari",
  LAMB: "Lamborghini", LAMBORGHINI: "Lamborghini",
  BENT: "Bentley", BENTLEY: "Bentley", ROLS: "Rolls-Royce", "ROLLS-ROYCE": "Rolls-Royce",
  ASTN: "Aston Martin", "ASTON MARTIN": "Aston Martin",
  LOTU: "Lotus", LOTUS: "Lotus", MCLA: "McLaren", MCLAREN: "McLaren",

  // Korean
  HYUN: "Hyundai", HYUNDAI: "Hyundai", KIA: "Kia",
  GENE: "Genesis", GENESIS: "Genesis",

  // Commercial / Truck
  FRTL: "Freightliner", FREIGHTLINER: "Freightliner",
  INTL: "International", INTERNATIONAL: "International",
  PTRB: "Peterbilt", PETERBILT: "Peterbilt",
  KENW: "Kenworth", KENWORTH: "Kenworth",
  MACK: "Mack", VLVO: "Volvo Trucks",
  WEST: "Western Star", HINO: "Hino",
  STER: "Sterling",

  // Other
  SMART: "Smart", RIVN: "Rivian", RIVIAN: "Rivian",
  LUCI: "Lucid", LUCID: "Lucid",
  POLS: "Polestar", POLESTAR: "Polestar",
  TOYO: "Toyota",
  ASTO: "Aston Martin", "ASTON": "Aston Martin",
};

// Trim levels, drivetrain, body styles, and option packages to strip.
// We only want the base model (e.g. "Macan" not "Macan S AWD W/Preferred Pkg").
const TRIM_CODES = new Set([
  // Drivetrain
  "AWD", "FWD", "RWD", "4WD", "2WD", "4X4", "4X2", "4MATIC", "XDRIVE", "QUATTRO",
  "E-4ORCE", "E4ORCE", "ETRON", "E-TRON",
  // Volvo/European powertrains
  "B3", "B4", "B5", "B6", "T4", "T5", "T6", "T8", "D4", "D5",
  "RECHARGE", "INSCRIPTION", "MOMENTUM", "R-DESIGN",
  // Common trim levels
  "S", "SV", "SE", "SR", "SL", "LE", "XLE", "XSE", "LX", "EX", "LXS", "SX",
  "GT", "GTS", "GTI", "RS", "SS", "LT", "LS", "LTZ", "GLS", "GL",
  "AT4", "SLT", "SLE", "TRD", "XLT", "SEL", "SXT", "SR5",
  "RT", "ST", "SRT", "AMG", "TDI", "TSI", "PHEV", "EV",
  "V6", "V8", "I4", "L4", "CVT", "DX", "CX", "ZR2",
  "II", "III", "IV", "XL", "HD", "LD",
  "SPORT", "TOURING", "LIMITED", "PREMIUM", "PREFERRED", "PRESTIGE", "PREMIER",
  "PLUS", "PRO", "BASE", "LUXURY", "PLATINUM", "TITANIUM",
  "DENALI", "LARAMIE", "LAREDO", "OVERLAND", "TRAILHAWK", "LATITUDE",
  "CLASSIC", "EXPRESS", "TRADESMAN", "BIGHORN", "LONE", "STAR",
  "LARIAT", "RAPTOR", "TREMOR", "WILDTRAK",
  "KING", "RANCH", "SUPERCREW", "SUPERCAB",
  "X-LINE", "NIGHTFALL", "CALLIGRAPHY",
  // Body styles / variants
  "COUPE", "SEDAN", "HATCHBACK", "CONVERTIBLE", "WAGON", "ROADSTER",
  "QUAD", "CAB", "CREW", "REGULAR", "DOUBLE", "MEGA", "ACCESS",
  "EXTENDED", "STANDARD", "CARGO", "PASSENGER", "VAN",
  "CLUBMAN", "COUNTRYMAN", "HARDTOP", "PACEMAN",
  // Misc
  "AUTOMATIC", "MANUAL", "HYBRID", "PLUG-IN",
  "PKG", "PACKAGE", "EDITION", "SPECIAL", "SIGNATURE", "RESERVE",
  "ADVANCE", "TECHNOLOGY", "A-SPEC", "TYPE-S", "TYPE-R",
  "NISMO", "MIDNIGHT",
]);

// Hyphenated model codes: input (lowercased) -> correct form
const MODEL_CODE_MAP: Record<string, string> = {
  "cr-v": "CR-V", "hr-v": "HR-V", "br-v": "BR-V", "wr-v": "WR-V",
  "cx-5": "CX-5", "cx-3": "CX-3", "cx-9": "CX-9", "cx-30": "CX-30",
  "cx-50": "CX-50", "cx-70": "CX-70", "cx-90": "CX-90",
  "mx-5": "MX-5", "mx-30": "MX-30",
  "rav4": "RAV4", "gr86": "GR86", "bz4x": "bZ4X",
  "rc-f": "RC-F", "lc-f": "LC-F", "is-f": "IS-F",
  "x-trail": "X-Trail",
  "e-pace": "E-Pace", "f-pace": "F-Pace", "i-pace": "I-Pace",
  "f-150": "F-150", "f-250": "F-250", "f-350": "F-350", "f-450": "F-450",
  "e-transit": "E-Transit",
  "id.4": "ID.4", "id.3": "ID.3", "id.buzz": "ID.Buzz",
  "ct4-v": "CT4-V", "ct5-v": "CT5-V",
  "x-line": "X-Line",
};

// All-uppercase model names (Lincoln MKT, MKZ, MKC, MKX, etc. + luxury codes)
const UPPERCASE_MODELS = new Set([
  "MKT", "MKZ", "MKC", "MKX", "MKS",
  "GV60", "GV70", "GV80", "G70", "G80", "G90",
  "GLC", "GLE", "GLS", "GLB", "GLA", "AMG",
  "RDX", "MDX", "TLX", "ILX", "NSX", "CDX",
  "NX", "RX", "UX", "LX", "GX", "TX", "ES", "IS", "LS", "LC", "RC",
  "Q3", "Q5", "Q7", "Q8", "A3", "A4", "A5", "A6", "A7", "A8", "S3", "S4", "S5", "S6", "S7", "S8",
  "TT", "RS3", "RS5", "RS6", "RS7",
  "X1", "X2", "X3", "X4", "X5", "X6", "X7", "XM", "IX",
  "M2", "M3", "M4", "M5", "M8",
  "XC40", "XC60", "XC90", "S60", "S90", "V60", "V90", "C40", "EX30", "EX90",
  "CT4", "CT5", "XT4", "XT5", "XT6", "LYRIQ", "ESCALADE",
  "QX50", "QX55", "QX60", "QX80", "Q50", "Q60",
]);

/**
 * Strip trim levels, drivetrain, body style, and option tokens from a model name.
 * Keeps only the base model.
 */
/**
 * Check if a token looks like a trim/variant code (not part of the base model).
 * Catches: SLT1, 760I, 535I, LT1, etc.
 */
function isTrimPattern(upper: string): boolean {
  // Known trim code with trailing digit(s): SLT1, LT1, RS3, etc.
  if (/^[A-Z]{1,4}\d{1,2}$/.test(upper) && !UPPERCASE_MODELS.has(upper)) return true;
  // 3+ digit number followed by letter(s): 760I, 535I, 328I, 550I
  if (/^\d{3,}[A-Z]+$/i.test(upper)) return true;
  return false;
}

// Words that should never be split from the following word
// "Model 3", "Model Y", "Model S", "Model X", "Series"
const MODEL_KEEP_NEXT = new Set(["MODEL", "SERIES"]);

// Known model numbers that are part of the base model name, not trims.
// Format: "MAKE:MODEL_PREFIX" -> the number is part of the model.
// e.g. Lexus RX 350: "LEXUS:RX" means a number after RX is model, not trim.
const NUMERIC_MODEL_PREFIXES = new Set([
  // Lexus
  "RX", "LX", "NX", "UX", "GX", "TX", "ES", "IS", "LS", "LC", "RC",
  // Infiniti
  "Q", "QX",
  // Audi
  "A", "S", "Q",
  // BMW
  "X", "M", "Z",
  // Mercedes
  "GLE", "GLC", "GLS", "GLB", "GLA", "CLA", "CLE", "AMG",
  // Volvo
  "XC", "S", "V", "C", "EX",
  // Cadillac
  "CT", "XT",
  // Genesis
  "G", "GV",
  // Chevrolet / GMC
  "SILVERADO", "SIERRA", "COLORADO", "CANYON",
  // Ram / Dodge
  "RAM",
  // Ford
  "F",
]);

function stripTrim(model: string): string {
  const words = model.split(/\s+/);
  const kept: string[] = [];

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const upper = w.toUpperCase().replace(/[.,]/g, "");

    // Stop at slash-prefixed tokens (W/PREFERRED, etc.)
    if (upper.startsWith("W/") || upper.startsWith("/")) break;
    // Stop at known trim codes -- but NOT if previous word expects a number/letter
    if (TRIM_CODES.has(upper)) {
      // Check if the previous word is a model prefix that needs this as part of the name
      const prevUpper = kept.length > 0 ? kept[kept.length - 1].toUpperCase() : "";
      if (MODEL_KEEP_NEXT.has(prevUpper)) {
        // "Model" + "3" or "Model" + "Y" -- keep it
        kept.push(w);
        continue;
      }
      break;
    }
    // Stop at trim-like patterns (SLT1, 760I, etc.) -- but only after first word
    if (kept.length > 0 && isTrimPattern(upper)) break;
    // Standalone numbers after first word: keep if previous word is a known model prefix
    if (/^\d+$/.test(w) && kept.length > 0) {
      const prevUpper = kept[kept.length - 1].toUpperCase();
      if (NUMERIC_MODEL_PREFIXES.has(prevUpper) || MODEL_KEEP_NEXT.has(prevUpper)) {
        kept.push(w);
        continue;
      }
      // Stop -- this number is likely a trim/engine code
      break;
    }
    kept.push(w);
  }

  return kept.length > 0 ? kept.join(" ") : model;
}

/**
 * Normalize model name casing. Handles hyphenated codes (CR-V, CX-5, F-150),
 * all-uppercase luxury codes (Q5, GLE, MKT), and standard title case.
 */
function normalizeModelCase(model: string): string {
  // Check whole model against known codes first
  const modelLower = model.toLowerCase().replace(/\s+/g, "");
  for (const [key, val] of Object.entries(MODEL_CODE_MAP)) {
    if (modelLower === key.replace(/-/g, "")) return val;
  }

  return model
    .split(/\s+/)
    .map((w) => {
      if (!w) return w;
      // Check hyphenated code map
      const lw = w.toLowerCase();
      if (MODEL_CODE_MAP[lw]) return MODEL_CODE_MAP[lw];
      // Check uppercase model set
      const uw = w.toUpperCase();
      if (UPPERCASE_MODELS.has(uw)) return uw;
      // Alphanumeric codes (1500, 2500, 350, etc.) -- keep as-is
      if (/^\d+$/.test(w)) return w;
      // Short alphanumeric codes (GV80, XC90) -- uppercase
      if (/^[A-Z]*\d+[A-Z]*$/i.test(w) && w.length <= 5) return uw;
      // Already mixed case -- leave alone
      if (w !== w.toUpperCase() && w !== w.toLowerCase()) return w;
      // Standard title case
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * Standardize vehicle makes using BMS abbreviation table,
 * title-case models, validate year range.
 */
export function standardizeVehicles(rows: Row[]): { rows: Row[]; flagged: number } {
  let flagged = 0;
  const currentYear = new Date().getFullYear();
  const maxYear = currentYear + 1;

  const result = rows.map((row) => {
    const updated = { ...row };

    // Make: expand BMS abbreviation, then validate against car data
    const rawMake = (row.VehicleMake ?? "").trim();
    if (rawMake) {
      const lookupKey = rawMake.toUpperCase();
      // 1. Try BMS abbreviation table first
      const bmsMatch = VEHICLE_MAKE_TABLE[lookupKey];
      if (bmsMatch) {
        // Verify against car data for canonical casing
        const carEntry = CAR_DATA[bmsMatch.toLowerCase()];
        updated.VehicleMake = carEntry?.canonical ?? bmsMatch;
      } else {
        // 2. Try car data directly (handles full names)
        const carEntry = CAR_DATA[rawMake.toLowerCase()];
        if (carEntry) {
          updated.VehicleMake = carEntry.canonical;
        } else {
          updated.VehicleMake = normalizeModelCase(rawMake);
        }
      }
    }

    // Model: strip trim codes, then validate against car data
    const rawModel = (row.VehicleModel ?? "").trim();
    if (rawModel) {
      const stripped = stripTrim(rawModel);
      const makeEntry = CAR_DATA[updated.VehicleMake?.toLowerCase() ?? ""];
      if (makeEntry) {
        // Try to match model against known models for this make
        const modelLower = stripped.toLowerCase();
        const knownModel = makeEntry.models.find((m) => m === modelLower);
        if (knownModel) {
          // Use canonical casing from the dataset
          updated.VehicleModel = normalizeModelCase(knownModel);
        } else {
          // No exact match -- try partial
          const partial = makeEntry.models.find(
            (m) => m.startsWith(modelLower) || modelLower.startsWith(m)
          );
          if (partial) {
            updated.VehicleModel = normalizeModelCase(partial);
          } else {
            updated.VehicleModel = normalizeModelCase(stripped);
          }
        }
      } else {
        updated.VehicleModel = normalizeModelCase(stripped);
      }
    }

    // Year: validate range
    const rawYear = (row.VehicleYear ?? "").trim();
    if (rawYear) {
      const year = parseInt(rawYear, 10);
      if (!isNaN(year) && (year < 1980 || year > maxYear)) {
        updated._vehicleWarning = `Year ${year} outside valid range (1980-${maxYear})`;
        flagged++;
      }
    }

    return updated;
  });

  return { rows: result, flagged };
}
