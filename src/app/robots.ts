import type { MetadataRoute } from "next";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");

export default function robots(): MetadataRoute.Robots {
  const publicDomainConfigured = Boolean(siteUrl);
  return {
    rules: {
      userAgent: "*",
      allow: publicDomainConfigured ? "/" : undefined,
      disallow: [
        ...(!publicDomainConfigured ? ["/"] : []),
        "/dashboard",
        "/flocks",
        "/rearing",
        "/feed",
        "/eggs",
        "/production",
        "/health",
        "/expenses",
        "/sales",
        "/collections",
        "/payables",
        "/cash-flow",
        "/reports",
        "/settings",
        "/platform",
        "/onboarding",
        "/login",
        "/signup",
        "/reset-password",
        "/forgot-password",
        "/accept-invitation",
        "/invite-redirect",
        "/account-status",
        "/auth/",
        "/api/",
      ],
    },
    ...(siteUrl ? { sitemap: `${siteUrl}/sitemap.xml` } : {}),
  };
}
