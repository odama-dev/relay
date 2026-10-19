import type { NextConfig } from "next";

// Routes that render invoice PDFs (download, issue/send actions).
const pdfRoutes = ["/api/invoices/**", "/invoices/**", "/payments/**"];

const nextConfig: NextConfig = {
  // Allow dev access through ngrok tunnels.
  allowedDevOrigins: ["*.ngrok-free.dev", "*.ngrok-free.app", "*.ngrok.app"],
  // Headless Chrome for invoice PDFs stays a Node dependency, never bundled.
  serverExternalPackages: ["puppeteer", "@sparticuz/chromium"],
  // Vercel: ship the serverless Chromium binary with the routes that print PDFs.
  outputFileTracingIncludes: Object.fromEntries(pdfRoutes.map((r) => [r, ["./node_modules/@sparticuz/chromium/bin/**"]])),
};

export default nextConfig;
