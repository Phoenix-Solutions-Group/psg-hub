import localFont from "next/font/local";

// PSG brand fonts from the design-system submodule (packages/ui/psg-brand/fonts).
// Gotham = headings/display, Didact Gothic = body. Gotham Rounded is intentionally
// NOT wired (brand reserves it for marketing). next/font/local statically analyzes
// its arguments, so paths MUST be explicit string literals (no variable/interpolation).
export const gotham = localFont({
  variable: "--font-gotham",
  display: "swap",
  src: [
    { path: "../../../../packages/ui/psg-brand/fonts/Gotham-Light.otf", weight: "300", style: "normal" },
    { path: "../../../../packages/ui/psg-brand/fonts/Gotham-Book.otf", weight: "400", style: "normal" },
    { path: "../../../../packages/ui/psg-brand/fonts/Gotham-Medium.otf", weight: "500", style: "normal" },
    { path: "../../../../packages/ui/psg-brand/fonts/Gotham-Bold.otf", weight: "700", style: "normal" },
    { path: "../../../../packages/ui/psg-brand/fonts/Gotham-Black.otf", weight: "800", style: "normal" },
  ],
});

export const didact = localFont({
  variable: "--font-didact",
  display: "swap",
  weight: "400",
  style: "normal",
  src: "../../../../packages/ui/psg-brand/fonts/DidactGothic-Regular.ttf",
});
