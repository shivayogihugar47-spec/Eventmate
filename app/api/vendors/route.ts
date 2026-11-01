import { NextResponse } from "next/server";
import { z } from "zod";
import { getVendorCategory } from "@/lib/vendorCategories";

const SearchSchema = z.object({
  city: z.string().trim().min(2).max(120),
  category: z.string().trim().min(2).max(40).default("all"),
});

const PlacesResponseSchema = z.object({
  places: z.array(z.object({
    id: z.string(),
    displayName: z.object({ text: z.string() }).optional(),
    formattedAddress: z.string().optional(),
    googleMapsUri: z.string().url().optional(),
    rating: z.number().min(0).max(5).optional(),
    userRatingCount: z.number().int().nonnegative().optional(),
    websiteUri: z.string().url().optional(),
    nationalPhoneNumber: z.string().optional(),
    primaryTypeDisplayName: z.object({ text: z.string() }).optional(),
    currentOpeningHours: z.object({ openNow: z.boolean().optional() }).optional(),
  }).passthrough()).optional(),
});

function googleMapsUrl(placeId: string): string {
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query_place_id", placeId);
  return url.toString();
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const input = SearchSchema.safeParse({
    city: params.get("city") ?? "",
    category: params.get("category") ?? "all",
  });
  if (!input.success) {
    return NextResponse.json({ error: "Enter a valid city and vendor category." }, { status: 400 });
  }

  const category = getVendorCategory(input.data.category);
  if (!category) {
    return NextResponse.json({ error: "Choose one of the available vendor categories." }, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      error: "Google Places search needs a server-side API key. Use the category search links below in the meantime.",
      code: "GOOGLE_PLACES_NOT_CONFIGURED",
      city: input.data.city,
      category: category.id,
      results: [],
    }, { status: 503 });
  }

  try {
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": [
          "places.id",
          "places.displayName",
          "places.formattedAddress",
          "places.googleMapsUri",
          "places.rating",
          "places.userRatingCount",
          "places.websiteUri",
          "places.nationalPhoneNumber",
          "places.primaryTypeDisplayName",
          "places.currentOpeningHours.openNow",
        ].join(","),
      },
      body: JSON.stringify({
        textQuery: `${category.search} in ${input.data.city}`,
        pageSize: 12,
        languageCode: "en",
        regionCode: "IN",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const details = await response.text();
      console.error("[/api/vendors] Google Places returned an error.", {
        status: response.status,
        details: details.slice(0, 1000),
      });
      return NextResponse.json({
        error: response.status === 403
          ? "Google Places rejected the API key. Check that Places API (New) is enabled and the key is allowed to use it."
          : "Google Places search is temporarily unavailable. Please try again.",
        code: "GOOGLE_PLACES_REQUEST_FAILED",
      }, { status: 502 });
    }

    const data = PlacesResponseSchema.parse(await response.json());
    const results = (data.places ?? []).flatMap((place) => {
      const name = place.displayName?.text?.trim();
      if (!name) return [];
      return [{
        id: place.id,
        name,
        category: place.primaryTypeDisplayName?.text ?? category.label,
        address: place.formattedAddress ?? null,
        phone: place.nationalPhoneNumber ?? null,
        website: place.websiteUri ?? null,
        mapUrl: place.googleMapsUri ?? googleMapsUrl(place.id),
        rating: place.rating ?? null,
        reviewCount: place.userRatingCount ?? null,
        openNow: place.currentOpeningHours?.openNow ?? null,
      }];
    });

    return NextResponse.json({
      city: input.data.city,
      category: category.id,
      categoryLabel: category.label,
      results,
      source: "Google Maps",
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[/api/vendors] Google Places search failed.", error);
    return NextResponse.json({
      error: "Google Places search could not be completed. Please try again.",
      code: "GOOGLE_PLACES_REQUEST_FAILED",
    }, { status: 502 });
  }
}
