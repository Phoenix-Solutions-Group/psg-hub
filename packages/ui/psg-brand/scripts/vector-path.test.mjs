import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertCleanVectorText,
  serializePath,
  VECTOR_CORRUPTION_PATTERN,
} from "./vector-path.mjs";

function opentypeRoundDecimalBug(value, places) {
  const integerPart = Math.floor(value);
  const decimalPart = value - integerPart;
  return integerPart + +(Math.round(decimalPart + `e+${places}`) + `e-${places}`);
}

describe("serializePath", () => {
  it("does not reproduce the opentype.js exponent-rounding NaN bug", () => {
    assert.ok(Number.isNaN(opentypeRoundDecimalBug(379.00000000000006, 3)));

    const pathData = serializePath([{ type: "M", x: 379.00000000000006, y: 20 }]);

    assert.equal(pathData, "M379 20");
    assert.equal(VECTOR_CORRUPTION_PATTERN.test(pathData), false);
  });

  it("serializes opentype-style line, curve, quadratic, and close commands", () => {
    const pathData = serializePath(
      {
        commands: [
          { type: "M", x: 0, y: -0 },
          { type: "L", x: 10.1254, y: 20.5 },
          { type: "C", x1: 1, y1: 2, x2: 3, y2: 4, x: 5, y: 6 },
          { type: "Q", x1: 7, y1: 8, x: 9, y: 10 },
          { type: "Z" },
        ],
      },
      { places: 3 },
    );

    assert.equal(pathData, "M0 0 L10.125 20.5 C 1 2 3 4 5 6 Q 7 8 9 10 Z");
  });

  it("fails loudly when a command contains a non-finite coordinate", () => {
    assert.throws(
      () => serializePath([{ type: "L", x: Number.POSITIVE_INFINITY, y: 0 }]),
      /non-finite coordinate/,
    );
  });
});

describe("assertCleanVectorText", () => {
  it("rejects corrupt vector tokens before files ship", () => {
    assert.throws(
      () => assertCleanVectorText('<path d="M0 0 LNaN 10" />', "test.svg"),
      /test\.svg contains corrupt vector data token: NaN/,
    );
  });

  it("allows ordinary vector text", () => {
    assert.doesNotThrow(() => assertCleanVectorText('<path d="M0 0 L10 10" />', "test.svg"));
  });
});
