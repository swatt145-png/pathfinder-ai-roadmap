// ─── Shared Resource Pipeline ─────────────────────────────────────────────────
// Canonical resource discovery, filtering, scoring, and selection functions
// shared between generate-roadmap and adapt-roadmap.
// ──────────────────────────────────────────────────────────────────────────────

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SerperWebResult { title: string; link: string; snippet: string; }
export interface SerperVideoResult { title: string; link: string; duration?: string; }

export interface ResourceSegment {
  module_id: string;
  module_title: string;
  start_minute: number;
  end_minute: number;
}

export type AuthorityTier = "OFFICIAL_DOCS" | "VENDOR_DOCS" | "UNIVERSITY_DIRECT" | "EDUCATION_DOMAIN" | "BLOG" | "YOUTUBE_TRUSTED" | "YOUTUBE_UNKNOWN" | "COMMUNITY" | "UNKNOWN";

export interface CandidateResource {
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

export interface Resource {
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

export interface YouTubeMetadata {
  title: string;
  channel: string;
  durationMinutes: number;
  viewCount: number;
  likeCount: number;
}

export interface ModuleContext {
  topic: string;
  moduleTitle: string;
  moduleDescription: string;
  learningObjectives: string[];
  goal: string;
  level: string;
  moduleMinutes: number;
  anchorTerms?: string[];
}

export interface GoalSearchConfig {
  queryModifiers: string[];
  videoCount: number;
  webCount: number;
  semanticHint: string;
  intentTokens: string[];
  outcomeTokens: string[];
}

// ─── Authority Tier Configuration ─────────────────────────────────────────────

export const TIER_CONFIG: Record<AuthorityTier, { norm: number; maxImpact: number }> = {
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

// ─── Domain Classification Lists ─────────────────────────────────────────────

export const OFFICIAL_DOC_PATTERNS = [
  "python.org/doc", "docs.python.org", "react.dev", "vuejs.org",
  "angular.io/docs", "docs.docker.com", "kubernetes.io/docs",
  "go.dev/doc", "doc.rust-lang.org", "docs.oracle.com",
  "learn.microsoft.com", "developer.apple.com", "developer.mozilla.org",
];

export const MAJOR_VENDOR_DOMAINS = [
  "cloud.google.com", "aws.amazon.com", "azure.microsoft.com",
  "ibm.com", "nvidia.com", "oracle.com", "redhat.com",
];

export const UNIVERSITY_DOMAINS = [
  "stanford.edu", "mit.edu", "harvard.edu", "berkeley.edu",
  "cs50.harvard.edu", "ocw.mit.edu",
];

export const EDUCATION_DOMAINS = [
  "coursera.org", "edx.org", "udacity.com", "khanacademy.org",
  "freecodecamp.org",
];

export const RECOGNIZED_BLOGS = [
  "dev.to", "realpython.com", "digitalocean.com", "geeksforgeeks.org",
  "baeldung.com", "medium.com", "hashnode.dev", "smashingmagazine.com",
  "css-tricks.com", "web.dev",
];

export const COMMUNITY_DOMAINS = [
  "stackoverflow.com", "reddit.com", "quora.com",
];

export const DEPRIORITIZE_DOMAINS = [
  "tutorialspoint.com", "javatpoint.com",
];

export const DISALLOWED_RESOURCE_DOMAINS = [
  "coursera.org",
  "coursera.com",
  "tiktok.com",
  "instagram.com",
  "facebook.com",
  "x.com",
  "twitter.com",
];

export const YOUTUBE_TRUSTED_CHANNELS = [
  "freecodecamp.org", "freecodecamp", "3blue1brown", "cs50", "computerphile",
  "mit opencourseware", "khan academy", "ibm technology", "google cloud tech",
  "aws", "microsoft developer", "traversy media", "fireship",
  "web dev simplified", "tech with tim", "programming with mosh",
  "the coding train", "sentdex", "corey schafer", "techworld with nana",
  "networkchuck", "net ninja", "javascript mastery", "cs dojo",
  "academind", "ben awad", "theo",
];

export const GARBAGE_DOMAINS = [
  "linkfarm", "spamsite", "click-bait", "content-farm",
];

export interface GoalResources {
  youtubeChannels: string[];
  siteFilters: string[];
}

export const GOAL_RESOURCES: Record<string, GoalResources> = {
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

export const BROAD_SCOPE_SIGNALS = [
  "roadmap", "full course", "complete guide", "overview",
  "beginner to advanced", "crash course", "ultimate guide",
  "everything you need", "learn .+ in \\d+", "zero to hero",
  "complete tutorial", "all you need to know",
];

// ─── Constants ───────────────────────────────────────────────────────────────

export const TIMEOUTS_MS: Record<string, number> = {
  serper: 8000,
  youtube: 4000,
  agent1Base: 30000,
  agent1PerWeek: 6000,
  agent2: 12000,
  geminiDirect: 10000,
};

export const CACHE_TTL = {
  serperHours: 48,
  youtubeHours: 168,
};

export const PIPELINE_LIMITS = {
  weakModuleCandidateThreshold: 8,
  weakModuleRatioForTopicAnchors: 0.3,
  shortModuleHours: 2,
  agent2CandidatesPerModule: 18,
};

const GENERIC_QUERY_WORDS = new Set([
  "learn", "learning", "guide", "overview", "basics",
  "introduction", "tutorial", "complete", "course",
  "roadmap", "resources", "best",
]);

// ─── Utility Functions ───────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export function hashKey(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

export function extractYouTubeVideoId(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
  return match ? match[1] : null;
}

export function formatViewCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

export function parseISO8601Duration(iso8601: string): number {
  const match = iso8601.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  const hours = parseInt(match?.[1] || '0');
  const minutes = parseInt(match?.[2] || '0');
  const seconds = parseInt(match?.[3] || '0');
  return hours * 60 + minutes + (seconds > 0 ? 1 : 0);
}

export function parseDurationToMinutes(duration?: string): number {
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

export function detectResourceType(url: string): CandidateResource["type"] {
  const lower = url.toLowerCase();
  const docDomains = ["docs.", "developer.", "devdocs.", "wiki.", "reference.", "documentation", "developer.mozilla.org", "learn.microsoft.com"];
  const practiceDomains = ["leetcode", "hackerrank", "codewars", "exercism", "codecademy.com/learn", "freecodecamp.org/learn", "sqlzoo"];
  const tutorialDomains = ["freecodecamp", "w3schools", "geeksforgeeks", "codecademy", "khanacademy", "realpython", "digitalocean.com/community", "theodinproject"];
  if (practiceDomains.some(d => lower.includes(d))) return "practice";
  if (docDomains.some(d => lower.includes(d))) return "documentation";
  if (tutorialDomains.some(d => lower.includes(d))) return "tutorial";
  return "article";
}

export function normalizeResourceUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol.toLowerCase();
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    let path = parsed.pathname || "/";
    if (path.length > 1) path = path.replace(/\/+$/, "");

    if (host.includes("google.") && (path === "/url" || path === "/interstitial")) {
      const realUrl = parsed.searchParams.get("q") || parsed.searchParams.get("url") || parsed.searchParams.get("sa");
      if (realUrl && realUrl.startsWith("http")) return normalizeResourceUrl(realUrl);
    }
    if (host.includes("google.") && path.startsWith("/amp/s/")) {
      const ampTarget = path.replace("/amp/s/", "https://");
      try { return normalizeResourceUrl(ampTarget); } catch { /* fall through */ }
    }
    if ((host === "youtube.com" || host === "m.youtube.com") && path === "/watch") {
      const videoId = parsed.searchParams.get("v");
      if (videoId) return `https://youtube.com/watch?v=${videoId}`;
    }
    if (host === "youtu.be") {
      const videoId = path.replace("/", "");
      if (videoId) return `https://youtube.com/watch?v=${videoId}`;
    }
    if (host.includes("google.") && path.startsWith("/search")) {
      return `https://${host}/search`;
    }
    const searchSubdomainPrefixes = ["scholar.", "books.", "cse.", "news."];
    if (searchSubdomainPrefixes.some(p => host.startsWith(p)) && host.includes("google.")) {
      return `https://${host}/search`;
    }
    return `${protocol}//${host}${path}`;
  } catch {
    return url.split("&")[0];
  }
}

export function extractResourceHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function isExcludedResource(url: string, excludedUrls: Set<string>, excludedDomains: Set<string>): boolean {
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

export function isAllowedResourceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.toLowerCase();
    if (DISALLOWED_RESOURCE_DOMAINS.some(d => host.includes(d))) return false;
    if (/^(?:m\.)?google\.[a-z.]+$/i.test(host)) return false;
    if (host.includes("google.") && path.startsWith("/search")) return false;
    const googleSearchSubdomains = ["scholar.google.", "books.google.", "cse.google.", "news.google."];
    if (googleSearchSubdomains.some(d => host.startsWith(d) || host.includes(`.${d}`))) return false;
    if (host.includes("youtube.com") && path.startsWith("/results")) return false;
    if ((host === "bing.com" || host.endsWith(".bing.com")) && path.startsWith("/search")) return false;
    if (host === "duckduckgo.com" || host === "search.yahoo.com") return false;
    return true;
  } catch {
    return false;
  }
}

export function estimateArticleMinutes(snippet: string): number {
  const wordCount = snippet ? snippet.split(/\s+/).length : 0;
  if (wordCount > 80) return 40;
  if (wordCount > 40) return 30;
  return 20;
}

export function detectCertificationIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return /\b(certification|cert|exam|associate|professional|practitioner|architect)\b/i.test(lower);
}

export function getMaxResourcesForModule(moduleHours: number): number {
  if (moduleHours <= 1.5) return 3;
  if (moduleHours <= 3) return 4;
  if (moduleHours <= 5) return 5;
  if (moduleHours <= 10) return 6;
  return 6;
}

// ─── Tokenization & Similarity ───────────────────────────────────────────────

export function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/[^a-z0-9+#./-]/g, "")
    .trim();
}

export function stemToken(token: string): string {
  let t = normalizeToken(token);
  if (t.length <= 4) return t;
  if (t.endsWith("ing") && t.length > 6) t = t.slice(0, -3);
  else if (t.endsWith("ed") && t.length > 5) t = t.slice(0, -2);
  else if (t.endsWith("es") && t.length > 5) t = t.slice(0, -2);
  else if (t.endsWith("s") && t.length > 4) t = t.slice(0, -1);
  return t;
}

export function tokenizeSemantic(text: string): string[] {
  const raw = text
    .toLowerCase()
    .replace(/[^a-z0-9+#./\-\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
  return raw.map(stemToken).filter(Boolean);
}

export function computeSemanticSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  if (words1.size === 0 || words2.size === 0) return 0;
  let overlap = 0;
  for (const w of words1) {
    if (words2.has(w)) overlap++;
  }
  return overlap / Math.min(words1.size, words2.size);
}

export function buildHashedEmbedding(text: string, dim = 256): number[] {
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

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < vecA.length; i++) dot += vecA[i] * vecB[i];
  return Math.max(0, Math.min(1, dot));
}

export function computeEmbeddingSimilarity(text1: string, text2: string): number {
  const vecA = buildHashedEmbedding(text1);
  const vecB = buildHashedEmbedding(text2);
  return cosineSimilarity(vecA, vecB);
}

export function computeHybridSimilarity(text1: string, text2: string): number {
  const lexical = computeSemanticSimilarity(text1, text2);
  const embedding = computeEmbeddingSimilarity(text1, text2);
  return Math.max(0, Math.min(1, lexical * 0.35 + embedding * 0.65));
}

// ─── Filtering Functions ─────────────────────────────────────────────────────

export function isVideoLikelyOffTopic(title: string, channel: string, ctx: ModuleContext): boolean {
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

export function looksLikeListingPage(url: string, title: string, snippet: string): boolean {
  const text = `${url} ${title} ${snippet}`.toLowerCase();
  const listingSignals = [
    "search", "results", "catalog", "directory", "collections",
    "category", "paths", "learning path", "certification path",
    "course list", "browse courses", "all courses",
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

export function isDiscussionOrMetaResource(url: string, title: string, snippet: string): boolean {
  const combined = `${title} ${snippet}`.toLowerCase();
  const urlLower = url.toLowerCase();
  const discussionSignals = [
    "what are the best", "best resources", "where to start",
    "how do i start", "any recommendations", "recommend me",
    "which course should", "is this worth it", "question",
    "discussion", "thread",
  ];
  const educationalSignals = [
    "tutorial", "guide", "lesson", "course", "documentation",
    "docs", "walkthrough", "lecture", "reference", "syllabus",
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

export function isDisqualified(title: string, url: string): boolean {
  const spamSignals = /\b(top \d+ best|best \d+|you won't believe|clickbait|ai generated|content farm)\b/i;
  if (spamSignals.test(title)) return true;
  if (DEPRIORITIZE_DOMAINS.some(d => url.toLowerCase().includes(d))) return true;
  return false;
}

export function isGarbage(candidate: CandidateResource): boolean {
  const urlLower = candidate.url.toLowerCase();
  const titleLower = candidate.title.toLowerCase();
  if (GARBAGE_DOMAINS.some(d => urlLower.includes(d))) return true;
  if (looksLikeListingPage(candidate.url, candidate.title, candidate.description)) return true;
  if (/\b(search results|course catalog|browse courses|learning paths?)\b/i.test(titleLower)) return true;
  if (isDiscussionOrMetaResource(candidate.url, candidate.title, candidate.description)) return true;
  if (/\.(xyz|tk|ml|ga|cf)\//.test(urlLower)) return true;
  if (candidate.description.length < 10 && !candidate.channel) return true;
  return false;
}

// ─── Anchor & Scope Functions ────────────────────────────────────────────────

export function generateModuleAnchors(mod: any, topic: string): string[] {
  if (mod.anchor_terms && Array.isArray(mod.anchor_terms) && mod.anchor_terms.length > 0) {
    return mod.anchor_terms.map((t: string) => t.toLowerCase().trim());
  }

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

  const titleWords = mod.title.toLowerCase().replace(/[^a-z0-9\s\-]/g, " ").split(/\s+/).filter((w: string) => w.length > 1);
  const bigrams: string[] = [];
  for (let i = 0; i < titleWords.length - 1; i++) {
    if (!stopWords.has(titleWords[i]) || !stopWords.has(titleWords[i + 1])) {
      bigrams.push(`${titleWords[i]} ${titleWords[i + 1]}`);
    }
  }

  const anchors = [...new Set([...bigrams, ...words])];
  const topicLower = topic.toLowerCase();
  const filtered = anchors.filter(a => a !== topicLower && a.length > 2);
  return filtered.slice(0, 8);
}

export function passesAnchorGate(candidate: CandidateResource, anchors: string[]): boolean {
  if (anchors.length === 0) return true;
  const text = `${candidate.title} ${candidate.description}`.toLowerCase();
  for (const anchor of anchors) {
    if (text.includes(anchor)) return true;
  }
  return false;
}

export function computeScopePenalty(candidate: CandidateResource, ctx: ModuleContext): number {
  const text = `${candidate.title} ${candidate.description}`.toLowerCase();
  const hasBroadSignal = BROAD_SCOPE_SIGNALS.some(pattern => {
    try {
      return new RegExp(pattern, "i").test(text);
    } catch {
      return text.includes(pattern);
    }
  });

  if (!hasBroadSignal) return 0;

  const modTitleLower = ctx.moduleTitle.toLowerCase();
  const isIntroModule = /introduction|overview|getting started|basics|fundamentals|what is/i.test(modTitleLower);
  const isQuickGoal = ctx.goal === "quick_overview";
  if (isIntroModule || isQuickGoal) return 0;

  const isNarrow = ctx.level === "intermediate" || ctx.level === "advanced" || ctx.goal === "deep_mastery";
  if (isNarrow) return 15;
  return 10;
}

export function applyStage4Filter(
  candidates: CandidateResource[],
  ctx: ModuleContext
): CandidateResource[] {
  const anchors = ctx.anchorTerms || [];
  const strictFiltered: CandidateResource[] = [];
  const relaxedPool: CandidateResource[] = [];
  const moduleText = `${ctx.topic} ${ctx.moduleTitle} ${ctx.moduleDescription} ${ctx.learningObjectives.join(" ")}`;

  for (const c of candidates) {
    if (isDisqualified(c.title, c.url)) continue;

    const resourceText = `${c.title} ${c.description} ${c.channel || ""}`;
    const similarity = computeHybridSimilarity(moduleText, resourceText);
    if (similarity < 0.14) continue;

    const penalty = computeScopePenalty(c, ctx);
    c.scope_penalty = penalty;
    relaxedPool.push(c);

    if (!passesAnchorGate(c, anchors)) continue;
    strictFiltered.push(c);
  }

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

export function applyDiversityCaps(candidates: CandidateResource[], maxPerModule: number, goal: string, _topic: string): CandidateResource[] {
  if (candidates.length <= maxPerModule) return candidates;

  const videos = candidates.filter(c => c.type === "video");
  const docs = candidates.filter(c => c.type === "documentation");
  const articles = candidates.filter(c => c.type === "article" || c.type === "tutorial" || c.type === "practice");

  const handsOn = goal === "hands_on";
  const maxVideos = Math.max(1, Math.floor(maxPerModule * (handsOn ? 0.45 : 0.35)));
  const maxDocs = Math.ceil(maxPerModule * (handsOn ? 0.15 : 0.35));
  const maxArticles = maxPerModule - Math.min(videos.length, maxVideos) - Math.min(docs.length, maxDocs);

  const result: CandidateResource[] = [];
  result.push(...videos.slice(0, maxVideos));
  result.push(...docs.slice(0, maxDocs));
  result.push(...articles.slice(0, Math.max(maxArticles, maxPerModule - result.length)));

  if (result.length < maxPerModule) {
    for (const c of candidates) {
      if (result.length >= maxPerModule) break;
      if (!result.includes(c)) result.push(c);
    }
  }

  return result.slice(0, maxPerModule);
}

// ─── Query Building ──────────────────────────────────────────────────────────

export function getGoalSearchConfig(goal: string, _topic = ""): GoalSearchConfig {
  switch (goal) {
    case "conceptual":
      return {
        queryModifiers: ["explained", "concepts", "theory", "visual explanation", "lecture", "guide"],
        videoCount: 8, webCount: 8,
        semanticHint: "mental model and concept explanation with examples",
        intentTokens: ["mental model", "concept explanation", "tradeoffs"],
        outcomeTokens: ["deep explanation", "why this works", "design intuition"],
      };
    case "hands_on":
      return {
        queryModifiers: ["tutorial", "build", "project", "practice", "hands-on", "step by step", "code along"],
        videoCount: 8, webCount: 6,
        semanticHint: "project based practical walkthrough",
        intentTokens: ["implementation", "code walkthrough", "real project"],
        outcomeTokens: ["build from scratch", "hands-on lab", "practical exercise"],
      };
    case "quick_overview":
      return {
        queryModifiers: ["crash course", "full guide", "start to finish", "top 10", "overview", "essentials"],
        videoCount: 6, webCount: 6,
        semanticHint: "high level summary and key takeaways",
        intentTokens: ["key ideas", "summary", "what matters most"],
        outcomeTokens: ["fast understanding", "cheat sheet", "essentials only"],
      };
    case "deep_mastery":
      return {
        queryModifiers: ["comprehensive", "advanced", "in depth", "research paper", "full course", "masterclass"],
        videoCount: 6, webCount: 10,
        semanticHint: "deep dive with advanced tradeoffs and references",
        intentTokens: ["advanced patterns", "production scale", "optimization"],
        outcomeTokens: ["expert level", "edge cases", "system tradeoffs"],
      };
    default:
      return {
        queryModifiers: ["tutorial", "guide"],
        videoCount: 6, webCount: 6,
        semanticHint: "clear explanation practical relevance",
        intentTokens: ["practical", "conceptual clarity"],
        outcomeTokens: ["learn effectively", "apply confidently"],
      };
  }
}

export function getLevelSearchModifier(level: string): string {
  switch (level) {
    case "beginner": return "for beginners introduction";
    case "intermediate": return "intermediate practical patterns";
    case "advanced": return "advanced best practices optimization";
    default: return "";
  }
}

export function scoreAnchorTerm(term: string): number {
  const normalized = normalizeToken(term);
  if (!normalized || normalized.length < 3) return 0;
  const parts = normalized.split(/[\s/_-]+/).filter(Boolean);
  if (parts.length === 0) return 0;
  const genericPenalty = parts.some((p) => GENERIC_QUERY_WORDS.has(p)) ? 0.55 : 1;
  const specificity = Math.min(1.5, 0.7 + normalized.length / 24);
  const technicalBoost = /[0-9+#./_-]/.test(normalized) ? 1.25 : 1;
  return specificity * technicalBoost * genericPenalty;
}

export function selectTopAnchors(terms: string[], maxCount = 3): string[] {
  return [...terms]
    .map((term) => term.trim())
    .filter((term) => term.length > 1)
    .sort((a, b) => scoreAnchorTerm(b) - scoreAnchorTerm(a))
    .slice(0, maxCount);
}

export function buildQuery(parts: Array<string | undefined | null>): string {
  const raw = parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return raw.slice(0, 180);
}

export function buildTopicQueryPlan(topic: string, level: string, goal: string, certificationIntent: boolean): { precision: string[]; expansion: string[] } {
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

export function buildModuleQueryPlan(
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

// ─── Search Functions ────────────────────────────────────────────────────────

export async function searchSerper(
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
        if (res.status === 401 || res.status === 403 || res.status === 402) return [];
        if (attempt < maxAttempts) { await sleep(500); continue; }
        return [];
      }
      const data = await res.json();
      const results = type === "videos" ? (data.videos || []) : (data.organic || []);
      if (supabaseAdmin && allowCacheWrite) {
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

export async function fetchYouTubeMetadata(videoIds: string[], apiKey: string, supabaseAdmin?: any): Promise<Map<string, YouTubeMetadata>> {
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

export async function fetchTopicAnchors(
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

export async function fetchModuleResults(
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
  const precisionQueries = plan.precision.slice(0, 1);
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

  const allQueries = [...precisionQueries, ...expansionQueries];
  const combined = await runQueryBatch(allQueries);
  return combined;
}

// ─── Scoring Functions ───────────────────────────────────────────────────────

export function classifyAuthorityTier(candidate: CandidateResource, ytMeta?: YouTubeMetadata): { tier: AuthorityTier; reasonFlags: string[] } {
  const urlLower = candidate.url.toLowerCase();
  const reasonFlags: string[] = [];

  if (OFFICIAL_DOC_PATTERNS.some(d => urlLower.includes(d))) {
    reasonFlags.push("official_docs");
    return { tier: "OFFICIAL_DOCS", reasonFlags };
  }
  if (MAJOR_VENDOR_DOMAINS.some(d => urlLower.includes(d))) {
    reasonFlags.push("vendor_docs");
    return { tier: "VENDOR_DOCS", reasonFlags };
  }
  if (UNIVERSITY_DOMAINS.some(d => urlLower.includes(d))) {
    reasonFlags.push("university");
    return { tier: "UNIVERSITY_DIRECT", reasonFlags };
  }
  if (EDUCATION_DOMAINS.some(d => urlLower.includes(d))) {
    reasonFlags.push("education_platform");
    return { tier: "EDUCATION_DOMAIN", reasonFlags };
  }
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
  if (RECOGNIZED_BLOGS.some(d => urlLower.includes(d))) {
    reasonFlags.push("recognized_blog");
    return { tier: "BLOG", reasonFlags };
  }
  if (urlLower.includes(".edu")) {
    reasonFlags.push("edu_domain");
    return { tier: "EDUCATION_DOMAIN", reasonFlags };
  }
  if (COMMUNITY_DOMAINS.some(d => urlLower.includes(d))) {
    reasonFlags.push("community_site");
    return { tier: "COMMUNITY", reasonFlags };
  }
  return { tier: "UNKNOWN", reasonFlags: ["unknown_source"] };
}

export function computeLightAuthorityBump(candidate: CandidateResource, ytMeta?: YouTubeMetadata): void {
  const { tier, reasonFlags } = classifyAuthorityTier(candidate, ytMeta);
  const config = TIER_CONFIG[tier];
  const bump = Math.min(config.maxImpact, Math.round(config.norm * config.maxImpact));

  candidate.authority_tier = tier;
  candidate.authority_score_norm = config.norm;
  candidate.authority_score = bump;
  candidate.reason_flags = reasonFlags;
}

export function computeContextFitScoreFallback(candidate: CandidateResource, ctx: ModuleContext, ytMeta?: YouTubeMetadata): number {
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
    if (ytMeta.viewCount < 1_000 && !goalChannels.some(ch => ytMeta.channel.toLowerCase().includes(ch))) qualityFit = Math.max(qualityFit - 4, 0);
    else if (ytMeta.viewCount < 5_000 && !goalChannels.some(ch => ytMeta.channel.toLowerCase().includes(ch))) qualityFit = Math.max(qualityFit - 2, 0);
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

  let score = topicFit + goalFit + levelFit + timeFit + qualityFit + practicalityAdjust;
  score -= (candidate.scope_penalty || 0);
  return Math.max(0, Math.min(score, 100));
}

// ─── Merge & Deduplicate ─────────────────────────────────────────────────────

export function mergeAndDeduplicate(
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

export function enrichCandidatesWithYouTube(
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
      computeLightAuthorityBump(c);
      c.context_fit_score = computeContextFitScoreFallback(c, ctx);
      return true;
    }
    if (isDiscussionOrMetaResource(c.url, meta.title || c.title, "")) return false;
    if (isVideoLikelyOffTopic(meta.title || c.title, meta.channel || "", ctx)) return false;

    c.title = meta.title || c.title;
    c.estimated_minutes = Math.max(1, meta.durationMinutes || c.estimated_minutes);
    c.channel = meta.channel;
    c.view_count = meta.viewCount;
    c.like_count = meta.likeCount;
    c.source = "YouTube";
    c.quality_signal = `${formatViewCount(meta.viewCount)} views · ${meta.channel} · ${meta.durationMinutes} min`;

    computeLightAuthorityBump(c, meta);
    c.context_fit_score = computeContextFitScoreFallback(c, ctx, meta);

    return true;
  });
}

// ─── Selection ───────────────────────────────────────────────────────────────

export function clusterAndDiversify(candidates: CandidateResource[], ctx: ModuleContext): CandidateResource[] {
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

  const lowViewVideos = deduplicated.filter(c => c.type === "video" && (c.view_count || 0) < 1000);
  let selectionPool = deduplicated;
  if (lowViewVideos.length > 1) {
    const lowViewToRemove = new Set(lowViewVideos.slice(1).map(c => c.url));
    selectionPool = deduplicated.filter(c => !lowViewToRemove.has(c.url));
  }

  const maxResources = 5;
  const selected: CandidateResource[] = [];
  let totalMinutes = 0;
  const dailyCapMinutes = ctx.moduleMinutes * 1.1;

  for (const c of selectionPool) {
    if (selected.length >= maxResources) break;
    if (totalMinutes + c.estimated_minutes > dailyCapMinutes) continue;
    selected.push(c);
    totalMinutes += c.estimated_minutes;
  }

  if (selected.length === 0 && selectionPool.length > 0) {
    const fitting = selectionPool.filter(c => c.estimated_minutes <= dailyCapMinutes);
    if (fitting.length > 0) {
      selected.push(fitting[0]);
    } else {
      const shortest = [...selectionPool].sort((a, b) => a.estimated_minutes - b.estimated_minutes)[0];
      selected.push(shortest);
    }
  }

  return selected;
}
