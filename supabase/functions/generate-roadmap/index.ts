import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface SerperWebResult { title: string; link: string; snippet: string; }
interface SerperVideoResult { title: string; link: string; duration?: string; }

interface ResourceSegment {
  module_id: string;
  module_title: string;
  start_minute: number;
  end_minute: number;
}

type AuthorityTier = "OFFICIAL_DOCS" | "VENDOR_DOCS" | "UNIVERSITY_DIRECT" | "EDUCATION_DOMAIN" | "BLOG" | "YOUTUBE_TRUSTED" | "YOUTUBE_UNKNOWN" | "COMMUNITY" | "UNKNOWN";

interface CandidateResource {
  title: string;
  url: string;
  type: "video" | "article" | "documentation" | "tutorial" | "practice";
  estimated_minutes: number;
  description: string;
  source?: string;
  channel?: string;
  view_count?: number;
  like_count?: number;
  quality_signal?: string;
  appearances_count: number;
  authority_score: number; // Now 0-5 (light bump)
  authority_tier?: AuthorityTier;
  authority_score_norm?: number;
  reason_flags?: string[];
  scope_penalty?: number;
  context_fit_score: number;
  why_selected?: string;
  span_plan?: ResourceSegment[];
  is_continuation?: boolean;
  continuation_of?: string;
}

interface Resource {
  title: string;
  url: string;
  type: "video" | "article" | "documentation" | "tutorial" | "practice";
  estimated_minutes: number;
  description: string;
  source?: string;
  channel?: string;
  view_count?: number;
  like_count?: number;
  quality_signal?: string;
  span_plan?: ResourceSegment[];
  is_continuation?: boolean;
  continuation_of?: string;
}

interface YouTubeMetadata {
  title: string;
  channel: string;
  durationMinutes: number;
  viewCount: number;
  likeCount: number;
}

interface ModuleContext {
  topic: string;
  moduleTitle: string;
  moduleDescription: string;
  learningObjectives: string[];
  goal: string;
  level: string;
  moduleMinutes: number;
  anchorTerms?: string[];
}

// ─── Authority Tier Configuration (Light Priors) ─────────────────────────────

const TIER_CONFIG: Record<AuthorityTier, { norm: number; maxImpact: number }> = {
  OFFICIAL_DOCS:    { norm: 1.00, maxImpact: 5 },
  VENDOR_DOCS:      { norm: 0.90, maxImpact: 4 },
  UNIVERSITY_DIRECT:{ norm: 0.85, maxImpact: 4 },
  EDUCATION_DOMAIN: { norm: 0.75, maxImpact: 3 },
  YOUTUBE_TRUSTED:  { norm: 0.80, maxImpact: 3 },
  BLOG:             { norm: 0.60, maxImpact: 3 },
  YOUTUBE_UNKNOWN:  { norm: 0.50, maxImpact: 2 },
  COMMUNITY:        { norm: 0.42, maxImpact: 2 },
  UNKNOWN:          { norm: 0.25, maxImpact: 1 },
};

// Domain classification lists
const OFFICIAL_DOC_PATTERNS = [
  "python.org/doc", "docs.python.org", "react.dev", "vuejs.org",
  "angular.io/docs", "docs.docker.com", "kubernetes.io/docs",
  "go.dev/doc", "doc.rust-lang.org", "docs.oracle.com",
  "learn.microsoft.com", "developer.apple.com", "developer.mozilla.org",
];

const MAJOR_VENDOR_DOMAINS = [
  "cloud.google.com", "aws.amazon.com", "azure.microsoft.com",
  "ibm.com", "nvidia.com", "oracle.com", "redhat.com",
];

const UNIVERSITY_DOMAINS = [
  "stanford.edu", "mit.edu", "harvard.edu", "berkeley.edu",
  "cs50.harvard.edu", "ocw.mit.edu",
];

const EDUCATION_DOMAINS = [
  "coursera.org", "edx.org", "udacity.com", "khanacademy.org",
  "freecodecamp.org",
];

const RECOGNIZED_BLOGS = [
  "dev.to", "realpython.com", "digitalocean.com", "geeksforgeeks.org",
  "baeldung.com", "medium.com", "hashnode.dev", "smashingmagazine.com",
  "css-tricks.com", "web.dev",
];

const COMMUNITY_DOMAINS = [
  "stackoverflow.com", "reddit.com", "quora.com",
];

const DEPRIORITIZE_DOMAINS = [
  "tutorialspoint.com", "javatpoint.com",
];

const DISALLOWED_RESOURCE_DOMAINS = [
  "coursera.org",
  "coursera.com",
  "tiktok.com",
  "instagram.com",
  "facebook.com",
  "x.com",
  "twitter.com",
];

// YouTube channel tiers
const YOUTUBE_TRUSTED_CHANNELS = [
  "freecodecamp.org", "freecodecamp", "3blue1brown", "cs50", "computerphile",
  "mit opencourseware", "khan academy", "ibm technology", "google cloud tech",
  "aws", "microsoft developer", "traversy media", "fireship",
  "web dev simplified", "tech with tim", "programming with mosh",
  "the coding train", "sentdex", "corey schafer", "techworld with nana",
  "networkchuck", "net ninja", "javascript mastery", "cs dojo",
  "academind", "ben awad", "theo",
];

// Spam/garbage domain patterns for Stage 5 hard filter
const GARBAGE_DOMAINS = [
  "linkfarm", "spamsite", "click-bait", "content-farm",
];

interface GoalResources {
  youtubeChannels: string[];
  siteFilters: string[];
}

const GOAL_RESOURCES: Record<string, GoalResources> = {
  quick_overview: {
    youtubeChannels: ["fireship", "networkchuck", "techworld with nana"],
    siteFilters: ["site:youtube.com fireship", "site:dev.to", "site:freecodecamp.org"],
  },
  hands_on: {
    youtubeChannels: ["traversy media", "web dev simplified", "tech with tim", "programming with mosh"],
    siteFilters: ["site:realpython.com", "site:digitalocean.com/community/tutorials", "site:freecodecamp.org"],
  },
  conceptual: {
    youtubeChannels: ["3blue1brown", "cs dojo", "computerphile", "corey schafer", "ibm technology"],
    siteFilters: ["site:edx.org", "site:ocw.mit.edu", "site:freecodecamp.org"],
  },
  deep_mastery: {
    youtubeChannels: ["freecodecamp", "sentdex", "the coding train"],
    siteFilters: ["site:realpython.com", "site:digitalocean.com/community/tutorials"],
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TIMEOUTS_MS: Record<string, number> = {
  serper: 8000,
  youtube: 4000,
  agent1Base: 15000,
  agent1PerWeek: 4000,
  agent2: 12000,
  geminiDirect: 5000,
};

const RETRIEVAL_THRESHOLDS = {
  topicMinUnique: 16,
  moduleMinUnique: 10,
};

const PIPELINE_LIMITS = {
  weakModuleCandidateThreshold: 8,
  weakModuleRatioForTopicAnchors: 0.3,
  shortModuleHours: 2,
  agent2CandidatesPerModule: 18,
};

const FAST_MODE_MAX_HOURS = 40;
const FAST_MODE_MAX_MODULES = 8;
const ENABLE_EXPENSIVE_LLM_STAGES = true;
const ROADMAP_MODEL_AGENT1 = Deno.env.get("ROADMAP_MODEL_AGENT1") || "google/gemini-2.5-flash-lite";
const ROADMAP_MODEL_AGENT2 = Deno.env.get("ROADMAP_MODEL_AGENT2") || "google/gemini-2.5-flash";

const CACHE_TTL = {
  serperHours: 48,
  youtubeHours: 168,
};

function extractJsonObject(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const unfenced = fenceMatch?.[1]?.trim() || trimmed;
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return unfenced.slice(start, end + 1);
}

function parsePossiblyMalformedJson(value: unknown): any | null {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    const extracted = extractJsonObject(value);
    if (!extracted) return null;
    try {
      return JSON.parse(extracted);
    } catch {
      return null;
    }
  }
}

function buildFallbackRoadmap(
  topic: string,
  skillLevel: string,
  timelineWeeks: number,
  hoursPerDay: number,
  totalHours: number,
  daysInTimeline: number,
): any {
  const total = Math.max(1, Number(totalHours || 1));
  const moduleCount = total <= 2 ? 1 : total <= 6 ? 2 : total <= 12 ? 3 : 4;
  const moduleHours = Math.max(0.5, Math.round((total / moduleCount) * 10) / 10);
  const modules = Array.from({ length: moduleCount }).map((_, i) => {
    const dayStart = Math.max(1, Math.floor((i * daysInTimeline) / moduleCount) + 1);
    const nextStart = Math.max(dayStart, Math.floor(((i + 1) * daysInTimeline) / moduleCount));
    const dayEnd = i === moduleCount - 1 ? Math.max(dayStart, daysInTimeline) : Math.max(dayStart, nextStart);
    const moduleIndex = i + 1;
    return {
      id: `mod_${moduleIndex}`,
      title: `Module ${moduleIndex}: ${topic}`,
      description: `Focused learning block ${moduleIndex} for ${topic}.`,
      estimated_hours: moduleHours,
      day_start: dayStart,
      day_end: dayEnd,
      week: Math.max(1, Math.ceil(dayStart / 7)),
      prerequisites: [],
      learning_objectives: [
        `Understand core concepts for module ${moduleIndex}`,
        `Apply key ideas in practice for module ${moduleIndex}`,
      ],
      resources: [],
      anchor_terms: [topic.toLowerCase(), "tutorial", "practice"],
      quiz: [],
    };
  });

  return {
    topic,
    skill_level: skillLevel,
    timeline_weeks: Math.max(0.1, Number(timelineWeeks || 0.1)),
    hours_per_day: Math.max(0.5, Number(hoursPerDay || 1)),
    total_hours: Math.round(modules.reduce((sum: number, m: any) => sum + Number(m.estimated_hours || 0), 0) * 10) / 10,
    summary: `A concise, practical roadmap for ${topic} tailored to your available time.`,
    modules,
    tips: "Stay consistent, complete each module in order, and review key takeaways after every session.",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeTopicKey(raw: string): string {
  return (raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s+#./-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function callLLM(
  model: string,
  messages: Array<{ role: string; content: string }>,
  apiKey: string,
  geminiKey: string | undefined,
  timeoutMs: number,
  jsonMode = true,
): Promise<Response> {
  // Strip "google/" prefix for direct Gemini calls
  const geminiModel = model.replace(/^google\//, "");

  // Try direct Gemini first with a shorter timeout — fall back to gateway quickly
  if (geminiKey) {
    const directTimeout = Math.min(timeoutMs, TIMEOUTS_MS.geminiDirect);
    try {
      const res = await fetchWithTimeout(
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${geminiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: geminiModel,
            messages,
            ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
          }),
        },
        directTimeout,
      );
      if (res.ok) return res;
      console.warn(`Direct Gemini returned ${res.status}, falling back to gateway...`);
    } catch (e) {
      console.warn(`Direct Gemini failed: ${isAbortError(e) ? "timeout" : e}, falling back to gateway...`);
    }
  }

  // Fallback to Lovable gateway
  return fetchWithTimeout(
    "https://ai.gateway.lovable.dev/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    },
    timeoutMs,
  );
}

function detectResourceType(url: string): CandidateResource["type"] {
  const lower = url.toLowerCase();
  const docDomains = ["docs.", "developer.", "devdocs.", "wiki.", "reference.", "documentation", "developer.mozilla.org", "learn.microsoft.com"];
  const practiceDomains = ["leetcode", "hackerrank", "codewars", "exercism", "codecademy.com/learn", "freecodecamp.org/learn", "sqlzoo"];
  const tutorialDomains = ["freecodecamp", "w3schools", "geeksforgeeks", "codecademy", "khanacademy", "realpython", "digitalocean.com/community", "theodinproject"];
  if (practiceDomains.some(d => lower.includes(d))) return "practice";
  if (docDomains.some(d => lower.includes(d))) return "documentation";
  if (tutorialDomains.some(d => lower.includes(d))) return "tutorial";
  return "article";
}

function parseDurationToMinutes(duration?: string): number {
  if (!duration) return 15;
  const raw = duration.trim().toLowerCase();
  const hms = raw.match(/^(\d+):(\d+):(\d+)$/);
  if (hms) {
    const hours = parseInt(hms[1], 10);
    const minutes = parseInt(hms[2], 10);
    const seconds = parseInt(hms[3], 10);
    return Math.max(1, (hours * 60) + minutes + (seconds > 0 ? 1 : 0));
  }
  const ms = raw.match(/^(\d+):(\d+)$/);
  if (ms) {
    const minutes = parseInt(ms[1], 10);
    const seconds = parseInt(ms[2], 10);
    return Math.max(1, minutes + (seconds > 0 ? 1 : 0));
  }
  const hrMin = raw.match(/(?:(\d+)\s*h(?:ours?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?/i);
  if (hrMin && (hrMin[1] || hrMin[2])) {
    const hours = parseInt(hrMin[1] || "0", 10);
    const minutes = parseInt(hrMin[2] || "0", 10);
    return Math.max(1, (hours * 60) + minutes);
  }
  const min = raw.match(/(\d+)\s*min/i);
  if (min) return Math.max(1, parseInt(min[1], 10));
  return 15;
}

function normalizeResourceUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol.toLowerCase();
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    let path = parsed.pathname || "/";
    if (path.length > 1) path = path.replace(/\/+$/, "");

    // Unwrap Google redirect URLs — extract the actual destination URL.
    if (host.includes("google.") && (path === "/url" || path === "/interstitial")) {
      const realUrl = parsed.searchParams.get("q") || parsed.searchParams.get("url") || parsed.searchParams.get("sa");
      if (realUrl && realUrl.startsWith("http")) return normalizeResourceUrl(realUrl);
    }

    // Unwrap Google AMP cache URLs.
    if (host.includes("google.") && path.startsWith("/amp/s/")) {
      const ampTarget = path.replace("/amp/s/", "https://");
      try { return normalizeResourceUrl(ampTarget); } catch { /* fall through */ }
    }

    // Keep stable canonicalization for YouTube watch URLs.
    if ((host === "youtube.com" || host === "m.youtube.com") && path === "/watch") {
      const videoId = parsed.searchParams.get("v");
      if (videoId) return `https://youtube.com/watch?v=${videoId}`;
    }
    if (host === "youtu.be") {
      const videoId = path.replace("/", "");
      if (videoId) return `https://youtube.com/watch?v=${videoId}`;
    }

    // Collapse Google search URLs to one canonical key (but not product docs like developers.google.com, cloud.google.com).
    if (host.includes("google.") && path.startsWith("/search")) {
      return `https://${host}/search`;
    }
    // Collapse search subdomains (scholar, books, cse, news).
    const searchSubdomainPrefixes = ["scholar.", "books.", "cse.", "news."];
    if (searchSubdomainPrefixes.some(p => host.startsWith(p)) && host.includes("google.")) {
      return `https://${host}/search`;
    }

    return `${protocol}//${host}${path}`;
  } catch {
    return url.split("&")[0];
  }
}

function extractResourceHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isExcludedResource(url: string, excludedUrls: Set<string>, excludedDomains: Set<string>): boolean {
  const normalized = normalizeResourceUrl(url);
  if (excludedUrls.has(normalized)) return true;
  const host = extractResourceHost(url);
  if (!host) return false;
  for (const blocked of excludedDomains) {
    if (blocked.startsWith("*.")) {
      const suffix = blocked.slice(2);
      if (host === suffix || host.endsWith(`.${suffix}`)) return true;
      continue;
    }
    if (host === blocked) return true;
  }
  return false;
}

function isAllowedResourceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.toLowerCase();
    const query = parsed.search.toLowerCase();
    if (DISALLOWED_RESOURCE_DOMAINS.some(d => host.includes(d))) return false;
    // Block all bare Google domains (google.com, google.co.in, m.google.com, etc.)
    if (/^(?:m\.)?google\.[a-z.]+$/i.test(host)) return false;
    // Block any Google subdomain with /search path
    if (host.includes("google.") && path.startsWith("/search")) return false;
    // Block Google search subdomains (scholar, books, cse) but allow product docs (developers, cloud)
    const googleSearchSubdomains = ["scholar.google.", "books.google.", "cse.google.", "news.google."];
    if (googleSearchSubdomains.some(d => host.startsWith(d) || host.includes(`.${d}`))) return false;
    // Block YouTube search results
    if (host.includes("youtube.com") && path.startsWith("/results")) return false;
    // Block Bing, DuckDuckGo, and other search engines
    if ((host === "bing.com" || host.endsWith(".bing.com")) && path.startsWith("/search")) return false;
    if (host === "duckduckgo.com" || host === "search.yahoo.com") return false;
    return true;
  } catch {
    return false;
  }
}

function parseISO8601Duration(iso8601: string): number {
  const match = iso8601.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  const hours = parseInt(match?.[1] || '0');
  const minutes = parseInt(match?.[2] || '0');
  const seconds = parseInt(match?.[3] || '0');
  return hours * 60 + minutes + (seconds > 0 ? 1 : 0);
}

function extractYouTubeVideoId(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
  return match ? match[1] : null;
}

function formatViewCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

function hashKey(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

async function fetchYouTubeMetadata(videoIds: string[], apiKey: string, supabaseAdmin?: any): Promise<Map<string, YouTubeMetadata>> {
  const metadataMap = new Map<string, YouTubeMetadata>();
  if (videoIds.length === 0) return metadataMap;
  const nowIso = new Date().toISOString();

  if (supabaseAdmin) {
    try {
      const { data: cached } = await supabaseAdmin
        .from("youtube_metadata_cache")
        .select("video_id,title,channel,duration_minutes,view_count,like_count")
        .in("video_id", videoIds)
        .gt("expires_at", nowIso);
      for (const row of (cached || [])) {
        metadataMap.set(row.video_id, {
          title: row.title,
          channel: row.channel,
          durationMinutes: Number(row.duration_minutes || 0),
          viewCount: Number(row.view_count || 0),
          likeCount: Number(row.like_count || 0),
        });
      }
    } catch (e) {
      console.warn("YouTube cache read failed:", e);
    }
  }

  const missingIds = videoIds.filter((id) => !metadataMap.has(id));
  if (missingIds.length === 0) return metadataMap;

  // Fire all YouTube API batches in parallel instead of sequentially
  const batchPromises: Promise<void>[] = [];
  for (let i = 0; i < missingIds.length; i += 50) {
    const batch = missingIds.slice(i, i + 50);
    const idsParam = batch.join(",");
    batchPromises.push((async () => {
      try {
        const res = await fetchWithTimeout(
          `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${idsParam}&key=${apiKey}`,
          { method: "GET" },
          TIMEOUTS_MS.youtube
        );
        if (!res.ok) {
          if (res.status === 403) {
            console.warn("YouTube API quota exceeded, skipping enrichment");
            return;
          }
          console.error(`YouTube API error: ${res.status}`);
          return;
        }
        const data = await res.json();
        const cacheRows: Array<Record<string, any>> = [];
        for (const item of (data.items || [])) {
          const metadata: YouTubeMetadata = {
            title: item.snippet?.title || "",
            channel: item.snippet?.channelTitle || "",
            durationMinutes: parseISO8601Duration(item.contentDetails?.duration || "PT0S"),
            viewCount: parseInt(item.statistics?.viewCount || "0"),
            likeCount: parseInt(item.statistics?.likeCount || "0"),
          };
          metadataMap.set(item.id, metadata);
          cacheRows.push({
            video_id: item.id,
            title: metadata.title,
            channel: metadata.channel,
            duration_minutes: metadata.durationMinutes,
            view_count: metadata.viewCount,
            like_count: metadata.likeCount,
            expires_at: new Date(Date.now() + CACHE_TTL.youtubeHours * 60 * 60 * 1000).toISOString(),
          });
        }
        if (supabaseAdmin && cacheRows.length > 0) {
          try {
            const upsertResult = supabaseAdmin.from("youtube_metadata_cache").upsert(cacheRows, { onConflict: "video_id" });
            if (upsertResult && typeof upsertResult.catch === "function") {
              upsertResult.catch((e: any) => console.warn("YouTube cache write failed:", e));
            }
          } catch (e) {
            console.warn("YouTube cache write failed:", e);
          }
        }
      } catch (e) {
        console.error("YouTube API fetch failed:", e);
      }
    })());
  }
  await Promise.all(batchPromises);
  return metadataMap;
}

async function searchSerper(
  query: string,
  apiKey: string,
  type: "search" | "videos",
  num: number,
  supabaseAdmin?: any,
  allowCacheWrite = true,
) {
  const url = type === "videos" ? "https://google.serper.dev/videos" : "https://google.serper.dev/search";
  const queryHash = hashKey(`${type}:${query.trim().toLowerCase()}`);
  const nowIso = new Date().toISOString();

  if (supabaseAdmin) {
    try {
      const { data: cached } = await supabaseAdmin
        .from("resource_search_cache")
        .select("response_json")
        .eq("query_hash", queryHash)
        .eq("search_type", type)
        .gt("expires_at", nowIso)
        .maybeSingle();
      if (cached?.response_json) {
        return cached.response_json;
      }
    } catch (e) {
      console.warn("Serper cache read failed:", e);
    }
  }

  // Retry once on transient failures (timeout, network error).
  // Serper is the sole source of resource candidates — if it fails, the entire
  // roadmap ships with 0 resources, which is worse than a slightly longer wait.
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, num }),
      }, TIMEOUTS_MS.serper);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(`Serper ${type} error: HTTP ${res.status} — ${body.slice(0, 200)}`);
        // Don't retry auth/billing errors — key is invalid, retrying won't help
        if (res.status === 401 || res.status === 403 || res.status === 402) return [];
        if (attempt < maxAttempts) { await sleep(500); continue; }
        return [];
      }
      const data = await res.json();
      const results = type === "videos" ? (data.videos || []) : (data.organic || []);
      if (supabaseAdmin && allowCacheWrite) {
        // Fire-and-forget cache write — don't block the return.
        try {
          const upsertResult = supabaseAdmin.from("resource_search_cache").upsert({
            query_hash: queryHash,
            query_text: query,
            search_type: type,
            response_json: results,
            expires_at: new Date(Date.now() + CACHE_TTL.serperHours * 60 * 60 * 1000).toISOString(),
          }, { onConflict: "query_hash,search_type" });
          if (upsertResult && typeof upsertResult.catch === "function") {
            upsertResult.catch((e: any) => console.warn("Serper cache write failed:", e));
          }
        } catch (e) {
          console.warn("Serper cache write failed:", e);
        }
      }
      return results;
    } catch (e) {
      const timeoutMsg = isAbortError(e) ? "timeout" : "fetch failed";
      console.error(`Serper ${type} ${timeoutMsg} (attempt ${attempt}/${maxAttempts}):`, e);
      if (attempt < maxAttempts) { await sleep(500); continue; }
      return [];
    }
  }
  return [];
}

function estimateArticleMinutes(snippet: string): number {
  const wordCount = snippet ? snippet.split(/\s+/).length : 0;
  if (wordCount > 80) return 40;
  if (wordCount > 40) return 30;
  return 20;
}

function computeSemanticSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  if (words1.size === 0 || words2.size === 0) return 0;
  let overlap = 0;
  for (const w of words1) {
    if (words2.has(w)) overlap++;
  }
  return overlap / Math.min(words1.size, words2.size);
}

function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/[^a-z0-9+#./-]/g, "")
    .trim();
}

function stemToken(token: string): string {
  let t = normalizeToken(token);
  if (t.length <= 4) return t;
  if (t.endsWith("ing") && t.length > 6) t = t.slice(0, -3);
  else if (t.endsWith("ed") && t.length > 5) t = t.slice(0, -2);
  else if (t.endsWith("es") && t.length > 5) t = t.slice(0, -2);
  else if (t.endsWith("s") && t.length > 4) t = t.slice(0, -1);
  return t;
}

function tokenizeSemantic(text: string): string[] {
  const raw = text
    .toLowerCase()
    .replace(/[^a-z0-9+#./\-\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
  return raw.map(stemToken).filter(Boolean);
}

function buildHashedEmbedding(text: string, dim = 256): number[] {
  const tokens = tokenizeSemantic(text);
  const vec = new Array<number>(dim).fill(0);
  const weights = new Map<string, number>();

  for (let i = 0; i < tokens.length; i++) {
    const unigram = tokens[i];
    weights.set(unigram, (weights.get(unigram) || 0) + 1);
    if (i < tokens.length - 1) {
      const bigram = `${tokens[i]}_${tokens[i + 1]}`;
      weights.set(bigram, (weights.get(bigram) || 0) + 1.35);
    }
  }

  for (const [token, tf] of weights.entries()) {
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      hash = (hash * 31 + token.charCodeAt(i)) >>> 0;
    }
    const idx = hash % dim;
    const idfLike = Math.min(2.5, 1 + token.length / 8);
    vec[idx] += tf * idfLike;
  }

  let norm = 0;
  for (const n of vec) norm += n * n;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  }
  return vec;
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < vecA.length; i++) dot += vecA[i] * vecB[i];
  return Math.max(0, Math.min(1, dot));
}

function computeEmbeddingSimilarity(text1: string, text2: string): number {
  const vecA = buildHashedEmbedding(text1);
  const vecB = buildHashedEmbedding(text2);
  return cosineSimilarity(vecA, vecB);
}

function computeHybridSimilarity(text1: string, text2: string): number {
  const lexical = computeSemanticSimilarity(text1, text2);
  const embedding = computeEmbeddingSimilarity(text1, text2);
  return Math.max(0, Math.min(1, lexical * 0.35 + embedding * 0.65));
}

function isVideoLikelyOffTopic(title: string, channel: string, ctx: ModuleContext): boolean {
  const combined = `${title} ${channel}`.toLowerCase();
  const moduleText = `${ctx.topic} ${ctx.moduleTitle} ${ctx.moduleDescription} ${ctx.learningObjectives.join(" ")}`.toLowerCase();
  const similarity = computeHybridSimilarity(moduleText, combined);
  const hashtags = (combined.match(/#[a-z0-9_]+/g) || []).length;
  const socialShortsSignal = /\b(tiktok|reels|shorts|vlog|trend|viral)\b/i.test(combined);
  const anchorTerms = (ctx.anchorTerms || []).map(a => a.toLowerCase()).filter(a => a.length > 2);
  const hasAnchor = anchorTerms.length === 0
    ? false
    : anchorTerms.some(a => combined.includes(a));

  if (similarity < 0.1 && !hasAnchor) return true;
  if (hashtags >= 3 && similarity < 0.16 && !hasAnchor) return true;
  if (socialShortsSignal && similarity < 0.2 && !hasAnchor) return true;
  return false;
}

function countUniqueSerperResults(results: { videos: SerperVideoResult[]; web: SerperWebResult[] }): number {
  const unique = new Set<string>();
  for (const v of results.videos || []) {
    if (v.link) unique.add(v.link.split("&")[0]);
  }
  for (const w of results.web || []) {
    if (w.link) unique.add(w.link);
  }
  return unique.size;
}

function mergeSerperResults(
  base: { videos: SerperVideoResult[]; web: SerperWebResult[] },
  incoming: { videos: SerperVideoResult[]; web: SerperWebResult[] },
): { videos: SerperVideoResult[]; web: SerperWebResult[] } {
  return {
    videos: [...base.videos, ...incoming.videos],
    web: [...base.web, ...incoming.web],
  };
}

function detectCertificationIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return /\b(certification|cert|exam|associate|professional|practitioner|architect)\b/i.test(lower);
}

function looksLikeListingPage(url: string, title: string, snippet: string): boolean {
  const text = `${url} ${title} ${snippet}`.toLowerCase();
  const listingSignals = [
    "search",
    "results",
    "catalog",
    "directory",
    "collections",
    "category",
    "paths",
    "learning path",
    "certification path",
    "course list",
    "browse courses",
    "all courses",
  ];
  let hits = 0;
  for (const signal of listingSignals) {
    if (text.includes(signal)) hits++;
  }
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const query = parsed.search.toLowerCase();

    if (host.includes("google.") && path.startsWith("/search")) return true;
    if (host.includes("youtube.com") && path.includes("/results")) return true;
    if (path.includes("/search") || path.includes("/catalog")) return true;
    if (query.includes("search") || query.includes("query=") || query.includes("q=")) return true;
  } catch {
    // No-op for malformed URLs
  }
  return hits >= 2;
}

function isDiscussionOrMetaResource(url: string, title: string, snippet: string): boolean {
  const combined = `${title} ${snippet}`.toLowerCase();
  const urlLower = url.toLowerCase();
  const discussionSignals = [
    "what are the best",
    "best resources",
    "where to start",
    "how do i start",
    "any recommendations",
    "recommend me",
    "which course should",
    "is this worth it",
    "question",
    "discussion",
    "thread",
  ];
  const educationalSignals = [
    "tutorial",
    "guide",
    "lesson",
    "course",
    "documentation",
    "docs",
    "walkthrough",
    "lecture",
    "reference",
    "syllabus",
  ];
  const hasDiscussionSignal = discussionSignals.some(s => combined.includes(s));
  const hasEducationalSignal = educationalSignals.some(s => combined.includes(s));
  const isQuestionTitle = title.trim().endsWith("?") || /\b(what|how|which|where|why)\b/i.test(title);
  const isCommunityPath = /\/(r\/|questions?|discussion|threads?|forum|community)\b/.test(urlLower);

  if (isCommunityPath && hasDiscussionSignal) return true;
  if (isQuestionTitle && hasDiscussionSignal && !hasEducationalSignal) return true;
  if (urlLower.includes("reddit.com") && !hasEducationalSignal) return true;
  return false;
}

function getModuleBounds(totalHours: number, daysInTimeline: number): { min: number; max: number } {
  const timelineWeeks = daysInTimeline / 7;
  if (timelineWeeks > 3) return { min: 4, max: 8 };
  if (timelineWeeks >= 2) return { min: 4, max: totalHours >= 30 ? 7 : 6 };
  if (totalHours <= 3) return { min: 1, max: 2 };
  return { min: 1, max: 4 };
}

function normalizeModulePlan(roadmap: any, totalHours: number, daysInTimeline: number): void {
  if (!roadmap || !Array.isArray(roadmap.modules) || roadmap.modules.length === 0) return;
  const modules = roadmap.modules as any[];
  const bounds = getModuleBounds(totalHours, daysInTimeline);

  while (modules.length > bounds.max) {
    const idx = modules.length - 2;
    const left = modules[idx];
    const right = modules[idx + 1];
    left.title = `${left.title} + ${right.title}`;
    left.description = `${left.description || ""} ${right.description || ""}`.trim();
    left.estimated_hours = Number(left.estimated_hours || 0) + Number(right.estimated_hours || 0);
    left.day_start = Math.min(Number(left.day_start || 1), Number(right.day_start || 1));
    left.day_end = Math.max(Number(left.day_end || left.day_start || 1), Number(right.day_end || right.day_start || 1));
    left.week = Math.ceil((Number(left.day_start || 1)) / 7);
    left.learning_objectives = [...new Set([...(left.learning_objectives || []), ...(right.learning_objectives || [])])].slice(0, 8);
    left.prerequisites = [...new Set([...(left.prerequisites || []), ...(right.prerequisites || [])])].slice(0, 8);
    left.quiz = [...(left.quiz || []), ...(right.quiz || [])].slice(0, 5);
    left.anchor_terms = [...new Set([...(left.anchor_terms || []), ...(right.anchor_terms || [])])].slice(0, 8);
    left.id = `mod_${idx + 1}`;
    modules.splice(idx + 1, 1);
  }

  if (modules.length < bounds.min) {
    console.log(`Module planner: keeping ${modules.length} modules (suggested minimum ${bounds.min}) to avoid artificial splitting.`);
  }

  const sum = modules.reduce((acc, m) => acc + Number(m.estimated_hours || 0), 0);
  const target = Math.max(totalHours * 0.85, 0.5);
  const factor = sum > 0 ? target / sum : 1;
  let consumedDays = 0;
  for (let i = 0; i < modules.length; i++) {
    const m = modules[i];
    m.id = `mod_${i + 1}`;
    m.estimated_hours = Math.max(0.5, Math.round((Number(m.estimated_hours || 1) * factor) * 10) / 10);
    const remainingModules = modules.length - i;
    const remainingDays = Math.max(daysInTimeline - consumedDays, remainingModules);
    const span = Math.max(1, Math.floor(remainingDays / remainingModules));
    m.day_start = consumedDays + 1;
    m.day_end = Math.min(daysInTimeline, consumedDays + span);
    m.week = Math.max(1, Math.ceil(m.day_start / 7));
    consumedDays = m.day_end;
  }
}

function enforceModuleTimeWindowConsistency(modules: any[], hoursPerDay: number): void {
  if (!Array.isArray(modules) || modules.length === 0) return;
  const safeHoursPerDay = Math.max(Number(hoursPerDay || 0), 0.1);

  for (const mod of modules) {
    const dayStart = Math.max(1, Number(mod.day_start || 1));
    const dayEnd = Math.max(dayStart, Number(mod.day_end || dayStart));
    const moduleDays = Math.max(1, dayEnd - dayStart + 1);
    const windowHours = moduleDays * safeHoursPerDay;
    const capHours = Math.max(0.5, Math.round(windowHours * 10) / 10);
    const est = Number(mod.estimated_hours || 0.5);

    if (est > capHours * 1.05) {
      mod.estimated_hours = capHours;
    } else if (est < 0.5) {
      mod.estimated_hours = 0.5;
    }

    mod.day_start = dayStart;
    mod.day_end = dayEnd;
    mod.week = Math.max(1, Math.ceil(dayStart / 7));
  }
}

// ─── STAGE 4: Enhanced Hard Filter ───────────────────────────────────────────

// 4.0: Basic disqualification (spam/garbage)
function isDisqualified(title: string, url: string): boolean {
  const spamSignals = /\b(top \d+ best|best \d+|you won't believe|clickbait|ai generated|content farm)\b/i;
  if (spamSignals.test(title)) return true;
  if (DEPRIORITIZE_DOMAINS.some(d => url.toLowerCase().includes(d))) return true;
  return false;
}

// 4.1: Anchor Precision Gate — module-specific anchor enforcement
function generateModuleAnchors(mod: any, topic: string): string[] {
  // Use AI-generated anchors if available
  if (mod.anchor_terms && Array.isArray(mod.anchor_terms) && mod.anchor_terms.length > 0) {
    return mod.anchor_terms.map((t: string) => t.toLowerCase().trim());
  }

  // Fallback: extract technical terms from module title, description, objectives
  const stopWords = new Set([
    "the", "and", "for", "with", "this", "that", "from", "into", "your", "will",
    "how", "what", "why", "when", "learn", "understand", "explore", "using",
    "introduction", "getting", "started", "basics", "overview", "module",
    "concepts", "working", "building", "creating", "implementing", "advanced",
    "intermediate", "beginner", "fundamental", "essential", "key", "core",
    "deep", "dive", "part", "section", "chapter", "unit", "lesson",
  ]);

  const allText = `${mod.title} ${mod.description || ""} ${(mod.learning_objectives || []).join(" ")}`;
  const words = allText.toLowerCase()
    .replace(/[^a-z0-9\s\-_.\/]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  // Also extract 2-word phrases from title
  const titleWords = mod.title.toLowerCase().replace(/[^a-z0-9\s\-]/g, " ").split(/\s+/).filter((w: string) => w.length > 1);
  const bigrams: string[] = [];
  for (let i = 0; i < titleWords.length - 1; i++) {
    if (!stopWords.has(titleWords[i]) || !stopWords.has(titleWords[i + 1])) {
      bigrams.push(`${titleWords[i]} ${titleWords[i + 1]}`);
    }
  }

  // Deduplicate and limit
  const anchors = [...new Set([...bigrams, ...words])];
  // Remove the main topic itself (too broad)
  const topicLower = topic.toLowerCase();
  const filtered = anchors.filter(a => a !== topicLower && a.length > 2);

  return filtered.slice(0, 8);
}

function passesAnchorGate(candidate: CandidateResource, anchors: string[]): boolean {
  if (anchors.length === 0) return true; // No anchors = skip gate

  const text = `${candidate.title} ${candidate.description}`.toLowerCase();
  for (const anchor of anchors) {
    if (text.includes(anchor)) return true;
  }
  return false;
}

// 4.2: Scope Mismatch Penalty — penalize broad meta-content for narrow modules
const BROAD_SCOPE_SIGNALS = [
  "roadmap", "full course", "complete guide", "overview",
  "beginner to advanced", "crash course", "ultimate guide",
  "everything you need", "learn .+ in \\d+", "zero to hero",
  "complete tutorial", "all you need to know",
];

function computeScopePenalty(candidate: CandidateResource, ctx: ModuleContext): number {
  const text = `${candidate.title} ${candidate.description}`.toLowerCase();
  const hasBroadSignal = BROAD_SCOPE_SIGNALS.some(pattern => {
    try {
      return new RegExp(pattern, "i").test(text);
    } catch {
      return text.includes(pattern);
    }
  });

  if (!hasBroadSignal) return 0;

  // Check if module is intro/overview → no penalty
  const modTitleLower = ctx.moduleTitle.toLowerCase();
  const isIntroModule = /introduction|overview|getting started|basics|fundamentals|what is/i.test(modTitleLower);
  const isQuickGoal = ctx.goal === "quick_overview";

  if (isIntroModule || isQuickGoal) return 0;

  // Intermediate/Advanced/Deep mastery/Tool-specific → penalty
  const isNarrow = ctx.level === "intermediate" || ctx.level === "advanced" || ctx.goal === "deep_mastery";
  if (isNarrow) return 15; // Stronger penalty for narrow modules
  return 10; // Default penalty for non-intro modules
}

// Full Stage 4 pipeline
function applyStage4Filter(
  candidates: CandidateResource[],
  ctx: ModuleContext
): CandidateResource[] {
  const anchors = ctx.anchorTerms || [];
  const strictFiltered: CandidateResource[] = [];
  const relaxedPool: CandidateResource[] = [];
  const moduleText = `${ctx.topic} ${ctx.moduleTitle} ${ctx.moduleDescription} ${ctx.learningObjectives.join(" ")}`;

  for (const c of candidates) {
    // 4.0: Basic spam check (already done in mergeAndDeduplicate, but double-check)
    if (isDisqualified(c.title, c.url)) continue;

    // 4.1: Embedding similarity threshold
    const resourceText = `${c.title} ${c.description} ${c.channel || ""}`;
    const similarity = computeHybridSimilarity(moduleText, resourceText);
    if (similarity < 0.14) continue;

    // Keep a relaxed pool to prevent starvation when anchors are too narrow/noisy.
    const penalty = computeScopePenalty(c, ctx);
    c.scope_penalty = penalty;
    relaxedPool.push(c);

    // 4.2: Anchor precision gate — hard reject if no anchors match
    if (!passesAnchorGate(c, anchors)) {
      continue;
    }
    strictFiltered.push(c);
  }

  // If strict anchor gate leaves too little headroom, blend best relaxed candidates.
  const minTarget = Math.min(8, Math.max(4, Math.floor(ctx.moduleMinutes / 35)));
  if (strictFiltered.length >= minTarget || relaxedPool.length <= strictFiltered.length) {
    console.log(`Stage 4: ${candidates.length} → ${strictFiltered.length} candidates for "${ctx.moduleTitle}" (${anchors.length} anchors, strict)`);
    return strictFiltered;
  }

  const merged = [...strictFiltered];
  for (const c of relaxedPool) {
    if (merged.length >= minTarget) break;
    if (merged.some(m => m.url === c.url)) continue;
    merged.push(c);
  }

  console.log(`Stage 4: ${candidates.length} → ${strictFiltered.length} strict, expanded to ${merged.length} for "${ctx.moduleTitle}"`);
  return merged;
}

// ─── STAGE 5: Light Authority Scoring ────────────────────────────────────────

function classifyAuthorityTier(candidate: CandidateResource, ytMeta?: YouTubeMetadata): { tier: AuthorityTier; reasonFlags: string[] } {
  const urlLower = candidate.url.toLowerCase();
  const reasonFlags: string[] = [];

  // Official docs
  if (OFFICIAL_DOC_PATTERNS.some(d => urlLower.includes(d))) {
    reasonFlags.push("official_docs");
    return { tier: "OFFICIAL_DOCS", reasonFlags };
  }

  // Major vendor
  if (MAJOR_VENDOR_DOMAINS.some(d => urlLower.includes(d))) {
    reasonFlags.push("vendor_docs");
    return { tier: "VENDOR_DOCS", reasonFlags };
  }

  // University direct
  if (UNIVERSITY_DOMAINS.some(d => urlLower.includes(d))) {
    reasonFlags.push("university");
    return { tier: "UNIVERSITY_DIRECT", reasonFlags };
  }

  // Education platforms
  if (EDUCATION_DOMAINS.some(d => urlLower.includes(d))) {
    reasonFlags.push("education_platform");
    return { tier: "EDUCATION_DOMAIN", reasonFlags };
  }

  // YouTube
  if (candidate.type === "video") {
    if (ytMeta) {
      const channelLower = ytMeta.channel.toLowerCase();
      if (YOUTUBE_TRUSTED_CHANNELS.some(ch => channelLower.includes(ch))) {
        reasonFlags.push("youtube_channel_known");
        return { tier: "YOUTUBE_TRUSTED", reasonFlags };
      }
    }
    reasonFlags.push("youtube_unknown");
    return { tier: "YOUTUBE_UNKNOWN", reasonFlags };
  }

  // Blogs
  if (RECOGNIZED_BLOGS.some(d => urlLower.includes(d))) {
    reasonFlags.push("recognized_blog");
    return { tier: "BLOG", reasonFlags };
  }

  // .edu domains (not in specific university list)
  if (urlLower.includes(".edu")) {
    reasonFlags.push("edu_domain");
    return { tier: "EDUCATION_DOMAIN", reasonFlags };
  }

  // Community
  if (COMMUNITY_DOMAINS.some(d => urlLower.includes(d))) {
    reasonFlags.push("community_site");
    return { tier: "COMMUNITY", reasonFlags };
  }

  return { tier: "UNKNOWN", reasonFlags: ["unknown_source"] };
}

function computeLightAuthorityBump(candidate: CandidateResource, ytMeta?: YouTubeMetadata): void {
  const { tier, reasonFlags } = classifyAuthorityTier(candidate, ytMeta);
  const config = TIER_CONFIG[tier];
  const bump = Math.min(config.maxImpact, Math.round(config.norm * config.maxImpact));

  candidate.authority_tier = tier;
  candidate.authority_score_norm = config.norm;
  candidate.authority_score = bump; // 0-5 range
  candidate.reason_flags = reasonFlags;
}

// Stage 5: Garbage filter — only hard-reject true junk
function isGarbage(candidate: CandidateResource): boolean {
  const urlLower = candidate.url.toLowerCase();
  const titleLower = candidate.title.toLowerCase();
  // Known spam/link farm domains
  if (GARBAGE_DOMAINS.some(d => urlLower.includes(d))) return true;
  // Search/listing pages are not direct learning resources.
  if (looksLikeListingPage(candidate.url, candidate.title, candidate.description)) return true;
  // Catalog/search style titles are almost always poor module resources.
  if (/\b(search results|course catalog|browse courses|learning paths?)\b/i.test(titleLower)) return true;
  // Discussion/recommendation threads are not direct instructional resources.
  if (isDiscussionOrMetaResource(candidate.url, candidate.title, candidate.description)) return true;
  // Suspicious URL patterns
  if (/\.(xyz|tk|ml|ga|cf)\//.test(urlLower)) return true;
  // Empty or suspiciously short descriptions that suggest thin content
  if (candidate.description.length < 10 && !candidate.channel) return true;
  return false;
}

// Stage 5: Diversity caps — ensure balanced mix going to Agent 2
function applyDiversityCaps(candidates: CandidateResource[], maxPerModule: number, goal: string, _topic: string): CandidateResource[] {
  if (candidates.length <= maxPerModule) return candidates;

  const videos = candidates.filter(c => c.type === "video");
  const docs = candidates.filter(c => c.type === "documentation");
  const articles = candidates.filter(c => c.type === "article" || c.type === "tutorial" || c.type === "practice");

  const handsOn = goal === "hands_on";
  const maxVideos = Math.ceil(maxPerModule * (handsOn ? 0.55 : 0.40));
  const maxDocs = Math.ceil(maxPerModule * (handsOn ? 0.15 : 0.35));
  const maxArticles = maxPerModule - Math.min(videos.length, maxVideos) - Math.min(docs.length, maxDocs);

  const result: CandidateResource[] = [];
  result.push(...videos.slice(0, maxVideos));
  result.push(...docs.slice(0, maxDocs));
  result.push(...articles.slice(0, Math.max(maxArticles, maxPerModule - result.length)));

  // Fill remaining slots if under cap
  if (result.length < maxPerModule) {
    for (const c of candidates) {
      if (result.length >= maxPerModule) break;
      if (!result.includes(c)) result.push(c);
    }
  }

  return result.slice(0, maxPerModule);
}

// ─── STAGE 6: Context Fit Scoring (Heuristic Fallback) ──────────────────────

function computeContextFitScoreFallback(candidate: CandidateResource, ctx: ModuleContext, ytMeta?: YouTubeMetadata): number {
  const moduleText = `${ctx.topic} ${ctx.moduleTitle} ${ctx.moduleDescription} ${ctx.learningObjectives.join(" ")} ${ctx.goal} ${ctx.level}`;
  const resourceText = `${candidate.title} ${candidate.description} ${candidate.channel || ""}`;
  const topicFit = Math.round(computeHybridSimilarity(moduleText, resourceText) * 35);
  let goalFit = 0;
  if (ctx.goal === "conceptual" && (candidate.type === "video" || candidate.type === "documentation" || candidate.type === "article")) goalFit = 20;
  else if (ctx.goal === "hands_on" && (candidate.type === "tutorial" || candidate.type === "practice" || candidate.type === "video")) goalFit = 20;
  else if (ctx.goal === "quick_overview" && candidate.estimated_minutes <= 45 && (candidate.type === "video" || candidate.type === "article" || candidate.type === "tutorial" || candidate.type === "documentation")) goalFit = 20;
  else if (ctx.goal === "deep_mastery" && candidate.estimated_minutes >= 25 && (candidate.type === "video" || candidate.type === "documentation" || candidate.type === "article")) goalFit = 20;
  else goalFit = 10;

  let levelFit = 8;
  const titleLower = candidate.title.toLowerCase();
  if (ctx.level === "beginner" && /beginner|intro|basic|fundamental|getting started|what is/i.test(titleLower)) levelFit = 15;
  if (ctx.level === "intermediate" && /intermediate|practical|pattern|use case/i.test(titleLower)) levelFit = 15;
  if (ctx.level === "advanced" && /advanced|deep|expert|optimization|architecture/i.test(titleLower)) levelFit = 15;

  let timeFit = 15;
  if (candidate.estimated_minutes > ctx.moduleMinutes * 1.2) timeFit = 6;
  if (candidate.estimated_minutes > ctx.moduleMinutes * 2) timeFit = 0;

  let qualityFit = 8;
  if ((candidate.authority_score_norm || 0) >= 0.75) qualityFit = 15;
  else if ((candidate.authority_score_norm || 0) >= 0.5) qualityFit = 12;
  if (looksLikeListingPage(candidate.url, candidate.title, candidate.description)) qualityFit = Math.max(qualityFit - 8, 0);

  const goalChannels = GOAL_RESOURCES[ctx.goal]?.youtubeChannels || [];
  if (candidate.type === "video" && ytMeta) {
    const channelLower = ytMeta.channel.toLowerCase();
    if (goalChannels.some(ch => channelLower.includes(ch))) qualityFit = Math.min(qualityFit + 3, 15);
    if (ytMeta.viewCount >= 1_000_000) qualityFit = Math.min(qualityFit + 2, 15);
    else if (ytMeta.viewCount >= 100_000) qualityFit = Math.min(qualityFit + 1, 15);
  }

  const topicOrModuleCert = detectCertificationIntent(`${ctx.topic} ${ctx.moduleTitle}`);
  if (topicOrModuleCert && /certification|exam|associate|professional/i.test(titleLower)) qualityFit = Math.min(qualityFit + 2, 15);

  let practicalityAdjust = 0;
  const practicalSignals = /\b(build|project|walkthrough|code along|coding|implementation|lab|exercise|kata|case study|mock interview|whiteboard)\b/i;
  const passiveSignals = /\b(reference|documentation|docs|overview|glossary|faq|catalog|search results)\b/i;
  const resourceComposite = `${candidate.title} ${candidate.description} ${candidate.url}`;
  if (ctx.goal === "hands_on") {
    if (candidate.type === "practice" || candidate.type === "tutorial" || candidate.type === "video") practicalityAdjust += 8;
    if (practicalSignals.test(resourceComposite)) practicalityAdjust += 6;
    if (candidate.type === "documentation") practicalityAdjust -= 8;
    if (passiveSignals.test(resourceComposite)) practicalityAdjust -= 4;
  }

  // Apply scope penalty from Stage 4
  let score = topicFit + goalFit + levelFit + timeFit + qualityFit + practicalityAdjust;
  score -= (candidate.scope_penalty || 0);

  return Math.max(0, Math.min(score, 100));
}

// ─── STAGE 6+8: Combined AI Scoring + Selection (Agent 2) ────────────────────

interface AIFitScoringInput {
  moduleId: string;
  moduleTitle: string;
  moduleDescription: string;
  learningObjectives: string[];
  candidates: Array<{
    index: number;
    title: string;
    url: string;
    type: string;
    channel: string;
    duration_minutes: number;
    description: string;
    authority_tier: string;
    authority_score_norm: number;
    authority_bump: number;
    content_type: string;
    reason_flags: string[];
    view_count: number;
    appearances_count: number;
  }>;
}

interface Agent2Result {
  success: boolean;
  selections: Map<string, string[]>;
}

// ─── Per-Module AI Scoring (Single Module) ────────────────────────────────────

interface ModuleScoringResult {
  moduleId: string;
  success: boolean;
  selections: string[];
}

async function scoreModuleResources(
  mod: any,
  candidates: CandidateResource[],
  topic: string,
  goal: string,
  level: string,
  apiKey: string
): Promise<ModuleScoringResult> {
  const moduleId = mod.id;
  const emptyResult: ModuleScoringResult = { moduleId, success: false, selections: [] };

  const sorted = [...candidates].sort((a, b) => b.context_fit_score - a.context_fit_score);
  const top = applyDiversityCaps(sorted, PIPELINE_LIMITS.agent2CandidatesPerModule, goal, topic);
  if (top.length === 0) return emptyResult;

  const scoringInput: AIFitScoringInput = {
    moduleId,
    moduleTitle: mod.title,
    moduleDescription: mod.description || "",
    learningObjectives: mod.learning_objectives || [],
    candidates: top.map((c, i) => ({
      index: i,
      title: c.title,
      url: c.url,
      type: c.type,
      channel: c.channel || (() => { try { return new URL(c.url).hostname.replace("www.", ""); } catch { return "unknown"; } })(),
      duration_minutes: c.estimated_minutes,
      description: c.description,
      authority_tier: c.authority_tier || "UNKNOWN",
      authority_score_norm: c.authority_score_norm || 0,
      authority_bump: c.authority_score,
      content_type: c.type,
      reason_flags: c.reason_flags || [],
      view_count: c.view_count || 0,
      appearances_count: c.appearances_count,
    })),
  };

  const goalInstruction = goal === "hands_on"
    ? "Prefer practical tutorials, code-alongs, project builds, labs, and implementation walkthroughs."
    : goal === "conceptual"
    ? "Prefer concept explainers: videos + study articles/docs focused on mental models and how/why."
    : goal === "quick_overview"
    ? "Prefer concise full-topic overviews: crash courses, start-to-finish guides, top takeaways."
    : "Prefer deep and comprehensive resources: advanced articles, official docs, long-form explainers, and research papers when relevant.";

  const prompt = `You are the Resource Evaluator for ONE module of a learning roadmap. Score and select the best resources.

Learner profile:
- Topic: ${topic}
- Learning Goal: ${goal}
- Proficiency Level: ${level}

Module: "${mod.title}"
Description: ${mod.description || ""}
Learning Objectives: ${(mod.learning_objectives || []).join("; ")}
Time Budget: ${mod.estimated_hours || 1} hours

=== SCORING CRITERIA ===

Score each candidate resource's FIT (0-100):
1. SEMANTIC RELEVANCE (0-40): Does this resource actually teach what this module needs? Not just keyword overlap — does the *content* align with the learning objectives?
2. LEVEL ALIGNMENT (0-20): Is this resource pitched at the right difficulty for a ${level} learner?
3. GOAL ALIGNMENT (0-20): Does the format match the learning goal? ${goalInstruction}
4. PEDAGOGICAL QUALITY (0-10): Quality educational content vs clickbait/listicle?
5. TOOL/FRAMEWORK FIT (0-10): Does the tech stack match what this module teaches?

authority_tier and authority_bump are informational only — do NOT let authority override content fit.
Score STRICTLY. 80+ = excellent, 50-79 = acceptable, below 50 = poor.

=== SELECTION RULES ===

Select the best 1-5 resources. The number is VARIABLE.

- A module CAN have just 1 resource if it's excellent and fits the time budget.
- Do NOT add filler. Each resource must add unique value.
- Use your scores as the PRIMARY signal.
- Avoid low-view unknown creators unless uniquely valuable.
- Avoid redundancy — don't pick 3 similar videos.
- DIVERSITY PREFERENCE: When quality is comparable, prefer a mix of resource types (videos, articles, docs, tutorials) over all-video selections. A single excellent video that fills the time budget is fine — but when choosing among similar-quality candidates, favor type variety.
- Time budget is a HARD CONSTRAINT: total selected minutes must not exceed ${Math.round((mod.estimated_hours || 1) * 60)} minutes.
- Prefer one long high-quality resource over multiple short ones when it fits the budget.
- Exclude discussion threads and search-result/listing pages.
- If a candidate title contains "(Continue: X–Y min)", it's a continuation resource — ALWAYS select it.
- For hands-on goals, pick ONE consistent tech stack across resources.

Candidates:
${JSON.stringify(scoringInput.candidates, null, 1)}

Return ONLY valid JSON:
{
  "candidate_scores": [
    { "index": 0, "score": 75, "reason": "one short sentence" }
  ],
  "selected": [
    { "url": "...", "why_selected": "one short sentence" }
  ]
}`;

  try {
    const response = await callLLM(
      ROADMAP_MODEL_AGENT2,
      [{ role: "user", content: prompt }],
      apiKey,
      Deno.env.get("GEMINI_API_KEY"),
      TIMEOUTS_MS.agent2,
    );

    if (!response.ok) {
      console.error(`Agent 2 (module "${mod.title}") error: ${response.status}`);
      return emptyResult;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return emptyResult;

    const parsed = parsePossiblyMalformedJson(content);
    if (!parsed) return emptyResult;

    // Apply scores back to candidates
    for (const cs of (parsed.candidate_scores || [])) {
      if (cs.index >= 0 && cs.index < top.length) {
        const candidate = top[cs.index];
        const original = candidates.find(c => c.url === candidate.url);
        if (original) {
          original.context_fit_score = Math.max(0, Math.min(cs.score, 100));
        }
      }
    }

    // Extract selections
    const selectedUrls = (parsed.selected || []).map((s: any) => s.url).filter(Boolean);

    // Store why_selected on candidates
    for (const s of (parsed.selected || [])) {
      if (!s.url || !s.why_selected) continue;
      const match = candidates.find(c => c.url === s.url);
      if (match) match.why_selected = s.why_selected;
    }

    console.log(`Agent 2 (module "${mod.title}"): scored ${parsed.candidate_scores?.length || 0} candidates, selected ${selectedUrls.length}`);
    return { moduleId, success: true, selections: selectedUrls };
  } catch (e) {
    if (isAbortError(e)) {
      console.warn(`Agent 2 (module "${mod.title}") timed out; using heuristic fallback.`);
      return emptyResult;
    }
    console.error(`Agent 2 (module "${mod.title}") failed:`, e);
    return emptyResult;
  }
}

// ─── Parallel Per-Module AI Scoring Orchestrator ──────────────────────────────

async function parallelModuleAIScoring(
  allModuleCandidates: Map<string, CandidateResource[]>,
  modules: any[],
  topic: string,
  goal: string,
  level: string,
  apiKey: string
): Promise<Agent2Result> {
  const modulesWithCandidates = modules.filter(mod => {
    const candidates = allModuleCandidates.get(mod.id) || [];
    return candidates.length > 0;
  });

  if (modulesWithCandidates.length === 0) {
    return { success: false, selections: new Map() };
  }

  console.log(`Agent 2: Launching ${modulesWithCandidates.length} parallel per-module scoring agents...`);
  const tAgent2 = Date.now();

  // Fire all module scoring calls in parallel
  const results = await Promise.all(
    modulesWithCandidates.map(mod =>
      scoreModuleResources(mod, allModuleCandidates.get(mod.id) || [], topic, goal, level, apiKey)
    )
  );

  // Aggregate results
  const selections = new Map<string, string[]>();
  let successCount = 0;
  for (const result of results) {
    if (result.success && result.selections.length > 0) {
      selections.set(result.moduleId, result.selections);
      successCount++;
    }
  }

  console.log(`[TIMING] Agent 2 parallel scoring: ${Date.now() - tAgent2} ms (${successCount}/${modulesWithCandidates.length} modules succeeded)`);
  return { success: successCount > 0, selections };
}

// ─── STAGE 7: Clustering & Diversity (FLEXIBLE) ─────────────────────────────

function clusterAndDiversify(candidates: CandidateResource[], ctx: ModuleContext): CandidateResource[] {
  // Sort by context_fit_score primarily, authority as tiebreaker
  const sorted = [...candidates].sort((a, b) => 
    (b.context_fit_score + b.authority_score) - (a.context_fit_score + a.authority_score)
  );

  const deduplicated: CandidateResource[] = [];
  for (const c of sorted) {
      const isDuplicate = deduplicated.some(existing => {
      const sim = computeHybridSimilarity(existing.title, c.title);
      return sim > 0.76;
    });
    if (!isDuplicate) deduplicated.push(c);
  }

  const maxResources = 5;
  const selected: CandidateResource[] = [];
  let totalMinutes = 0;
  const dailyCapMinutes = ctx.moduleMinutes * 1.1;

  for (const c of deduplicated) {
    if (selected.length >= maxResources) break;

    // BUG FIX: Enforce budget even for the first resource
    if (totalMinutes + c.estimated_minutes > dailyCapMinutes) continue;

    selected.push(c);
    totalMinutes += c.estimated_minutes;
  }

  // Minimum 1 resource — pick the single best that fits budget, or smallest if none fit
  if (selected.length === 0 && deduplicated.length > 0) {
    const fitting = deduplicated.filter(c => c.estimated_minutes <= dailyCapMinutes);
    if (fitting.length > 0) {
      selected.push(fitting[0]);
    } else {
      // All exceed budget — pick the shortest one
      const shortest = [...deduplicated].sort((a, b) => a.estimated_minutes - b.estimated_minutes)[0];
      selected.push(shortest);
    }
  }

  return selected;
}

// ─── NEGOTIATION PASS: Resource-Curriculum Agent Communication ───────────────

interface SpanCandidate {
  resource: CandidateResource;
  sourceModuleIndex: number;
  qualityScore: number;
}

function negotiateSpanningResources(
  allModuleCandidates: Map<string, CandidateResource[]>,
  modules: any[],
  effectiveHoursPerDay: number,
  totalUsableMinutes: number,
  topic: string
): Map<string, CandidateResource[]> {
  if (modules.length < 2) return allModuleCandidates;

  const dailyCapMinutes = effectiveHoursPerDay * 60;
  const spanCandidates: SpanCandidate[] = [];

  for (let i = 0; i < modules.length; i++) {
    const mod = modules[i];
    const candidates = allModuleCandidates.get(mod.id) || [];
    const moduleMinutes = Math.floor((mod.estimated_hours || 1) * 60);

    for (const c of candidates) {
      if (c.estimated_minutes > moduleMinutes * 1.1 && c.estimated_minutes <= totalUsableMinutes) {
        // Use context_fit as primary quality signal (authority is now only 0-5)
        const qualityScore = c.context_fit_score;
        if (qualityScore >= 30) {
          spanCandidates.push({ resource: c, sourceModuleIndex: i, qualityScore });
        }
      }
    }
  }

  if (spanCandidates.length === 0) return allModuleCandidates;

  spanCandidates.sort((a, b) => b.qualityScore - a.qualityScore);
  const topSpanCandidates = spanCandidates.slice(0, 3);
  const usedSpanUrls = new Set<string>();

  console.log(`Negotiation: Found ${spanCandidates.length} span candidates, evaluating top ${topSpanCandidates.length}`);

  for (const span of topSpanCandidates) {
    const { resource, sourceModuleIndex } = span;
    if (usedSpanUrls.has(resource.url)) continue;

    const resourceMinutes = resource.estimated_minutes;
    const segments: ResourceSegment[] = [];
    let minutesRemaining = resourceMinutes;
    let currentMinute = 0;

    for (let j = sourceModuleIndex; j < modules.length && minutesRemaining > 0; j++) {
      const mod = modules[j];
      const moduleMinutes = Math.floor((mod.estimated_hours || 1) * 60);
      const segmentMinutes = Math.min(minutesRemaining, moduleMinutes);
      
      segments.push({
        module_id: mod.id,
        module_title: mod.title,
        start_minute: currentMinute,
        end_minute: currentMinute + segmentMinutes,
      });

      currentMinute += segmentMinutes;
      minutesRemaining -= segmentMinutes;
    }

    if (minutesRemaining > 0) {
      console.log(`Negotiation: Skipping "${resource.title}" (${resourceMinutes}min) — doesn't fit even spanning ${segments.length} modules`);
      continue;
    }

    if (segments.length < 2) continue;

    console.log(`Negotiation: Spanning "${resource.title}" (${resourceMinutes}min) across ${segments.length} modules: ${segments.map(s => `${s.module_title}[${s.start_minute}-${s.end_minute}min]`).join(" → ")}`);

    usedSpanUrls.add(resource.url);

    const primaryResource: CandidateResource = {
      ...resource,
      span_plan: segments,
      estimated_minutes: segments[0].end_minute - segments[0].start_minute,
    };

    const firstModId = modules[sourceModuleIndex].id;
    const firstModCandidates = allModuleCandidates.get(firstModId) || [];
    const filteredFirst = firstModCandidates.filter(c => c.url !== resource.url);
    filteredFirst.unshift(primaryResource);
    allModuleCandidates.set(firstModId, filteredFirst);

    for (let k = 1; k < segments.length; k++) {
      const seg = segments[k];
      const continuationResource: CandidateResource = {
        ...resource,
        title: `${resource.title} (Continue: ${seg.start_minute}–${seg.end_minute} min)`,
        estimated_minutes: seg.end_minute - seg.start_minute,
        is_continuation: true,
        continuation_of: resource.url,
        span_plan: segments,
        authority_score: resource.authority_score,
        context_fit_score: Math.min(resource.context_fit_score + 10, 100),
      };

      const modCandidates = allModuleCandidates.get(seg.module_id) || [];
      const filteredMod = modCandidates.filter(c => c.url !== resource.url);
      filteredMod.unshift(continuationResource);
      allModuleCandidates.set(seg.module_id, filteredMod);
    }
  }

  return allModuleCandidates;
}

// ─── STAGE 2: High-Recall Retrieval ──────────────────────────────────────────

interface GoalSearchConfig {
  queryModifiers: string[];
  videoCount: number;
  webCount: number;
  semanticHint: string;
  intentTokens: string[];
  outcomeTokens: string[];
}

function getGoalSearchConfig(goal: string, _topic = ""): GoalSearchConfig {
  switch (goal) {
    case "conceptual":
      return {
        queryModifiers: ["explained", "concepts", "theory", "visual explanation", "lecture", "guide"],
        videoCount: 8,
        webCount: 8,
        semanticHint: "mental model and concept explanation with examples",
        intentTokens: ["mental model", "concept explanation", "tradeoffs"],
        outcomeTokens: ["deep explanation", "why this works", "design intuition"],
      };
    case "hands_on":
      return {
        queryModifiers: ["tutorial", "build", "project", "practice", "hands-on", "step by step", "code along"],
        videoCount: 8,
        webCount: 6,
        semanticHint: "project based practical walkthrough",
        intentTokens: ["implementation", "code walkthrough", "real project"],
        outcomeTokens: ["build from scratch", "hands-on lab", "practical exercise"],
      };
    case "quick_overview":
      return {
        queryModifiers: ["crash course", "full guide", "start to finish", "top 10", "overview", "essentials"],
        videoCount: 6,
        webCount: 6,
        semanticHint: "high level summary and key takeaways",
        intentTokens: ["key ideas", "summary", "what matters most"],
        outcomeTokens: ["fast understanding", "cheat sheet", "essentials only"],
      };
    case "deep_mastery":
      return {
        queryModifiers: ["comprehensive", "advanced", "in depth", "research paper", "full course", "masterclass"],
        videoCount: 6,
        webCount: 10,
        semanticHint: "deep dive with advanced tradeoffs and references",
        intentTokens: ["advanced patterns", "production scale", "optimization"],
        outcomeTokens: ["expert level", "edge cases", "system tradeoffs"],
      };
    default:
      return {
        queryModifiers: ["tutorial", "guide"],
        videoCount: 6,
        webCount: 6,
        semanticHint: "clear explanation practical relevance",
        intentTokens: ["practical", "conceptual clarity"],
        outcomeTokens: ["learn effectively", "apply confidently"],
      };
  }
}

function getLevelSearchModifier(level: string): string {
  switch (level) {
    case "beginner": return "for beginners introduction";
    case "intermediate": return "intermediate practical patterns";
    case "advanced": return "advanced best practices optimization";
    default: return "";
  }
}

const GENERIC_QUERY_WORDS = new Set([
  "learn",
  "learning",
  "guide",
  "overview",
  "basics",
  "introduction",
  "tutorial",
  "complete",
  "course",
  "roadmap",
  "resources",
  "best",
]);

function scoreAnchorTerm(term: string): number {
  const normalized = normalizeToken(term);
  if (!normalized || normalized.length < 3) return 0;
  const parts = normalized.split(/[\s/_-]+/).filter(Boolean);
  if (parts.length === 0) return 0;
  const genericPenalty = parts.some((p) => GENERIC_QUERY_WORDS.has(p)) ? 0.55 : 1;
  const specificity = Math.min(1.5, 0.7 + normalized.length / 24);
  const technicalBoost = /[0-9+#./_-]/.test(normalized) ? 1.25 : 1;
  return specificity * technicalBoost * genericPenalty;
}

function selectTopAnchors(terms: string[], maxCount = 3): string[] {
  return [...terms]
    .map((term) => term.trim())
    .filter((term) => term.length > 1)
    .sort((a, b) => scoreAnchorTerm(b) - scoreAnchorTerm(a))
    .slice(0, maxCount);
}

function buildQuery(parts: Array<string | undefined | null>): string {
  const raw = parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return raw.slice(0, 180);
}

function buildTopicQueryPlan(topic: string, level: string, goal: string, certificationIntent: boolean): { precision: string[]; expansion: string[] } {
  const levelMod = getLevelSearchModifier(level);
  const cfg = getGoalSearchConfig(goal, topic);
  const certMod = certificationIntent ? "certification objective interview prep" : "";
  const precision = [
    buildQuery([topic, cfg.intentTokens[0], cfg.queryModifiers[0], levelMod, cfg.semanticHint]),
    buildQuery([topic, cfg.intentTokens[1], cfg.queryModifiers[1], cfg.outcomeTokens[0], certMod]),
  ].filter(Boolean);
  const expansion = [
    buildQuery([topic, cfg.intentTokens[2], cfg.queryModifiers[2], levelMod]),
    buildQuery([topic, cfg.queryModifiers[3] || "guide", "direct tutorial article"]),
  ].filter(Boolean);
  return { precision: [...new Set(precision)], expansion: [...new Set(expansion)] };
}

function buildModuleQueryPlan(
  module: any,
  topic: string,
  level: string,
  goal: string,
  certificationIntent: boolean,
): { precision: string[]; expansion: string[] } {
  const moduleTitle = module?.title || "";
  const cfg = getGoalSearchConfig(goal, `${topic} ${moduleTitle}`);
  const levelMod = getLevelSearchModifier(level);
  const objective = (module?.learning_objectives || [])
    .filter((o: string) => typeof o === "string" && o.trim().length > 0)
    .slice(0, 1)
    .join(" ");
  const seedAnchors = selectTopAnchors((module?.anchor_terms || []) as string[], 3);
  const anchors = seedAnchors.length > 0
    ? seedAnchors.join(" ")
    : selectTopAnchors(`${moduleTitle} ${objective}`.split(/\s+/), 3).join(" ");
  const certMod = certificationIntent ? "interview question certification objective" : "interview question";

  const precision = [
    buildQuery([moduleTitle, topic, anchors, cfg.intentTokens[0], cfg.queryModifiers[0], levelMod]),
    buildQuery([moduleTitle, topic, anchors, objective, cfg.outcomeTokens[0], cfg.queryModifiers[1], certMod]),
  ].filter(Boolean);

  const expansion = [
    buildQuery([moduleTitle, topic, cfg.intentTokens[1], cfg.queryModifiers[2], levelMod]),
    buildQuery([moduleTitle, topic, cfg.intentTokens[2], cfg.queryModifiers[3] || (goal === "hands_on" ? "walkthrough" : "guide"), "direct learning resource"]),
  ].filter(Boolean);

  return { precision: [...new Set(precision)], expansion: [...new Set(expansion)] };
}

async function fetchTopicAnchors(
  topic: string,
  level: string,
  goal: string,
  certificationIntent: boolean,
  serperKey: string,
  supabaseAdmin?: any,
  allowCacheWrite = true,
  fastMode = false,
): Promise<{ videos: SerperVideoResult[]; web: SerperWebResult[] }> {
  const goalConfig = getGoalSearchConfig(goal, topic);
  const plan = buildTopicQueryPlan(topic, level, goal, certificationIntent);
  const effectiveVideoCount = fastMode ? Math.min(goalConfig.videoCount, 4) : Math.min(goalConfig.videoCount, 5);
  const effectiveWebCount = fastMode ? Math.min(goalConfig.webCount, 3) : Math.min(goalConfig.webCount, 5);
  // Always use only 1 precision query for topic anchors — the expansion round rarely helps and adds latency.
  const precisionQueries = plan.precision.slice(0, 1);
  const runQueryBatch = async (queries: string[]) => {
    const promises: Promise<any>[] = [];
    for (const q of queries) {
      promises.push(searchSerper(q, serperKey, "videos", effectiveVideoCount, supabaseAdmin, allowCacheWrite));
      promises.push(searchSerper(q, serperKey, "search", effectiveWebCount, supabaseAdmin, allowCacheWrite));
    }
    const results = await Promise.all(promises);
    const batch: { videos: SerperVideoResult[]; web: SerperWebResult[] } = { videos: [], web: [] };
    for (let i = 0; i < results.length; i++) {
      if (i % 2 === 0) batch.videos.push(...(results[i] as SerperVideoResult[]));
      else batch.web.push(...(results[i] as SerperWebResult[]));
    }
    return batch;
  };

  const combined = await runQueryBatch(precisionQueries);

  console.log(`Topic anchors: ${combined.videos.length} videos, ${combined.web.length} web results`);
  return combined;
}

async function fetchModuleResults(
  module: any,
  topic: string,
  level: string,
  goal: string,
  certificationIntent: boolean,
  serperKey: string,
  supabaseAdmin?: any,
  allowCacheWrite = true,
  fastMode = false,
): Promise<{ videos: SerperVideoResult[]; web: SerperWebResult[] }> {
  const config = getGoalSearchConfig(goal, `${topic} ${module?.title || ""}`);
  const plan = buildModuleQueryPlan(module, topic, level, goal, certificationIntent);
  const effectiveVideoCount = fastMode ? Math.min(config.videoCount, 4) : Math.min(config.videoCount, 5);
  const effectiveWebCount = fastMode ? Math.min(config.webCount, 2) : Math.min(config.webCount, 3);
  const moduleHours = Number(module?.estimated_hours || 1);
  const shortModule = moduleHours <= PIPELINE_LIMITS.shortModuleHours;
  // Always use 1 precision query — second precision query adds latency with diminishing returns.
  const precisionQueries = plan.precision.slice(0, 1);
  // Only run expansion queries for non-short modules in non-fast mode, and with a higher threshold.
  const expansionQueries = (fastMode || shortModule) ? [] : plan.expansion.slice(0, 1);
  const runQueryBatch = async (queries: string[]) => {
    const promises: Promise<any>[] = [];
    for (const q of queries) {
      promises.push(searchSerper(q, serperKey, "videos", effectiveVideoCount, supabaseAdmin, allowCacheWrite));
      promises.push(searchSerper(q, serperKey, "search", effectiveWebCount, supabaseAdmin, allowCacheWrite));
    }
    const results = await Promise.all(promises);
    const batch: { videos: SerperVideoResult[]; web: SerperWebResult[] } = { videos: [], web: [] };
    for (let i = 0; i < results.length; i++) {
      if (i % 2 === 0) batch.videos.push(...(results[i] as SerperVideoResult[]));
      else batch.web.push(...(results[i] as SerperWebResult[]));
    }
    return batch;
  };

  // Fire precision + expansion queries together instead of waiting for precision
  // results to decide whether to expand.  Topic anchors now always provide backup
  // coverage, so the conditional expansion round is no longer needed serially.
  const allQueries = [...precisionQueries, ...expansionQueries];
  const combined = await runQueryBatch(allQueries);

  return combined;
}

// ─── Merge & Deduplicate with Appearance Counting ────────────────────────────

function mergeAndDeduplicate(
  topicAnchors: { videos: SerperVideoResult[]; web: SerperWebResult[] },
  moduleResults: { videos: SerperVideoResult[]; web: SerperWebResult[] },
  moduleTitle: string,
  totalAvailableMinutes: number,
  excludedUrls: Set<string>,
  excludedDomains: Set<string>
): CandidateResource[] {
  const urlMap = new Map<string, CandidateResource>();

  function processVideo(v: SerperVideoResult) {
    if (!v.link) return;
    const normalizedUrl = normalizeResourceUrl(v.link);
    if (isExcludedResource(normalizedUrl, excludedUrls, excludedDomains)) return;
    if (!isAllowedResourceUrl(normalizedUrl)) return;
    const title = v.title || "Video Tutorial";
    if (isDiscussionOrMetaResource(normalizedUrl, title, "")) return;
    if (isDisqualified(title, normalizedUrl)) return;
    const mins = parseDurationToMinutes(v.duration);

    if (urlMap.has(normalizedUrl)) {
      urlMap.get(normalizedUrl)!.appearances_count++;
    } else {
      urlMap.set(normalizedUrl, {
        title, url: normalizedUrl, type: "video",
        estimated_minutes: mins,
        description: `Video on ${moduleTitle}`,
        appearances_count: 1,
        authority_score: 0,
        context_fit_score: 0,
      });
    }
  }

  function processWeb(r: SerperWebResult) {
    if (!r.link) return;
    const normalizedUrl = normalizeResourceUrl(r.link);
    if (isExcludedResource(normalizedUrl, excludedUrls, excludedDomains)) return;
    if (!isAllowedResourceUrl(normalizedUrl)) return;
    const title = r.title || "Learning Resource";
    if (isDiscussionOrMetaResource(normalizedUrl, title, r.snippet || "")) return;
    if (isDisqualified(title, normalizedUrl)) return;
    if (normalizedUrl.includes("youtube.com/watch") || normalizedUrl.includes("youtu.be/")) return;

    if (urlMap.has(normalizedUrl)) {
      urlMap.get(normalizedUrl)!.appearances_count++;
    } else {
      const listingLike = looksLikeListingPage(normalizedUrl, title, r.snippet || "");
      if (listingLike) return;
      urlMap.set(normalizedUrl, {
        title, url: normalizedUrl,
        type: detectResourceType(r.link),
        estimated_minutes: estimateArticleMinutes(r.snippet || ""),
        description: r.snippet || `Resource for ${moduleTitle}`,
        appearances_count: 1,
        authority_score: 0,
        context_fit_score: 0,
        scope_penalty: 0,
      });
    }
  }

  for (const v of topicAnchors.videos) processVideo(v);
  for (const r of topicAnchors.web) processWeb(r);
  for (const v of moduleResults.videos) processVideo(v);
  for (const r of moduleResults.web) processWeb(r);

  return Array.from(urlMap.values());
}

// ─── Enrich with YouTube Metadata ────────────────────────────────────────────

function enrichCandidatesWithYouTube(
  candidates: CandidateResource[],
  ytMap: Map<string, YouTubeMetadata>,
  ctx: ModuleContext
): CandidateResource[] {
  return candidates.filter(c => {
    if (c.type !== "video") return true;
    const videoId = extractYouTubeVideoId(c.url);
    if (!videoId) return true;
    const meta = ytMap.get(videoId);
    if (!meta) {
      // Keep the video even without YouTube metadata — the API may have
      // timed out or hit quota.  Score with heuristic fallback so it
      // still participates in selection rather than being silently dropped.
      computeLightAuthorityBump(c);
      c.context_fit_score = computeContextFitScoreFallback(c, ctx);
      return true;
    }
    if (isDiscussionOrMetaResource(c.url, meta.title || c.title, "")) return false;
    if (isVideoLikelyOffTopic(meta.title || c.title, meta.channel || "", ctx)) return false;

    // Enrich
    c.title = meta.title || c.title;
    c.estimated_minutes = Math.max(1, meta.durationMinutes || c.estimated_minutes);
    c.channel = meta.channel;
    c.view_count = meta.viewCount;
    c.like_count = meta.likeCount;
    c.source = "YouTube";
    c.quality_signal = `${formatViewCount(meta.viewCount)} views · ${meta.channel} · ${meta.durationMinutes} min`;

    // Light authority bump (Stage 5)
    computeLightAuthorityBump(c, meta);
    // Heuristic context fit (Stage 6 fallback)
    c.context_fit_score = computeContextFitScoreFallback(c, ctx, meta);

    return true;
  });
}

// ─── System Prompt Builder ───────────────────────────────────────────────────

function buildSystemPrompt(totalHours: number, learningGoal: string, skillLevel: string): string {
  const goalBlock = getGoalPromptBlock(learningGoal);
  const levelBlock = getLevelPromptBlock(skillLevel);
  const interactionBlock = getInteractionBlock(learningGoal, skillLevel);

  const totalMinutes = totalHours * 60;
  const usableMinutes = Math.floor(totalMinutes * 0.85);

  return `You are Pathfinder, an expert learning curriculum designer. You create personalized, structured, and realistic learning roadmaps.

PRIORITY 1 — TOPIC UNDERSTANDING (do this FIRST):
Before creating the roadmap, analyze the topic:
1. What domain does this belong to? (programming language, framework, cybersecurity, data science, DevOps, cloud, networking, databases, interview prep, etc.)
2. What are the essential subtopics and in what order should they be learned?
3. What are the prerequisites for each subtopic?
4. Is this topic primarily theoretical, practical, or a mix?
This analysis informs every subsequent decision.

PRIORITY 2 — LEARNING GOAL:
${goalBlock}

PRIORITY 3 — PROFICIENCY LEVEL:
${levelBlock}

PRIORITY 2+3 INTERACTION:
${interactionBlock}

PRIORITY 4 — TIME CONSTRAINTS:
- Total available hours: ${totalHours}
- Usable minutes (85% of total): ${usableMinutes}
- NEVER assign more total hours than available. If the roadmap would exceed available time, CUT content from the bottom (advanced/optional) not the top (fundamentals).
- Each module's estimated_hours must be realistic and proportional.
- If not enough time for full topic coverage, be honest in the summary about what's covered and what would need more time.

=== FLEXIBLE STRUCTURE RULES (MANDATORY) ===

1. MODULE COUNT IS VARIABLE — adapt to total time and topic complexity:
   - If total time ≤ 2 hours: default to 1 module, unless 2 coherent chunks naturally emerge.
   - If total time is small, do NOT split into many modules just for structure.
   - For longer timelines, modules can be "day chunks" aligned to daily study budget.

2. RESOURCES PER MODULE IS VARIABLE (1-5):
   - A module can have 1 resource if that single resource is excellent and fits the time budget.
   - Do NOT add extra resources as filler. Each must add unique value.
   - Resources will be fetched separately — leave resources as empty arrays.

3. SHORT TIMELINE COMPRESSION: If total time < 5 hours, reduce module count, increase density, avoid over-fragmentation and repeated introductory content. Prefer fewer, stronger anchors.

=== GLOBAL ROADMAP CONSTRAINTS (MANDATORY) ===

1. RESOURCE UNIQUENESS: No resource URL may appear in more than one module.
2. TIME BUDGET: Sum of all module estimated_hours must not exceed ${usableMinutes} minutes. No module may exceed its budget by >5%.
3. STACK CONSISTENCY: If user does not specify a language/framework/tool — for conceptual goals use tool-agnostic resources; for hands-on goals declare ONE stack and use it consistently across all modules.
4. COVERAGE BEFORE REDUNDANCY: Maximize coverage of learning objectives. Never have two modules teaching identical content.
5. FINAL VALIDATION: Before outputting JSON, verify: no duplicate resources, all modules respect time budget, stack consistency.

RULES:
- Break the topic into sequential modules. Module count is VARIABLE based on time and complexity.
- Each module must logically build on the previous one.
- DO NOT include any resources or URLs — leave resources as empty arrays. Resources will be fetched separately.
- Do NOT include placeholder actions like "search Google", "look up resources", or "find videos online" in module descriptions/objectives/tips.
- Leave quiz as an empty array for each module. Quizzes are generated later on demand.
- Assign each module to specific days within the timeline.
- Generate a concise "topic" field summarizing the user's input as a proper title (capitalize, remove filler like "I want to learn").
- For each module, generate 3-8 "anchor_terms" — concrete technical terms/entities specific to that module (NOT generic words). These are used for resource filtering.`;
}

function getGoalPromptBlock(goal: string): string {
  switch (goal) {
    case "conceptual": return `CONCEPTUAL learning goal selected.
- Focus on "why" and "how it works" — mental models, comparisons, theory
- Resource style target: mix explainer videos with concept-focused study articles/docs.
- Module count: VARIABLE based on time budget. Fewer modules for short timelines.
- Time split: 80% consuming content, 20% reflection/quizzes
- Assessment style (generated later): Definition-based, concept checks, "explain why X works this way"`;
    case "hands_on": return `HANDS-ON learning goal selected.
- Every module MUST have a "build something" or "try this" component
- Resource style target: mostly practical videos/tutorials/labs that show how to build or implement.
- Module count: VARIABLE based on time budget. Fewer modules for short timelines.
- Time split: 30% learning, 70% doing
- Assessment style (generated later): Code-oriented, "what would this output", practical scenarios`;
    case "quick_overview": return `QUICK OVERVIEW learning goal selected.
- Hit key points fast, no deep dives, focus on "what you need to know"
- Resource style target: concise end-to-end material (crash course, full guide, start-to-finish, top takeaways).
- Module count: Keep MINIMAL — as few modules as possible to cover essentials.
- Even if the user has weeks available, keep it concise. Use extra time for review, not more content.
- Time split: 100% efficient consumption, no lengthy exercises
- Assessment style (generated later): Quick recall, key terminology`;
    case "deep_mastery": return `DEEP MASTERY learning goal selected.
- Thorough coverage including edge cases, best practices, architecture patterns, real-world scenarios
- Resource style target: advanced deep-dive mix (research papers, technical articles/docs, long-form video explanations).
- Module count: VARIABLE — use more modules for longer timelines, but never pad unnecessarily.
- Time split: 40% learning, 40% practice, 20% review
- Assessment style (generated later): Advanced nuance, tradeoffs, "when would you use X vs Y", design decisions`;
    default: return "";
  }
}

function getLevelPromptBlock(level: string): string {
  switch (level) {
    case "beginner": return `BEGINNER level.
- Start from absolute fundamentals, assume zero prior knowledge
- Use simpler language, more hand-holding in early modules
- Include "what is X" and "why does X matter" before "how to do X"
- Quiz difficulty: Definition-based, basic concept checks
- Pacing: More time per concept, smaller steps between modules`;
    case "intermediate": return `INTERMEDIATE level.
- Skip "what is X" basics — assume familiarity with fundamentals
- Focus on practical patterns, common use cases, connecting concepts
- Optional brief refresher module (30 min) then dive into intermediate topics
- Quiz difficulty: Application-based, "when would you use X vs Y"
- Pacing: Moderate, cover more ground per module`;
    case "advanced": return `ADVANCED level.
- Skip fundamentals AND intermediate patterns — go straight to advanced topics
- Focus on optimization, architecture, edge cases, performance, design patterns
- Include real-world case studies and production scenarios
- Quiz difficulty: Nuanced tradeoffs, "what's wrong with this approach", design decisions
- Pacing: Fast, complex topics in fewer modules`;
    default: return "";
  }
}

function getInteractionBlock(goal: string, level: string): string {
  const key = `${level}_${goal}`;
  const interactions: Record<string, string> = {
    "beginner_quick_overview": "Crash course for absolute beginners — simplest explanation of essentials only.",
    "beginner_deep_mastery": "From zero to expert — more modules, starting from basics going all the way to advanced.",
    "beginner_conceptual": "Foundational theory — build mental models from scratch, no assumptions.",
    "beginner_hands_on": "Guided project-based learning — hold their hand through every step.",
    "advanced_conceptual": "Deep theoretical understanding — architecture docs, design philosophy, academic depth.",
    "advanced_hands_on": "Advanced projects and challenges — skip tutorials, complex builds and coding challenges.",
    "advanced_quick_overview": "Executive summary of advanced topics — what experts need to know, fast.",
    "advanced_deep_mastery": "Expert-level mastery — edge cases, performance tuning, system design.",
    "intermediate_quick_overview": "Practical refresher — key patterns and tools, skip the basics.",
    "intermediate_deep_mastery": "Comprehensive intermediate-to-advanced journey.",
    "intermediate_conceptual": "Deepen understanding of patterns and principles behind what they already use.",
    "intermediate_hands_on": "Build real projects applying intermediate patterns.",
  };
  return interactions[key] || "Balance the learning goal with the proficiency level appropriately.";
}

function sanitizeRoadmapText(value: string): string {
  if (!value || typeof value !== "string") return value;
  const cleaned = value
    .replace(/\[([^\]]+)\]\((https?:\/\/(?:www\.)?google\.[^)]+)\)/gi, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/(?:www\.)?youtube\.com\/results[^)]*)\)/gi, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/(?:www\.)?(?:[^)\s]+\.)?coursera\.(?:org|com)[^)]*)\)/gi, "$1")
    .replace(/https?:\/\/(?:www\.)?google\.[^\s)]+/gi, "")
    .replace(/https?:\/\/(?:www\.)?youtube\.com\/results[^\s)]+/gi, "")
    .replace(/https?:\/\/(?:www\.)?(?:[^\s)]+\.)?coursera\.(?:org|com)[^\s)]*/gi, "")
    .replace(/\b(?:google|youtube)\s+(?:search\s+)?link\b/gi, "")
    .replace(/\bcoursera\s+(?:link|course)\b/gi, "")
    .replace(/\b(?:google|youtube)\s+(?:it|this|that)\b/gi, "")
    .replace(/\b(?:search|google|look up|find)\s+(?:on\s+)?(?:google|youtube|coursera|online|the web)\b[^.]*[.]?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || value;
}

function sanitizeRoadmapPlaceholders(roadmap: any): void {
  if (!roadmap || typeof roadmap !== "object") return;
  if (typeof roadmap.summary === "string") roadmap.summary = sanitizeRoadmapText(roadmap.summary);
  if (typeof roadmap.tips === "string") roadmap.tips = sanitizeRoadmapText(roadmap.tips);
  if (!Array.isArray(roadmap.modules)) return;
  for (const mod of roadmap.modules) {
    if (typeof mod?.description === "string") mod.description = sanitizeRoadmapText(mod.description);
    if (Array.isArray(mod?.learning_objectives)) {
      mod.learning_objectives = mod.learning_objectives
        .filter((o: any) => typeof o === "string")
        .map((o: string) => sanitizeRoadmapText(o))
        .filter((o: string) => o.trim().length > 0);
    }
  }
}

// ─── Main Handler ────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supabaseAuthClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: authUser }, error: authError } = await supabaseAuthClient.auth.getUser();
    if (authError || !authUser) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { user_id, topic, skill_level, learning_goal, timeline_weeks, timeline_days, hours_per_day, total_hours: providedTotalHours, hard_deadline, deadline_date, include_weekends, timeline_mode } = await req.json();
    const effectiveGoal = learning_goal || "hands_on";
    
    const isHoursOnly = timeline_mode === "hours";
    const daysInTimeline = isHoursOnly ? 1 : (timeline_days || (timeline_weeks * 7));
    const studyDays = isHoursOnly ? 1 : (include_weekends === false ? Math.round(daysInTimeline * 5 / 7) : daysInTimeline);
    const totalHours = providedTotalHours || (studyDays * hours_per_day);
    const expectedFastMode = totalHours <= FAST_MODE_MAX_HOURS;
    const effectiveHoursPerDay = isHoursOnly ? totalHours : hours_per_day;
    const effectiveTimelineWeeks = isHoursOnly ? Math.round((totalHours / (effectiveHoursPerDay || 1) / 7) * 100) / 100 : (timeline_days ? Math.round((timeline_days / 7) * 10) / 10 : timeline_weeks);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
    const SERPER_API_KEY = Deno.env.get("SERPER_API_KEY");
    if (!SERPER_API_KEY) throw new Error("SERPER_API_KEY not configured");
    const YOUTUBE_API_KEY = Deno.env.get("YOUTUBE_API_KEY");
    if (!YOUTUBE_API_KEY) throw new Error("YOUTUBE_API_KEY not found. Add it in Lovable environment settings.");
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAdmin = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
      ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
      : null;
    // Reuse the auth user already validated above — no need for a second getUser() call
    let resolvedUserId: string | null = user_id || authUser.id || null;

    // ════════════════════════════════════════════════════════════════════════
    // STEP 1: Generate roadmap structure via AI (Agent 1)
    // Feedback exclusion query runs in parallel — both are independent.
    // ════════════════════════════════════════════════════════════════════════
    const feedbackPromise = (async () => {
      const urls = new Set<string>();
      const domains = new Set<string>();
      if (supabaseAdmin && resolvedUserId && topic) {
        try {
          const topicKey = normalizeTopicKey(topic);
          const { data: feedbackRows } = await supabaseAdmin
            .from("resource_feedback")
            .select("resource_url")
            .eq("user_id", resolvedUserId)
            .eq("topic_key", topicKey)
            .eq("relevant", false);
          for (const row of (feedbackRows || [])) {
            if (!row.resource_url) continue;
            const raw = String(row.resource_url);
            const normalized = normalizeResourceUrl(raw);
            urls.add(normalized);
            const host = extractResourceHost(raw);
            if (host) {
              const baseHost = host.replace(/^www\./, "");
              if (/^google\./.test(baseHost)) {
                domains.add(baseHost);
              }
              if (baseHost === "coursera.org" || baseHost.endsWith(".coursera.org")) {
                domains.add("*.coursera.org");
              }
              if (baseHost === "coursera.com" || baseHost.endsWith(".coursera.com")) {
                domains.add("*.coursera.com");
              }
            }
          }
        } catch (e) {
          console.warn("Failed to load resource feedback exclusions:", e);
        }
      }
      return { urls, domains };
    })();

    const systemPrompt = buildSystemPrompt(totalHours, effectiveGoal, skill_level);

    const userPrompt = `Create a learning roadmap for: "${topic}"
Skill level: ${skill_level}
Learning Goal: ${effectiveGoal}
${isHoursOnly ? `Timeline: Single session of ${totalHours} hours total. All modules happen on day 1.` : `Timeline: ${daysInTimeline} day${daysInTimeline === 1 ? '' : 's'} (${studyDays} study day${studyDays === 1 ? '' : 's'}${include_weekends === false ? ", weekends excluded" : ""})`}
Hours per day: ${effectiveHoursPerDay}
Total available hours: ${totalHours}
${hard_deadline && deadline_date ? `Hard deadline: ${deadline_date} — be extra conservative, plan for ${Math.round(totalHours * 0.8)} hours of content.` : ""}
${isHoursOnly ? `IMPORTANT: This is a single-session roadmap (${totalHours} hours total). All modules must have day_start=1 and day_end=1 and week=1. Keep module count low (2-4 max). The total estimated hours across all modules must not exceed ${totalHours}.` : (daysInTimeline <= 3 ? `IMPORTANT: This is a very short timeline (${daysInTimeline} day${daysInTimeline === 1 ? '' : 's'}). All modules must fit within ${daysInTimeline} day${daysInTimeline === 1 ? '' : 's'}. day_start and day_end must be between 1 and ${daysInTimeline}. Keep module count low (2-4 max).` : "")}

Return ONLY valid JSON with this exact structure:
{
  "topic": "concise clean title",
  "skill_level": "${skill_level}",
  "timeline_weeks": ${effectiveTimelineWeeks},
  "hours_per_day": ${effectiveHoursPerDay},
  "total_hours": ${totalHours},
  "summary": "2-3 sentence overview.",
  "modules": [
    {
      "id": "mod_1",
      "title": "string",
      "description": "2-3 sentences",
      "estimated_hours": number,
      "day_start": number,
      "day_end": number,
      "week": number,
      "prerequisites": [],
      "learning_objectives": ["objective 1", "objective 2"],
      "resources": [],
      "anchor_terms": ["term1", "term2", "term3"],
      "quiz": []
    }
  ],
  "tips": "2-3 practical tips"
}

IMPORTANT for anchor_terms: For each module, provide 3-8 concrete technical terms that are specific to that module's content. These should be specific entities (e.g., "lambda", "serverless", "faas") NOT generic words (e.g., "learn", "understand"). They will be used for precise resource filtering.
IMPORTANT: Do NOT write placeholder tasks like "Google this", "search YouTube", or "find resources online" anywhere in modules or tips.`;

    const t0 = Date.now();
    console.log(`Generating roadmap: topic="${topic}", goal=${effectiveGoal}, level=${skill_level}, hours=${totalHours}`);

    let response: Response | null = null;
    const agent1Attempts = 1; // always 1 attempt — retrying doubles worst-case latency; fallback roadmap handles failures
    for (let attempt = 1; attempt <= agent1Attempts; attempt++) {
      try {
        const agent1Timeout = TIMEOUTS_MS.agent1Base + TIMEOUTS_MS.agent1PerWeek * Math.max(0, Math.ceil(daysInTimeline / 7) - 1);
        response = await callLLM(
          ROADMAP_MODEL_AGENT1,
          [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
          LOVABLE_API_KEY,
          GEMINI_API_KEY,
          agent1Timeout,
        );
        break;
      } catch (e) {
        if (attempt < agent1Attempts) {
          const reason = isAbortError(e) ? "timed out" : "failed";
          console.warn(`Agent 1 ${reason}; retrying once...`);
          await sleep(300);
          continue;
        }
        if (isAbortError(e)) {
          throw new Error("AI generation timed out. Please try again.");
        }
        throw e;
      }
    }

    if (!response) throw new Error("AI generation failed");

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Usage limit reached. Please add credits." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const t = await response.text();
      console.error("AI error:", response.status, t);
      throw new Error("AI generation failed");
    }

    const responseText = await response.text();
    if (!responseText || responseText.trim().length === 0) {
      throw new Error("AI returned an empty response. Please try again.");
    }
    const data = parsePossiblyMalformedJson(responseText);
    const content = data?.choices?.[0]?.message?.content ?? responseText;

    let roadmap;
    roadmap = parsePossiblyMalformedJson(content);
    if (!roadmap || !Array.isArray(roadmap.modules)) {
      console.error("Failed to parse roadmap JSON from content:", String(content).substring(0, 500));
      roadmap = buildFallbackRoadmap(
        topic,
        skill_level,
        effectiveTimelineWeeks,
        effectiveHoursPerDay,
        totalHours,
        daysInTimeline
      );
      console.warn("Using fallback roadmap structure due to malformed Agent 1 output.");
    }

    sanitizeRoadmapPlaceholders(roadmap);
    normalizeModulePlan(roadmap, totalHours, daysInTimeline);
    enforceModuleTimeWindowConsistency(roadmap.modules || [], effectiveHoursPerDay);
    const moduleCount = Array.isArray(roadmap.modules) ? roadmap.modules.length : 0;
    const fastMode = totalHours <= FAST_MODE_MAX_HOURS || moduleCount <= FAST_MODE_MAX_MODULES;
    console.log(`[TIMING] Agent 1 (structure): ${Date.now() - t0} ms`);
    if (Array.isArray(roadmap.modules)) {
      for (const mod of roadmap.modules) mod.quiz = [];
      roadmap.total_hours = Math.round(
        roadmap.modules.reduce((sum: number, m: any) => sum + Number(m.estimated_hours || 0), 0) * 10
      ) / 10;
    }
    const certificationIntent = detectCertificationIntent(topic);

    // Resolve feedback exclusions (started in parallel with Agent 1).
    const { urls: excludedUrls, domains: excludedDomains } = await feedbackPromise;
    const allowCacheWrite = excludedUrls.size === 0;

    // ════════════════════════════════════════════════════════════════════════
    // STEP 2: STAGE 2A+2B — Module results + topic anchors fully parallel.
    // Previously, topic anchors fired sequentially AFTER module results only
    // when coverage was weak — adding a full second Serper round (3–7 s) to
    // the critical path. Now both fetches start at the same time; topic
    // anchors are always available when the merge runs, with no serial wait.
    // ════════════════════════════════════════════════════════════════════════
    const totalAvailableMinutes = totalHours * 60;
    const allModuleCandidates = new Map<string, CandidateResource[]>();

    console.log(`Stage 2: Fetching module results + topic anchors in parallel (${roadmap.modules?.length || 0} modules, fastMode=${fastMode})...`);
    const t2Start = Date.now();

    const moduleResultsPromises = (roadmap.modules || []).map((mod: any) =>
      fetchModuleResults(mod, topic, skill_level, effectiveGoal, certificationIntent, SERPER_API_KEY, supabaseAdmin, allowCacheWrite, fastMode)
    );
    // Always fetch topic anchors in parallel — even for short roadmaps the quality
    // uplift is worth the ~3 s parallel wait.  Previously fast-mode skipped this
    // entirely, resulting in thin candidate pools and low-quality rescue-pool resources.
    const topicAnchorPromise = fetchTopicAnchors(topic, skill_level, effectiveGoal, certificationIntent, SERPER_API_KEY, supabaseAdmin, allowCacheWrite, fastMode);

    const [allModuleResults, topicAnchors] = await Promise.all([
      Promise.all(moduleResultsPromises),
      topicAnchorPromise,
    ]);

    console.log(`Stage 2: retrieval done in ${Date.now() - t2Start} ms`);

    // Single merge pass — topic anchors already in hand, no second await needed.
    for (let i = 0; i < (roadmap.modules || []).length; i++) {
      const mod = roadmap.modules[i];
      const candidates = mergeAndDeduplicate(
        topicAnchors,
        allModuleResults[i],
        mod.title,
        totalAvailableMinutes,
        excludedUrls,
        excludedDomains,
      );
      allModuleCandidates.set(mod.id, candidates);
    }

    const moduleCandidateCounts = (roadmap.modules || []).map((mod: any) => (allModuleCandidates.get(mod.id) || []).length);
    const totalCandidatesAcrossModules = moduleCandidateCounts.reduce((sum: number, c: number) => sum + c, 0);
    const weakModules = moduleCandidateCounts.filter((count: number) => count < PIPELINE_LIMITS.weakModuleCandidateThreshold).length;
    console.log(`Stage 2: ${totalCandidatesAcrossModules} total candidates, ${weakModules}/${moduleCandidateCounts.length} modules with thin coverage (threshold: ${PIPELINE_LIMITS.weakModuleCandidateThreshold}).`);

    // Fail fast if resource search returned absolutely nothing — the Serper API
    // key may be invalid, expired, or the service may be down. Returning a
    // roadmap with 0 resources is worse than returning an error the user can retry.
    if (totalCandidatesAcrossModules === 0) {
      console.error("CRITICAL: Resource search returned 0 candidates for ALL modules. Serper API may be down or key may be invalid.");
      return new Response(
        JSON.stringify({ error: "Resource search failed — no learning resources could be found. Please try again in a moment." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ════════════════════════════════════════════════════════════════════════
    // STEP 5: STAGE 3 — YouTube API Enrichment (batch all video IDs)
    // ════════════════════════════════════════════════════════════════════════
    const allVideoIds = new Set<string>();
    for (const candidates of allModuleCandidates.values()) {
      for (const c of candidates) {
        if (c.type === "video") {
          const id = extractYouTubeVideoId(c.url);
          if (id) allVideoIds.add(id);
        }
      }
    }

    let ytMap = new Map<string, YouTubeMetadata>();
    if (allVideoIds.size > 0) {
      const tYT = Date.now();
      console.log(`Stage 3: Enriching ${allVideoIds.size} YouTube videos with metadata...`);
      ytMap = await fetchYouTubeMetadata([...allVideoIds], YOUTUBE_API_KEY, supabaseAdmin);
      console.log(`[TIMING] YouTube enrichment: ${Date.now() - tYT} ms (${ytMap.size} hits)`);
    }

    // ════════════════════════════════════════════════════════════════════════
    // STEP 6: STAGES 4-5 — Enhanced Hard Filter + Light Authority + Enrichment
    // ════════════════════════════════════════════════════════════════════════
    const tFilter = Date.now();
    const moduleRescuePools = new Map<string, CandidateResource[]>();
    for (const mod of (roadmap.modules || [])) {
      const candidates = allModuleCandidates.get(mod.id) || [];
      const anchorTerms = generateModuleAnchors(mod, topic);
      const ctx: ModuleContext = {
        topic,
        moduleTitle: mod.title,
        moduleDescription: mod.description || "",
        learningObjectives: mod.learning_objectives || [],
        goal: effectiveGoal,
        level: skill_level,
        moduleMinutes: Math.floor((mod.estimated_hours || 1) * 60),
        anchorTerms,
      };

      // Enrich videos with YouTube data + compute light authority + heuristic context fit
      const enriched = enrichCandidatesWithYouTube(candidates, ytMap, ctx);
      
      // Score non-video candidates
      for (const c of enriched) {
        if (c.type !== "video") {
          computeLightAuthorityBump(c);
          c.context_fit_score = computeContextFitScoreFallback(c, ctx);
        }
      }

      // Keep a relaxed but clean pool for later rescue (if strict filters/budgeting produce 0).
      // Apply the same URL-level guards used elsewhere so search-engine links,
      // listing pages, and disallowed domains never sneak through the rescue path.
      const moduleText = `${ctx.topic} ${ctx.moduleTitle} ${ctx.moduleDescription} ${ctx.learningObjectives.join(" ")}`;
      const rescuePool = [...enriched]
        .filter(c => !isGarbage(c))
        .filter(c => isAllowedResourceUrl(c.url))
        .filter(c => !isExcludedResource(c.url, excludedUrls, excludedDomains))
        .filter(c => !looksLikeListingPage(c.url, c.title, c.description))
        .filter(c => !isDiscussionOrMetaResource(c.url, c.title, c.description))
        .filter(c => computeHybridSimilarity(moduleText, `${c.title} ${c.description} ${c.channel || ""}`) >= 0.1)
        .sort((a, b) => (b.context_fit_score + b.authority_score) - (a.context_fit_score + a.authority_score));
      moduleRescuePools.set(mod.id, rescuePool);

      // Apply enhanced Stage 4 filter (anchor gate + scope penalty)
      const stage4Filtered = applyStage4Filter(enriched, ctx);

      // Stage 5: Remove garbage
      let stage5Filtered = stage4Filtered.filter(c => !isGarbage(c));
      if (stage5Filtered.length === 0 && rescuePool.length > 0) {
        console.warn(`Stage 4/5 produced 0 candidates for "${mod.title}". Using relaxed rescue pool.`);
        stage5Filtered = rescuePool.slice(0, 8);
      }
      stage5Filtered = [...stage5Filtered]
        .sort((a, b) => (b.context_fit_score + b.authority_score) - (a.context_fit_score + a.authority_score))
        .slice(0, 18);

      allModuleCandidates.set(mod.id, stage5Filtered);
    }
    console.log(`[TIMING] Stages 4-5 filtering: ${Date.now() - tFilter} ms`);

    // ════════════════════════════════════════════════════════════════════════
    // STEP 6.1: PARALLEL — Per-Module AI Agents (Score+Select) + Negotiation
    // Each module gets its own gemini-3-pro agent running in parallel.
    // Wall-clock time = slowest single module (~3-4s) instead of batch (~10-12s).
    // ════════════════════════════════════════════════════════════════════════
    console.log(`Running per-module AI agents + Negotiation Pass in parallel...`);
    const usableMinutesForNegotiation = totalHours * 60 * 0.85;
    const negotiationInput = new Map<string, CandidateResource[]>();
    for (const [moduleId, candidates] of allModuleCandidates.entries()) {
      negotiationInput.set(moduleId, candidates.map(c => ({ ...c })));
    }

    const [agent2Result, negotiatedCandidates] = await Promise.all([
      (!ENABLE_EXPENSIVE_LLM_STAGES)
        ? Promise.resolve({ success: false, selections: new Map<string, string[]>() } as Agent2Result)
        : parallelModuleAIScoring(
            allModuleCandidates,
            roadmap.modules || [],
            topic,
            effectiveGoal,
            skill_level,
            LOVABLE_API_KEY
          ),
      // Negotiation Pass: runs on heuristic scores (good enough for span detection)
      Promise.resolve(
        negotiateSpanningResources(
          negotiationInput,
          roadmap.modules || [],
          effectiveHoursPerDay,
          usableMinutesForNegotiation,
          topic
        )
      ),
    ]);

    // Merge negotiation output into AI-scored candidates by URL.
    for (const [moduleId, negotiatedList] of negotiatedCandidates.entries()) {
      const scoredList = allModuleCandidates.get(moduleId) || [];
      const merged = negotiatedList.map((neg) => {
        if (neg.is_continuation) return neg;
        const scored = scoredList.find(s => s.url === neg.url);
        if (!scored) return neg;
        return {
          ...scored,
          span_plan: neg.span_plan,
          is_continuation: neg.is_continuation,
          continuation_of: neg.continuation_of,
        };
      });
      allModuleCandidates.set(moduleId, merged);
    }

    const rerankerSelections = agent2Result.selections;
    if (agent2Result.success) {
      console.log(`Agent 2: AI scoring + selection complete — heuristic scores overridden.`);
    } else {
      console.warn(`Agent 2: AI scoring + selection failed — falling back to heuristic scores.`);
    }

    // ════════════════════════════════════════════════════════════════════════
    // STEP 9: STAGE 9 — Final Assembly
    // ════════════════════════════════════════════════════════════════════════
    const usedResourceUrls = new Set<string>();
    const usedVideoIds = new Set<string>();
    const usedChannelTitles = new Map<string, Set<string>>();
    const usableMinutes = totalHours * 60 * 0.85;
    let totalRoadmapMinutes = 0;

    // Track which base URLs actually got selected (for continuation validation)
    const selectedPrimaryUrls = new Set<string>();

    for (const mod of (roadmap.modules || [])) {
      const candidates = allModuleCandidates.get(mod.id) || [];
      const moduleMinutes = Math.floor((mod.estimated_hours || 1) * 60);
      const dailyCapMinutes = effectiveHoursPerDay * 60 * 1.1;
      const dayStart = Number(mod.day_start || 1);
      const dayEnd = Number(mod.day_end || dayStart);
      const moduleDays = Math.max(1, dayEnd - dayStart + 1);
      const windowBudgetCap = moduleDays * dailyCapMinutes;
      const moduleBudgetCap = Math.min(moduleMinutes * 1.05, windowBudgetCap);
      const ctx: ModuleContext = {
        topic,
        moduleTitle: mod.title,
        moduleDescription: mod.description || "",
        learningObjectives: mod.learning_objectives || [],
        goal: effectiveGoal,
        level: skill_level,
        moduleMinutes,
      };

      const rerankedUrls = rerankerSelections.get(mod.id);

      let finalResources: CandidateResource[];

      if (rerankedUrls && rerankedUrls.length > 0) {
        const reranked: CandidateResource[] = [];
        for (const url of rerankedUrls) {
          const match = candidates.find(c => c.url === url);
          if (match) reranked.push(match);
        }
        finalResources = reranked.length > 0 ? reranked : clusterAndDiversify(candidates, ctx);
      } else {
        finalResources = clusterAndDiversify(candidates, ctx);
      }

      // ── Constraint 1: Global uniqueness enforcement ──
      const uniqueResources: CandidateResource[] = [];
      for (const c of finalResources) {
        const normalizedUrl = c.url.split("&")[0];
        const videoId = extractYouTubeVideoId(normalizedUrl);

        // BUG FIX: Continuation resources — only allow if the primary was actually selected
        if (c.is_continuation && c.continuation_of) {
          const baseUrl = c.continuation_of.split("&")[0];
          if (!selectedPrimaryUrls.has(baseUrl)) {
            console.warn(`Skipping orphan continuation: "${c.title}" — primary not selected`);
            continue;
          }
          uniqueResources.push(c);
          continue;
        }

        if (usedResourceUrls.has(normalizedUrl)) continue;
        if (videoId && usedVideoIds.has(videoId)) continue;
        if (c.channel) {
          const channelTitles = usedChannelTitles.get(c.channel.toLowerCase());
          if (channelTitles) {
            const isDup = [...channelTitles].some(t => computeHybridSimilarity(t, c.title) > 0.92);
            if (isDup) continue;
          }
        }

        uniqueResources.push(c);
      }

      // ── Constraint 2: Hard time budget enforcement ──
      // BUG FIX: Enforce budget even for the FIRST resource
      const budgetedResources: CandidateResource[] = [];
      let moduleTotal = 0;
      for (const c of uniqueResources) {
        if (totalRoadmapMinutes + moduleTotal + c.estimated_minutes > usableMinutes) continue;
        if (moduleTotal + c.estimated_minutes > moduleBudgetCap) continue;
        budgetedResources.push(c);
        moduleTotal += c.estimated_minutes;
      }

      // If no resources fit budget, pick the shortest candidate
      if (budgetedResources.length === 0 && uniqueResources.length > 0) {
        const shortest = [...uniqueResources]
          .filter(c => c.is_continuation || (c.estimated_minutes <= moduleBudgetCap * 1.1))
          .filter(c => totalRoadmapMinutes + c.estimated_minutes <= usableMinutes)
          .sort((a, b) => a.estimated_minutes - b.estimated_minutes)[0];
        if (shortest) {
          budgetedResources.push(shortest);
          moduleTotal = shortest.estimated_minutes;
        }
      }

      // Soft diversity rule: include at least one strong video when feasible.
      const hasVideo = budgetedResources.some(r => r.type === "video");
      if (!hasVideo) {
        const candidateVideo = uniqueResources.find(c =>
          c.type === "video" &&
          !budgetedResources.some(r => r.url === c.url) &&
          moduleTotal + c.estimated_minutes <= moduleBudgetCap &&
          totalRoadmapMinutes + moduleTotal + c.estimated_minutes <= usableMinutes
        );
        if (candidateVideo) {
          budgetedResources.push(candidateVideo);
          moduleTotal += candidateVideo.estimated_minutes;
        }
      }


      // Coverage repair: if resource time is below 60% of module time, keep filling with best remaining fits.
      const coverageTarget = moduleMinutes * 0.6;
      if (moduleTotal < coverageTarget) {
        const recoveryPool = [...candidates]
          .filter(c => !budgetedResources.some(b => b.url === c.url))
          .sort((a, b) => (b.context_fit_score + b.authority_score) - (a.context_fit_score + a.authority_score));

        for (const c of recoveryPool) {
          const normalized = normalizeResourceUrl(c.url);
          const videoId = extractYouTubeVideoId(normalized);
          if (usedResourceUrls.has(normalized)) continue;
          if (videoId && usedVideoIds.has(videoId)) continue;
          if (moduleTotal + c.estimated_minutes > moduleBudgetCap) continue;
          if (totalRoadmapMinutes + moduleTotal + c.estimated_minutes > usableMinutes) continue;
          budgetedResources.push(c);
          moduleTotal += c.estimated_minutes;
          if (moduleTotal >= coverageTarget) break;
        }
      }

      if (budgetedResources.length === 0) {
        // Final safety net: use clean relaxed candidates (no search/catalog links) before giving up.
        const rescuePool = moduleRescuePools.get(mod.id) || [];
        for (const c of rescuePool) {
          if (budgetedResources.length >= 2) break;
          const normalizedUrl = normalizeResourceUrl(c.url);
          const videoId = extractYouTubeVideoId(normalizedUrl);
          if (usedResourceUrls.has(normalizedUrl)) continue;
          if (videoId && usedVideoIds.has(videoId)) continue;
          if (totalRoadmapMinutes + moduleTotal + c.estimated_minutes > usableMinutes) continue;
          if (moduleTotal + c.estimated_minutes > moduleBudgetCap) continue;
          budgetedResources.push(c);
          moduleTotal += c.estimated_minutes;
        }
      }

      const cleanedResources = budgetedResources.filter(c =>
        !isExcludedResource(c.url, excludedUrls, excludedDomains) &&
        isAllowedResourceUrl(c.url) &&
        !looksLikeListingPage(c.url, c.title, c.description) &&
        !isDiscussionOrMetaResource(c.url, c.title, c.description)
      );

      let finalizedResources = [...cleanedResources];
      let finalizedMinutes = finalizedResources.reduce((sum, r) => sum + Number(r.estimated_minutes || 0), 0);
      const hardCoverageTarget = Math.min(moduleBudgetCap, Math.max(20, moduleMinutes * 0.45));

      if (finalizedMinutes < hardCoverageTarget) {
        const topUpPools = [...candidates, ...(moduleRescuePools.get(mod.id) || [])]
          .sort((a, b) => (b.context_fit_score + b.authority_score) - (a.context_fit_score + a.authority_score));
        for (const c of topUpPools) {
          if (finalizedMinutes >= hardCoverageTarget) break;
          if (finalizedResources.some(r => r.url === c.url)) continue;

          const normalized = normalizeResourceUrl(c.url);
          const videoId = extractYouTubeVideoId(normalized);
          if (usedResourceUrls.has(normalized)) continue;
          if (videoId && usedVideoIds.has(videoId)) continue;
          if (isExcludedResource(normalized, excludedUrls, excludedDomains)) continue;
          if (!isAllowedResourceUrl(c.url)) continue;
          if (looksLikeListingPage(c.url, c.title, c.description)) continue;
          if (isDiscussionOrMetaResource(c.url, c.title, c.description)) continue;
          if (finalizedMinutes + c.estimated_minutes > moduleBudgetCap) continue;
          if (totalRoadmapMinutes + finalizedMinutes + c.estimated_minutes > usableMinutes) continue;

          finalizedResources.push(c);
          finalizedMinutes += c.estimated_minutes;
        }
      }

      // Register used resources globally only after cleaning + top-up.
      for (const c of finalizedResources) {
        const normalizedUrl = normalizeResourceUrl(c.url);
        usedResourceUrls.add(normalizedUrl);
        if (!c.is_continuation && c.span_plan && c.span_plan.length > 1) {
          selectedPrimaryUrls.add(normalizedUrl);
        }
        const videoId = extractYouTubeVideoId(normalizedUrl);
        if (videoId) usedVideoIds.add(videoId);
        if (c.channel) {
          const key = c.channel.toLowerCase();
          if (!usedChannelTitles.has(key)) usedChannelTitles.set(key, new Set());
          usedChannelTitles.get(key)!.add(c.title);
        }
      }
      totalRoadmapMinutes += finalizedMinutes;

      if (finalizedResources.length > 0) {
        mod.resources = finalizedResources.map(c => ({
          title: c.title,
          url: c.url,
          type: c.type,
          estimated_minutes: c.estimated_minutes,
          description: c.description,
          source: c.source,
          channel: c.channel,
          view_count: c.view_count,
          like_count: c.like_count,
          quality_signal: c.quality_signal,
          span_plan: c.span_plan,
          is_continuation: c.is_continuation,
          continuation_of: c.continuation_of,
        } as Resource));
      } else {
        console.warn(`Module "${mod.title}" has 0 resources after full pipeline; returning empty resources.`);
        mod.resources = [];
      }

      // Final safety net: strip any resource whose URL is a search engine page.
      if (mod.resources && mod.resources.length > 0) {
        mod.resources = mod.resources.filter((r: Resource) => {
          try {
            const u = new URL(r.url);
            const h = u.hostname.toLowerCase().replace(/^www\./, "");
            const p = u.pathname.toLowerCase();
            // Block bare Google domains (google.com, m.google.com, google.co.in)
            if (/^(?:m\.)?google\.[a-z.]+$/i.test(h)) return false;
            // Block /search path on any Google subdomain
            if (h.includes("google.") && p.startsWith("/search")) return false;
            // Block known Google search subdomains
            if (/^(?:scholar|books|cse|news)\.google\./i.test(h)) return false;
            // Block other search engines
            if (h === "bing.com" || h === "duckduckgo.com" || h === "search.yahoo.com") return false;
            return true;
          } catch { return false; }
        });
      }

      // Remove anchor_terms from final output (internal use only)
      delete mod.anchor_terms;
    }

    // ── Roadmap-level diversity pass ──
    // If the entire roadmap is >75% video, swap weakest videos in multi-resource
    // modules for the best available non-video candidate from rescue pools.
    {
      const allResources = (roadmap.modules || []).flatMap((m: any) => m.resources || []);
      const videoCount = allResources.filter((r: Resource) => r.type === "video").length;
      const totalCount = allResources.length;
      const videoRatio = totalCount > 0 ? videoCount / totalCount : 0;
      const targetMaxVideoRatio = 0.70;

      if (videoRatio > targetMaxVideoRatio && totalCount >= 3) {
        const videosToReplace = Math.ceil(videoCount - totalCount * targetMaxVideoRatio);
        let replaced = 0;
        console.log(`Roadmap diversity: ${videoCount}/${totalCount} resources are videos (${Math.round(videoRatio * 100)}%). Swapping up to ${videosToReplace} for articles/docs.`);

        // Iterate modules — prefer swapping in modules with multiple resources
        const sortedModules = [...(roadmap.modules || [])]
          .filter((m: any) => (m.resources?.length || 0) >= 2)
          .sort((a: any, b: any) => (b.resources?.length || 0) - (a.resources?.length || 0));

        for (const mod of sortedModules) {
          if (replaced >= videosToReplace) break;
          const resources = mod.resources as Resource[];
          const moduleVideos = resources.filter((r: Resource) => r.type === "video");
          if (moduleVideos.length < 2) continue; // keep at least 1 video per module

          // Find the weakest video (last one, since they're roughly score-ordered)
          const weakestVideo = moduleVideos[moduleVideos.length - 1];
          const rescuePool = moduleRescuePools.get(mod.id) || [];
          const bestNonVideo = rescuePool.find((c: CandidateResource) =>
            c.type !== "video" &&
            !usedResourceUrls.has(normalizeResourceUrl(c.url)) &&
            !isGarbage(c) &&
            isAllowedResourceUrl(c.url)
          );

          if (bestNonVideo) {
            const idx = resources.findIndex((r: Resource) => r.url === weakestVideo.url);
            if (idx >= 0) {
              resources[idx] = {
                title: bestNonVideo.title,
                url: bestNonVideo.url,
                type: bestNonVideo.type,
                estimated_minutes: bestNonVideo.estimated_minutes,
                description: bestNonVideo.description,
                channel: bestNonVideo.channel,
                view_count: bestNonVideo.view_count,
                like_count: bestNonVideo.like_count,
                quality_signal: bestNonVideo.quality_signal,
              } as Resource;
              usedResourceUrls.add(normalizeResourceUrl(bestNonVideo.url));
              replaced++;
              console.log(`Roadmap diversity: Swapped video "${weakestVideo.title}" → article/doc "${bestNonVideo.title}" in module "${mod.title}"`);
            }
          }
        }
        console.log(`Roadmap diversity: Replaced ${replaced}/${videosToReplace} videos with non-video resources.`);
      }
    }

    // ── Final validation log ──
    const totalResources = (roadmap.modules || []).reduce((sum: number, m: any) => sum + (m.resources?.length || 0), 0);
    const pipelineDiag = {
      totalCandidatesAfterSerper: totalCandidatesAcrossModules,
      youtubeVideosFound: ytMap.size,
      youtubeVideosRequested: allVideoIds.size,
      agent2Success: agent2Result.success,
      totalResourcesAssigned: totalResources,
      totalMinutesUsed: Math.round(totalRoadmapMinutes),
      usableMinutesBudget: Math.round(usableMinutes),
      pipelineMs: Date.now() - t0,
    };
    console.log(`Final validation: ${totalResources} total resources, ${usedResourceUrls.size} unique URLs, ${Math.round(totalRoadmapMinutes)} mins used of ${Math.round(usableMinutes)} usable.`);
    console.log(`Pipeline diagnostics: ${JSON.stringify(pipelineDiag)}`);

    console.log(`[TIMING] Total pipeline: ${Date.now() - t0} ms`);
    console.log("Roadmap generation complete (pipeline with 2 AI agents).");

    // Attach diagnostics so frontend/logs can identify pipeline failures
    roadmap._pipeline_diag = pipelineDiag;

    return new Response(JSON.stringify(roadmap), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("generate-roadmap error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
