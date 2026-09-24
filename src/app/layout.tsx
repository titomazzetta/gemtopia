import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gemtopia",
  description:
    "Dig through your Discogs collection, hear every record, and plan sets that tell a story. For the storytelling DJ — built by a DJ who loves records.",
  robots: { index: false, follow: false },
  applicationName: "Gemtopia",
};

export const viewport: Viewport = {
  themeColor: "#050806",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full">{children}</body>
    </html>
  );
}
