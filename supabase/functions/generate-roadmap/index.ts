import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface SerperWebResult { title: string; link: string; snippet: string; }
interface SerperVideoResult { title: string; link: string; duration?: string; }
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

// ─── Tiered Resource Prioritization ──────────────────────────────────────────

// TIER 1: Always prioritize regardless of learning goal
const TIER1_DOMAINS = [
  "freecodecamp.org", "cs50.harvard.edu", "ocw.mit.edu",
  "khanacademy.org", "developer.mozilla.org",
];

// Official documentation domains (always tier 1 for their technology)
const OFFICIAL_DOC_PATTERNS = [
  "python.org/doc", "docs.python.org", "react.dev", "vuejs.org",
  "angular.io/docs", "docs.docker.com", "kubernetes.io/docs",
  "go.dev/doc", "doc.rust-lang.org", "docs.oracle.com",
  "learn.microsoft.com", "developer.apple.com",
];

// TIER 2: Prioritize based on learning goal

interface GoalResources {
  youtubeChannels: string[];
  coursePlatforms: string[];
  practicePlatforms: string[];
  articleSites: string[];
  siteFilters: string[]; // for Serper site: queries
}

const GOAL_RESOURCES: Record<string, GoalResources> = {
  quick_overview: {
    youtubeChannels: ["fireship", "networkchuck", "techworld with nana"],
    coursePlatforms: ["codecademy.com"],
    practicePlatforms: [],
    articleSites: ["dev.to", "w3schools.com"],
    siteFilters: [
      "site:youtube.com fireship", "site:youtube.com networkchuck",
      "site:youtube.com techworld with nana", "site:codecademy.com",
      "site:dev.to", "site:w3schools.com", "site:freecodecamp.org",
    ],
  },
  hands_on: {
    youtubeChannels: [
      "traversy media", "web dev simplified", "tech with tim",
      "net ninja", "programming with mosh", "javascript mastery",
    ],
    coursePlatforms: ["udemy.com", "codecademy.com", "theodinproject.com"],
    practicePlatforms: ["leetcode.com", "hackerrank.com", "exercism.org", "sqlzoo.net"],
    articleSites: ["digitalocean.com", "realpython.com", "geeksforgeeks.org", "w3schools.com"],
    siteFilters: [
      "site:youtube.com traversy media", "site:youtube.com web dev simplified",
      "site:youtube.com programming with mosh", "site:udemy.com",
      "site:codecademy.com", "site:theodinproject.com",
      "site:realpython.com", "site:digitalocean.com/community/tutorials",
      "site:freecodecamp.org",
    ],
  },
  conceptual: {
    youtubeChannels: [
      "3blue1brown", "cs dojo", "computerphile", "corey schafer",
    ],
    coursePlatforms: ["coursera.org", "edx.org", "khanacademy.org"],
    practicePlatforms: [],
    articleSites: ["geeksforgeeks.org", "realpython.com"],
    siteFilters: [
      "site:youtube.com 3blue1brown", "site:youtube.com cs dojo",
      "site:youtube.com computerphile", "site:youtube.com corey schafer",
      "site:coursera.org", "site:edx.org", "site:khanacademy.org",
      "site:freecodecamp.org", "site:ocw.mit.edu",
    ],
  },
  deep_mastery: {
    youtubeChannels: [
      "freecodecamp", "sentdex", "the coding train",
    ],
    coursePlatforms: ["coursera.org", "edx.org", "ocw.mit.edu"],
    practicePlatforms: ["leetcode.com", "hackerrank.com", "exercism.org", "sqlzoo.net"],
    articleSites: ["realpython.com", "digitalocean.com", "geeksforgeeks.org"],
    siteFilters: [
      "site:youtube.com freecodecamp", "site:youtube.com sentdex",
      "site:coursera.org", "site:edx.org", "site:ocw.mit.edu",
      "site:realpython.com", "site:digitalocean.com/community/tutorials",
      "site:freecodecamp.org",
    ],
  },
};

// Anti-pattern domains to deprioritize or skip
const DEPRIORITIZE_DOMAINS = [
  "tutorialspoint.com", "javatpoint.com",
];

// All known good domains (for general trust check)
const ALL_TRUSTED_DOMAINS = [
  ...TIER1_DOMAINS, ...OFFICIAL_DOC_PATTERNS,
  "youtube.com", "youtu.be", "coursera.org", "udemy.com", "edx.org",
  "codecademy.com", "theodinproject.com",
  "leetcode.com", "hackerrank.com", "sqlzoo.net", "exercism.org",
  "w3schools.com", "realpython.com", "digitalocean.com",
  "geeksforgeeks.org", "stackoverflow.com", "reddit.com",
  "dev.to",
];

// All known YouTube channels (for general channel trust check)
const ALL_YOUTUBE_CHANNELS = [
  "freecodecamp", "traversy media", "fireship", "networkchuck", "cs dojo",
  "corey schafer", "web dev simplified", "tech with tim", "techworld with nana",
  "3blue1brown", "sentdex", "programming with mosh", "the coding train",
  "net ninja", "javascript mastery", "computerphile", "cs50",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function detectResourceType(url: string): Resource["type"] {
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

  // Batch in groups of 50
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

function enrichResourcesWithYouTube(resources: Resource[], ytMap: Map<string, YouTubeMetadata>): Resource[] {
  return resources.filter(r => {
    if (r.type !== "video") return true;
    const videoId = extractYouTubeVideoId(r.url);
    if (!videoId) return true; // non-YouTube video, keep
    const meta = ytMap.get(videoId);
    if (!meta) return false; // video not found (deleted/private), exclude
    r.title = meta.title || r.title;
    r.estimated_minutes = meta.durationMinutes || r.estimated_minutes;
    r.channel = meta.channel;
    r.view_count = meta.viewCount;
    r.like_count = meta.likeCount;
    r.source = "YouTube";
    r.quality_signal = `${formatViewCount(meta.viewCount)} views · ${meta.channel} · ${meta.durationMinutes} min`;
    return true;
  });
}

function isDisqualified(title: string, url: string): boolean {
  const spamSignals = /\b(top \d+ best|best \d+|you won't believe|clickbait)\b/i;
  if (spamSignals.test(title)) return true;
  // Deprioritized/anti-pattern domains
  if (DEPRIORITIZE_DOMAINS.some(d => url.toLowerCase().includes(d))) return true;
  // AI content farm signals
  if (/\b(ai generated|content farm)\b/i.test(title)) return true;
  return false;
}

function estimateArticleMinutes(snippet: string): number {
  const wordCount = snippet ? snippet.split(/\s+/).length : 0;
  if (wordCount > 80) return 15;
  return 10;
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

// ─── Goal-Aware Search Config ────────────────────────────────────────────────

interface GoalSearchConfig {
  queryModifiers: string[];
  videoCount: number;
  webCount: number;
  targetMix: { videos: number; articles: number; practice: number };
  maxResourcesPerModule: number;
  minResourcesPerModule: number;
}

function getGoalSearchConfig(goal: string): GoalSearchConfig {
  switch (goal) {
    case "conceptual":
      return {
        queryModifiers: ["explained", "how does it work", "concepts", "theory", "lecture", "introduction"],
        videoCount: 8, webCount: 6,
        targetMix: { videos: 2, articles: 2, practice: 0 },
        maxResourcesPerModule: 5, minResourcesPerModule: 3,
      };
    case "hands_on":
      return {
        queryModifiers: ["tutorial", "build", "project", "practice", "exercise", "hands-on", "step by step", "code along"],
        videoCount: 6, webCount: 8,
        targetMix: { videos: 1, articles: 1, practice: 1 },
        maxResourcesPerModule: 5, minResourcesPerModule: 3,
      };
    case "quick_overview":
      return {
        queryModifiers: ["crash course", "in 10 minutes", "quick guide", "overview", "cheat sheet", "essentials"],
        videoCount: 6, webCount: 4,
        targetMix: { videos: 1, articles: 1, practice: 0 },
        maxResourcesPerModule: 3, minResourcesPerModule: 2,
      };
    case "deep_mastery":
      return {
        queryModifiers: ["complete guide", "comprehensive", "advanced", "in depth", "best practices", "full course", "masterclass"],
        videoCount: 6, webCount: 8,
        targetMix: { videos: 2, articles: 1, practice: 1 },
        maxResourcesPerModule: 5, minResourcesPerModule: 3,
      };
    default:
      return {
        queryModifiers: ["tutorial", "guide"],
        videoCount: 6, webCount: 6,
        targetMix: { videos: 1, articles: 1, practice: 0 },
        maxResourcesPerModule: 5, minResourcesPerModule: 3,
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

// ─── Resource Scoring & Selection ────────────────────────────────────────────

function scoreResource(
  res: Resource,
  moduleTitle: string,
  goal: string,
  level: string,
  config: GoalSearchConfig,
  moduleMinutes: number
): number {
  let score = 0;
  const urlLower = res.url.toLowerCase();
  const titleLower = res.title.toLowerCase();
  const goalRes = GOAL_RESOURCES[goal] || GOAL_RESOURCES["hands_on"];

  // CRITERION 1: RELEVANCE — title/description must relate to module
  const moduleLower = moduleTitle.toLowerCase();
  const moduleWords = moduleLower.split(/\s+/).filter(w => w.length > 3);
  const matchingWords = moduleWords.filter(w => titleLower.includes(w));
  score += matchingWords.length * 15;

  // Goal fit
  if (goal === "conceptual" && (res.type === "video" || res.type === "documentation")) score += 10;
  if (goal === "hands_on" && (res.type === "tutorial" || res.type === "practice")) score += 10;
  if (goal === "quick_overview" && res.estimated_minutes <= 20) score += 10;
  if (goal === "deep_mastery" && res.estimated_minutes >= 20) score += 10;

  // Level fit
  if (level === "beginner" && res.type === "video") score += 5;
  if (level === "advanced" && (res.type === "documentation" || res.type === "article")) score += 5;

  // CRITERION 2: SOURCE TRUST (tiered)
  // Tier 1: universal priority (+25)
  const isTier1 = TIER1_DOMAINS.some(d => urlLower.includes(d));
  const isOfficialDoc = OFFICIAL_DOC_PATTERNS.some(d => urlLower.includes(d));
  if (isTier1) score += 25;
  if (isOfficialDoc) score += 25;

  // Tier 2: goal-specific priority (+20)
  const isGoalChannel = goalRes.youtubeChannels.some(ch => titleLower.includes(ch));
  const isGoalPlatform = goalRes.coursePlatforms.some(p => urlLower.includes(p));
  const isGoalPractice = goalRes.practicePlatforms.some(p => urlLower.includes(p));
  const isGoalArticle = goalRes.articleSites.some(s => urlLower.includes(s));
  if (isGoalChannel) score += 20;
  if (isGoalPlatform) score += 18;
  if (isGoalPractice) score += 18;
  if (isGoalArticle) score += 15;

  // Known good but not goal-specific (+10)
  const isAnyTrusted = ALL_TRUSTED_DOMAINS.some(d => urlLower.includes(d));
  const isAnyKnownChannel = ALL_YOUTUBE_CHANNELS.some(ch => titleLower.includes(ch));
  if (!isTier1 && !isOfficialDoc && !isGoalPlatform && !isGoalArticle && isAnyTrusted) score += 10;
  if (!isGoalChannel && isAnyKnownChannel) score += 10;

  // Unknown source penalty
  if (!isAnyTrusted && !isAnyKnownChannel) score -= 8;

  // Reddit community resource (include max 1 per roadmap, handled in selection)
  if (urlLower.includes("reddit.com")) score += 5;

  // CRITERION 3: TIME FIT
  const ratio = res.estimated_minutes / moduleMinutes;
  if (ratio >= 0.1 && ratio <= 0.5) score += 10;
  else if (ratio > 0.5 && ratio <= 0.8) score += 5;
  else if (ratio > 0.8) score -= 5;

  return score;
}

function selectResources(
  candidates: Resource[],
  moduleTitle: string,
  goal: string,
  level: string,
  config: GoalSearchConfig,
  moduleMinutes: number
): Resource[] {
  const scored = candidates.map(r => ({
    resource: r,
    score: scoreResource(r, moduleTitle, goal, level, config, moduleMinutes),
  }));
  scored.sort((a, b) => b.score - a.score);

  const selected: Resource[] = [];
  let totalMinutes = 0;
  const typeCounts: Record<string, number> = { video: 0, article: 0, documentation: 0, tutorial: 0, practice: 0 };

  for (const { resource } of scored) {
    if (selected.length >= config.maxResourcesPerModule) break;
    if (totalMinutes + resource.estimated_minutes > moduleMinutes * 1.15) continue;

    const typeGroup = resource.type === "documentation" || resource.type === "tutorial" ? "articles" : resource.type === "practice" ? "practice" : "videos";
    const targetForType = (config.targetMix as any)[typeGroup] || 2;
    const currentOfType = typeGroup === "articles"
      ? (typeCounts["article"] + typeCounts["documentation"] + typeCounts["tutorial"])
      : typeGroup === "videos" ? typeCounts["video"] : typeCounts["practice"];
    if (currentOfType >= targetForType + 1) continue;

    selected.push(resource);
    totalMinutes += resource.estimated_minutes;
    typeCounts[resource.type] = (typeCounts[resource.type] || 0) + 1;
  }

  // Scale resource estimates to fill ~85% of module time if underfilled
  if (selected.length > 0 && totalMinutes < moduleMinutes * 0.6) {
    const scale = Math.min(moduleMinutes * 0.85 / totalMinutes, 3);
    for (const res of selected) {
      res.estimated_minutes = Math.round(res.estimated_minutes * scale);
    }
  }

  // Fill to minimum if needed
  if (selected.length < config.minResourcesPerModule) {
    for (const { resource } of scored) {
      if (selected.includes(resource)) continue;
      if (selected.length >= config.minResourcesPerModule) break;
      selected.push(resource);
    }
  }

  return selected;
}

// ─── Fetch Resources for a Module ────────────────────────────────────────────

async function fetchResourcesForModule(
  moduleTitle: string,
  topic: string,
  skillLevel: string,
  apiKey: string,
  moduleHours: number,
  learningGoal: string
): Promise<Resource[]> {
  const config = getGoalSearchConfig(learningGoal);
  const moduleMinutes = Math.floor(moduleHours * 60);
  const levelMod = getLevelSearchModifier(skillLevel);
  const goalMod = config.queryModifiers.slice(0, 3).join(" ");
  const goalRes = GOAL_RESOURCES[learningGoal] || GOAL_RESOURCES["hands_on"];

  // Build goal-specific site-scoped query from tier 2 mappings
  const siteFilter = goalRes.siteFilters.slice(0, 5).join(" OR ");
  const webQuery = `${moduleTitle} ${topic} ${levelMod} ${goalMod}`;
  const webQueryTrusted = `${moduleTitle} ${topic} ${siteFilter}`;

  // Build goal-specific YouTube query with preferred channels
  const preferredChannels = goalRes.youtubeChannels.slice(0, 2).join(" OR ");
  const videoQuery = `${moduleTitle} ${topic} ${goalMod} ${levelMod}`;
  const videoQueryTargeted = preferredChannels
    ? `${moduleTitle} ${topic} ${preferredChannels}`
    : videoQuery;

  // Run 4 parallel searches: general web, trusted-site web, general videos, targeted channel videos
  const [webResults, trustedWebResults, videoResults, targetedVideoResults] = await Promise.all([
    searchSerper(webQuery, apiKey, "search", config.webCount),
    searchSerper(webQueryTrusted, apiKey, "search", 4),
    searchSerper(videoQuery, apiKey, "videos", config.videoCount),
    searchSerper(videoQueryTargeted, apiKey, "videos", 4),
  ]);

  const candidates: Resource[] = [];
  const seenUrls = new Set<string>();

  // Process videos: targeted first (higher chance of preferred channels), then general
  const allVideoResults = [...(targetedVideoResults as SerperVideoResult[]), ...(videoResults as SerperVideoResult[])];
  for (const v of allVideoResults) {
    if (!v.link || seenUrls.has(v.link)) continue;
    seenUrls.add(v.link);
    const title = v.title || "Video Tutorial";
    if (isDisqualified(title, v.link)) continue;
    const mins = parseDurationToMinutes(v.duration);
    if (mins > moduleMinutes * 0.8) continue;
    candidates.push({
      title, url: v.link, type: "video",
      estimated_minutes: mins,
      description: `Video tutorial on ${moduleTitle}`,
    });
  }

  // Process web results: trusted first, then general, deduplicated
  const allWebResults = [...(trustedWebResults as SerperWebResult[]), ...(webResults as SerperWebResult[])];
  for (const r of allWebResults) {
    if (!r.link || seenUrls.has(r.link)) continue;
    seenUrls.add(r.link);
    const title = r.title || "Learning Resource";
    if (isDisqualified(title, r.link)) continue;
    const mins = estimateArticleMinutes(r.snippet || "");
    candidates.push({
      title, url: r.link,
      type: detectResourceType(r.link),
      estimated_minutes: mins,
      description: r.snippet || `Resource for learning ${moduleTitle}`,
    });
  }

  return selectResources(candidates, moduleTitle, learningGoal, skillLevel, config, moduleMinutes);
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
    const { topic, skill_level, learning_goal, timeline_weeks, hours_per_day, hard_deadline, deadline_date, include_weekends } = await req.json();
    const effectiveGoal = learning_goal || "hands_on";
    const daysInTimeline = timeline_weeks * 7;
    const studyDays = include_weekends === false ? Math.round(daysInTimeline * 5 / 7) : daysInTimeline;
    const totalHours = studyDays * hours_per_day;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
    const SERPER_API_KEY = Deno.env.get("SERPER_API_KEY");
    if (!SERPER_API_KEY) throw new Error("SERPER_API_KEY not configured");
    const YOUTUBE_API_KEY = Deno.env.get("YOUTUBE_API_KEY");
    if (!YOUTUBE_API_KEY) throw new Error("YOUTUBE_API_KEY not found. Add it in Lovable environment settings.");

    // Step 1: Generate roadmap structure via AI
    const systemPrompt = buildSystemPrompt(totalHours, effectiveGoal, skill_level);

    const userPrompt = `Create a learning roadmap for: "${topic}"
Skill level: ${skill_level}
Learning Goal: ${effectiveGoal}
Timeline: ${timeline_weeks} weeks (${studyDays} study days${include_weekends === false ? ", weekends excluded" : ", including weekends"})
Hours per day: ${hours_per_day}
Total available hours: ${totalHours}
${hard_deadline && deadline_date ? `Hard deadline: ${deadline_date} — be extra conservative, plan for ${Math.round(totalHours * 0.8)} hours of content.` : ""}

Return ONLY valid JSON with this exact structure:
{
  "topic": "concise clean title (e.g. 'Docker Basics in 2 Days', 'Machine Learning Models', 'Python Libraries Intermediate')",
  "skill_level": "${skill_level}",
  "timeline_weeks": ${timeline_weeks},
  "hours_per_day": ${hours_per_day},
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

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("No response from AI");

    const roadmap = JSON.parse(content);

    // Step 2: Fetch real resources via Serper (parallelized per module)
    console.log(`Fetching resources for ${roadmap.modules?.length || 0} modules (goal: ${effectiveGoal}, level: ${skill_level})...`);

    const resourcePromises = (roadmap.modules || []).map((mod: any) =>
      fetchResourcesForModule(mod.title, topic, skill_level, SERPER_API_KEY, mod.estimated_hours || hours_per_day, effectiveGoal)
    );
    const allResources = await Promise.all(resourcePromises);

    // Step 3: YouTube API enrichment
    const allVideoIds = new Set<string>();
    for (const resources of allResources) {
      for (const r of resources) {
        if (r.type === "video") {
          const id = extractYouTubeVideoId(r.url);
          if (id) allVideoIds.add(id);
        }
      }
    }

    let ytMap = new Map<string, YouTubeMetadata>();
    if (allVideoIds.size > 0 && YOUTUBE_API_KEY) {
      console.log(`Enriching ${allVideoIds.size} YouTube videos with metadata...`);
      ytMap = await fetchYouTubeMetadata([...allVideoIds], YOUTUBE_API_KEY);
      console.log(`Got metadata for ${ytMap.size} videos.`);
    }

    // Step 4: Inject enriched resources
    for (let i = 0; i < (roadmap.modules || []).length; i++) {
      roadmap.modules[i].resources = enrichResourcesWithYouTube(allResources[i] || [], ytMap);
    }

    console.log("Roadmap generation complete.");
    return new Response(JSON.stringify(roadmap), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("generate-roadmap error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
