export const VENDOR_CATEGORIES = [
  { id: "all", label: "All vendors", search: "wedding and event vendors including venues, caterers, photographers, decorators" },
  { id: "venues", label: "Venues", search: "wedding venues and banquet halls" },
  { id: "caterers", label: "Caterers", search: "wedding and event caterers" },
  { id: "decorators", label: "Decorators & florists", search: "wedding decorators and event florists" },
  { id: "photographers", label: "Photographers", search: "wedding and event photographers" },
  { id: "entertainment", label: "Entertainment", search: "event DJs and live music bands" },
  { id: "event-planners", label: "Event planners", search: "wedding and event planners" },
  { id: "bakeries", label: "Bakeries", search: "wedding cake bakeries" },
  { id: "beauty", label: "Beauty & styling", search: "bridal makeup artists and hair stylists" },
  { id: "rentals", label: "Rentals & party supplies", search: "event furniture and party equipment rentals" },
  { id: "transport", label: "Transport", search: "event transport and car rentals" },
  { id: "restaurants", label: "Restaurants", search: "restaurants for private events" },
] as const;

export type VendorCategoryId = (typeof VENDOR_CATEGORIES)[number]["id"];

export function getVendorCategory(id: string) {
  return VENDOR_CATEGORIES.find((category) => category.id === id);
}
