import type { Metadata, Viewport } from "next";
import { NumberInputWheelGuard } from "@/components/ui/number-input-wheel-guard";
import { LegacyOfflineCleanup } from "@/components/pwa/legacy-offline-cleanup";
import "./globals.css";

const metadataOrigin = process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
const googleSiteVerification = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION;

export const metadata: Metadata = {
  metadataBase: new URL(metadataOrigin),
  applicationName: "HabFarms",
  title: { default: "HabFarms | Poultry Farm Management Software", template: "%s | HabFarms" },
  description: "A poultry-farm operations workspace for flocks, production, feed, finance and rearing.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: { capable: true, title: "HabFarms", statusBarStyle: "default" },
  ...(googleSiteVerification ? { verification: { google: googleSiteVerification } } : {}),
};

export const viewport: Viewport = { themeColor: "#06452D" };

export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en"><body><LegacyOfflineCleanup /><NumberInputWheelGuard />{children}</body></html>; }
