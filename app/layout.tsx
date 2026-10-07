import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Request System",
  description: "Staples Foods Corporation Request System",
  icons: { icon: "/favicon.svg" }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
