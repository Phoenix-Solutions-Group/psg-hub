// PSG-132 — Import reference datasets + standardization rules (public surface).
//
// Net-new IP harvested from `Phoenix-Solutions-Group/import` @ main `a11133d`
// ahead of the PSG-50 decommission. These helpers operate on canonical-38 rows
// (see ./types `Row`) — the same vocabulary as the FileMaker export layer
// (../filemaker). They are a standalone, dependency-free library; live wiring
// into the canonical-38 export pipeline (../filemaker) is the natural follow-up
// integration and is intentionally left out of this change to keep the existing
// import/export tests regression-free.

export type { Row } from "./types";
export { CAR_DATA } from "./car-data";
export { standardizeVehicles } from "./vehicle-standardization";
export { applyRules, DEFAULT_FLEET_KEYWORDS } from "./rules-engine";
export { MASTER_HEADER_MAPPINGS } from "./header-mappings";
export {
  USPS_SUFFIXES,
  USPS_DIRECTIONALS,
  USPS_UNITS,
  UNIT_DESIGNATORS,
  UNIT_RE,
  expandStreetSuffix,
  extractUnit,
} from "./address-units";
