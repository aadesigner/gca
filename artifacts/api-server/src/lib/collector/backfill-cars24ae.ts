/**
 * Legacy Cars24.ae backfill from stored raw HTML.
 * HTML is no longer stored — this is a no-op.
 */

interface SqlPool {
  query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number | null }>;
}

export interface Cars24BackfillStats {
  scanned: number;
  listingsUpdated: number;
  vehiclesUpdated: number;
  photosReplaced: number;
  skipped: number;
}

export async function backfillCars24FromRaw(_pool: SqlPool): Promise<Cars24BackfillStats> {
  return {
    scanned: 0,
    listingsUpdated: 0,
    vehiclesUpdated: 0,
    photosReplaced: 0,
    skipped: 0,
  };
}
