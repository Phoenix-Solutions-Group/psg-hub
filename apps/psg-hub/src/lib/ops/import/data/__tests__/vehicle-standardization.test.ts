// PSG-132 — Tests for the ported vehicle make/model standardization.

import { describe, it, expect } from "vitest";
import { standardizeVehicles } from "@/lib/ops/import/data/vehicle-standardization";
import type { Row } from "@/lib/ops/import/data/types";

const row = (r: Partial<Record<string, string>>): Row => ({ ...r }) as Row;

describe("standardizeVehicles — make standardization", () => {
  it("expands BMS make abbreviations to canonical make names", () => {
    const { rows } = standardizeVehicles([
      row({ VehicleMake: "CHEV" }),
      row({ VehicleMake: "TOYT" }),
      row({ VehicleMake: "MERZ" }),
      row({ VehicleMake: "VW" }),
      row({ VehicleMake: "LNDR" }),
    ]);
    expect(rows.map((r) => r.VehicleMake)).toEqual([
      "Chevrolet",
      "Toyota",
      "Mercedes-Benz",
      "Volkswagen",
      "Land Rover",
    ]);
  });

  it("canonicalizes full make names case-insensitively via the car dataset", () => {
    const { rows } = standardizeVehicles([
      row({ VehicleMake: "peugeot" }),
      row({ VehicleMake: "MASERATI" }),
    ]);
    expect(rows[0].VehicleMake).toBe("Peugeot");
    expect(rows[1].VehicleMake).toBe("Maserati");
  });

  it("leaves an unknown make title-cased rather than dropping it", () => {
    const { rows } = standardizeVehicles([row({ VehicleMake: "ZIPCAR MOTORS" })]);
    expect(rows[0].VehicleMake).toBe("Zipcar Motors");
  });
});

describe("standardizeVehicles — model trim stripping", () => {
  it("strips trim/drivetrain/package tokens to the base model", () => {
    const { rows } = standardizeVehicles([
      row({ VehicleMake: "PORS", VehicleModel: "Macan S AWD W/Preferred Pkg" }),
      row({ VehicleMake: "FORD", VehicleModel: "F-150 XLT SuperCrew" }),
      row({ VehicleMake: "HOND", VehicleModel: "cr-v EX-L AWD" }),
    ]);
    expect(rows[0].VehicleModel).toBe("Macan");
    expect(rows[1].VehicleModel).toBe("F-150");
    expect(rows[2].VehicleModel).toBe("CR-V");
  });

  it("keeps numeric/letter model designators after a keep-next prefix", () => {
    const { rows } = standardizeVehicles([
      row({ VehicleMake: "TESL", VehicleModel: "Model 3 AWD" }),
    ]);
    expect(rows[0].VehicleModel).toBe("Model 3");
  });
});

describe("standardizeVehicles — year validation", () => {
  it("flags model years outside the valid range", () => {
    const { rows, flagged } = standardizeVehicles([
      row({ VehicleMake: "FORD", VehicleYear: "1950" }),
      row({ VehicleMake: "FORD", VehicleYear: "2022" }),
    ]);
    expect(flagged).toBe(1);
    expect(rows[0]._vehicleWarning).toMatch(/1950 outside valid range/);
    expect(rows[1]._vehicleWarning).toBeUndefined();
  });
});
