import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/vendors/route";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Google Places vendor search API", () => {
  it("rejects invalid city values without contacting Google", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key");

    const response = await GET(new Request("https://eventmate.test/api/vendors?city=x"));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns Google place ratings and contact details for the requested category", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      places: [{
        id: "place-123",
        displayName: { text: "Celebrations Convention Hall" },
        primaryTypeDisplayName: { text: "Banquet hall" },
        formattedAddress: "26, Industrial Estate, Belagavi",
        googleMapsUri: "https://maps.google.com/?cid=123",
        rating: 4.5,
        userRatingCount: 518,
        nationalPhoneNumber: "+91 1234567890",
        websiteUri: "https://venue.example.test",
        currentOpeningHours: { openNow: true },
      }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key");

    const response = await GET(new Request("https://eventmate.test/api/vendors?city=Belagavi&category=venues"));
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result).toMatchObject({
      city: "Belagavi",
      category: "venues",
      categoryLabel: "Venues",
      source: "Google Maps",
      results: [{
        id: "place-123",
        name: "Celebrations Convention Hall",
        category: "Banquet hall",
        address: "26, Industrial Estate, Belagavi",
        mapUrl: "https://maps.google.com/?cid=123",
        rating: 4.5,
        reviewCount: 518,
        phone: "+91 1234567890",
        website: "https://venue.example.test",
        openNow: true,
      }],
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(options.headers["X-Goog-Api-Key"]).toBe("test-key");
    expect(options.headers["X-Goog-FieldMask"]).toContain("places.rating");
    expect(JSON.parse(options.body)).toMatchObject({
      textQuery: "wedding venues and banquet halls in Belagavi",
      pageSize: 12,
    });
  });

  it("requires a server-side API key and returns a usable fallback code", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("https://eventmate.test/api/vendors?city=Belagavi&category=photographers"));
    const result = await response.json();

    expect(response.status).toBe(503);
    expect(result).toMatchObject({
      code: "GOOGLE_PLACES_NOT_CONFIGURED",
      city: "Belagavi",
      category: "photographers",
      results: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unknown categories", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key");

    const response = await GET(new Request("https://eventmate.test/api/vendors?city=Belagavi&category=made-up"));

    expect(response.status).toBe(400);
  });
});
