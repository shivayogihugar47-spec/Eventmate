import { NextResponse } from "next/server";
import { z } from "zod";

const CitySchema = z.string().trim().min(2).max(120);
const NominatimSchema = z.array(z.object({
  lat: z.string(),
  lon: z.string(),
  display_name: z.string(),
}));
const OverpassSchema = z.object({
  elements: z.array(z.object({
    type: z.enum(["node", "way", "relation"]),
    id: z.number(),
    lat: z.number().optional(),
    lon: z.number().optional(),
    center: z.object({ lat: z.number(), lon: z.number() }).optional(),
    tags: z.record(z.string(), z.string()).optional(),
  }).passthrough()).optional(),
});

function vendorCategory(tags: Record<string, string>): string | null {
  if (["events_venue", "conference_centre", "community_centre", "banquet_hall"].includes(tags.amenity ?? "")) return "Event venue";
  if (tags.craft === "caterer" || tags.shop === "caterer") return "Caterer";
  if (tags.amenity === "restaurant") return "Restaurant";
  if (tags.shop === "florist" || tags.craft === "florist") return "Florist & decor";
  if (tags.craft === "photographer" || tags.shop === "photo") return "Photography";
  if (tags.shop === "bakery") return "Bakery";
  if (["theatre", "music_venue", "nightclub"].includes(tags.amenity ?? "")) return "Entertainment";
  return null;
}

function addressFromTags(tags: Record<string, string>): string | null {
  const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  const locality = [tags["addr:suburb"], tags["addr:city"]].filter(Boolean).join(", ");
  const address = [street, locality].filter(Boolean).join(", ");
  return address || null;
}

export async function GET(request: Request) {
  const cityResult = CitySchema.safeParse(new URL(request.url).searchParams.get("city") ?? "");
  if (!cityResult.success) {
    return NextResponse.json({ error: "Enter a city name between 2 and 120 characters." }, { status: 400 });
  }
  const city = cityResult.data;

  try {
    const geocodeUrl = new URL("https://nominatim.openstreetmap.org/search");
    geocodeUrl.searchParams.set("q", city);
    geocodeUrl.searchParams.set("format", "jsonv2");
    geocodeUrl.searchParams.set("limit", "1");
    const geocodeResponse = await fetch(geocodeUrl, {
      headers: { "User-Agent": "EventMate/1.0 (local event vendor discovery)" },
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(10_000),
    });
    if (!geocodeResponse.ok) throw new Error(`City lookup returned ${geocodeResponse.status}.`);
    const places = NominatimSchema.parse(await geocodeResponse.json());
    const place = places[0];
    if (!place) {
      return NextResponse.json({ error: `We couldn't find "${city}". Check the city name and try again.` }, { status: 404 });
    }

    const lat = Number(place.lat);
    const lon = Number(place.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("City lookup returned invalid coordinates.");

    const around = `around:15000,${lat},${lon}`;
    const query = `[out:json][timeout:25];(` +
      `nwr(${around})["name"]["amenity"~"^(events_venue|conference_centre|community_centre|banquet_hall|restaurant|theatre|music_venue|nightclub)$"];` +
      `nwr(${around})["name"]["shop"~"^(caterer|florist|photo|bakery)$"];` +
      `nwr(${around})["name"]["craft"~"^(caterer|florist|photographer)$"];` +
      `);out center;`;
    const overpassUrl = new URL("https://overpass-api.de/api/interpreter");
    overpassUrl.searchParams.set("data", query);
    const listingResponse = await fetch(overpassUrl, {
      headers: { "User-Agent": "EventMate/1.0 (local event vendor discovery)" },
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(35_000),
    });
    if (!listingResponse.ok) throw new Error(`Local listings search returned ${listingResponse.status}.`);
    const listingData = OverpassSchema.parse(await listingResponse.json());
    const seen = new Set<string>();
    const vendors = (listingData.elements ?? []).flatMap((element) => {
      const tags = element.tags ?? {};
      const category = vendorCategory(tags);
      const name = tags.name?.trim();
      const id = `${element.type}/${element.id}`;
      if (!name || !category || seen.has(id)) return [];
      seen.add(id);
      const coordinates = element.center ?? (
        element.lat !== undefined && element.lon !== undefined
          ? { lat: element.lat, lon: element.lon }
          : undefined
      );
      return [{
        id,
        name,
        category,
        address: addressFromTags(tags),
        phone: tags.phone ?? tags["contact:phone"] ?? null,
        website: tags.website ?? tags["contact:website"] ?? null,
        mapUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
        ...(coordinates ? { latitude: coordinates.lat, longitude: coordinates.lon } : {}),
      }];
    }).slice(0, 60);

    return NextResponse.json({
      city,
      results: vendors,
      source: "OpenStreetMap",
      attributionUrl: "https://www.openstreetmap.org/copyright",
    }, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch (error) {
    console.error("[/api/vendors] Local vendor search failed.", error);
    return NextResponse.json({
      error: "Local vendor search is temporarily unavailable. Please try again in a moment.",
    }, { status: 503 });
  }
}
