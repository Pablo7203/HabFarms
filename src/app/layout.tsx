import type { Metadata } from "next";
import { NumberInputWheelGuard } from "@/components/ui/number-input-wheel-guard";
import "./globals.css";

const metadataOrigin = process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(metadataOrigin),
  title: { default: "HabFarms", template: "%s | HabFarms" },
  description: "A poultry-farm operations workspace for flocks, production, feed, finance and rearing.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en"><body><NumberInputWheelGuard />{children}</body></html>; }
