# PSG brand vector export safety

Logo and brand-kit exports must not call `opentype.js` `toPathData()` directly. Version
2.0.0 can silently write `NaN` into path data when a coordinate is extremely close to a whole
number. Renderers may then abandon the rest of the path while the logo still looks mostly
correct.

Use `vector-path.mjs` for outlined font paths:

```js
import { assertCleanVectorText, serializePath } from "./vector-path.mjs";

const d = serializePath(font.getPath("ELLIS", 0, 0, 72), { places: 3 });
assertCleanVectorText(`<path d="${d}" />`, "ellis-logo.svg");
```

Before shipping SVG, PDF, or EPS files, run the hard gate:

```bash
pnpm --filter @psg/brand vector:check -- ./kit
```

The gate fails if any scanned vector file contains `NaN`, `Infinity`, or `undefined`.
