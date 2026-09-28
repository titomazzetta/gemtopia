import type { MetadataRoute } from "next";

/**
 * The web app manifest, served by Next at /manifest.webmanifest.
 *
 * This is what makes Gemtopia installable: Chrome and Edge offer "Install
 * Gemtopia" in the address bar, Safari on the Mac offers File → Add to Dock,
 * and a phone offers Add to Home Screen. Each opens it in its own window with
 * its own icon and no browser chrome.
 *
 * Deliberately no service worker. Modern Chrome and Edge no longer require one
 * to install, iOS never has, and one here would buy little — Gemtopia is
 * useless offline, since every sound comes from YouTube and every record from
 * Discogs — while costing a real risk: pages carry a per-request CSP nonce
 * (src/lib/csp.ts), and a worker that cached a page would replay a stale nonce
 * and a stale session state. The cheapest cache bug is the one never written.
 *
 * Colours match the app's ink so the launch screen and title bar are
 * seamless. `id` pins the app's identity to "/" so a later change to
 * start_url cannot make browsers treat it as a second, different app.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Gemtopia",
    short_name: "Gemtopia",
    description:
      "Dig your Discogs records, shape the set, tell the story. For the storytelling DJ.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#050806",
    theme_color: "#050806",
    categories: ["music", "entertainment"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
