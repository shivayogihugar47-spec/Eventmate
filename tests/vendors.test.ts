import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/vendors/route";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Local vendor search API", () => {
  it("rejects invalid city values without contacting external services", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("https://eventmate.test/api/vendors?city=x"));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns named place listings and source links for the requested city", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        lat: "18.5204",
        lon: "73.8567",
        display_name: "Pune, Maharashtra, India",
      }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        elements: [{
          type: "node",
          id: 123,
          lat: 18.52,
          lon: 73.85,
          tags: {
            name: "Example Banquet Hall",
            amenity: "events_venue",
            "addr:street": "Market Road",
            "addr:city": "Pune",
            phone: "+91 1234567890",
            website: "https://example.test",
          },
        }],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("https://eventmate.test/api/vendors?city=Pune"));
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result).toMatchObject({
      city: "Pune",
      source: "OpenStreetMap",
      results: [{
        name: "Example Banquet Hall",
        category: "Event venue",
        address: "Market Road, Pune",
        phone: "+91 1234567890",
        website: "https://example.test",
        mapUrl: "https://www.openstreetmap.org/node/123",
      }],
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain("nominatim.openstreetmap.org");
    expect(String(fetchMock.mock.calls[1][0])).toContain("overpass-api.de");
  });

  it("returns a useful not-found response for an unknown city", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("[]", { status: 200 })));

    const response = await GET(new Request("https://eventmate.test/api/vendors?city=NotARealCity"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: `We couldn't find "NotARealCity". Check the city name and try again.`,
    });
  });
});
