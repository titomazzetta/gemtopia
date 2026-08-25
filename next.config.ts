import type { NextConfig } from "next";

/**
 * Static security headers.
 *
 * Content-Security-Policy is deliberately NOT set here — it is emitted
 * per-request from `middleware.ts` so that every response carries a fresh
 * script nonce. Everything below is request-independent.
 */
const securityHeaders = [
  // Force HTTPS for two years, including subdomains. Vercel terminates TLS.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // Disable MIME sniffing.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Legacy clickjacking defence; CSP frame-ancestors is the modern control.
  { key: "X-Frame-Options", value: "DENY" },
  // Never leak our URLs (which contain no secrets, but still) cross-origin.
  { key: "Referrer-Policy", value: "no-referrer" },
  // Drop every powerful browser feature we do not use.
  {
    key: "Permissions-Policy",
    value: [
      "accelerometer=()",
      "autoplay=(self)",
      "camera=()",
      "display-capture=()",
      "encrypted-media=(self)",
      "fullscreen=(self)",
      "geolocation=()",
      "gyroscope=()",
      "magnetometer=()",
      "microphone=()",
      "payment=()",
      "usb=()",
      "interest-cohort=()",
    ].join(", "),
  },
  // Cross-origin isolation primitives. COEP is intentionally omitted:
  // the YouTube iframe does not send CORP headers and would be blocked.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Do not advertise the framework version.
  poweredByHeader: false,

  // Fail the production build on type errors rather than shipping them.
  // (Next 16 dropped the built-in lint step; `npm run lint` runs ESLint,
  //  and CI runs it alongside `typecheck` — see .github/workflows/ci.yml.)
  typescript: { ignoreBuildErrors: false },

  images: {
    // Discogs artwork CDNs only.
    remotePatterns: [
      { protocol: "https", hostname: "i.discogs.com" },
      { protocol: "https", hostname: "img.discogs.com" },
      { protocol: "https", hostname: "**.discogs.com" },
    ],
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // API responses must never be cached by a shared cache.
        source: "/api/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, private",
          },
          { key: "Pragma", value: "no-cache" },
        ],
      },
    ];
  },
};

export default nextConfig;
