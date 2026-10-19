import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow dev access through ngrok tunnels.
  allowedDevOrigins: ["*.ngrok-free.dev", "*.ngrok-free.app", "*.ngrok.app"],
  // Headless Chrome for invoice PDFs stays a Node dependency, never bundled.
  serverExternalPackages: ["puppeteer"],
};

export default nextConfig;
