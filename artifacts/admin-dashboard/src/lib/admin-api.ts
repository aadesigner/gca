async function adminFetch(path: string, init?: RequestInit) {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string | { message?: string }; message?: string };
    const msg =
      typeof body.error === "string"
        ? body.error
        : body.error?.message ?? body.message ?? `Request failed (${res.status})`;
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

export interface VehicleStats {
  total: number;
  withListings: number;
  withObservations: number;
  byMake: Array<{ make: string | null; count: number }>;
  byCountry?: Array<{ country: string | null; count: number }>;
  byProvider?: Array<{ id: number; name: string; count: number }>;
}

export function fetchVehicleStats(make?: string, country?: string, providerId?: number, search?: string) {
  const qs = new URLSearchParams();
  if (search) qs.set("search", search);
  if (make) qs.set("make", make);
  if (country) qs.set("country", country);
  if (providerId) qs.set("providerId", String(providerId));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return adminFetch(`/admin/vehicles/stats${suffix}`) as Promise<VehicleStats>;
}

export function deleteVehicle(vin: string) {
  return adminFetch(`/admin/vehicles/${encodeURIComponent(vin)}`, { method: "DELETE" });
}

export function deleteAllVehicles() {
  return adminFetch("/admin/vehicles/purge", { method: "DELETE" });
}

export function pauseJob(id: number) {
  return adminFetch(`/admin/jobs/${id}/pause`, { method: "POST" });
}

export function resumeJob(
  id: number,
  body?: {
    filterParams?: Record<string, unknown>;
    jobType?: string;
    targetUrl?: string | null;
    resetProgress?: boolean;
  },
) {
  return adminFetch(`/admin/jobs/${id}/resume`, {
    method: "POST",
    body: JSON.stringify(body ?? {}),
  });
}

export function purgeJob(id: number) {
  return adminFetch(`/admin/jobs/${id}/purge`, { method: "DELETE" });
}

export function purgeAllJobs(status?: string) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return adminFetch(`/admin/jobs/purge${qs}`, { method: "DELETE" });
}

export async function downloadCsv(path: string) {
  return downloadAdminFile(path);
}

export async function downloadAdminFile(path: string) {
  const res = await fetch(`/api${path}`, { credentials: "include" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Export failed (${res.status})`);
  }
  const blob = await res.blob();
  const match = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/);
  const filename = match?.[1] ?? "export.bin";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface VinImportResult {
  listingsRead: number;
  vehiclesUpserted: number;
  listingsUpserted: number;
  photosAdded: number;
  observationsAdded: number;
  eventsAdded: number;
  skippedNoVin: number;
  providersCreated: string[];
  errors: string[];
}

export function importVinCatalog(payload: unknown) {
  return adminFetch("/admin/vins/import", {
    method: "POST",
    body: JSON.stringify(payload),
  }) as Promise<VinImportResult>;
}
