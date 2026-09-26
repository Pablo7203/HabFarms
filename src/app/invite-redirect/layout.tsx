import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Opening invitation",
  robots: { index: false, follow: false },
};

export default function InviteRedirectLayout({ children }: { children: React.ReactNode }) {
  return children;
}
