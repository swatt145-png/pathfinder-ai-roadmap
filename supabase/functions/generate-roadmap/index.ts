import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

// ─── STAGE 6: Context Fit Scoring (Heuristic Fallback) ──────────────────────

function computeContextFitScoreFallback(candidate: CandidateResource, ctx: ModuleContext, ytMeta?: YouTubeMetadata): number {
  let score = 0;
  const moduleText = `${ctx.topic} ${ctx.moduleTitle} ${ctx.moduleDescription} ${ctx.learningObjectives.join(" ")} ${ctx.goal} ${ctx.level}`;
  const resourceText = `${candidate.title} ${candidate.description} ${candidate.channel || ""}`;
  const similarity = computeSemanticSimilarity(moduleText, resourceText);
  score += Math.round(similarity * 50);
  if (ctx.goal === "conceptual" && (candidate.type === "video" || candidate.type === "documentation")) score += 10;
  if (ctx.goal === "hands_on" && (candidate.type === "tutorial" || candidate.type === "practice")) score += 10;
  if (ctx.goal === "quick_overview" && candidate.estimated_minutes <= 20) score += 8;
  if (ctx.goal === "deep_mastery" && candidate.estimated_minutes >= 20) score += 8;
  const titleLower = candidate.title.toLowerCase();
  if (ctx.level === "beginner" && /beginner|intro|basic|fundamental|getting started|what is/i.test(titleLower)) score += 8;
  if (ctx.level === "intermediate" && /intermediate|practical|pattern|use case/i.test(titleLower)) score += 8;
  if (ctx.level === "advanced" && /advanced|deep|expert|optimization|architecture/i.test(titleLower)) score += 8;
  const goalChannels = GOAL_RESOURCES[ctx.goal]?.youtubeChannels || [];
  if (candidate.type === "video" && ytMeta) {
    const channelLower = ytMeta.channel.toLowerCase();
    if (goalChannels.some(ch => channelLower.includes(ch))) score += 10;
  }
  if (candidate.estimated_minutes > ctx.moduleMinutes * 2) score -= 5;
  return Math.max(0, Math.min(score, 100));
}

// ─── STAGE 6: AI-Powered Context Fit Scoring (Agent 2) ──────────────────────

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
  }>;
}

async function batchAIContextFitScoring(
  allModuleCandidates: Map<string, CandidateResource[]>,
  modules: any[],
  topic: string,
  goal: string,
  level: string,
  apiKey: string
): Promise<boolean> {
  // Build compact input for the AI scorer
  const scoringModules: AIFitScoringInput[] = [];
  
  for (const mod of modules) {
    const candidates = allModuleCandidates.get(mod.id) || [];
    // Only send top 20 by authority to keep payload manageable
    const top = [...candidates]
      .sort((a, b) => b.authority_score - a.authority_score)
      .slice(0, 20);
    
    if (top.length === 0) continue;
    
    scoringModules.push({
      moduleId: mod.id,
      moduleTitle: mod.title,
      moduleDescription: mod.description || "",
      learningObjectives: mod.learning_objectives || [],
      candidates: top.map((c, i) => ({
        index: i,
        title: c.title,
        url: c.url,
        type: c.type,
        channel: c.channel || new URL(c.url).hostname.replace("www.", ""),
        duration_minutes: c.estimated_minutes,
        description: c.description,
      })),
    });
  }

  if (scoringModules.length === 0) return false;

  const prompt = `You are Agent 2: the Resource Fit Scorer for a learning roadmap.

Learner profile:
- Topic: ${topic}
- Learning Goal: ${goal}
- Proficiency Level: ${level}

Your job: Score each candidate resource's FIT (0-100) for its module. Consider:

1. SEMANTIC RELEVANCE (0-40): Does this resource actually teach what the module needs? Not just keyword overlap — does the *content* align with the module's learning objectives?
2. LEVEL ALIGNMENT (0-20): Is this resource pitched at the right difficulty? A "Python basics" video is wrong for an advanced module even if the topic matches.
3. GOAL ALIGNMENT (0-20): Does the format match the learning goal? (${goal === "hands_on" ? "Prefer tutorials, code-alongs, project builds" : goal === "conceptual" ? "Prefer explanations, lectures, theory deep-dives" : goal === "quick_overview" ? "Prefer short crash courses, summaries" : "Prefer comprehensive, in-depth content"})
4. PEDAGOGICAL QUALITY (0-10): Based on title/description, does this look like quality educational content vs clickbait/listicle?
5. TOOL/FRAMEWORK FIT (0-10): If the module is about React, a Vue tutorial scores 0 here. If tool-agnostic topic, give 5-10.

Score STRICTLY. A score of 80+ means "excellent fit". 50-79 means "acceptable". Below 50 means "poor fit".

Modules and candidates:
${JSON.stringify(scoringModules, null, 1)}

Return ONLY valid JSON:
{
  "scores": [
    {
      "module_id": "mod_1",
      "candidate_scores": [
        { "index": 0, "score": 75, "reason": "one short sentence" }
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
        model: "google/gemini-3-pro-preview",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      console.error(`AI Context Fit Scorer error: ${response.status}`);
      return false;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return false;

    const parsed = JSON.parse(content);
    
    // Apply AI scores back to candidates
    for (const modScores of (parsed.scores || [])) {
      const candidates = allModuleCandidates.get(modScores.module_id);
      if (!candidates) continue;
      
      // Build authority-sorted top 20 to map indices back
      const top = [...candidates]
        .sort((a, b) => b.authority_score - a.authority_score)
        .slice(0, 20);
      
      for (const cs of (modScores.candidate_scores || [])) {
        if (cs.index >= 0 && cs.index < top.length) {
          const candidate = top[cs.index];
          // Find it in the original array and update
          const original = candidates.find(c => c.url === candidate.url);
          if (original) {
            original.context_fit_score = Math.max(0, Math.min(cs.score, 100));
          }
        }
      }
    }

    console.log(`AI Context Fit Scorer: Scored candidates for ${parsed.scores?.length || 0} modules`);
    return true;
  } catch (e) {
    console.error("AI Context Fit Scorer failed:", e);
    return false;
  }
}

// ─── STAGE 7: Clustering & Diversity (FLEXIBLE) ─────────────────────────────

function clusterAndDiversify(candidates: CandidateResource[], ctx: ModuleContext): CandidateResource[] {
  // Sort by combined score (authority + context fit)
  const sorted = [...candidates].sort((a, b) => 
    (b.authority_score + b.context_fit_score) - (a.authority_score + a.context_fit_score)
  );

  // Simple clustering: remove near-duplicates (high title similarity)
  const deduplicated: CandidateResource[] = [];
  for (const c of sorted) {
    const isDuplicate = deduplicated.some(existing => {
      const sim = computeSemanticSimilarity(existing.title, c.title);
      return sim > 0.7;
    });
    if (!isDuplicate) deduplicated.push(c);
  }

  // FLEXIBLE: 1-5 resources per module based on time budget
  const maxResources = 5;
  const selected: CandidateResource[] = [];
  let totalMinutes = 0;
  const dailyCapMinutes = ctx.moduleMinutes * 1.1; // 10% overflow allowed

  for (const c of deduplicated) {
    if (selected.length >= maxResources) break;

    // A resource is feasible if it fits within the module's daily cap
    if (selected.length > 0 && totalMinutes + c.estimated_minutes > dailyCapMinutes) continue;

    selected.push(c);
    totalMinutes += c.estimated_minutes;
  }

  // Minimum 1 resource per module — always include at least the top candidate
  if (selected.length === 0 && deduplicated.length > 0) {
    selected.push(deduplicated[0]);
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

  // Pass 1: Resource agent identifies high-quality oversized resources
  for (let i = 0; i < modules.length; i++) {
    const mod = modules[i];
    const candidates = allModuleCandidates.get(mod.id) || [];
    const moduleMinutes = Math.floor((mod.estimated_hours || 1) * 60);

    for (const c of candidates) {
      // Resource exceeds this module's budget but is high quality
      if (c.estimated_minutes > moduleMinutes * 1.1 && c.estimated_minutes <= totalUsableMinutes) {
        const qualityScore = c.authority_score + c.context_fit_score;
        // Only consider truly high-quality resources for spanning (top quartile threshold)
        if (qualityScore >= 40) {
          spanCandidates.push({ resource: c, sourceModuleIndex: i, qualityScore });
        }
      }
    }
  }

  if (spanCandidates.length === 0) return allModuleCandidates;

  // Sort by quality — best resources first
  spanCandidates.sort((a, b) => b.qualityScore - a.qualityScore);
  
  // Limit to top 3 spanning candidates to avoid over-spanning
  const topSpanCandidates = spanCandidates.slice(0, 3);
  const usedSpanUrls = new Set<string>();

  console.log(`Negotiation: Found ${spanCandidates.length} span candidates, evaluating top ${topSpanCandidates.length}`);

  for (const span of topSpanCandidates) {
    const { resource, sourceModuleIndex } = span;
    if (usedSpanUrls.has(resource.url)) continue;

    const resourceMinutes = resource.estimated_minutes;
    
    // Pass 2: Curriculum agent determines how many consecutive modules this resource can span
    const segments: ResourceSegment[] = [];
    let minutesRemaining = resourceMinutes;
    let currentMinute = 0;

    for (let j = sourceModuleIndex; j < modules.length && minutesRemaining > 0; j++) {
      const mod = modules[j];
      const moduleMinutes = Math.floor((mod.estimated_hours || 1) * 60);
      // Allocate up to the module's daily cap for this resource segment
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

    // Only create span if resource can be completed within available modules
    if (minutesRemaining > 0) {
      console.log(`Negotiation: Skipping "${resource.title}" (${resourceMinutes}min) — doesn't fit even spanning ${segments.length} modules`);
      continue;
    }

    if (segments.length < 2) continue; // No spanning needed

    console.log(`Negotiation: Spanning "${resource.title}" (${resourceMinutes}min) across ${segments.length} modules: ${segments.map(s => `${s.module_title}[${s.start_minute}-${s.end_minute}min]`).join(" → ")}`);

    usedSpanUrls.add(resource.url);

    // Create the primary resource with full span_plan in the first module
    const primaryResource: CandidateResource = {
      ...resource,
      span_plan: segments,
      estimated_minutes: segments[0].end_minute - segments[0].start_minute, // Only this segment's time counts for module 1
    };

    // Add primary to first module's candidates
    const firstModId = modules[sourceModuleIndex].id;
    const firstModCandidates = allModuleCandidates.get(firstModId) || [];
    // Remove original oversized version, add spanning version
    const filteredFirst = firstModCandidates.filter(c => c.url !== resource.url);
    filteredFirst.unshift(primaryResource); // Add at top since it's high quality
    allModuleCandidates.set(firstModId, filteredFirst);

    // Add continuation resources to subsequent modules
    for (let k = 1; k < segments.length; k++) {
      const seg = segments[k];
      const continuationResource: CandidateResource = {
        ...resource,
        title: `${resource.title} (Continue: ${seg.start_minute}–${seg.end_minute} min)`,
        estimated_minutes: seg.end_minute - seg.start_minute,
        is_continuation: true,
        continuation_of: resource.url,
        span_plan: segments,
        // Boost scores so reranker picks it up
        authority_score: resource.authority_score + 10,
        context_fit_score: resource.context_fit_score + 10,
      };

      const modCandidates = allModuleCandidates.get(seg.module_id) || [];
      // Remove any duplicate of this URL in the target module
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
    const normalizedUrl = v.link.split("&")[0];
    const title = v.title || "Video Tutorial";
    if (isDisqualified(title, normalizedUrl)) return;
    const mins = parseDurationToMinutes(v.duration);
    // Don't hard-reject long resources here — negotiation pass will handle spanning

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
    c.context_fit_score = computeContextFitScoreFallback(c, ctx, meta);

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

  const rerankerPrompt = `You are an Expert Curriculum Curator. Given a learner profile and module candidates, select the best 1-5 resources per module. The number of resources per module is VARIABLE — use fewer if time is tight or if one excellent resource covers everything.

Learner profile:
- Topic: ${topic}
- Goal: ${goal}
- Level: ${level}

Rules:
- A module CAN have just 1 resource if it's excellent and fits the time budget perfectly.
- Do NOT add filler resources just to reach a count. Each must add unique value.
- Prefer canonical, widely trusted sources (high authority_score)
- Avoid low-view unknown creators unless uniquely valuable
- Avoid redundancy — don't pick 3 similar videos
- Time is a HARD FEASIBILITY CONSTRAINT, NOT a ranking bonus
- If a single long high-quality resource fits the module budget perfectly, prefer it over multiple short ones

=== GLOBAL CONSTRAINTS (MANDATORY) ===

1. GLOBAL RESOURCE UNIQUENESS: A resource URL may appear AT MOST ONCE across all modules — EXCEPT continuation resources (marked with "(Continue: X–Y min)" in the title). Always select continuation resources if present.
2. HARD TIME BUDGET: Each module's total resource minutes must not exceed its budget. Remove lowest-value resource if over budget.
3. STACK CONSISTENCY: If user did not specify a language/framework — for conceptual goals prefer tool-agnostic resources; for hands-on goals pick ONE consistent stack.
4. COVERAGE BEFORE REDUNDANCY: Maximize coverage of module learning objectives. Never select multiple resources teaching identical content from the same channel.
5. SPANNING RESOURCES: If a candidate title contains "(Continue: X–Y min)", it is a continuation of a long high-quality resource spanning multiple modules. ALWAYS select these — they represent negotiated splits from the curriculum planning phase.

For each module, return the URLs of your selected resources (1-5) and a 1-sentence "why_selected" for each.

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
5. FINAL VALIDATION: Before outputting JSON, verify: no duplicate resources, all modules respect time budget, stack consistency, each module has 3-5 quiz questions.

RULES:
- Break the topic into sequential modules. Module count is VARIABLE based on time and complexity.
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
- Module count: VARIABLE based on time budget. Fewer modules for short timelines.
- Time split: 80% consuming content, 20% reflection/quizzes
- Quiz style: Definition-based, concept checks, "explain why X works this way"`;
    case "hands_on": return `HANDS-ON learning goal selected.
- Every module MUST have a "build something" or "try this" component
- Module count: VARIABLE based on time budget. Fewer modules for short timelines.
- Time split: 30% learning, 70% doing
- Quiz style: Code-oriented, "what would this output", practical scenarios`;
    case "quick_overview": return `QUICK OVERVIEW learning goal selected.
- Hit key points fast, no deep dives, focus on "what you need to know"
- Module count: Keep MINIMAL — as few modules as possible to cover essentials.
- Even if the user has weeks available, keep it concise. Use extra time for review, not more content.
- Time split: 100% efficient consumption, no lengthy exercises
- Quiz style: Quick recall, key terminology`;
    case "deep_mastery": return `DEEP MASTERY learning goal selected.
- Thorough coverage including edge cases, best practices, architecture patterns, real-world scenarios
- Module count: VARIABLE — use more modules for longer timelines, but never pad unnecessarily.
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
        model: "google/gemini-2.5-flash",
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

      // Enrich videos with YouTube data + compute authority scores
      const enriched = enrichCandidatesWithYouTube(candidates, ytMap, ctx);
      
      // Score non-video candidates (authority + heuristic fallback for context fit)
      for (const c of enriched) {
        if (c.type !== "video") {
          c.authority_score = computeAuthorityScore(c);
          c.context_fit_score = computeContextFitScoreFallback(c, ctx);
        }
      }

      allModuleCandidates.set(mod.id, enriched);
    }

    // ════════════════════════════════════════════════════════════════════════
    // STEP 6.1: STAGE 6 — AI-Powered Context Fit Scoring (Agent 2)
    // ════════════════════════════════════════════════════════════════════════
    console.log(`Stage 6 (Agent 2): Running AI context fit scoring...`);
    const aiScoringSuccess = await batchAIContextFitScoring(
      allModuleCandidates,
      roadmap.modules || [],
      topic,
      effectiveGoal,
      skill_level,
      LOVABLE_API_KEY
    );
    if (aiScoringSuccess) {
      console.log(`Stage 6: AI scoring complete — heuristic scores overridden with AI scores.`);
    } else {
      console.warn(`Stage 6: AI scoring failed — falling back to heuristic context fit scores.`);
    }

    // ════════════════════════════════════════════════════════════════════════
    // STEP 6.5: NEGOTIATION PASS — Resource ↔ Curriculum Agent Communication
    // ════════════════════════════════════════════════════════════════════════
    const usableMinutesForNegotiation = totalHours * 60 * 0.85;
    console.log(`Negotiation: Checking for high-quality oversized resources that can span modules...`);
    const negotiatedCandidates = negotiateSpanningResources(
      allModuleCandidates,
      roadmap.modules || [],
      effectiveHoursPerDay,
      usableMinutesForNegotiation,
      topic
    );
    // Replace allModuleCandidates with negotiated version
    for (const [key, val] of negotiatedCandidates) {
      allModuleCandidates.set(key, val);
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
      const dailyCapMinutes = effectiveHoursPerDay * 60 * 1.1; // 10% overflow allowed per day
      const moduleBudgetCap = Math.min(moduleMinutes * 1.05, dailyCapMinutes); // respect both module and daily cap
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
      // Continuation resources share the same base URL — allow them through
      const uniqueResources: CandidateResource[] = [];
      for (const c of finalResources) {
        const normalizedUrl = c.url.split("&")[0];
        const videoId = extractYouTubeVideoId(normalizedUrl);

        // Continuation resources are allowed even if the base URL was used
        if (c.is_continuation) {
          uniqueResources.push(c);
          continue;
        }

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
          span_plan: c.span_plan,
          is_continuation: c.is_continuation,
          continuation_of: c.continuation_of,
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

    console.log("Roadmap generation complete (10-stage pipeline with 3 AI agents).");
    return new Response(JSON.stringify(roadmap), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("generate-roadmap error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
