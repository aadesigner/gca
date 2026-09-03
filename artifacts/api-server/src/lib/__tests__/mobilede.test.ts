import { describe, it, expect } from "vitest";
import { MobiledeHistoricalAdapter } from "../providers/mobilede";

describe("MobiledeHistoricalAdapter", () => {
  const adapter = new MobiledeHistoricalAdapter();

  it("parses VIP response with VIN in description", async () => {
    const fetched = {
      url: "https://suchen.mobile.de/fahrzeuge/details.html?id=123",
      statusCode: 200,
      headers: {},
      json: {
        ad: {
          id: 123,
          title: "BMW 320d xDrive Touring M Sport",
          shortTitle: "BMW 320d",
          subTitle: "xDrive Touring M Sport",
          makeKey: "BMW",
          modelKey: "320d",
          price: { grossAmount: 35900, grossCurrency: "EUR" },
          category: "EstateCar",
          attributes: [
            { label: "Mileage", tag: "mileage", value: "78,500 km" },
            { label: "First Registration", tag: "firstRegistration", value: "03/2020" },
            { label: "Fuel", tag: "fuel", value: "Diesel" },
            { label: "Transmission", tag: "transmission", value: "Automatik" },
            { label: "Color", tag: "color", value: "Schwarz Metallic" },
            { label: "Displacement", tag: "cubicCapacity", value: "1,995 ccm" },
          ],
          htmlDescription:
            "<b>Top gepflegt!</b><br>VIN: WBAPH5C51BA123456<br>Service komplett bei BMW.",
          galleryImages: [
            {
              src: "https://img.classistatic.de/api/v1/mo-prod/images/aa/aabbccdd?rule=mo-360",
              srcSet:
                "https://img.classistatic.de/api/v1/mo-prod/images/aa/aabbccdd?rule=mo-360 360w, https://img.classistatic.de/api/v1/mo-prod/images/aa/aabbccdd?rule=mo-1024 1024w, https://img.classistatic.de/api/v1/mo-prod/images/aa/aabbccdd?rule=mo-1600 1600w",
            },
            {
              src: "https://img.classistatic.de/api/v1/mo-prod/images/bb/bbeeffgg?rule=mo-360",
              srcSet:
                "https://img.classistatic.de/api/v1/mo-prod/images/bb/bbeeffgg?rule=mo-360 360w, https://img.classistatic.de/api/v1/mo-prod/images/bb/bbeeffgg?rule=mo-1600 1600w",
            },
          ],
          ogImage: {
            src: "https://img.classistatic.de/api/v1/mo-prod/images/aa/aabbccdd?rule=mo-1600",
          },
          contactInfo: { location: "80333 München", country: "DE" },
          // ⚠ This must be completely ignored by the parser
          similarAdsInfo: {
            items: [
              {
                id: 999,
                title: "OTHER CAR",
                htmlDescription: "VIN: WF0XXXGCDX1234567",
                galleryImages: [
                  { src: "https://img.classistatic.de/api/v1/mo-prod/images/zz/other?rule=mo-1600" },
                ],
              },
            ],
          },
        },
      },
    };

    const listing = await adapter.parseListing(fetched);

    expect(listing.sourceId).toBe("123");
    expect(listing.vehicle?.vin).toBe("WBAPH5C51BA123456");
    expect(listing.vehicle?.make).toBe("BMW");
    expect(listing.vehicle?.model).toBe("320d");
    expect(listing.priceAmount).toBe(35900);
    expect(listing.priceCurrency).toBe("EUR");
    expect(listing.mileage).toBe(78500);
    expect(listing.vehicle?.fuelType).toBe("Diesel");
    expect(listing.vehicle?.transmission).toBe("Automatic");
    expect(listing.vehicle?.color).toBe("Black");
    expect(listing.vehicle?.bodyType).toBe("Wagon");
    expect(listing.vehicle?.year).toBe(2020);

    // Photos should come ONLY from ad.galleryImages, not similarAdsInfo
    expect(listing.photos?.length).toBe(2);
    expect(listing.photos?.[0]?.sourceUrl).toContain("aabbccdd");
    expect(listing.photos?.[0]?.sourceUrl).toContain("mo-1600");
    // Must NOT contain the "other" image from similarAdsInfo
    expect(listing.photos?.some((p) => p.sourceUrl.includes("other"))).toBe(false);

    // VIN must be from main ad, not from similarAdsInfo
    expect(listing.vehicle?.vin).toBe("WBAPH5C51BA123456");

    // First registration event
    expect(listing.events?.length).toBe(1);
    expect(listing.events?.[0]?.eventType).toBe("delivery");
  });

  it("rejects non-classistatic image URLs", async () => {
    const fetched = {
      url: "https://suchen.mobile.de/fahrzeuge/details.html?id=456",
      statusCode: 200,
      headers: {},
      json: {
        ad: {
          id: 456,
          title: "Test",
          makeKey: "Audi",
          modelKey: "A4",
          price: { grossAmount: 20000, grossCurrency: "EUR" },
          attributes: [{ tag: "mileage", value: "50,000 km" }],
          htmlDescription: "Nice car. VIN: WAUZZZ8K9BA000001",
          galleryImages: [
            // Real car photo
            { src: "https://img.classistatic.de/api/v1/mo-prod/images/xx/real?rule=mo-1600" },
            // Icon/logo — should be filtered out
            { src: "https://cdn.example.com/dealer-logo.png" },
            // Another real photo
            { src: "https://img.classistatic.de/api/v1/mo-prod/images/yy/real2?rule=mo-1024" },
          ],
        },
      },
    };

    const listing = await adapter.parseListing(fetched);
    expect(listing.photos?.length).toBe(2);
    expect(listing.photos?.every((p) => p.sourceUrl.includes("classistatic.de"))).toBe(true);
  });

  it("extracts VIN using Fahrgestell-Nr label", async () => {
    const fetched = {
      url: "https://suchen.mobile.de/fahrzeuge/details.html?id=789",
      statusCode: 200,
      headers: {},
      json: {
        ad: {
          id: 789,
          title: "Mercedes-Benz C 200",
          makeKey: "Mercedes-Benz",
          modelKey: "C 200",
          price: { grossAmount: 42000, grossCurrency: "EUR" },
          attributes: [{ tag: "mileage", value: "30,000 km" }],
          htmlDescription:
            "<p>Fahrgestell-Nr.: WDD2050081R123456</p><p>Scheckheftgepflegt</p>",
          galleryImages: [],
        },
      },
    };

    const listing = await adapter.parseListing(fetched);
    expect(listing.vehicle?.vin).toBe("WDD2050081R123456");
  });
});
