/**
 * KB ChaChaCha historical adapter (www.kbchachacha.com).
 * Persist is VIN-only (pipeline). VIN is fetched from the Carmodoo inspection sheet.
 */

import type {
  ProviderAdapter,
  ListingReference,
  FetchedListing,
  NormalizedListing,
  NormalizedVehicle,
  NormalizedPhoto,
  PaginationInfo,
  SourceMetadata,
} from "@workspace/providers";
import { SOUTH_KOREA } from "../geo";
import {
  KB_PAGE_SIZE,
  extractKbCarSeq,
  kbDetailUrl,
  kbFetchDetail,
  kbFetchInspection,
  kbFetchSearch,
} from "./kbchachacha-http";
import {
  collectKbPhotos,
  extractKbEvents,
  kbListingStatus,
  kbMatchesLocalFilters,
  normalizeKbVin,
  parseKbDetailHtml,
  parseKbInspectionHtml,
  parseKbSearchHtml,
  type KbParsedListing,
  type KbSearchCard,
} from "./kbchachacha-normalize";

export const KBCHACHACHA_PARSER_VERSION = "kbchachacha-v1.0.0";

export interface KbFilterParams {
  brand?: string;
  make?: string;
  model?: string;
  modelGroup?: string;
  yearFrom?: number;
  yearTo?: number;
  fuel?: string;
  minPrice?: number;
  maxPrice?: number;
  minMileage?: number;
  maxMileage?: number;
  location?: string;
  keyword?: string;
  searchQuery?: string;
  maxPages?: number;
  maxListings?: number;
  delayMs?: number;
  concurrency?: number;
  retryCount?: number;
  pageSize?: number;
  skipRecentHours?: number;
}

export class KbchachachaHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "kbchachacha";
  private filters: KbFilterParams;
  private searchCache = new Map<string, KbSearchCard>();

  constructor(_webBaseUrl?: string, filters: KbFilterParams = {}) {
    this.filters = filters;
  }

  async discoverListings(
    page: number,
  ): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const html = await kbFetchSearch({
      page,
      keyword: this.filters.keyword || this.filters.searchQuery,
    });
    const cards = parseKbSearchHtml(html);
    if (page === 1 && cards.length === 0) {
      throw new Error("KB ChaChaCha search returned zero listings on page 1 — likely blocked or HTML changed");
    }
    const listings: ListingReference[] = [];
    for (const card of cards) {
      if (!kbMatchesLocalFilters(card, this.filters)) continue;
      this.searchCache.set(card.carSeq, card);
      listings.push({
        sourceId: card.carSeq,
        url: kbDetailUrl(card.carSeq),
        metadata: {
          title: card.title,
          price: card.priceKrw,
          mileage: card.mileage,
          year: card.year,
        },
      });
    }
    const pageSize = this.filters.pageSize ?? KB_PAGE_SIZE;
    return {
      listings,
      pagination: {
        currentPage: page,
        hasMore: cards.length >= pageSize,
      },
    };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const carSeq = extractKbCarSeq(url);
    if (!carSeq) throw new Error(`Could not extract KB ChaChaCha listing ID from URL: ${url}`);

    const detail = await kbFetchDetail(carSeq);
    const parsed = parseKbDetailHtml(detail.html, carSeq);
    let inspectionHtml: string | null = null;
    if (parsed.inspectionUrl) {
      for (let attempt = 1; attempt <= 3 && !inspectionHtml; attempt++) {
        try {
          inspectionHtml = await kbFetchInspection(parsed.inspectionUrl);
        } catch {
          if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
        }
      }
    }

    const payload = {
      meta: { collectedAt: new Date().toISOString(), detailLevel: "full" as const, provider: "kbchachacha" },
      carSeq,
      search: this.searchCache.get(carSeq) ?? null,
      parsed,
      inspection: inspectionHtml ? parseKbInspectionHtml(inspectionHtml) : null,
    };

    return {
      url: kbDetailUrl(carSeq),
      html: JSON.stringify(payload),
      json: payload,
      statusCode: 200,
      headers: detail.headers,
    };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const payload = (fetched.json ?? {}) as {
      carSeq?: string;
      parsed?: KbParsedListing;
      inspection?: { vin?: string; firstRegistration?: string } | null;
    };
    const parsed = payload.parsed ?? parseKbDetailHtml(typeof fetched.html === "string" ? fetched.html : "", payload.carSeq);
    if (payload.inspection?.vin) parsed.vin = payload.inspection.vin;
    if (payload.inspection?.firstRegistration && !parsed.firstRegistration) {
      parsed.firstRegistration = payload.inspection.firstRegistration.slice(0, 7);
    } else if (payload.inspection?.firstRegistration) {
      parsed.firstRegistration = payload.inspection.firstRegistration;
    }

    const vin = normalizeKbVin(parsed.vin);
    const activity = kbListingStatus(parsed);
    const events = extractKbEvents(parsed);
    const photos = collectKbPhotos(parsed);
    const sourceId = parsed.carSeq || payload.carSeq || extractKbCarSeq(fetched.url) || "unknown";

    const vehicle: NormalizedVehicle = {
      vin,
      make: parsed.make,
      model: parsed.model,
      trim: parsed.trim,
      year: parsed.year,
      fuelType: parsed.fuel,
      transmission: parsed.transmission,
      bodyType: parsed.bodyType,
      engineDisplacement: parsed.engineDisplacement,
      color: parsed.color,
      country: SOUTH_KOREA,
    };

    return {
      sourceId,
      sourceUrl: fetched.url,
      title: parsed.title,
      priceAmount: parsed.priceKrw,
      priceCurrency: "KRW",
      mileage: parsed.mileage,
      mileageUnit: "km",
      location: parsed.location,
      country: SOUTH_KOREA,
      isActive: activity.isActive,
      listingStatus: activity.listingStatus,
      soldAt: activity.listingStatus === "sold" ? new Date() : undefined,
      accidentCount: parsed.history.accidentCount,
      ownerChangeCount: parsed.history.ownerChangeCount,
      events,
      vehicle,
      photos,
    };
  }

  async normalizeVehicle(listing: NormalizedListing): Promise<NormalizedVehicle> {
    return listing.vehicle ?? {};
  }

  extractVIN(listing: NormalizedListing): string | undefined {
    return listing.vehicle?.vin ? normalizeKbVin(listing.vehicle.vin) : undefined;
  }

  extractPhotos(listing: NormalizedListing): NormalizedPhoto[] {
    return listing.photos ?? [];
  }

  getPagination(_fetched: FetchedListing): PaginationInfo {
    return { currentPage: 1, hasMore: false };
  }

  getSourceMetadata(fetched: FetchedListing): SourceMetadata {
    return {
      collectedAt: new Date(),
      rawJson: fetched.html ?? JSON.stringify(fetched.json ?? ""),
    };
  }
}
