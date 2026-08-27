import { cn } from "@/lib/utils";

type LogoProps = {
  className?: string;
  /** Tailwind text-size / spacing classes for the lockup */
  textClassName?: string;
  variant?: "default" | "inverse";
};

/**
 * GetCarAPI text wordmark — GetCar + animated API gradient + .com
 */
export function Logo({
  className,
  textClassName = "text-[1.125rem]",
  variant = "default",
}: LogoProps) {
  const tone = variant === "inverse" ? "brand-lockup--dark" : "brand-lockup--day";

  return (
    <div className={cn("inline-flex min-w-0 items-center", className)}>
      <span
        className={cn("brand-lockup", tone, textClassName)}
        aria-label="GetCarAPI"
      >
        <span className="brand-get">GetCar</span>
        <span className="brand-api">API</span>
        <span className="brand-tld">.com</span>
      </span>
    </div>
  );
}

/** Compact mark — same wordmark, smaller. */
export function LogoMark({
  className,
  inverse = false,
}: {
  className?: string;
  inverse?: boolean;
}) {
  return (
    <Logo
      variant={inverse ? "inverse" : "default"}
      textClassName={cn("text-sm", className)}
      className="shrink-0"
    />
  );
}
