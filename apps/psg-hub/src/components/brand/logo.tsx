import { cn } from "@/lib/utils";

// PSG logo — DS RECONSTRUCTION sourced from packages/ui/psg-brand/assets/.
// The design system self-declares these SVGs as a reconstruction from the brand
// brief; operator approved using them now. Swap the official vector when available,
// and re-copy from the submodule (packages/ui/psg-brand/assets) on any brand update.
type LogoVariant = "primary" | "reverse" | "mark";

const SRC: Record<LogoVariant, string> = {
  primary: "/brand/psg-logo-primary.svg", // on light surfaces
  reverse: "/brand/psg-logo-reverse.svg", // on dark surfaces (navy)
  mark: "/brand/psg-mark.svg", // Phoenix mark only
};

export function Logo({
  variant = "primary",
  className,
  alt = "Phoenix Solutions Group",
}: {
  variant?: LogoVariant;
  className?: string;
  alt?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static brand SVG, sized via className
    <img src={SRC[variant]} alt={alt} className={cn("block select-none", className)} />
  );
}
