import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Poultry Farm Management", template: "%s | Poultry Farm" },
  description: "A calm, secure operational workspace for poultry farms.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
