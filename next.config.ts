import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: [
    "@prisma/client",
    "amqplib",
    "pdf-parse",
    "pdfjs-dist",
  ],

  webpack(config, { dev }) {
    if (dev) {
      // In containerised environments (Alpine/Docker) inotify watch limits are
      // very low and Watchpack exhausts them during the initial directory scan.
      // Polling avoids inotify entirely at the cost of slightly higher CPU use.
      config.watchOptions = {
        poll: 2000,
        aggregateTimeout: 300,
        ignored: ["**/node_modules/**", "**/.next/**", "**/prisma/**"],
      };
    }
    return config;
  },
};

export default nextConfig;
