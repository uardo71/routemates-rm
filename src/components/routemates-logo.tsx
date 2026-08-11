import { cn } from "@/lib/utils";

// Full Routemates lockup (gem + wordmark). Pick the variant by surface:
//  - "negative" (light/reversed) for DARK chrome like the ink-navy sidebar,
//  - "mono" / "color" (dark gem) for LIGHT surfaces like the login card or documents.
// All three PNGs have transparent backgrounds. Size via `className` (default h-9).
//
// Plain <img> on purpose (not next/image): these are tiny static brand assets; next/image's
// optimizer choked on them in dev and its `priority` preload produced a broken image, so the
// framework machinery was pure downside here.
const SRC = {
  negative: "/routemates-negative.png",
  mono: "/routemates-mono.png",
  color: "/routemates-color.png",
} as const;

export function RoutematesLogo({
  variant = "negative",
  className,
}: {
  variant?: keyof typeof SRC;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={SRC[variant]} alt="Routemates" className={cn("h-9 w-auto", className)} />
  );
}
