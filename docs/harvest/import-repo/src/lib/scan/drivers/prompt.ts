import type { FormSchema } from "../schema";

export function buildExtractionPrompt(schema: FormSchema, multiPage: boolean): string {
  const fieldLines = schema.fields
    .map(
      (f) =>
        `  - "${f.key}" (${f.label}): type=${f.type}${f.required ? " [REQUIRED]" : ""}`
    )
    .join("\n");

  const checkboxLines = schema.checkboxes
    .map(
      (c) =>
        `  - "${c.key}" (${c.label})${c.group ? ` [group: ${c.group}]` : ""}`
    )
    .join("\n");

  const outputShape = multiPage
    ? `OUTPUT FORMAT (strict JSON — array with one object per page/form):
[
  {
    "page": 1,
    "fields": {
      "<key>": { "value": "<extracted string or null>", "confidence": <0.0-1.0> }
    },
    "checkboxes": {
      "<key>": <true | false | null>
    }
  }
]

IMPORTANT: This document contains multiple pages. Each page is a SEPARATE customer form. Return one array entry per page. If a page is blank or not a form, skip it.`
    : `OUTPUT FORMAT (strict JSON):
{
  "fields": {
    "<key>": { "value": "<extracted string or null>", "confidence": <0.0-1.0> }
  },
  "checkboxes": {
    "<key>": <true | false | null>
  }
}`;

  return `You are a document extraction engine. Extract field values from this handwritten collision repair / auto body customer intake form.

This is an ACRB (Automotive Customer Relations Bureau) customer information form. Common fields include customer name, address, phone, vehicle year/make/model, repair dates, repair total, insurance info, and payment type checkboxes.

Extract ONLY the fields listed below. Return ONLY valid JSON — no markdown fences, no explanation.

FIELDS:
${fieldLines}

CHECKBOXES (return true if checked/marked, false if unchecked, null if not visible):
${checkboxLines}

CONFIDENCE SCORING:
- 0.95+ for clearly printed or typed text
- 0.80-0.94 for legible handwriting
- 0.60-0.79 for partially legible or ambiguous
- below 0.60 for guesses or very unclear

${outputShape}

Rules:
- Dates: use MM/DD/YYYY format
- Phone: include area code, any format acceptable
- State: two-letter abbreviation
- Zip: 5-digit or 5+4 format
- If a field is blank or not present on the form, set value to null
- Do NOT infer values — only extract what is written/printed`;
}
