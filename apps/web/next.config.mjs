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
            (request && request.startsWith("@doceomenter/"))
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
