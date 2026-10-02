import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { AppProviders } from "./providers";

export const metadata: Metadata = { title: "Meeting", description: "Meeting source test application" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body><AppProviders>{children}</AppProviders></body></html>;
}
