/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: [
      "bullmq",
      "ioredis",
      "playwright",
      "playwright-core",
      "sharp",
      "@anthropic-ai/sdk",
      "@doceomenter/worker",
      "@doceomenter/capture",
      "@doceomenter/render",
      "@doceomenter/boot",
      "@doceomenter/claude",
      "execa",
    ],
  },
  webpack: (cfg, { isServer }) => {
    if (isServer) {
      const externals = Array.isArray(cfg.externals) ? cfg.externals : [cfg.externals].filter(Boolean);
      cfg.externals = [
        ...externals,
        // Treat heavy native/CommonJS deps as runtime requires.
        ({ request }, callback) => {
          if (
            request === "playwright" ||
            request === "playwright-core" ||
            request === "sharp" ||
            request === "@anthropic-ai/sdk" ||
            request === "execa" ||
            request === "bullmq" ||
            request === "ioredis" ||
            // `@doceomenter/auth` is deliberately absent from this list: it is plain ESM with
            // no native dependency, so webpack bundles it and the server build never has to
            // `require()` an ES module.
            (request && request.startsWith("@doceomenter/") && request !== "@doceomenter/auth")
          ) {
            return callback(null, "commonjs " + request);
          }
          callback();
        },
      ];
    }
    return cfg;
  },
};
export default config;
