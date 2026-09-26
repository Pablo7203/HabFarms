import type { Metadata } from "next";
import { NumberInputWheelGuard } from "@/components/ui/number-input-wheel-guard";
import "./globals.css";

const metadataOrigin = process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
const googleSiteVerification = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION;

export const metadata: Metadata = {
  metadataBase: new URL(metadataOrigin),
  applicationName: "HabFarms",
  title: { default: "HabFarms | Poultry Farm Management Software", template: "%s | HabFarms" },
  description: "A poultry-farm operations workspace for flocks, production, feed, finance and rearing.",
  ...(googleSiteVerification ? { verification: { google: googleSiteVerification } } : {}),
};

export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en"><body><NumberInputWheelGuard />{children}</body></html>; }
