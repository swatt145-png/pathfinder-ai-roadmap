import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function sanitizeControlCharsInJson(raw: string): string {
  let inString = false;
  let escaped = false;
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) { out += ch; escaped = false; continue; }
      if (ch === "\\") { out += ch; escaped = true; continue; }
      if (ch === "\"") { out += ch; inString = false; continue; }
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        if (ch === "\n") out += "\\n";
        else if (ch === "\r") out += "\\r";
        else if (ch === "\t") out += "\\t";
        else if (ch === "\b") out += "\\b";
        else if (ch === "\f") out += "\\f";
        else out += `\\u${code.toString(16).padStart(4, "0")}`;
        continue;
      }
      out += ch; continue;
    }
    if (ch === "\"") inString = true;
    out += ch;
  }
  return out;
}

function getMaxResourcesForModule(moduleHours: number): number {
  if (moduleHours <= 1.5) return 3;
  if (moduleHours <= 3) return 4;
  if (moduleHours <= 5) return 5;
  if (moduleHours <= 10) return 6;
  return 6;
}

function extractJsonCandidate(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) return content.slice(firstBrace, lastBrace + 1);
  return content;
}

function parseAiJson(content: unknown): any {
  if (typeof content === "object" && content !== null) return content;
  if (typeof content !== "string") throw new Error("AI returned unexpected response format");
  const attempts: string[] = [content];
  const extracted = extractJsonCandidate(content);
  if (extracted !== content) attempts.push(extracted);
  const sanitized = sanitizeControlCharsInJson(content);
  if (sanitized !== content) attempts.push(sanitized);
  const extractedSanitized = sanitizeControlCharsInJson(extracted);
  if (!attempts.includes(extractedSanitized)) attempts.push(extractedSanitized);
  let lastErr: unknown = null;
  for (const candidate of attempts) {
    try { return JSON.parse(candidate); } catch (e) { lastErr = e; }
  }
  throw new Error(`Unable to parse AI JSON response: ${lastErr instanceof Error ? lastErr.message : "Unknown parse error"}`);
}

function sanitizeRoadmapText(value: string): string {
  if (!value || typeof value !== "string") return value;
  const cleaned = value
    .replace(/\[([^\]]+)\]\((https?:\/\/(?:www\.)?google\.[^)]+)\)/gi, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/(?:www\.)?youtube\.com\/results[^)]*)\)/gi, "$1")
    .replace(/https?:\/\/(?:www\.)?google\.[^\s)]+/gi, "")
    .replace(/https?:\/\/(?:www\.)?youtube\.com\/results[^\s)]+/gi, "")
    .replace(/\b(?:google|youtube)\s+(?:search\s+)?link\b/gi, "")
    .replace(/\b(?:google|youtube)\s+(?:it|this|that)\b/gi, "")
    .replace(/\b(?:search|google|look up|find)\s+(?:on\s+)?(?:google|youtube|online|the web)\b[^.]*[.]?/gi, "")
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

function stripModuleQuizzes(roadmap: any): void {
  if (!roadmap || !Array.isArray(roadmap.modules)) return;
  for (const mod of roadmap.modules) {
    mod.quiz = [];
  }
}

// ─── YouTube API Enrichment ──────────────────────────────────────────────────

function parseISO8601Duration(iso8601: string): number {
  const match = iso8601.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  return parseInt(match?.[1] || '0') * 60 + parseInt(match?.[2] || '0') + (parseInt(match?.[3] || '0') > 0 ? 1 : 0);
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

const TECH_RELEVANCE_KEYWORDS = [
  "programming", "coding", "software", "developer", "engineer", "tutorial",
  "course", "learn", "code", "tech", "computer", "science", "data",
  "web", "app", "design", "system", "algorithm", "database", "server",
  "cloud", "devops", "api", "framework", "python", "javascript", "java",
  "react", "node", "sql", "html", "css", "machine learning", "ai",
  "network", "security", "linux", "docker", "kubernetes", "git",
  "interview", "architecture", "scalab", "distribut", "microservice",
  "load balanc", "cache", "proxy", "freecodecamp", "traversy", "fireship",
  "mosh", "sentdex", "corey schafer", "tech with tim", "net ninja", "cs50",
];

interface SerperWebResult { title: string; link: string; snippet: string; }
interface SerperVideoResult { title: string; link: string; duration?: string; }

const DISALLOWED_RESOURCE_DOMAINS = [
  "coursera.org",
  "coursera.com",
  "tiktok.com",
  "instagram.com",
  "facebook.com",
  "x.com",
  "twitter.com",
];

interface CandidateResource {
  title: string;
  url: string;
  type: "video" | "article" | "documentation" | "tutorial" | "practice";
  estimated_minutes: number;
  description: string;
  channel?: string;
  view_count?: number;
  like_count?: number;
  source?: string;
  quality_signal?: string;
  score: number;
  listing_penalty?: number;
}

const STACK_KEYWORDS: Record<string, string[]> = {
  react: ["react", "next.js", "nextjs"],
  vue: ["vue", "nuxt"],
  angular: ["angular"],
  svelte: ["svelte", "sveltekit"],
  node: ["node.js", "nodejs", "express"],
  python: ["python", "django", "flask", "fastapi"],
  java: ["java", "spring", "spring boot"],
  csharp: ["c#", ".net", "asp.net"],
  go: ["golang", "go"],
  rust: ["rust"],
};

function inferPreferredStack(topic: string, modules: any[]): string | null {
  const corpus = `${topic} ${(modules || []).map((m: any) => `${m.title || ""} ${m.description || ""}`).join(" ")}`.toLowerCase();
  for (const [stack, keywords] of Object.entries(STACK_KEYWORDS)) {
    if (keywords.some(k => corpus.includes(k))) return stack;
  }
  return null;
}

function detectMentionedStacks(text: string): string[] {
  const lower = text.toLowerCase();
  const matches: string[] = [];
  for (const [stack, keywords] of Object.entries(STACK_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) matches.push(stack);
  }
  return matches;
}

function normalizeQuery(q: string): string {
  return q.replace(/\s+/g, " ").trim();
}

function dedupeQueries(queries: string[]): string[] {
  return [...new Set(queries.map(normalizeQuery).filter(Boolean))];
}

function detectResourceType(url: string): CandidateResource["type"] {
  const lower = url.toLowerCase();
  if (["leetcode", "hackerrank", "codewars", "exercism", "freecodecamp.org/learn"].some(d => lower.includes(d))) return "practice";
  if (["docs.", "developer.", "developer.mozilla.org", "learn.microsoft.com", "kubernetes.io/docs", "react.dev"].some(d => lower.includes(d))) return "documentation";
  if (["freecodecamp", "khanacademy", "realpython", "digitalocean.com/community", "geeksforgeeks", "codecademy"].some(d => lower.includes(d))) return "tutorial";
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

function isAllowedResourceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.toLowerCase();
    if (DISALLOWED_RESOURCE_DOMAINS.some(d => host.includes(d))) return false;
    if (host === "google.com") return false;
    if (host.includes("google.") && path.startsWith("/search")) return false;
    return true;
  } catch {
    return false;
  }
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

function detectCertificationIntent(text: string): boolean {
  return /\b(certification|cert|exam|associate|professional|practitioner|architect)\b/i.test(text.toLowerCase());
}

function looksLikeListingPage(url: string, title: string, snippet: string): boolean {
  const text = `${url} ${title} ${snippet}`.toLowerCase();
  const signals = ["search", "results", "catalog", "paths", "course list", "browse courses", "certification path"];
  let hit = 0;
  for (const signal of signals) {
    if (text.includes(signal)) hit++;
  }
  return hit >= 2;
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

function enforceModuleTimeWindowConsistency(
  modules: any[],
  hoursPerDay: number,
  skipModuleIds: Set<string>
): void {
  if (!Array.isArray(modules) || modules.length === 0) return;
  const safeHoursPerDay = Math.max(Number(hoursPerDay || 0), 0.1);

  for (const mod of modules) {
    if (skipModuleIds.has(String(mod.id || ""))) continue;

    const dayStart = Math.max(1, Number(mod.day_start || 1));
    const dayEnd = Math.max(dayStart, Number(mod.day_end || dayStart));
    const moduleDays = Math.max(1, dayEnd - dayStart + 1);
    const windowHours = moduleDays * safeHoursPerDay;
    const capHours = Math.max(0.5, Math.round(windowHours * 10) / 10);
    const est = Number(mod.estimated_hours || 0.5);

    if (est > capHours * 1.05) mod.estimated_hours = capHours;
    else if (est < 0.5) mod.estimated_hours = 0.5;

    mod.day_start = dayStart;
    mod.day_end = dayEnd;
    mod.week = Math.max(1, Math.ceil(dayStart / 7));
  }
}

function getGoalSearchConfig(goal: string): { queryModifiers: string[]; semanticHint: string } {
  switch (goal) {
    case "conceptual":
      return { queryModifiers: ["explained", "theory", "lecture", "concepts"], semanticHint: "mental model explained with examples" };
    case "hands_on":
      return { queryModifiers: ["tutorial", "build", "project", "step by step"], semanticHint: "project based practical walkthrough" };
    case "quick_overview":
      return { queryModifiers: ["crash course", "quick guide", "overview", "essentials"], semanticHint: "high level summary key concepts" };
    case "deep_mastery":
      return { queryModifiers: ["advanced", "in depth", "comprehensive", "full course"], semanticHint: "deep dive architecture and tradeoffs" };
    default:
      return { queryModifiers: ["tutorial", "guide"], semanticHint: "clear explanation practical relevance" };
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

async function searchSerper(query: string, apiKey: string, type: "search" | "videos", num: number) {
  const url = type === "videos" ? "https://google.serper.dev/videos" : "https://google.serper.dev/search";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const data = await res.json();
    return type === "videos" ? (data.videos || []) : (data.organic || []);
  } catch {
    return [];
  }
}

async function fetchTopicAnchors(topic: string, level: string, goal: string, certificationIntent: boolean, serperKey: string): Promise<{ videos: SerperVideoResult[]; web: SerperWebResult[] }> {
  const levelMod = getLevelSearchModifier(level);
  const goalCfg = getGoalSearchConfig(goal);
  const goalMod = goalCfg.queryModifiers[0] || "";
  const certMod = certificationIntent ? "certification exam guide" : "";
  const queries = dedupeQueries([
    `${topic} ${goalMod} ${levelMod} ${goalCfg.semanticHint}`,
    `${topic} ${goalCfg.queryModifiers[1] || "guide"} practical examples ${levelMod}`,
    `${topic} ${goalCfg.queryModifiers[2] || "overview"} ${certMod}`,
    `${topic} direct tutorial lecture article`,
  ]);
  const promises: Promise<any>[] = [];
  for (const q of queries) {
    promises.push(searchSerper(q, serperKey, "videos", 10));
    promises.push(searchSerper(q, serperKey, "search", 8));
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

async function fetchModuleResults(module: any, topic: string, level: string, goal: string, certificationIntent: boolean, serperKey: string): Promise<{ videos: SerperVideoResult[]; web: SerperWebResult[] }> {
  const config = getGoalSearchConfig(goal);
  const levelMod = getLevelSearchModifier(level);
  const moduleTitle = module?.title || "";
  const anchorTerms = (module?.anchor_terms || []).slice(0, 3).join(" ");
  const objectiveTerms = (module?.learning_objectives || []).slice(0, 1).join(" ");
  const certMod = certificationIntent ? "certification objective" : "";

  const queries = dedupeQueries([
    `${moduleTitle} ${topic} ${anchorTerms} ${config.queryModifiers[0] || "explained"} ${levelMod} ${config.semanticHint}`,
    `${moduleTitle} ${topic} ${objectiveTerms} ${config.queryModifiers[1] || "tutorial"} ${certMod}`,
    `${moduleTitle} ${topic} ${config.queryModifiers[2] || "guide"} direct learning resource`,
  ]);

  const promises: Promise<any>[] = [];
  for (const q of queries) {
    promises.push(searchSerper(q, serperKey, "videos", 5));
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

function mergeAndDeduplicate(topicAnchors: { videos: SerperVideoResult[]; web: SerperWebResult[] }, moduleResults: { videos: SerperVideoResult[]; web: SerperWebResult[] }, moduleTitle: string): CandidateResource[] {
  const map = new Map<string, CandidateResource>();

  const pushVideo = (v: SerperVideoResult) => {
    if (!v.link) return;
    const normalizedUrl = v.link.split("&")[0];
    if (!isAllowedResourceUrl(normalizedUrl)) return;
    if (isDiscussionOrMetaResource(normalizedUrl, v.title || "Video tutorial", "")) return;
    if (map.has(normalizedUrl)) return;
    map.set(normalizedUrl, {
      title: v.title || "Video tutorial",
      url: normalizedUrl,
      type: "video",
      estimated_minutes: parseDurationToMinutes(v.duration),
      description: `Video on ${moduleTitle}`,
      score: 0,
    });
  };

  const pushWeb = (w: SerperWebResult) => {
    if (!w.link) return;
    if (!isAllowedResourceUrl(w.link)) return;
    if (isDiscussionOrMetaResource(w.link, w.title || "Learning resource", w.snippet || "")) return;
    if (w.link.includes("youtube.com/watch") || w.link.includes("youtu.be/")) return;
    if (map.has(w.link)) return;
    const listingLike = looksLikeListingPage(w.link, w.title || "", w.snippet || "");
    map.set(w.link, {
      title: w.title || "Learning resource",
      url: w.link,
      type: detectResourceType(w.link),
      estimated_minutes: estimateArticleMinutes(w.snippet || ""),
      description: w.snippet || `Resource for ${moduleTitle}`,
      score: 0,
      listing_penalty: listingLike ? 20 : 0,
    });
  };

  topicAnchors.videos.forEach(pushVideo);
  topicAnchors.web.forEach(pushWeb);
  moduleResults.videos.forEach(pushVideo);
  moduleResults.web.forEach(pushWeb);

  return [...map.values()];
}

function generateModuleAnchors(mod: any, topic: string): string[] {
  if (mod.anchor_terms && Array.isArray(mod.anchor_terms) && mod.anchor_terms.length > 0) {
    return mod.anchor_terms.map((t: string) => t.toLowerCase().trim());
  }
  const txt = `${mod.title || ""} ${mod.description || ""} ${((mod.learning_objectives || []) as string[]).join(" ")}`.toLowerCase();
  const words = txt.replace(/[^a-z0-9\s\-]/g, " ").split(/\s+/).filter(w => w.length > 3);
  return [...new Set(words)].filter(w => w !== topic.toLowerCase()).slice(0, 8);
}

function scoreCandidate(
  c: CandidateResource,
  mod: any,
  topic: string,
  goal: string,
  level: string,
  moduleMinutes: number,
  anchors: string[],
  preferredStack: string | null
): number {
  if (isDiscussionOrMetaResource(c.url, c.title, c.description)) return -1;
  const moduleText = `${topic} ${mod.title || ""} ${mod.description || ""} ${((mod.learning_objectives || []) as string[]).join(" ")} ${goal} ${level}`;
  const resourceText = `${c.title} ${c.description}`;
  const sim = computeSemanticSimilarity(moduleText, resourceText);
  if (sim < 0.03) return -1;

  if (anchors.length > 0) {
    const text = resourceText.toLowerCase();
    const hasAnchor = anchors.some(a => text.includes(a));
    if (!hasAnchor) {
      // Soft-penalize anchor misses instead of hard reject to avoid starving modules.
      // Semantic relevance still determines eligibility.
      // Penalty applied later in final score.
      c.listing_penalty = (c.listing_penalty || 0) + 12;
    }
  }

  const topicFit = Math.round(sim * 35);
  let goalFit = 10;
  if (goal === "conceptual" && (c.type === "video" || c.type === "documentation" || c.type === "article")) goalFit = 20;
  if (goal === "hands_on" && (c.type === "tutorial" || c.type === "practice" || c.type === "video")) goalFit = 20;
  if (goal === "quick_overview" && c.estimated_minutes <= 25) goalFit = 20;
  if (goal === "deep_mastery" && c.estimated_minutes >= 20) goalFit = 20;

  let levelFit = 8;
  const titleLower = c.title.toLowerCase();
  if (level === "beginner" && /beginner|intro|basic|fundamental|getting started/.test(titleLower)) levelFit = 15;
  if (level === "intermediate" && /intermediate|practical|pattern|use case/.test(titleLower)) levelFit = 15;
  if (level === "advanced" && /advanced|deep|expert|optimization|architecture/.test(titleLower)) levelFit = 15;

  let timeFit = 15;
  if (c.estimated_minutes > moduleMinutes * 1.2) timeFit = 6;
  if (c.estimated_minutes > moduleMinutes * 2) timeFit = 0;

  let qualityFit = looksLikeListingPage(c.url, c.title, c.description) ? 6 : 12;
  if (/freecodecamp|edx|learn.microsoft.com|aws|cloud\.google/i.test(c.url)) qualityFit = 15;

  if (goal === "hands_on" && preferredStack) {
    const mentioned = detectMentionedStacks(`${c.title} ${c.description}`);
    if (mentioned.length > 0) {
      if (mentioned.includes(preferredStack)) qualityFit = Math.min(qualityFit + 2, 15);
      else qualityFit = Math.max(qualityFit - 8, 0);
    }
  }

  if (detectCertificationIntent(`${topic} ${mod.title || ""}`) && /certification|exam|associate|professional/i.test(titleLower)) {
    qualityFit = Math.min(qualityFit + 2, 15);
  }

  let score = topicFit + goalFit + levelFit + timeFit + qualityFit;
  score -= c.listing_penalty || 0;
  return Math.max(0, Math.min(score, 100));
}

async function refreshResourcesForAdaptedRoadmap(
  roadmap: any,
  completedModuleIds: Set<string>,
  topic: string,
  level: string,
  goal: string,
  hoursPerDay: number,
  totalHours: number,
  serperKey: string
): Promise<void> {
  if (!serperKey || !roadmap?.modules?.length) return;
  const modules = roadmap.modules || [];
  const certificationIntent = detectCertificationIntent(topic);
  const preferredStack = goal === "hands_on" ? inferPreferredStack(topic, modules) : null;

  // Run topic anchors and all module searches in parallel
  const [topicAnchors, ...moduleResults] = await Promise.all([
    fetchTopicAnchors(topic, level, goal, certificationIntent, serperKey),
    ...modules.map((mod: any) => completedModuleIds.has(mod.id)
      ? Promise.resolve({ videos: [], web: [] })
      : fetchModuleResults(mod, topic, level, goal, certificationIntent, serperKey)),
  ]);

  const usedUrls = new Set<string>();
  const usedVideoIds = new Set<string>();
  const usableMinutes = totalHours * 60 * 0.85;
  let totalRoadmapMinutes = 0;

  for (const mod of modules) {
    for (const r of (mod.resources || [])) {
      const normalized = String(r.url || "").split("&")[0];
      if (!normalized) continue;
      usedUrls.add(normalized);
      const vid = extractYouTubeVideoId(normalized);
      if (vid) usedVideoIds.add(vid);
      totalRoadmapMinutes += Number(r.estimated_minutes || 0);
    }
  }

  for (let i = 0; i < modules.length; i++) {
    const mod = modules[i];
    if (completedModuleIds.has(mod.id)) continue;

    const moduleMinutes = Math.floor((mod.estimated_hours || 1) * 60);
    const dayStart = Number(mod.day_start || 1);
    const dayEnd = Number(mod.day_end || dayStart);
    const moduleDays = Math.max(1, dayEnd - dayStart + 1);
    const moduleBudgetCap = Math.min(moduleMinutes * 1.05, moduleDays * hoursPerDay * 60 * 1.1);
    const maxResources = getMaxResourcesForModule(Number(mod.estimated_hours || 1));
    const anchors = generateModuleAnchors(mod, topic);
    const candidates = mergeAndDeduplicate(topicAnchors, moduleResults[i], mod.title || "");

    const scored = candidates
      .map(c => ({ ...c, score: scoreCandidate(c, mod, topic, goal, level, moduleMinutes, anchors, preferredStack) }))
      .filter(c => c.score >= 0)
      .sort((a, b) => b.score - a.score);

    const selected: CandidateResource[] = [];
    let moduleTotal = 0;
    for (const c of scored) {
      if (selected.length >= maxResources) break;
      const normalized = c.url.split("&")[0];
      const videoId = extractYouTubeVideoId(normalized);
      if (usedUrls.has(normalized)) continue;
      if (videoId && usedVideoIds.has(videoId)) continue;
      if (moduleTotal + c.estimated_minutes > moduleBudgetCap) continue;
      if (totalRoadmapMinutes + c.estimated_minutes > usableMinutes) continue;
      selected.push(c);
      moduleTotal += c.estimated_minutes;
    }

    if (selected.length === 0 && scored.length > 0) {
      const shortest = scored
        .filter(c => totalRoadmapMinutes + c.estimated_minutes <= usableMinutes)
        .sort((a, b) => a.estimated_minutes - b.estimated_minutes)[0];
      if (shortest) {
        selected.push(shortest);
        moduleTotal = shortest.estimated_minutes;
      }
    }

    // Soft diversity rule: add one strong video when feasible.
    if (!selected.some(r => r.type === "video")) {
      const videoCandidate = scored.find(c => {
        const normalized = c.url.split("&")[0];
        const videoId = extractYouTubeVideoId(normalized);
        if (c.type !== "video") return false;
        if (usedUrls.has(normalized)) return false;
        if (videoId && usedVideoIds.has(videoId)) return false;
        if (moduleTotal + c.estimated_minutes > moduleBudgetCap) return false;
        if (totalRoadmapMinutes + moduleTotal + c.estimated_minutes > usableMinutes) return false;
        return true;
      });
      if (videoCandidate) {
        selected.push(videoCandidate);
        moduleTotal += videoCandidate.estimated_minutes;
      }
    }

    // Coverage repair for major mismatch: fill until 60% of module time if possible.
    const coverageTarget = moduleMinutes * 0.6;
    if (moduleTotal < coverageTarget) {
      for (const c of scored) {
        if (selected.some(s => s.url === c.url)) continue;
        const normalized = c.url.split("&")[0];
        const videoId = extractYouTubeVideoId(normalized);
        if (usedUrls.has(normalized)) continue;
        if (videoId && usedVideoIds.has(videoId)) continue;
        if (moduleTotal + c.estimated_minutes > moduleBudgetCap) continue;
        if (totalRoadmapMinutes + moduleTotal + c.estimated_minutes > usableMinutes) continue;
        selected.push(c);
        moduleTotal += c.estimated_minutes;
        if (moduleTotal >= coverageTarget) break;
      }
    }

    const cleaned = selected.filter(c =>
      isAllowedResourceUrl(c.url) &&
      !looksLikeListingPage(c.url, c.title, c.description) &&
      !isDiscussionOrMetaResource(c.url, c.title, c.description)
    );
    let finalized = [...cleaned];
    let finalizedMinutes = finalized.reduce((sum, r) => sum + Number(r.estimated_minutes || 0), 0);
    const hardCoverageTarget = Math.min(moduleBudgetCap, Math.max(20, moduleMinutes * 0.45));

    if (finalizedMinutes < hardCoverageTarget) {
      for (const c of scored) {
        if (finalized.length >= maxResources) break;
        if (finalized.some(r => r.url === c.url)) continue;
        const normalized = c.url.split("&")[0];
        const videoId = extractYouTubeVideoId(normalized);
        if (usedUrls.has(normalized)) continue;
        if (videoId && usedVideoIds.has(videoId)) continue;
        if (!isAllowedResourceUrl(c.url)) continue;
        if (looksLikeListingPage(c.url, c.title, c.description)) continue;
        if (isDiscussionOrMetaResource(c.url, c.title, c.description)) continue;
        if (finalizedMinutes + c.estimated_minutes > moduleBudgetCap) continue;
        if (totalRoadmapMinutes + finalizedMinutes + c.estimated_minutes > usableMinutes) continue;
        finalized.push(c);
        finalizedMinutes += c.estimated_minutes;
        if (finalizedMinutes >= hardCoverageTarget) break;
      }
    }

    // Hard cap: enforce duration-based max resources per module
    if (finalized.length > maxResources) {
      finalized.sort((a, b) => (b.score || 0) - (a.score || 0));
      finalized = finalized.slice(0, maxResources);
      finalizedMinutes = finalized.reduce((sum, r) => sum + Number(r.estimated_minutes || 0), 0);
    }

    for (const c of finalized) {
      const normalized = c.url.split("&")[0];
      usedUrls.add(normalized);
      const videoId = extractYouTubeVideoId(normalized);
      if (videoId) usedVideoIds.add(videoId);
    }

    mod.resources = finalized.map(c => ({
      title: c.title,
      url: c.url,
      type: c.type,
      estimated_minutes: c.estimated_minutes,
      description: c.description,
    }));

    totalRoadmapMinutes += finalizedMinutes;
  }
}

function isVideoRelevant(title: string, channel: string, moduleTitle: string, topic: string): boolean {
  const combined = `${title} ${channel}`.toLowerCase();
  const searchContext = `${moduleTitle} ${topic}`.toLowerCase();
  const topicWords = searchContext.split(/\s+/).filter(w => w.length > 3);
  const matchCount = topicWords.filter(w => combined.includes(w)).length;
  const similarity = computeSemanticSimilarity(searchContext, combined);
  const hashtagCount = (combined.match(/#[a-z0-9_]+/g) || []).length;
  const socialShortsSignal = /\b(tiktok|reels|shorts|vlog|trend|viral)\b/i.test(combined);
  if (matchCount >= 2) return true;
  const hasTechSignal = TECH_RELEVANCE_KEYWORDS.some(kw => combined.includes(kw));
  if (hasTechSignal && matchCount >= 1) return true;
  if (similarity < 0.1 && matchCount === 0) return false;
  if (hashtagCount >= 3 && similarity < 0.16 && matchCount === 0) return false;
  if (socialShortsSignal && similarity < 0.2 && matchCount === 0) return false;
  if (matchCount === 0 && !hasTechSignal) return false;
  return true;
}

async function enrichRoadmapYouTube(roadmap: any, apiKey: string): Promise<void> {
  if (!roadmap?.modules || !apiKey) return;
  const topic = roadmap.topic || "";
  const videoIds = new Set<string>();
  for (const mod of roadmap.modules) {
    for (const r of (mod.resources || [])) {
      if (r.type === "video" || (r.url && r.url.includes("youtube"))) {
        const id = extractYouTubeVideoId(r.url);
        if (id) videoIds.add(id);
      }
    }
  }
  if (videoIds.size === 0) return;

  const ids = [...videoIds];
  const metaMap = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50).join(",");
    try {
      const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${batch}&key=${apiKey}`);
      if (!res.ok) { console.warn(`YouTube API error: ${res.status}`); return; }
      const data = await res.json();
      for (const item of (data.items || [])) {
        metaMap.set(item.id, {
          title: item.snippet?.title, channel: item.snippet?.channelTitle,
          durationMinutes: parseISO8601Duration(item.contentDetails?.duration || "PT0S"),
          viewCount: parseInt(item.statistics?.viewCount || "0"),
          likeCount: parseInt(item.statistics?.likeCount || "0"),
        });
      }
    } catch (e) { console.error("YouTube API error in adapt:", e); return; }
  }

  for (const mod of roadmap.modules) {
    mod.resources = (mod.resources || []).filter((r: any) => {
      const id = extractYouTubeVideoId(r.url);
      if (!id) return true;
      const meta = metaMap.get(id);
      if (!meta) return true; // Keep video even without metadata (API may have failed)
      if (!isVideoRelevant(meta.title, meta.channel, mod.title, topic)) {
        console.warn(`Excluding off-topic video: "${meta.title}" by ${meta.channel}`);
        return false;
      }
      if (isDiscussionOrMetaResource(r.url, meta.title || r.title || "", "")) {
        return false;
      }
      r.title = meta.title || r.title;
      r.estimated_minutes = Math.max(1, meta.durationMinutes || r.estimated_minutes);
      r.channel = meta.channel;
      r.view_count = meta.viewCount;
      r.like_count = meta.likeCount;
      r.source = "YouTube";
      r.quality_signal = `${formatViewCount(meta.viewCount)} views · ${meta.channel} · ${meta.durationMinutes} min`;
      return true;
    });
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { createClient: createAuthClient } = await import("npm:@supabase/supabase-js@2");
    const supabaseAuth = createAuthClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: authUser }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !authUser) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { roadmap_data, all_progress, new_timeline_weeks, new_timeline_days, new_hours_per_day, learning_goal } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
    const SERPER_API_KEY = Deno.env.get("SERPER_API_KEY") || "";
    const YOUTUBE_API_KEY = Deno.env.get("YOUTUBE_API_KEY") || "";

    const effectiveGoal = learning_goal || "hands_on";

    // Support both days and weeks input; prefer days
    const rawDays = new_timeline_days != null ? Number(new_timeline_days) : (Number(new_timeline_weeks) * 7);
    const hrsPerDay = Number(new_hours_per_day);
    const totalAvailableHours = rawDays === 0 ? hrsPerDay : rawDays * hrsPerDay;
    const displayDays = rawDays === 0 ? 1 : rawDays;

    const completedModules = all_progress?.filter((p: any) => p.status === "completed") || [];
    const remainingModules = roadmap_data.modules.filter((m: any) =>
      !completedModules.some((p: any) => p.module_id === m.id)
    );
    const remainingHours = remainingModules.reduce((sum: number, m: any) => sum + (m.estimated_hours || 0), 0);

    const completedModuleIds = completedModules.map((p: any) => p.module_id);
    const completedModulesData = roadmap_data.modules.filter((m: any) => completedModuleIds.includes(m.id));
    const totalCompletedHours = completedModulesData.reduce((sum: number, m: any) => sum + (m.estimated_hours || 0), 0);
    const totalDaysCompleted = completedModulesData.length;

    const isCrashCourse = totalAvailableHours < remainingHours;
    const isSplit = !isCrashCourse && hrsPerDay < remainingHours && displayDays > 1;

    let strategyInstruction: string;
    if (isCrashCourse) {
      strategyInstruction = `STRATEGY: CRASH COURSE (user has ${totalAvailableHours}h but needs ${remainingHours}h — LESS time available).
You MUST condense all remaining modules to fit within exactly ${totalAvailableHours}h total.
- Prefer FEWER, denser modules over many tiny modules for short deadlines. You MAY merge adjacent remaining modules if that improves clarity and quality.
- The total estimated_hours of ALL remaining modules combined MUST equal ${totalAvailableHours}h (not more).
- Each remaining module fits within ${displayDays} day(s) at ${hrsPerDay}h/day.
- timeline_days in the response = ${totalDaysCompleted + displayDays}.`;
    } else if (isSplit) {
      const numChunks = Math.ceil(remainingHours / hrsPerDay);
      strategyInstruction = `STRATEGY: SPLIT MODULES (user has ${totalAvailableHours}h across ${displayDays} days at ${hrsPerDay}h/day — enough time but fewer hours per day).
- SPLIT each remaining module into daily chunks of ${hrsPerDay}h each.
- A ${remainingHours}h module becomes ${numChunks} modules of ~${hrsPerDay}h each.
- Give each split module a unique id (original_id + "_part1", "_part2", etc.) and its own subset of resources.
- Day numbering for adapted modules starts at day ${totalDaysCompleted + 1}.
- timeline_days in the response = ${totalDaysCompleted + numChunks}.`;
    } else {
      strategyInstruction = `STRATEGY: REDISTRIBUTE (user has enough time — ${totalAvailableHours}h available for ${remainingHours}h of content).
- Keep existing modules and resources as-is, just update day_start/day_end/week fields.
- timeline_days in the response = ${totalDaysCompleted + displayDays}.`;
    }

    const goalContext = effectiveGoal === "conceptual"
      ? "The student's learning goal is CONCEPTUAL. When replacing or adding resources, prefer lectures, explainer videos, and theory articles."
      : effectiveGoal === "hands_on"
      ? "The student's learning goal is HANDS-ON. When replacing or adding resources, prefer coding tutorials, exercises, and project-based content."
      : effectiveGoal === "quick_overview"
      ? "The student's learning goal is QUICK OVERVIEW. When replacing or adding resources, prefer crash courses, cheat sheets, and summary content."
      : effectiveGoal === "deep_mastery"
      ? "The student's learning goal is DEEP MASTERY. When replacing or adding resources, prefer comprehensive courses, official docs, and advanced tutorials."
      : "";

    const systemPrompt = `You are a concise learning-plan optimizer. Address the user directly ("you/your"). Keep all text crisp — no filler.

${goalContext}

RULES:
- The updated_roadmap MUST include ALL modules: both completed and adapted. Do NOT omit completed modules.
- Completed modules (IDs: ${JSON.stringify(completedModuleIds)}) MUST appear first in the modules array, completely unchanged — same id, title, resources, estimated_hours, day_start, day_end, week.
- For adapted modules, focus on structure and timing correctness; resources will be re-curated by the pipeline after adaptation.
${strategyInstruction}
- total_hours in updated_roadmap = ${totalCompletedHours} (completed) + adapted remaining hours
- timeline_weeks = ceil(total_days / 7)
- hours_per_day = ${hrsPerDay}
- modules_kept = total number of modules in the final roadmap (completed + adapted)
- MODULE COUNT LIMIT: The total number of remaining (non-completed) modules must follow this formula based on remaining hours (R = total remaining hours):
  - If R ≤ 12: max remaining modules = floor(R / 2)
  - If 12 < R ≤ 50: max remaining modules = floor(R / 3)
  - If R > 50: max remaining modules = floor(R / 4)
  - Do NOT create more modules than this allows. Each adapted module must have meaningful content and enough hours for resources to be assigned.
  - Minimum module duration: 1 hour. Never create modules shorter than 1 hour.
- Keep analysis to 1-2 sentences`;

    const userPrompt = `Completed: ${completedModules.length}/${roadmap_data.modules.length} modules (${remainingModules.length} remaining, ~${remainingHours}h of content).
Available: ${displayDays} day(s), ${hrsPerDay}h/day (${totalAvailableHours}h total).
Learning Goal: ${effectiveGoal}

Current roadmap: ${JSON.stringify({
      ...roadmap_data,
      modules: (roadmap_data.modules || []).map((m: any) => ({
        id: m.id,
        title: m.title,
        description: m.description,
        estimated_hours: m.estimated_hours,
        day_start: m.day_start,
        day_end: m.day_end,
        week: m.week,
        prerequisites: m.prerequisites,
        learning_objectives: m.learning_objectives,
        anchor_terms: m.anchor_terms,
      })),
    })}
Progress: ${JSON.stringify(all_progress)}

Return ONLY valid JSON:
{
  "analysis": "1-2 sentence summary of the situation and what the adapted plan does",
  "options": [
    {
      "id": "adapted_plan",
      "label": "Adapted Plan",
      "description": "1 sentence describing how the plan was adapted",
      "timeline_days": number,
      "hours_per_day": number,
      "total_remaining_hours": number,
      "modules_kept": number,
      "modules_removed": [],
      "modules_added": [],
      "tradeoff": "1 sentence about what changed",
      "updated_roadmap": { full roadmap JSON with same structure, with adapted remaining modules and REPLACED/SPLIT resources as needed }
    }
  ],
  "recommendation": "adapted_plan",
  "recommendation_reason": "1 sentence"
}`;
    const aiController = new AbortController();
    const moduleCount = roadmap_data.modules?.length || 0;
    const aiTimeoutMs = Math.min(120000, 45000 + Math.max(0, moduleCount - 6) * 8000);
    const aiTimeout = setTimeout(() => aiController.abort(), aiTimeoutMs);
    let response: Response;
    try {
      response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-3-pro-preview",
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
          response_format: { type: "json_object" },
        }),
        signal: aiController.signal,
      });
    } catch (e: any) {
      clearTimeout(aiTimeout);
      if (e.name === "AbortError") throw new Error(`AI call timed out after ${Math.round(aiTimeoutMs / 1000)}s`);
      throw e;
    }
    clearTimeout(aiTimeout);

    if (!response.ok) {
      if (response.status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (response.status === 402) return new Response(JSON.stringify({ error: "Usage limit reached" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error("AI call failed");
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    let result: any;
    try {
      result = parseAiJson(content);
    } catch {
      result = {
        analysis: "Couldn't generate options automatically. Your current plan is preserved.",
        options: [{
          id: "option_a", label: "Keep Current Plan",
          description: "Continue with your current roadmap.",
          timeline_days: displayDays, hours_per_day: Number(new_hours_per_day),
          total_remaining_hours: totalAvailableHours,
          modules_kept: Array.isArray(roadmap_data?.modules) ? roadmap_data.modules.length : 0,
          modules_removed: [], modules_added: [],
          tradeoff: "No changes applied.", updated_roadmap: roadmap_data,
        }],
        recommendation: "option_a",
        recommendation_reason: "Fallback to avoid interruption.",
      };
    }

    // Rebuild resources for adapted modules with deterministic retrieval/ranking pipeline
    const roadmapTopic = roadmap_data?.topic || "Learning Topic";
    const roadmapLevel = roadmap_data?.skill_level || "beginner";
    const completedModuleIdSet = new Set<string>(completedModuleIds);

    if (result.options) {
      for (const opt of result.options) {
        if (opt.updated_roadmap) {
          stripModuleQuizzes(opt.updated_roadmap);
          sanitizeRoadmapPlaceholders(opt.updated_roadmap);
          enforceModuleTimeWindowConsistency(
            opt.updated_roadmap.modules || [],
            hrsPerDay,
            completedModuleIdSet
          );
          if (Array.isArray(opt.updated_roadmap.modules)) {
            opt.updated_roadmap.total_hours = Math.round(
              opt.updated_roadmap.modules.reduce((sum: number, m: any) => sum + Number(m.estimated_hours || 0), 0) * 10
            ) / 10;
          }
          // Enforce module count limit on remaining modules before resource refresh
          if (Array.isArray(opt.updated_roadmap.modules)) {
            const remainingMods = opt.updated_roadmap.modules.filter((m: any) => !completedModuleIdSet.has(m.id));
            const remainingHrs = remainingMods.reduce((sum: number, m: any) => sum + Number(m.estimated_hours || 0), 0);
            let maxRemaining: number;
            if (remainingHrs <= 12) maxRemaining = Math.max(1, Math.floor(remainingHrs / 2));
            else if (remainingHrs <= 50) maxRemaining = Math.max(4, Math.floor(remainingHrs / 3));
            else maxRemaining = Math.max(6, Math.floor(remainingHrs / 4));

            if (remainingMods.length > maxRemaining) {
              // Merge excess trailing modules into the last kept module
              const completedMods = opt.updated_roadmap.modules.filter((m: any) => completedModuleIdSet.has(m.id));
              const keptRemaining = remainingMods.slice(0, maxRemaining);
              const excessMods = remainingMods.slice(maxRemaining);
              if (keptRemaining.length > 0 && excessMods.length > 0) {
                const lastKept = keptRemaining[keptRemaining.length - 1];
                for (const ex of excessMods) {
                  lastKept.estimated_hours = Number(lastKept.estimated_hours || 0) + Number(ex.estimated_hours || 0);
                  lastKept.day_end = Math.max(Number(lastKept.day_end || 1), Number(ex.day_end || 1));
                  lastKept.learning_objectives = [...new Set([...(lastKept.learning_objectives || []), ...(ex.learning_objectives || [])])].slice(0, 8);
                  lastKept.anchor_terms = [...new Set([...(lastKept.anchor_terms || []), ...(ex.anchor_terms || [])])].slice(0, 8);
                }
              }
              opt.updated_roadmap.modules = [...completedMods, ...keptRemaining];
            }

            // Enforce minimum 1h per remaining module — merge tiny modules into neighbors
            const finalRemaining = opt.updated_roadmap.modules.filter((m: any) => !completedModuleIdSet.has(m.id));
            for (let ri = finalRemaining.length - 1; ri >= 0; ri--) {
              if (Number(finalRemaining[ri].estimated_hours || 0) < 1 && finalRemaining.length > 1) {
                const mergeTarget = ri > 0 ? finalRemaining[ri - 1] : finalRemaining[ri + 1];
                mergeTarget.estimated_hours = Number(mergeTarget.estimated_hours || 0) + Number(finalRemaining[ri].estimated_hours || 0);
                mergeTarget.day_end = Math.max(Number(mergeTarget.day_end || 1), Number(finalRemaining[ri].day_end || 1));
                mergeTarget.learning_objectives = [...new Set([...(mergeTarget.learning_objectives || []), ...(finalRemaining[ri].learning_objectives || [])])].slice(0, 8);
                mergeTarget.anchor_terms = [...new Set([...(mergeTarget.anchor_terms || []), ...(finalRemaining[ri].anchor_terms || [])])].slice(0, 8);
                const modIdx = opt.updated_roadmap.modules.indexOf(finalRemaining[ri]);
                if (modIdx >= 0) opt.updated_roadmap.modules.splice(modIdx, 1);
                finalRemaining.splice(ri, 1);
              }
            }

            // Recalculate total_hours after merging
            opt.updated_roadmap.total_hours = Math.round(
              opt.updated_roadmap.modules.reduce((sum: number, m: any) => sum + Number(m.estimated_hours || 0), 0) * 10
            ) / 10;
          }

          await refreshResourcesForAdaptedRoadmap(
            opt.updated_roadmap,
            completedModuleIdSet,
            roadmapTopic,
            roadmapLevel,
            effectiveGoal,
            hrsPerDay,
            totalCompletedHours + Number(opt.total_remaining_hours || totalAvailableHours),
            SERPER_API_KEY
          );

          // Safety net: if any non-completed module still has 0 resources, log a warning
          // and ensure the module at least has anchor_terms for future resource fetching
          if (Array.isArray(opt.updated_roadmap.modules)) {
            for (const mod of opt.updated_roadmap.modules) {
              if (completedModuleIdSet.has(mod.id)) continue;
              if (!mod.resources || mod.resources.length === 0) {
                console.warn(`[adapt] Module "${mod.title}" (${mod.id}) has 0 resources after refresh — ensuring anchor_terms exist`);
                if (!mod.anchor_terms || mod.anchor_terms.length === 0) {
                  const words = `${mod.title || ""} ${mod.description || ""}`.toLowerCase()
                    .replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w: string) => w.length > 3);
                  mod.anchor_terms = [...new Set(words)].slice(0, 6);
                }
              }
            }
          }
        }
      }
    }

    // Enrich YouTube URLs after curation
    if (YOUTUBE_API_KEY && result.options) {
      for (const opt of result.options) {
        if (opt.updated_roadmap) {
          await enrichRoadmapYouTube(opt.updated_roadmap, YOUTUBE_API_KEY);
        }
      }
    }

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("adapt-roadmap error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
