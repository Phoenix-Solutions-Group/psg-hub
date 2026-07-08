import { describe, it, expect } from "vitest";
import {
  validateArtworkDoc,
  emptyArtworkDoc,
  ARTWORK_DOC_SCHEMA,
  type ArtworkDoc,
} from "@/lib/production/mail-artwork-doc";

function baseDoc(overrides: Partial<ArtworkDoc> = {}): ArtworkDoc {
  return {
    schema: ARTWORK_DOC_SCHEMA,
    sizeKey: "postcard:6x9",
    baseGraphics: [{ face: "front", assetKey: "co/postcard:6x9/front-abc.png" }],
    elements: [
      { id: "t1", type: "text", face: "front", xIn: 1, yIn: 1, wIn: 3, hIn: 0.5, text: "Hi", z: 2 },
    ],
    ...overrides,
  };
}

describe("mail-artwork-doc: happy path", () => {
  it("accepts a well-formed doc and returns the resolved spec", () => {
    const res = validateArtworkDoc(baseDoc());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.doc.sizeKey).toBe("postcard:6x9");
      expect(res.doc.elements).toHaveLength(1);
      expect(res.doc.elements[0].z).toBe(2);
      expect(res.spec.type).toBe("postcard");
    }
  });
  it("emptyArtworkDoc round-trips through validation", () => {
    const doc = emptyArtworkDoc("letter:8.5x11");
    const res = validateArtworkDoc(doc);
    expect(res.ok).toBe(true);
  });
  it("emptyArtworkDoc throws on an unknown size", () => {
    expect(() => emptyArtworkDoc("postcard:5x7")).toThrow(/Unknown mail size key/);
  });
});

describe("mail-artwork-doc: structural rejects", () => {
  it("rejects non-objects", () => {
    for (const bad of [null, undefined, 3, "x", []]) {
      const res = validateArtworkDoc(bad);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.issues[0].code).toBe("not_object");
    }
  });
  it("rejects an unknown size key", () => {
    const res = validateArtworkDoc(baseDoc({ sizeKey: "postcard:5x7" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.some((i) => i.code === "unknown_size")).toBe(true);
  });
  it("flags a bad schema version", () => {
    const res = validateArtworkDoc(baseDoc({ schema: 99 }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.some((i) => i.code === "bad_schema")).toBe(true);
  });
  it("rejects a base graphic missing an assetKey", () => {
    const res = validateArtworkDoc(
      baseDoc({ baseGraphics: [{ face: "front", assetKey: "" }] })
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const issue = res.issues.find((i) => i.code === "bad_base_graphics");
      expect(issue?.index).toBe(0);
    }
  });
  it("rejects an element with a bad type / missing geometry", () => {
    const res = validateArtworkDoc(
      baseDoc({
        // @ts-expect-error deliberately malformed
        elements: [{ id: "e", type: "video", face: "front", xIn: 0, yIn: 0, wIn: 1 }],
      })
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.some((i) => i.code === "bad_element")).toBe(true);
  });
  it("rejects an element that spills outside the artwork box", () => {
    // 6x9 full-bleed box is 6.25 x 9.25; place a wide element past the right edge.
    const res = validateArtworkDoc(
      baseDoc({
        elements: [{ id: "e", type: "shape", face: "front", xIn: 8, yIn: 0, wIn: 2, hIn: 1 }],
      })
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const issue = res.issues.find((i) => i.code === "element_out_of_bounds");
      expect(issue?.index).toBe(0);
    }
  });
  it("rejects zero/negative-sized elements", () => {
    const res = validateArtworkDoc(
      baseDoc({
        elements: [{ id: "e", type: "shape", face: "front", xIn: 1, yIn: 1, wIn: 0, hIn: 1 }],
      })
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.some((i) => i.code === "element_out_of_bounds")).toBe(true);
  });
  it("drops unknown optional fields but keeps known ones", () => {
    const res = validateArtworkDoc(
      baseDoc({
        elements: [
          {
            id: "e",
            type: "text",
            face: "back",
            xIn: 0.2,
            yIn: 0.2,
            wIn: 2,
            hIn: 0.4,
            font: "Inter",
            size: 12,
            color: "#111",
            // @ts-expect-error extraneous field is ignored
            rotate: 45,
          },
        ],
      })
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      const el = res.doc.elements[0];
      expect(el.font).toBe("Inter");
      expect(el.size).toBe(12);
      expect(el.color).toBe("#111");
      expect("rotate" in el).toBe(false);
    }
  });
});
