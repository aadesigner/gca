/**
 * Railway private Postgres (*.railway.internal) does not speak SSL.
 * Public proxy URLs (*.rlwy.net) need SSL with a relaxed cert check.
 */
export function isPrivateOrLocalPostgres(connectionString: string): boolean {
  return /railway\.internal/i.test(connectionString) || /localhost|127\.0\.0\.1/i.test(connectionString);
}

export function pgSsl(
  connectionString = process.env.DATABASE_URL ?? "",
): false | { rejectUnauthorized: boolean } | undefined {
  if (!connectionString) return undefined;
  if (isPrivateOrLocalPostgres(connectionString) || /sslmode=disable/i.test(connectionString)) {
    return false;
  }
  if (process.env.NODE_ENV === "production") {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

/** Force sslmode=disable on private URLs — query-string sslmode=require overrides `ssl: false`. */
export function pgConnectionString(
  connectionString = process.env.DATABASE_URL ?? "",
): string {
  if (!connectionString || !isPrivateOrLocalPostgres(connectionString)) {
    return connectionString;
  }
  const [base, query] = connectionString.split("?");
  const params = (query ?? "")
    .split("&")
    .map((part) => part.trim())
    .filter((part) => part && !part.toLowerCase().startsWith("sslmode="));
  params.push("sslmode=disable");
  return `${base}?${params.join("&")}`;
}

export function describeDatabaseTarget(connectionString = process.env.DATABASE_URL ?? ""): string {
  try {
    const normalized = connectionString.replace(/^postgres(ql)?:/i, "http:");
    const url = new URL(normalized);
    const host = url.hostname || "(no-host)";
    const port = url.port || "5432";
    const db = url.pathname || "/";
    const sslmode = url.searchParams.get("sslmode") || "default";
    return `${host}:${port}${db} sslmode=${sslmode}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

export function formatPgError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const extra = err as Error & { code?: string; detail?: string; hint?: string };
  return [
    extra.message,
    extra.code ? `code=${extra.code}` : "",
    extra.detail ? `detail=${extra.detail}` : "",
    extra.hint ? `hint=${extra.hint}` : "",
    extra.stack ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}
