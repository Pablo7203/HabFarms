import type { Metadata } from "next";
import { MarketingSite } from "@/components/marketing/marketing-site";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");

export const metadata: Metadata = {
  title: { absolute: "HabFarms | Poultry Farm Management Software in Ghana" },
  description: "HabFarms helps poultry farmers in Ghana manage flocks, egg production, feed, sales, expenses and DOC rearing in one organized platform.",
  ...(siteUrl ? { alternates: { canonical: siteUrl } } : {}),
  openGraph: {
    type: "website",
    title: "HabFarms | Your poultry farm. One clear view.",
    description: "Bring birds, eggs, feed, sales, expenses and rearing into one farm workspace.",
  },
  twitter: {
    card: "summary_large_image",
    title: "HabFarms | Your poultry farm. One clear view.",
    description: "Poultry farm records, brought together.",
    images: ["/opengraph-image"],
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "HabFarms",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description: "Poultry-farm management software for flock records, egg production, feed, sales, expenses and DOC rearing.",
  areaServed: { "@type": "Country", name: "Ghana" },
  email: "Habfarmtech@gmail.com",
  telephone: "+233555152989",
  ...(siteUrl ? { url: siteUrl } : {}),
};

export default function Home() {
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
    <MarketingSite />
  </>;
}
