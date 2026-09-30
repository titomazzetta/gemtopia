import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gemtopia",
  description:
    "Dig through your Discogs collection, hear every record, and plan sets that tell a story. For the storytelling DJ — built by a DJ who loves records.",
  robots: { index: false, follow: false },
  applicationName: "Gemtopia",
  /*
   * iPhone and iPad: Add to Home Screen opens full screen, titled "Gemtopia".
   * The home-screen icon is src/app/apple-icon.png. A "black" status bar
   * rather than "black-translucent", so iOS keeps the clock and battery out of
   * the page instead of laying them over the header.
   */
  appleWebApp: {
    capable: true,
    title: "Gemtopia",
    statusBarStyle: "black",
  },
};

export const viewport: Viewport = {
  themeColor: "#050806",
  width: "device-width",
  initialScale: 1,
  /*
   * Let the page reach the screen's rounded corners and home indicator, and
   * say so — without this, iOS reports every safe-area inset as 0, so nothing
   * can move out of the way and, in the installed app, the bottom bar's
   * outer corners were being clipped by the screen itself.
   */
  viewportFit: "cover",
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
