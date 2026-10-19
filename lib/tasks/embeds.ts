/**
 * Embed provider detection for the Task rich editor (PRD FEATURE_Task-Detail.md
 * §11). Pure — no IO — so it's trivially unit-tested and shared between the
 * paste-URL handler and the slash-command "Embed" block.
 *
 * Only an allowlisted set of hosts render as a sandboxed iframe. Everything
 * else falls back to a plain bookmark-style link — never fetched, never
 * treated as embeddable just because it parses as a URL.
 */

export type EmbedProvider = "youtube" | "loom" | "figma" | "google";

export type EmbedMatch = {
  provider: EmbedProvider;
  /** The iframe-safe URL, rewritten from whatever the user pasted. */
  embedUrl: string;
};

/** http(s) only — blocks `javascript:`, `data:`, etc. */
export function isSafeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function youtubeEmbed(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, "");
  let videoId: string | null = null;
  if (host === "youtu.be") {
    videoId = url.pathname.slice(1);
  } else if (host === "youtube.com" || host === "m.youtube.com") {
    if (url.pathname === "/watch") videoId = url.searchParams.get("v");
    else if (url.pathname.startsWith("/embed/")) videoId = url.pathname.slice("/embed/".length);
    else if (url.pathname.startsWith("/shorts/")) videoId = url.pathname.slice("/shorts/".length);
  }
  videoId = videoId?.split(/[?&]/)[0] || null;
  return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
}

function loomEmbed(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, "");
  if (host !== "loom.com") return null;
  const match = url.pathname.match(/^\/(share|embed)\/([a-zA-Z0-9]+)/);
  return match ? `https://www.loom.com/embed/${match[2]}` : null;
}

function figmaEmbed(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, "");
  if (host !== "figma.com") return null;
  if (!/^\/(file|proto|design|board)\//.test(url.pathname)) return null;
  return `https://www.figma.com/embed?embed_host=company-os&url=${encodeURIComponent(url.toString())}`;
}

function googleEmbed(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, "");
  if (host !== "docs.google.com" && host !== "drive.google.com") return null;
  if (/\/preview\/?$/.test(url.pathname)) return url.toString();
  if (host === "drive.google.com") {
    const match = url.pathname.match(/^\/file\/d\/([^/]+)/);
    return match ? `https://drive.google.com/file/d/${match[1]}/preview` : null;
  }
  // docs.google.com/{document|spreadsheets|presentation}/d/<id>/(edit|view)?...
  const match = url.pathname.match(/^\/(document|spreadsheets|presentation)\/d\/([^/]+)/);
  return match ? `https://docs.google.com/${match[1]}/d/${match[2]}/preview` : null;
}

const DETECTORS: { provider: EmbedProvider; detect: (url: URL) => string | null }[] = [
  { provider: "youtube", detect: youtubeEmbed },
  { provider: "loom", detect: loomEmbed },
  { provider: "figma", detect: figmaEmbed },
  { provider: "google", detect: googleEmbed },
];

/** Recognizes an allowlisted, embeddable URL. Returns null for anything else
 * (including malformed URLs) so the caller can fall back to a bookmark link. */
export function detectEmbed(value: string): EmbedMatch | null {
  if (!isSafeUrl(value)) return null;
  const url = new URL(value);
  for (const { provider, detect } of DETECTORS) {
    const embedUrl = detect(url);
    if (embedUrl) return { provider, embedUrl };
  }
  return null;
}
