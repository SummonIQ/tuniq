import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/:path*",
          has: [
            {
              type: "host",
              value: "relay.tuniq.dev",
            },
          ],
          destination: "https://tuniq-relay-production.up.railway.app/:path*",
        },
        {
          source: "/:path*",
          has: [
            {
              type: "host",
              value: "(?<subdomain>.+)\\.tuniq\\.dev",
            },
          ],
          // Vercel external rewrites do not preserve the original Host
          // header. Encode it into a synthetic path prefix the relay knows
          // how to strip so route resolution sees the real subdomain.
          destination:
            "https://tuniq-relay-production.up.railway.app/__tuniqhost/:subdomain.tuniq.dev/:path*",
        },
      ],
    };
  },
};

export default nextConfig;
