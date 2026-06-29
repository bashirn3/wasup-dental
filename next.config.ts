import type { NextConfig } from "next";

// App page documents must never be served stale from the browser cache, or a
// fresh deploy keeps showing the old UI until a hard refresh. Hashed assets
// under /_next/static stay immutable (Next handles those), so this only stops
// the HTML document itself from being cached.
const NO_STORE = "no-store, must-revalidate";
const APP_PAGES = ["/", "/dashboard", "/agent", "/connect", "/start", "/sign-in", "/sign-up"];

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/",
        has: [{ type: "host", value: "garage.wasup.co" }],
        destination: "https://wasup.co/mot",
        permanent: false,
      },
    ];
  },
  async headers() {
    return APP_PAGES.map((source) => ({
      source,
      headers: [{ key: "Cache-Control", value: NO_STORE }],
    }));
  },
};

export default nextConfig;
