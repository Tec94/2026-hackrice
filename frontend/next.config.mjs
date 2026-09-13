const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:4000";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * Proxy the API through this app's own origin.
   *
   * This is not just convenience. The API rejects any mutation whose `Origin`
   * header does not match its `APP_URL`, and the Better Auth session cookie is
   * only sent same-origin. Serving `/api/*` from the page's own origin satisfies
   * both without CORS or cross-site cookie settings.
   */
  async rewrites() {
    if (process.env.SERVE_FRONTEND === "true") return [];
    return [
      { source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` },
      { source: "/health", destination: `${API_ORIGIN}/health` },
      { source: "/internal/think", destination: `${API_ORIGIN}/internal/think` },
    ];
  },
};

export default (phase) => ({
  ...nextConfig,
  distDir: phase === 'phase-development-server' ? '.next-dev' : '.next',
});
