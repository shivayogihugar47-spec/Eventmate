import type { Metadata } from "next";
import "./globals.css";
import { ClientProviders } from "./ClientProviders";

export const metadata: Metadata = {
  metadataBase: new URL(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL ?? "localhost:3000"}`),
  title: "Jashn — Plans your celebration. Runs it too.",
  description: "Plans your celebration. Runs it too. Jashn helps you create and manage weddings, birthdays, and every event in between.",
  applicationName: "Jashn",
  icons: {
    icon: "/brand/jashn-icon.png",
    apple: "/brand/jashn-icon.png",
  },
  openGraph: {
    type: "website",
    siteName: "Jashn",
    title: "Jashn — Plans your celebration. Runs it too.",
    description: "Plans your celebration. Runs it too. Plan the day, budget, vendors, and event operations with Jashn.",
    images: [
      {
        url: "/brand/jashn-logo.png",
        alt: "Jashn — Plans your celebration. Runs it too.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Jashn — Plans your celebration. Runs it too.",
    description: "Plans your celebration. Runs it too. Plan the day, budget, vendors, and event operations with Jashn.",
    images: ["/brand/jashn-logo.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased bg-white">
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}
