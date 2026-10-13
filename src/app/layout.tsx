import type { Metadata } from "next";
import { connection } from "next/server";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Request System",
  description: "Staples Foods Corporation Request System",
  icons: { icon: "/favicon.svg" }
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Every page must render per request so Next.js can stamp the CSP nonce
  // generated in proxy.ts onto its scripts; a statically prerendered page
  // would ship scripts without it and be blocked by the policy.
  await connection();
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
