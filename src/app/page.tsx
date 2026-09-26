import type { Metadata } from "next";
import { MarketingSite } from "@/components/marketing/marketing-site";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");

export const metadata: Metadata = {
  title: { absolute: "HabFarms | Poultry Farm Management Software in Ghana" },
  description: "HabFarms helps poultry farmers in Ghana manage flocks, egg production, feed, sales, expenses and DOC rearing in one organized platform.",
  keywords: ["poultry farm management software Ghana", "poultry farm records", "egg production tracking", "feed inventory management", "DOC rearing management"],
  ...(siteUrl ? { alternates: { canonical: siteUrl } } : {}),
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 },
  },
  openGraph: {
    type: "website",
    locale: "en_GH",
    siteName: "HabFarms",
    title: "HabFarms | Your poultry farm. One clear view.",
    description: "Bring birds, eggs, feed, sales, expenses and rearing into one farm workspace.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "HabFarms poultry farm management software" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "HabFarms | Your poultry farm. One clear view.",
    description: "Poultry farm records, brought together.",
    images: [{ url: "/opengraph-image", alt: "HabFarms poultry farm management software" }],
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${siteUrl || "https://www.habfarm.com"}/#organization`,
      name: "HabFarms",
      url: siteUrl || "https://www.habfarm.com",
      email: "info@habfarm.com",
      telephone: "+233555152989",
      areaServed: { "@type": "Country", name: "Ghana" },
    },
    {
      "@type": "SoftwareApplication",
      name: "HabFarms",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description: "Poultry-farm management software for flock records, egg production, feed, sales, expenses and DOC rearing.",
      provider: { "@id": `${siteUrl || "https://www.habfarm.com"}/#organization` },
      areaServed: { "@type": "Country", name: "Ghana" },
      ...(siteUrl ? { url: siteUrl } : {}),
    },
  ],
};

export default function Home() {
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
    <MarketingSite />
  </>;
}
