import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface SerperWebResult { title: string; link: string; snippet: string; }
interface SerperVideoResult { title: string; link: string; duration?: string; }

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
  authority_score: number;
  context_fit_score: number;
  why_selected?: string;
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
}

// ─── Tiered Source Authority ─────────────────────────────────────────────────

const TIER1_DOMAINS = [
  "freecodecamp.org", "cs50.harvard.edu", "ocw.mit.edu",
  "khanacademy.org", "developer.mozilla.org",
];

const OFFICIAL_DOC_PATTERNS = [
  "python.org/doc", "docs.python.org", "react.dev", "vuejs.org",
  "angular.io/docs", "docs.docker.com", "kubernetes.io/docs",
  "go.dev/doc", "doc.rust-lang.org", "docs.oracle.com",
  "learn.microsoft.com", "developer.apple.com",
];

const MAJOR_VENDOR_DOMAINS = [
  "cloud.google.com", "aws.amazon.com", "azure.microsoft.com",
  "ibm.com", "nvidia.com", "oracle.com", "redhat.com",
];

const UNIVERSITY_DOMAINS = [
  "stanford.edu", "mit.edu", "harvard.edu", "berkeley.edu",
  "coursera.org", "edx.org", "udacity.com",
];

const RECOGNIZED_TECH_BLOGS = [
  "dev.to", "realpython.com", "digitalocean.com", "geeksforgeeks.org",
  "baeldung.com", "medium.com", "hashnode.dev", "smashingmagazine.com",
  "css-tricks.com", "web.dev",
];

const DEPRIORITIZE_DOMAINS = [
  "tutorialspoint.com", "javatpoint.com",
];

// YouTube channel tiers (lowercase)
const YOUTUBE_TIER1_CHANNELS = [
  "freecodecamp.org", "freecodecamp", "3blue1brown", "cs50", "computerphile",
  "mit opencourseware", "khan academy",
];
const YOUTUBE_TIER2_CHANNELS = [
  "traversy media", "fireship", "web dev simplified", "tech with tim",
  "programming with mosh", "the coding train", "sentdex", "corey schafer",
  "techworld with nana", "networkchuck", "net ninja", "javascript mastery",
  "cs dojo", "academind", "ben awad", "theo", "ibm technology",
  "google cloud tech", "aws", "microsoft developer",
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
    siteFilters: ["site:coursera.org", "site:edx.org", "site:freecodecamp.org"],
  },
  deep_mastery: {
    youtubeChannels: ["freecodecamp", "sentdex", "the coding train"],
    siteFilters: ["site:realpython.com", "site:digitalocean.com/community/tutorials"],
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  const hms = duration.match(/(\d+):(\d+):(\d+)/);
  if (hms) return parseInt(hms[1]) * 60 + parseInt(hms[2]);
  const ms = duration.match(/(\d+):(\d+)/);
  if (ms) return parseInt(ms[1]);
  const min = duration.match(/(\d+)\s*min/i);
  if (min) return parseInt(min[1]);
  return 15;
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

async function fetchYouTubeMetadata(videoIds: string[], apiKey: string): Promise<Map<string, YouTubeMetadata>> {
  const metadataMap = new Map<string, YouTubeMetadata>();
  if (videoIds.length === 0) return metadataMap;

  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const idsParam = batch.join(",");
    try {
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${idsParam}&key=${apiKey}`
      );
      if (!res.ok) {
        if (res.status === 403) {
          console.warn("YouTube API quota exceeded, skipping enrichment");
          return metadataMap;
        }
        console.error(`YouTube API error: ${res.status}`);
        return metadataMap;
      }
      const data = await res.json();
      for (const item of (data.items || [])) {
        metadataMap.set(item.id, {
          title: item.snippet?.title || "",
          channel: item.snippet?.channelTitle || "",
          durationMinutes: parseISO8601Duration(item.contentDetails?.duration || "PT0S"),
          viewCount: parseInt(item.statistics?.viewCount || "0"),
          likeCount: parseInt(item.statistics?.likeCount || "0"),
        });
      }
    } catch (e) {
      console.error("YouTube API fetch failed:", e);
      return metadataMap;
    }
  }
  return metadataMap;
}

async function searchSerper(query: string, apiKey: string, type: "search" | "videos", num: number) {
  const url = type === "videos" ? "https://google.serper.dev/videos" : "https://google.serper.dev/search";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num }),
    });
    if (!res.ok) { console.error(`Serper ${type} error: ${res.status}`); return []; }
    const data = await res.json();
    return type === "videos" ? (data.videos || []) : (data.organic || []);
  } catch (e) { console.error(`Serper ${type} fetch failed:`, e); return []; }
}

function estimateArticleMinutes(snippet: string): number {
  const wordCount = snippet ? snippet.split(/\s+/).length : 0;
  if (wordCount > 80) return 15;
  return 10;
}

// ─── STAGE 4: Hard Filter ────────────────────────────────────────────────────

function isDisqualified(title: string, url: string): boolean {
  const spamSignals = /\b(top \d+ best|best \d+|you won't believe|clickbait|ai generated|content farm)\b/i;
  if (spamSignals.test(title)) return true;
  if (DEPRIORITIZE_DOMAINS.some(d => url.toLowerCase().includes(d))) return true;
  return false;
}

function computeSemanticSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  if (words1.size === 0 || words2.size === 0) return 0;
  let overlap = 0;
  for (const w of words1) {
    if (words2.has(w)) overlap++;
  }
  // Jaccard-like but weighted toward the smaller set for recall
  return overlap / Math.min(words1.size, words2.size);
}

// ─── STAGE 5: Authority Scoring ──────────────────────────────────────────────

function computeAuthorityScore(candidate: CandidateResource, ytMeta?: YouTubeMetadata): number {
  let score = 0;
  const urlLower = candidate.url.toLowerCase();

  // Domain authority
  if (TIER1_DOMAINS.some(d => urlLower.includes(d))) score += 30;
  if (OFFICIAL_DOC_PATTERNS.some(d => urlLower.includes(d))) score += 28;
  if (MAJOR_VENDOR_DOMAINS.some(d => urlLower.includes(d))) score += 22;
  if (UNIVERSITY_DOMAINS.some(d => urlLower.includes(d))) score += 20;
  if (RECOGNIZED_TECH_BLOGS.some(d => urlLower.includes(d))) score += 12;

  // YouTube-specific authority
  if (candidate.type === "video" && ytMeta) {
    // View count: log-normalized (log10(1M) ≈ 6, log10(100K) ≈ 5, log10(10K) ≈ 4)
    const logViews = ytMeta.viewCount > 0 ? Math.log10(ytMeta.viewCount) : 0;
    score += Math.min(logViews * 4, 28); // max 28 from views

    // Channel tier
    const channelLower = ytMeta.channel.toLowerCase();
    if (YOUTUBE_TIER1_CHANNELS.some(ch => channelLower.includes(ch))) score += 20;
    else if (YOUTUBE_TIER2_CHANNELS.some(ch => channelLower.includes(ch))) score += 15;
  } else if (candidate.type === "video") {
    // No YT metadata — slight penalty but don't kill it
    score += 5;
  }

  // Appearances bonus (appeared in multiple queries = validated relevance)
  score += Math.min(candidate.appearances_count * 5, 20);

  return Math.min(score, 100);
}

// ─── STAGE 6: Context Fit Scoring ────────────────────────────────────────────

function computeContextFitScore(candidate: CandidateResource, ctx: ModuleContext, ytMeta?: YouTubeMetadata): number {
  let score = 0;

  // Semantic similarity (dominant factor)
  const moduleText = `${ctx.topic} ${ctx.moduleTitle} ${ctx.moduleDescription} ${ctx.learningObjectives.join(" ")} ${ctx.goal} ${ctx.level}`;
  const resourceText = `${candidate.title} ${candidate.description} ${candidate.channel || ""}`;
  const similarity = computeSemanticSimilarity(moduleText, resourceText);
  score += Math.round(similarity * 50); // up to 50 points

  // Learning goal alignment
  if (ctx.goal === "conceptual" && (candidate.type === "video" || candidate.type === "documentation")) score += 10;
  if (ctx.goal === "hands_on" && (candidate.type === "tutorial" || candidate.type === "practice")) score += 10;
  if (ctx.goal === "quick_overview" && candidate.estimated_minutes <= 20) score += 8;
  if (ctx.goal === "deep_mastery" && candidate.estimated_minutes >= 20) score += 8;

  // Level alignment
  const titleLower = candidate.title.toLowerCase();
  if (ctx.level === "beginner" && /beginner|intro|basic|fundamental|getting started|what is/i.test(titleLower)) score += 8;
  if (ctx.level === "intermediate" && /intermediate|practical|pattern|use case/i.test(titleLower)) score += 8;
  if (ctx.level === "advanced" && /advanced|deep|expert|optimization|architecture/i.test(titleLower)) score += 8;

  // Freshness (prefer newer content for fast-moving topics)
  // Can't check date easily, so skip

  // Format alignment per goal
  const goalChannels = GOAL_RESOURCES[ctx.goal]?.youtubeChannels || [];
  if (candidate.type === "video" && ytMeta) {
    const channelLower = ytMeta.channel.toLowerCase();
    if (goalChannels.some(ch => channelLower.includes(ch))) score += 10;
  }

  // Time feasibility (constraint, not boost)
  if (candidate.estimated_minutes > ctx.moduleMinutes * 2) score -= 5;

  return Math.max(0, Math.min(score, 100));
}

// ─── STAGE 7: Clustering & Diversity ─────────────────────────────────────────

interface GoalDiversityConfig {
  videos: number;
  articles: number; // includes docs, tutorials
  practice: number;
  maxPerModule: number;
  minPerModule: number;
}

function getGoalDiversity(goal: string): GoalDiversityConfig {
  switch (goal) {
    case "conceptual": return { videos: 2, articles: 2, practice: 0, maxPerModule: 5, minPerModule: 2 };
    case "hands_on": return { videos: 1, articles: 2, practice: 1, maxPerModule: 5, minPerModule: 2 };
    case "quick_overview": return { videos: 1, articles: 1, practice: 0, maxPerModule: 3, minPerModule: 1 };
    case "deep_mastery": return { videos: 2, articles: 1, practice: 1, maxPerModule: 5, minPerModule: 2 };
    default: return { videos: 1, articles: 2, practice: 0, maxPerModule: 5, minPerModule: 2 };
  }
}

function clusterAndDiversify(candidates: CandidateResource[], ctx: ModuleContext): CandidateResource[] {
  const diversity = getGoalDiversity(ctx.goal);
  
  // Sort by combined score (authority + context fit)
  const sorted = [...candidates].sort((a, b) => 
    (b.authority_score + b.context_fit_score) - (a.authority_score + a.context_fit_score)
  );

  // Simple clustering: remove near-duplicates (high title similarity)
  const deduplicated: CandidateResource[] = [];
  for (const c of sorted) {
    const isDuplicate = deduplicated.some(existing => {
      const sim = computeSemanticSimilarity(existing.title, c.title);
      return sim > 0.7; // 70%+ title overlap = near duplicate
    });
    if (!isDuplicate) deduplicated.push(c);
  }

  // Select with diversity constraints
  const selected: CandidateResource[] = [];
  const typeCounts = { video: 0, article: 0, practice: 0 };
  let totalMinutes = 0;

  for (const c of deduplicated) {
    if (selected.length >= diversity.maxPerModule) break;

    const typeGroup = c.type === "video" ? "video" : 
      c.type === "practice" ? "practice" : "article";
    
    const maxForType = typeGroup === "video" ? diversity.videos :
      typeGroup === "practice" ? diversity.practice : diversity.articles;

    if (typeCounts[typeGroup] >= maxForType + 1) continue;

    // Time constraint: allow first resource even if exceeds, cap subsequent
    if (selected.length > 0 && totalMinutes + c.estimated_minutes > ctx.moduleMinutes * 1.2) continue;

    selected.push(c);
    totalMinutes += c.estimated_minutes;
    typeCounts[typeGroup]++;
  }

  // Fill to minimum
  if (selected.length < diversity.minPerModule) {
    for (const c of deduplicated) {
      if (selected.includes(c)) continue;
      if (selected.length >= diversity.minPerModule) break;
      selected.push(c);
    }
  }

  return selected;
}

// ─── STAGE 2: High-Recall Retrieval ──────────────────────────────────────────

interface GoalSearchConfig {
  queryModifiers: string[];
  videoCount: number;
  webCount: number;
}

function getGoalSearchConfig(goal: string): GoalSearchConfig {
  switch (goal) {
    case "conceptual":
      return { queryModifiers: ["explained", "how does it work", "concepts", "theory", "lecture", "introduction"], videoCount: 8, webCount: 6 };
    case "hands_on":
      return { queryModifiers: ["tutorial", "build", "project", "practice", "hands-on", "step by step", "code along"], videoCount: 6, webCount: 8 };
    case "quick_overview":
      return { queryModifiers: ["crash course", "in 10 minutes", "quick guide", "overview", "essentials"], videoCount: 6, webCount: 4 };
    case "deep_mastery":
      return { queryModifiers: ["complete guide", "comprehensive", "advanced", "in depth", "full course", "masterclass"], videoCount: 6, webCount: 8 };
    default:
      return { queryModifiers: ["tutorial", "guide"], videoCount: 6, webCount: 6 };
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

// Stage 2A: Topic-Wide Anchor Retrieval
async function fetchTopicAnchors(
  topic: string,
  level: string,
  goal: string,
  serperKey: string
): Promise<{ videos: SerperVideoResult[]; web: SerperWebResult[] }> {
  const levelMod = getLevelSearchModifier(level);
  const goalConfig = getGoalSearchConfig(goal);
  const goalMod = goalConfig.queryModifiers[0] || "";

  // 3 broad queries: explained, tutorial, full course
  const queries = [
    `${topic} ${goalMod} ${levelMod}`,
    `${topic} tutorial complete guide`,
    `${topic} full course best`,
  ];

  const promises: Promise<any>[] = [];
  for (const q of queries) {
    promises.push(searchSerper(q, serperKey, "videos", 15));
    promises.push(searchSerper(q, serperKey, "search", 10));
  }

  const results = await Promise.all(promises);
  const videos: SerperVideoResult[] = [];
  const web: SerperWebResult[] = [];

  for (let i = 0; i < results.length; i++) {
    if (i % 2 === 0) videos.push(...(results[i] as SerperVideoResult[]));
    else web.push(...(results[i] as SerperWebResult[]));
  }

  console.log(`Topic anchors: ${videos.length} videos, ${web.length} web results`);
  return { videos, web };
}

// Stage 2B: Module-Specific Retrieval
async function fetchModuleResults(
  moduleTitle: string,
  topic: string,
  level: string,
  goal: string,
  serperKey: string
): Promise<{ videos: SerperVideoResult[]; web: SerperWebResult[] }> {
  const config = getGoalSearchConfig(goal);
  const levelMod = getLevelSearchModifier(level);
  const goalRes = GOAL_RESOURCES[goal] || GOAL_RESOURCES["hands_on"];

  // Generate 5 diversified queries
  const queries = [
    `${moduleTitle} ${topic} ${config.queryModifiers[0] || "explained"}`,
    `${moduleTitle} ${topic} ${levelMod}`,
    `${moduleTitle} ${topic} ${config.queryModifiers[1] || "tutorial"}`,
    `${moduleTitle} ${topic} ${goalRes.siteFilters[0] || ""}`,
    `${moduleTitle} ${config.queryModifiers[2] || "guide"} ${levelMod}`,
  ];

  // Run 5 video + 5 web searches in parallel
  const promises: Promise<any>[] = [];
  for (const q of queries) {
    promises.push(searchSerper(q, serperKey, "videos", 6));
    promises.push(searchSerper(q, serperKey, "search", 4));
  }

  const results = await Promise.all(promises);
  const videos: SerperVideoResult[] = [];
  const web: SerperWebResult[] = [];

  for (let i = 0; i < results.length; i++) {
    if (i % 2 === 0) videos.push(...(results[i] as SerperVideoResult[]));
    else web.push(...(results[i] as SerperWebResult[]));
  }

  return { videos, web };
}

// ─── Merge & Deduplicate with Appearance Counting ────────────────────────────

function mergeAndDeduplicate(
  topicAnchors: { videos: SerperVideoResult[]; web: SerperWebResult[] },
  moduleResults: { videos: SerperVideoResult[]; web: SerperWebResult[] },
  moduleTitle: string,
  totalAvailableMinutes: number
): CandidateResource[] {
  const urlMap = new Map<string, CandidateResource>();

  function processVideo(v: SerperVideoResult) {
    if (!v.link) return;
    const normalizedUrl = v.link.split("&")[0]; // normalize YouTube URLs
    const title = v.title || "Video Tutorial";
    if (isDisqualified(title, normalizedUrl)) return;
    const mins = parseDurationToMinutes(v.duration);
    if (mins > totalAvailableMinutes) return;

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
    const title = r.title || "Learning Resource";
    if (isDisqualified(title, r.link)) return;
    // Skip YouTube links in web results (already handled as videos)
    if (r.link.includes("youtube.com/watch") || r.link.includes("youtu.be/")) return;

    if (urlMap.has(r.link)) {
      urlMap.get(r.link)!.appearances_count++;
    } else {
      urlMap.set(r.link, {
        title, url: r.link,
        type: detectResourceType(r.link),
        estimated_minutes: estimateArticleMinutes(r.snippet || ""),
        description: r.snippet || `Resource for ${moduleTitle}`,
        appearances_count: 1,
        authority_score: 0,
        context_fit_score: 0,
      });
    }
  }

  // Process topic anchors first
  for (const v of topicAnchors.videos) processVideo(v);
  for (const r of topicAnchors.web) processWeb(r);

  // Process module results
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
    if (!meta) return false; // Video not found (private/deleted)

    // Stage 4: Semantic filter — reject only if very low similarity
    const moduleText = `${ctx.topic} ${ctx.moduleTitle} ${ctx.moduleDescription} ${ctx.learningObjectives.join(" ")}`;
    const resourceText = `${meta.title} ${meta.channel}`;
    const similarity = computeSemanticSimilarity(moduleText, resourceText);
    if (similarity < 0.05) {
      console.warn(`Excluding very off-topic video: "${meta.title}" by ${meta.channel} (similarity: ${similarity.toFixed(2)})`);
      return false;
    }

    // Enrich
    c.title = meta.title || c.title;
    c.estimated_minutes = meta.durationMinutes || c.estimated_minutes;
    c.channel = meta.channel;
    c.view_count = meta.viewCount;
    c.like_count = meta.likeCount;
    c.source = "YouTube";
    c.quality_signal = `${formatViewCount(meta.viewCount)} views · ${meta.channel} · ${meta.durationMinutes} min`;

    // Compute authority & context fit scores
    c.authority_score = computeAuthorityScore(c, meta);
    c.context_fit_score = computeContextFitScore(c, ctx, meta);

    return true;
  });
}

// ─── STAGE 8: Batch LLM Reranker ─────────────────────────────────────────────

interface RerankerInput {
  moduleTitle: string;
  moduleDescription: string;
  candidates: Array<{
    index: number;
    title: string;
    url: string;
    type: string;
    channel_or_site: string;
    duration_minutes: number;
    view_count: number;
    appearances_count: number;
    authority_score: number;
    context_fit_score: number;
  }>;
}

async function batchRerank(
  moduleCandidates: Map<string, CandidateResource[]>,
  modules: any[],
  topic: string,
  goal: string,
  level: string,
  apiKey: string
): Promise<Map<string, string[]>> {
  // Build reranker input for all modules
  const rerankerModules: RerankerInput[] = [];
  
  for (const mod of modules) {
    const candidates = moduleCandidates.get(mod.id) || [];
    // Take top 12 by combined score
    const top12 = [...candidates]
      .sort((a, b) => (b.authority_score + b.context_fit_score) - (a.authority_score + a.context_fit_score))
      .slice(0, 12);

    rerankerModules.push({
      moduleTitle: mod.title,
      moduleDescription: mod.description || "",
      candidates: top12.map((c, i) => ({
        index: i,
        title: c.title,
        url: c.url,
        type: c.type,
        channel_or_site: c.channel || new URL(c.url).hostname.replace("www.", ""),
        duration_minutes: c.estimated_minutes,
        view_count: c.view_count || 0,
        appearances_count: c.appearances_count,
        authority_score: c.authority_score,
        context_fit_score: c.context_fit_score,
      })),
    });
  }

  const rerankerPrompt = `You are an Expert Curriculum Curator. Given a learner profile and module candidates, select the best 3-5 resources per module.

Learner profile:
- Topic: ${topic}
- Goal: ${goal}
- Level: ${level}

Rules:
- Prefer canonical, widely trusted sources (high authority_score)
- Avoid low-view unknown creators unless uniquely valuable
- Avoid redundancy — don't pick 3 similar videos
- Time is a constraint (resources must fit module budget), NOT a ranking boost
- Your selections override heuristic ordering

=== GLOBAL CONSTRAINTS (MANDATORY) ===

1. GLOBAL RESOURCE UNIQUENESS: A resource URL may appear AT MOST ONCE across all modules. Do NOT select the same URL for multiple modules.

2. HARD TIME BUDGET: Each module's total resource minutes must not exceed its budget. Remove lowest-value resource if over budget. Never exceed total roadmap time.

3. STACK CONSISTENCY: If user did not specify a language/framework:
   - For conceptual goals: prefer tool-agnostic resources
   - For hands-on goals: pick ONE consistent stack across all modules, do NOT mix Python/JS/no-code randomly

4. SHORT TIMELINE COMPRESSION: If total time < 5 hours, prefer fewer but stronger resources. Avoid padding with small redundant videos.

5. COVERAGE BEFORE REDUNDANCY: Maximize coverage of module learning objectives. Never select multiple resources teaching identical content from the same channel.

For each module, return the URLs of your selected resources and a 1-sentence "why_selected" for each.

Modules and candidates:
${JSON.stringify(rerankerModules, null, 1)}

Return ONLY valid JSON:
{
  "selections": [
    {
      "module_title": "...",
      "selected": [
        { "url": "...", "why_selected": "..." }
      ]
    }
  ]
}`;

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "user", content: rerankerPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      console.error(`Reranker LLM error: ${response.status}`);
      return new Map();
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return new Map();

    const parsed = JSON.parse(content);
    const result = new Map<string, string[]>();
    
    for (const sel of (parsed.selections || [])) {
      const urls = (sel.selected || []).map((s: any) => s.url);
      result.set(sel.module_title, urls);
      
      // Store why_selected back onto candidates
      for (const s of (sel.selected || [])) {
        for (const mod of modules) {
          const candidates = moduleCandidates.get(mod.id) || [];
          const match = candidates.find(c => c.url === s.url);
          if (match) match.why_selected = s.why_selected;
        }
      }
    }

    console.log(`Reranker selected resources for ${result.size} modules`);
    return result;
  } catch (e) {
    console.error("Reranker failed:", e);
    return new Map();
  }
}

// ─── System Prompt Builder ───────────────────────────────────────────────────

function buildSystemPrompt(totalHours: number, learningGoal: string, skillLevel: string): string {
  const goalBlock = getGoalPromptBlock(learningGoal);
  const levelBlock = getLevelPromptBlock(skillLevel);
  const interactionBlock = getInteractionBlock(learningGoal, skillLevel);

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
- NEVER assign more total hours than available. If the roadmap would exceed available time, CUT content from the bottom (advanced/optional) not the top (fundamentals).
- Build in a 10-15% buffer. Plan for ~${Math.round(totalHours * 0.88)} hours of content.
- Each module's estimated_hours must be realistic and proportional.
- If not enough time for full topic coverage, be honest in the summary about what's covered and what would need more time.

=== GLOBAL ROADMAP CONSTRAINTS (MANDATORY) ===

1. RESOURCE UNIQUENESS: No resource URL may appear in more than one module. Each module must have distinct resources.
2. TIME BUDGET: total_minutes = weeks × 7 × hours_per_day × 60; usable = total_minutes × 0.85. Sum of all module estimated_hours must not exceed usable time. No module may exceed its budget by >5%.
3. STACK CONSISTENCY: If user does not specify a language/framework/tool — for conceptual goals use tool-agnostic resources; for hands-on goals declare ONE stack and use it consistently across all modules.
4. SHORT TIMELINE COMPRESSION: If total time < 5 hours, reduce module count, increase density, avoid over-fragmentation and repeated introductory content.
5. COVERAGE BEFORE REDUNDANCY: Maximize coverage of learning objectives. Never have two modules teaching identical content.
6. FINAL VALIDATION: Before outputting JSON, verify: no duplicate resources, all modules respect time budget, stack consistency, each module has 3-5 quiz questions.

RULES:
- Break the topic into sequential modules. Module count depends on learning goal.
- Each module must logically build on the previous one.
- DO NOT include any resources or URLs — leave resources as empty arrays. Resources will be fetched separately.
- Generate 3-5 multiple-choice quiz questions per module that test understanding appropriate to the learning goal and level.
- Each quiz question must have exactly 4 options with one correct answer and a clear explanation.
- Assign each module to specific days within the timeline.
- Generate a concise "topic" field summarizing the user's input as a proper title (capitalize, remove filler like "I want to learn").`;
}

function getGoalPromptBlock(goal: string): string {
  switch (goal) {
    case "conceptual": return `CONCEPTUAL learning goal selected.
- Focus on "why" and "how it works" — mental models, comparisons, theory
- Module count: 5-7 modules, moderate depth
- Time split: 80% consuming content, 20% reflection/quizzes
- Quiz style: Definition-based, concept checks, "explain why X works this way"`;
    case "hands_on": return `HANDS-ON learning goal selected.
- Every module MUST have a "build something" or "try this" component
- Module count: 5-8 modules, practice-heavy
- Time split: 30% learning, 70% doing
- Quiz style: Code-oriented, "what would this output", practical scenarios`;
    case "quick_overview": return `QUICK OVERVIEW learning goal selected.
- Hit key points fast, no deep dives, focus on "what you need to know"
- Module count: 3-5 modules MAXIMUM. Each completable in 1-2 hours.
- Even if the user has weeks available, keep it concise. Use extra time for review, not more content.
- Time split: 100% efficient consumption, no lengthy exercises
- Quiz style: Quick recall, key terminology`;
    case "deep_mastery": return `DEEP MASTERY learning goal selected.
- Thorough coverage including edge cases, best practices, architecture patterns, real-world scenarios
- Module count: 7-10 modules, includes prerequisites and advanced topics
- Time split: 40% learning, 40% practice, 20% review
- Quiz style: Advanced nuance, tradeoffs, "when would you use X vs Y", design decisions`;
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

// ─── Main Handler ────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { topic, skill_level, learning_goal, timeline_weeks, timeline_days, hours_per_day, total_hours: providedTotalHours, hard_deadline, deadline_date, include_weekends, timeline_mode } = await req.json();
    const effectiveGoal = learning_goal || "hands_on";
    
    const isHoursOnly = timeline_mode === "hours";
    const daysInTimeline = isHoursOnly ? 1 : (timeline_days || (timeline_weeks * 7));
    const studyDays = isHoursOnly ? 1 : (include_weekends === false ? Math.round(daysInTimeline * 5 / 7) : daysInTimeline);
    const totalHours = providedTotalHours || (studyDays * hours_per_day);
    const effectiveHoursPerDay = isHoursOnly ? totalHours : hours_per_day;
    const effectiveTimelineWeeks = isHoursOnly ? Math.round((totalHours / (effectiveHoursPerDay || 1) / 7) * 100) / 100 : (timeline_days ? Math.round((timeline_days / 7) * 10) / 10 : timeline_weeks);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
    const SERPER_API_KEY = Deno.env.get("SERPER_API_KEY");
    if (!SERPER_API_KEY) throw new Error("SERPER_API_KEY not configured");
    const YOUTUBE_API_KEY = Deno.env.get("YOUTUBE_API_KEY");
    if (!YOUTUBE_API_KEY) throw new Error("YOUTUBE_API_KEY not found. Add it in Lovable environment settings.");

    // ════════════════════════════════════════════════════════════════════════
    // STEP 1: Generate roadmap structure via AI (same as before)
    // ════════════════════════════════════════════════════════════════════════
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
  "topic": "concise clean title (e.g. 'Docker Basics in 2 Days', 'Machine Learning Models', 'Python Libraries Intermediate')",
  "skill_level": "${skill_level}",
  "timeline_weeks": ${effectiveTimelineWeeks},
  "hours_per_day": ${effectiveHoursPerDay},
  "total_hours": ${totalHours},
  "summary": "2-3 sentence overview. If the topic can't be fully covered in the available time, mention what's covered and what would need more time.",
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
      "quiz": [
        { "id": "q1", "question": "question text", "options": ["A", "B", "C", "D"], "correct_answer": "exact text of correct option", "explanation": "why correct" }
      ]
    }
  ],
  "tips": "2-3 practical tips"
}`;

    console.log(`Generating roadmap: topic="${topic}", goal=${effectiveGoal}, level=${skill_level}, hours=${totalHours}`);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-pro-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

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
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseErr) {
      console.error("Failed to parse AI response:", responseText.substring(0, 500));
      throw new Error("AI returned an invalid response. Please try again.");
    }
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("No response from AI. Please try again.");

    let roadmap;
    try {
      roadmap = JSON.parse(content);
    } catch (parseErr) {
      console.error("Failed to parse roadmap JSON:", content.substring(0, 500));
      throw new Error("AI returned malformed roadmap data. Please try again.");
    }

    // ════════════════════════════════════════════════════════════════════════
    // STEP 2: STAGE 2A — Topic-Wide Anchor Retrieval
    // ════════════════════════════════════════════════════════════════════════
    console.log(`Stage 2A: Fetching topic-wide anchors for "${topic}"...`);
    const topicAnchors = await fetchTopicAnchors(topic, skill_level, effectiveGoal, SERPER_API_KEY);

    // ════════════════════════════════════════════════════════════════════════
    // STEP 3: STAGE 2B — Module-Specific Retrieval (parallelized)
    // ════════════════════════════════════════════════════════════════════════
    console.log(`Stage 2B: Fetching module-specific results for ${roadmap.modules?.length || 0} modules...`);
    const moduleResultsPromises = (roadmap.modules || []).map((mod: any) =>
      fetchModuleResults(mod.title, topic, skill_level, effectiveGoal, SERPER_API_KEY)
    );
    const allModuleResults = await Promise.all(moduleResultsPromises);

    // ════════════════════════════════════════════════════════════════════════
    // STEP 4: Merge, deduplicate, count appearances per module
    // ════════════════════════════════════════════════════════════════════════
    const totalAvailableMinutes = totalHours * 60;
    const allModuleCandidates = new Map<string, CandidateResource[]>();

    for (let i = 0; i < (roadmap.modules || []).length; i++) {
      const mod = roadmap.modules[i];
      const moduleResults = allModuleResults[i];
      const candidates = mergeAndDeduplicate(topicAnchors, moduleResults, mod.title, totalAvailableMinutes);
      allModuleCandidates.set(mod.id, candidates);
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
      console.log(`Stage 3: Enriching ${allVideoIds.size} YouTube videos with metadata...`);
      ytMap = await fetchYouTubeMetadata([...allVideoIds], YOUTUBE_API_KEY);
      console.log(`Got metadata for ${ytMap.size} videos.`);
    }

    // ════════════════════════════════════════════════════════════════════════
    // STEP 6: STAGES 4-6 — Hard filter, Authority, Context Fit scoring
    // ════════════════════════════════════════════════════════════════════════
    for (const mod of (roadmap.modules || [])) {
      const candidates = allModuleCandidates.get(mod.id) || [];
      const ctx: ModuleContext = {
        topic,
        moduleTitle: mod.title,
        moduleDescription: mod.description || "",
        learningObjectives: mod.learning_objectives || [],
        goal: effectiveGoal,
        level: skill_level,
        moduleMinutes: Math.floor((mod.estimated_hours || 1) * 60),
      };

      // Enrich videos with YouTube data + compute authority & context scores
      const enriched = enrichCandidatesWithYouTube(candidates, ytMap, ctx);
      
      // Score non-video candidates too
      for (const c of enriched) {
        if (c.type !== "video") {
          c.authority_score = computeAuthorityScore(c);
          c.context_fit_score = computeContextFitScore(c, ctx);
        }
      }

      allModuleCandidates.set(mod.id, enriched);
    }

    // ════════════════════════════════════════════════════════════════════════
    // STEP 7: STAGE 7 — Clustering & Diversity (pre-reranker)
    // ════════════════════════════════════════════════════════════════════════
    // Applied after reranker as fallback

    // ════════════════════════════════════════════════════════════════════════
    // STEP 8: STAGE 8 — Batch LLM Reranker
    // ════════════════════════════════════════════════════════════════════════
    console.log(`Stage 8: Running batch LLM reranker...`);
    const rerankerSelections = await batchRerank(
      allModuleCandidates,
      roadmap.modules || [],
      topic,
      effectiveGoal,
      skill_level,
      LOVABLE_API_KEY
    );

    // ════════════════════════════════════════════════════════════════════════
    // STEP 9: STAGE 9 — Final Assembly
    // ════════════════════════════════════════════════════════════════════════
    // ── Global uniqueness set ──
    const usedResourceUrls = new Set<string>();
    const usedVideoIds = new Set<string>();
    const usedChannelTitles = new Map<string, Set<string>>(); // channel -> set of titles
    const usableMinutes = totalHours * 60 * 0.85;
    let totalRoadmapMinutes = 0;

    for (const mod of (roadmap.modules || [])) {
      const candidates = allModuleCandidates.get(mod.id) || [];
      const moduleMinutes = Math.floor((mod.estimated_hours || 1) * 60);
      const moduleBudgetCap = moduleMinutes * 1.05; // 5% tolerance
      const ctx: ModuleContext = {
        topic,
        moduleTitle: mod.title,
        moduleDescription: mod.description || "",
        learningObjectives: mod.learning_objectives || [],
        goal: effectiveGoal,
        level: skill_level,
        moduleMinutes,
      };

      const rerankedUrls = rerankerSelections.get(mod.title);

      let finalResources: CandidateResource[];

      if (rerankedUrls && rerankedUrls.length > 0) {
        const reranked: CandidateResource[] = [];
        for (const url of rerankedUrls) {
          const match = candidates.find(c => c.url === url);
          if (match) reranked.push(match);
        }
        finalResources = reranked.length < 2 ? clusterAndDiversify(candidates, ctx) : reranked;
      } else {
        finalResources = clusterAndDiversify(candidates, ctx);
      }

      // ── Constraint 1: Global uniqueness enforcement ──
      const uniqueResources: CandidateResource[] = [];
      for (const c of finalResources) {
        const normalizedUrl = c.url.split("&")[0];
        const videoId = extractYouTubeVideoId(normalizedUrl);

        // Check exact URL duplicate
        if (usedResourceUrls.has(normalizedUrl)) continue;
        // Check same video ID
        if (videoId && usedVideoIds.has(videoId)) continue;
        // Check same channel + similar title (near-duplicate)
        if (c.channel) {
          const channelTitles = usedChannelTitles.get(c.channel.toLowerCase());
          if (channelTitles) {
            const isDup = [...channelTitles].some(t => computeSemanticSimilarity(t, c.title) > 0.92);
            if (isDup) continue;
          }
        }

        uniqueResources.push(c);
      }

      // ── Constraint 2: Hard time budget enforcement ──
      const budgetedResources: CandidateResource[] = [];
      let moduleTotal = 0;
      for (const c of uniqueResources) {
        if (moduleTotal + c.estimated_minutes > moduleBudgetCap && budgetedResources.length > 0) continue;
        if (totalRoadmapMinutes + moduleTotal + c.estimated_minutes > usableMinutes && budgetedResources.length > 0) continue;
        budgetedResources.push(c);
        moduleTotal += c.estimated_minutes;
      }

      // Register used resources globally
      for (const c of budgetedResources) {
        const normalizedUrl = c.url.split("&")[0];
        usedResourceUrls.add(normalizedUrl);
        const videoId = extractYouTubeVideoId(normalizedUrl);
        if (videoId) usedVideoIds.add(videoId);
        if (c.channel) {
          const key = c.channel.toLowerCase();
          if (!usedChannelTitles.has(key)) usedChannelTitles.set(key, new Set());
          usedChannelTitles.get(key)!.add(c.title);
        }
      }
      totalRoadmapMinutes += moduleTotal;

      // Convert to output format
      if (budgetedResources.length > 0) {
        mod.resources = budgetedResources.map(c => ({
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
        } as Resource));
      } else {
        console.warn(`Module "${mod.title}" has 0 resources after full pipeline, using fallback`);
        mod.resources = [{
          title: `${mod.title} - Official Documentation`,
          url: `https://www.google.com/search?q=${encodeURIComponent(mod.title + " " + topic + " documentation")}`,
          type: "article" as const,
          estimated_minutes: Math.round((mod.estimated_hours || 1) * 30),
          description: `Search for official documentation on ${mod.title}`,
        }];
      }
    }

    // ── Final validation log ──
    const totalResources = (roadmap.modules || []).reduce((sum: number, m: any) => sum + (m.resources?.length || 0), 0);
    console.log(`Final validation: ${totalResources} total resources, ${usedResourceUrls.size} unique URLs, ${Math.round(totalRoadmapMinutes)} mins used of ${Math.round(usableMinutes)} usable.`);

    console.log("Roadmap generation complete (9-stage pipeline).");
    return new Response(JSON.stringify(roadmap), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("generate-roadmap error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
