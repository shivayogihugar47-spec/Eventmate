import type { Metadata } from "next";
import "./globals.css";
import { ClientProviders } from "./ClientProviders";

export const metadata: Metadata = {
  title: "EventMate — AI Event Planner",
  description: "Plan weddings, birthdays and community events with Eve, your AI planner.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased bg-white">
        {children}
        <ClientProviders />
      </body>
    </html>
  );
}
