import type { NextConfig } from "next";

/**
 * Static security headers.
 *
 * Content-Security-Policy is deliberately NOT set here — it is emitted
 * per-request from `proxy.ts` so that every response carries a fresh script
 * nonce. Everything below is request-independent.
 *
 * Exported so `scripts/test-headers.mjs` can assert the policy directly. A
 * header that silently disables a feature is not something to discover by
 * hand: `display-capture=()` and `microphone=()` shipped here and disabled BPM
 * detection entirely, in both its modes, with the browser reporting only
 * "audio capture not allowed" and no indication that the page's own response
 * headers were the cause.
 */
/**
 * The origins the embedded player actually runs on.
 *
 * `host: "https://www.youtube-nocookie.com"` is what `useYouTubePlayer`
 * passes, so that is the frame's origin in practice; www.youtube.com is named
 * too because the widget API falls back to it and a silent fallback must not
 * become a silent outage.
 */
export const YOUTUBE_ORIGINS =
  '"https://www.youtube-nocookie.com" "https://www.youtube.com"';

export const securityHeaders = [
  // Force HTTPS for two years, including subdomains. Vercel terminates TLS.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // Disable MIME sniffing.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Legacy clickjacking defence; CSP frame-ancestors is the modern control.
  { key: "X-Frame-Options", value: "DENY" },
  /*
   * `strict-origin-when-cross-origin`, not `no-referrer`.
   *
   * Honest history, because the first version of this comment claimed more
   * than it could prove. `no-referrer` was suspected of causing the YouTube
   * 153/154 errors on Safari, on the theory that the player frame was loading
   * with no `Referer` and YouTube could not identify the embedding site.
   * Reading YouTube's shipped widget API afterwards showed it sets
   * `referrerPolicy="strict-origin-when-cross-origin"` on its own iframe
   * before assigning `src`, so that frame's document request was never
   * governed by this header. The real cause was almost certainly the
   * `autoplay` delegation below.
   *
   * The change stays, on its own merits rather than a borrowed one: the
   * origin is what an embed host is entitled to see, several YouTube
   * subresource requests do inherit this policy, and `no-referrer` buys
   * nothing here that the policy below does not already buy. On a
   * cross-origin request the browser sends only the origin —
   * `https://gemtopia.vercel.app` — never a path or query. A share token
   * lives in a path, so it still cannot leak. Same-origin requests are
   * unaffected and downgrades to HTTP send nothing.
   */
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  /*
   * Drop every powerful browser feature we do not use — and grant each one we
   * do to exactly the origin that needs it.
   *
   * `()` is an empty allowlist: it denies the feature to everyone, this page
   * included. That is right for a camera we never open. It was wrong for
   * display-capture and microphone, which are how BPM detection works, and the
   * result was a headline feature that could not run on any deployment while
   * appearing, from the code, to be fully implemented.
   *
   * `(self)` grants the feature to this origin and nothing else — and that is
   * the trap this header sets twice, because the player is NOT this origin.
   * It runs in a cross-origin iframe on youtube-nocookie.com, and the default
   * allowlist for `autoplay` is already `self`, so writing `autoplay=(self)`
   * looks like granting the app what it needs while in fact denying the frame
   * that does the playing. The symptom is not an error: the first tap on a
   * track does nothing at all, the playhead sits at 0:00, and everything
   * starts working the moment you press YouTube's own play button once —
   * because a user gesture inside that frame is what lifts the block. See the
   * `autoplay` entry below.
   *
   * The two YouTube origins are named for `autoplay` and `encrypted-media`
   * only. Everything else stays `(self)` or `()`, so the embedded frame still
   * cannot reach the screen, the microphone, the camera, or anything else.
   */
  {
    key: "Permissions-Policy",
    value: [
      "accelerometer=()",
      /*
       * Delegated to the player's own origins, not just ours.
       *
       * The iframe asks for it — YouTube's widget API sets
       * `allow="accelerometer; autoplay; clipboard-write; encrypted-media;
       * gyroscope; picture-in-picture; web-share"` on the frame it builds.
       * An `allow` attribute can only ask; the parent's header decides. With
       * `autoplay=(self)` the answer was no, so `loadVideoById` — which
       * autoplays — was refused for every track the app started itself.
       */
      `autoplay=(self ${YOUTUBE_ORIGINS})`,
      "camera=()",
      // Tab-audio capture — the primary BPM detection path (Chromium).
      "display-capture=(self)",
      // Same delegation, same reason: DRM-protected clips are decoded inside
      // the player's frame, not ours.
      `encrypted-media=(self ${YOUTUBE_ORIGINS})`,
      "fullscreen=(self)",
      "geolocation=()",
      "gyroscope=()",
      "magnetometer=()",
      // Fallback BPM detection off the speakers, for Safari and Firefox.
      "microphone=(self)",
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
