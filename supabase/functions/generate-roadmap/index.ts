import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// ─── Import shared resource pipeline ─────────────────────────────────────────
import {
  // Types
  type SerperWebResult,
  type SerperVideoResult,
  type ResourceSegment,
  type AuthorityTier,
  type CandidateResource,
  type Resource,
  type YouTubeMetadata,
  type ModuleContext,
  type GoalSearchConfig,

  // Constants
  TIER_CONFIG,
  OFFICIAL_DOC_PATTERNS,
  MAJOR_VENDOR_DOMAINS,
  UNIVERSITY_DOMAINS,
  EDUCATION_DOMAINS,
  RECOGNIZED_BLOGS,
  COMMUNITY_DOMAINS,
  DEPRIORITIZE_DOMAINS,
  DISALLOWED_RESOURCE_DOMAINS,
  YOUTUBE_TRUSTED_CHANNELS,
  GARBAGE_DOMAINS,
  GOAL_RESOURCES,
  BROAD_SCOPE_SIGNALS,
  TIMEOUTS_MS,
  CACHE_TTL,
  PIPELINE_LIMITS,

  // Utilities
  sleep,
  isAbortError,
  fetchWithTimeout,
  hashKey,
  extractYouTubeVideoId,
  formatViewCount,
  parseISO8601Duration,
  parseDurationToMinutes,
  detectResourceType,
  normalizeResourceUrl,
  extractResourceHost,
  isExcludedResource,
  isAllowedResourceUrl,
  estimateArticleMinutes,
  detectCertificationIntent,
  getMaxResourcesForModule,

  // Tokenization & Similarity
  normalizeToken,
  stemToken,
  tokenizeSemantic,
  computeSemanticSimilarity,
  buildHashedEmbedding,
  cosineSimilarity,
  computeEmbeddingSimilarity,
  computeHybridSimilarity,

  // Filtering
  isVideoLikelyOffTopic,
  looksLikeListingPage,
  isDiscussionOrMetaResource,
  isDisqualified,
  isGarbage,
  generateModuleAnchors,
  passesAnchorGate,
  computeScopePenalty,
  applyStage4Filter,
  applyDiversityCaps,

  // Query building
  getGoalSearchConfig,
  getLevelSearchModifier,
  scoreAnchorTerm,
  selectTopAnchors,
  buildQuery,
  buildTopicQueryPlan,
  buildModuleQueryPlan,

  // Search
  searchSerper,
  fetchYouTubeMetadata,
  fetchTopicAnchors,
  fetchModuleResults,

  // Scoring
  classifyAuthorityTier,
  computeLightAuthorityBump,
  computeContextFitScoreFallback,

  // Merge & enrich
  mergeAndDeduplicate,
  enrichCandidatesWithYouTube,

  // Selection
  clusterAndDiversify,
} from "../_shared/resource-pipeline.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Helpers (generate-roadmap specific) ─────────────────────────────────────

interface GoalResources {
  youtubeChannels: string[];
  siteFilters: string[];
}

const FAST_MODE_MAX_HOURS = 40;
const FAST_MODE_MAX_MODULES = 8;
const ENABLE_EXPENSIVE_LLM_STAGES = true;
const ROADMAP_MODEL_AGENT1 = Deno.env.get("ROADMAP_MODEL_AGENT1") || "google/gemini-3-pro-preview";
const ROADMAP_MODEL_AGENT2 = Deno.env.get("ROADMAP_MODEL_AGENT2") || "google/gemini-2.5-flash";

const RETRIEVAL_THRESHOLDS = {
  topicMinUnique: 16,
  moduleMinUnique: 10,
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
  const bounds = getModuleBounds(total, daysInTimeline);
  const moduleCount = Math.min(bounds.max, Math.max(1, total <= 2 ? 1 : total <= 6 ? 2 : Math.floor(total / 2)));
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

function normalizeTopicKey(raw: string): string {
  return (raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s+#./-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function callLLM(
  model: string,
  messages: Array<{ role: string; content: string }>,
  apiKey: string,
  geminiKey: string | undefined,
  timeoutMs: number,
  jsonMode = true,
): Promise<Response> {
  const geminiModel = model.replace(/^google\//, "");

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

function getModuleBounds(totalHours: number, _daysInTimeline: number): { min: number; max: number } {
  const N = Math.max(1, totalHours);
  let max: number;
  if (N <= 12) max = Math.max(1, Math.floor(N / 2));
  else if (N <= 50) max = Math.max(4, Math.floor(N / 3));
  else if (N <= 70) max = Math.max(6, Math.floor(N / 4));
  else max = Math.max(8, Math.floor(N / 4));
  return { min: 1, max };
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
- LOW-VIEW PENALTY: If a YouTube video has fewer than 1,000 views from an unknown channel, only select it if no better alternative exists. Never select more than 1 low-view video per module.
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

    for (const cs of (parsed.candidate_scores || [])) {
      if (cs.index >= 0 && cs.index < top.length) {
        const candidate = top[cs.index];
        const original = candidates.find(c => c.url === candidate.url);
        if (original) {
          original.context_fit_score = Math.max(0, Math.min(cs.score, 100));
        }
      }
    }

    const selectedUrls = (parsed.selected || []).map((s: any) => s.url).filter(Boolean);

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

  const results = await Promise.all(
    modulesWithCandidates.map(mod =>
      scoreModuleResources(mod, allModuleCandidates.get(mod.id) || [], topic, goal, level, apiKey)
    )
  );

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

// ─── System Prompt Builder ───────────────────────────────────────────────────

function buildSystemPrompt(totalHours: number, learningGoal: string, skillLevel: string): string {
  const goalBlock = getGoalPromptBlock(learningGoal);
  const levelBlock = getLevelPromptBlock(skillLevel);
  const interactionBlock = getInteractionBlock(learningGoal, skillLevel);

  const totalMinutes = totalHours * 60;
  const usableMinutes = Math.floor(totalMinutes * 0.85);

  return `You are WayVion, an expert learning curriculum designer. You create personalized, structured, and realistic learning roadmaps.

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

1. MODULE COUNT IS BASED ON TOTAL HOURS (N = total available hours):
   - If N ≤ 12: maximum modules = floor(N / 2) (e.g., 6 hours → max 3 modules, 12 hours → max 6)
   - If 12 < N ≤ 50: maximum modules = floor(N / 3) (e.g., 24 hours → max 8 modules)
   - If N > 50: maximum modules = floor(N / 4) (e.g., 60 hours → max 15 modules)
   - Never create more modules than this formula allows. Fewer is fine if the topic doesn't need that many.
   - If total time ≤ 2 hours: default to 1 module.

2. RESOURCES PER MODULE — leave resources as empty arrays (fetched separately), but plan module duration accordingly:
   - Do NOT add extra resources as filler. Each must add unique value.
   - If a module would require more than 4 hours, split it into focused sub-modules of 2-4 hours each.

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
    let resolvedUserId: string | null = user_id || authUser.id || null;

    // ════════════════════════════════════════════════════════════════════════
    // STEP 1: Generate roadmap structure via AI (Agent 1)
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
    const agent1Attempts = 1;
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

    const { urls: excludedUrls, domains: excludedDomains } = await feedbackPromise;
    const allowCacheWrite = excludedUrls.size === 0;

    // ════════════════════════════════════════════════════════════════════════
    // STEP 2: STAGE 2A+2B — Module results + topic anchors fully parallel.
    // ════════════════════════════════════════════════════════════════════════
    const totalAvailableMinutes = totalHours * 60;
    const allModuleCandidates = new Map<string, CandidateResource[]>();

    console.log(`Stage 2: Fetching module results + topic anchors in parallel (${roadmap.modules?.length || 0} modules, fastMode=${fastMode})...`);
    const t2Start = Date.now();

    const moduleResultsPromises = (roadmap.modules || []).map((mod: any) =>
      fetchModuleResults(mod, topic, skill_level, effectiveGoal, certificationIntent, SERPER_API_KEY, supabaseAdmin, allowCacheWrite, fastMode)
    );
    const topicAnchorPromise = fetchTopicAnchors(topic, skill_level, effectiveGoal, certificationIntent, SERPER_API_KEY, supabaseAdmin, allowCacheWrite, fastMode);

    const [allModuleResults, topicAnchors] = await Promise.all([
      Promise.all(moduleResultsPromises),
      topicAnchorPromise,
    ]);

    console.log(`Stage 2: retrieval done in ${Date.now() - t2Start} ms`);

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

      const enriched = enrichCandidatesWithYouTube(candidates, ytMap, ctx);

      for (const c of enriched) {
        if (c.type !== "video") {
          computeLightAuthorityBump(c);
          c.context_fit_score = computeContextFitScoreFallback(c, ctx);
        }
      }

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

      const stage4Filtered = applyStage4Filter(enriched, ctx);

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
      const maxResources = getMaxResourcesForModule(Number(mod.estimated_hours || 1));
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
      const budgetedResources: CandidateResource[] = [];
      let moduleTotal = 0;
      for (const c of uniqueResources) {
        if (totalRoadmapMinutes + moduleTotal + c.estimated_minutes > usableMinutes) continue;
        if (moduleTotal + c.estimated_minutes > moduleBudgetCap) continue;
        budgetedResources.push(c);
        moduleTotal += c.estimated_minutes;
      }

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

      const coverageTarget = moduleMinutes * 0.6;
      if (moduleTotal < coverageTarget) {
        const recoveryPool = [...candidates]
          .filter(c => !budgetedResources.some(b => b.url === c.url))
          .sort((a, b) => (b.context_fit_score + b.authority_score) - (a.context_fit_score + a.authority_score));

        for (const c of recoveryPool) {
          if (budgetedResources.length >= maxResources) break;
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
      if (finalizedResources.length >= 2) {
        const maxModuleVideos = Math.max(1, Math.floor(finalizedResources.length * 0.60));
        const modVideos = finalizedResources.filter(r => r.type === "video");
        if (modVideos.length > maxModuleVideos) {
          const sortedVideos = [...modVideos].sort((a, b) => (b.context_fit_score + b.authority_score) - (a.context_fit_score + a.authority_score));
          const videosToRemove = new Set(sortedVideos.slice(maxModuleVideos).map(v => v.url));
          finalizedResources = finalizedResources.filter(r => r.type !== "video" || !videosToRemove.has(r.url));
        }
      }
      let finalizedMinutes = finalizedResources.reduce((sum, r) => sum + Number(r.estimated_minutes || 0), 0);
      const hardCoverageTarget = Math.min(moduleBudgetCap, Math.max(20, moduleMinutes * 0.45));

      if (finalizedMinutes < hardCoverageTarget) {
        const topUpPools = [...candidates, ...(moduleRescuePools.get(mod.id) || [])]
          .sort((a, b) => (b.context_fit_score + b.authority_score) - (a.context_fit_score + a.authority_score));
        for (const c of topUpPools) {
          if (finalizedResources.length >= maxResources) break;
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

      if (finalizedResources.length >= 2) {
        const maxVidsAfterTopUp = Math.max(1, Math.floor(finalizedResources.length * 0.60));
        const vidsAfterTopUp = finalizedResources.filter(r => r.type === "video");
        if (vidsAfterTopUp.length > maxVidsAfterTopUp) {
          const sortedVids = [...vidsAfterTopUp].sort((a, b) => (b.context_fit_score + b.authority_score) - (a.context_fit_score + a.authority_score));
          const vidsToRemove = new Set(sortedVids.slice(maxVidsAfterTopUp).map(v => v.url));
          finalizedResources = finalizedResources.filter(r => r.type !== "video" || !vidsToRemove.has(r.url));
          finalizedMinutes = finalizedResources.reduce((sum, r) => sum + Number(r.estimated_minutes || 0), 0);
        }
      }

      if (finalizedResources.length > maxResources) {
        finalizedResources.sort((a, b) => (b.context_fit_score + b.authority_score) - (a.context_fit_score + a.authority_score));
        finalizedResources = finalizedResources.slice(0, maxResources);
        finalizedMinutes = finalizedResources.reduce((sum, r) => sum + Number(r.estimated_minutes || 0), 0);
      }

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

      if (mod.resources && mod.resources.length > 0) {
        mod.resources = mod.resources.filter((r: Resource) => {
          try {
            const u = new URL(r.url);
            const h = u.hostname.toLowerCase().replace(/^www\./, "");
            const p = u.pathname.toLowerCase();
            if (/^(?:m\.)?google\.[a-z.]+$/i.test(h)) return false;
            if (h.includes("google.") && p.startsWith("/search")) return false;
            if (/^(?:scholar|books|cse|news)\.google\./i.test(h)) return false;
            if (h === "bing.com" || h === "duckduckgo.com" || h === "search.yahoo.com") return false;
            return true;
          } catch { return false; }
        });
      }

      delete mod.anchor_terms;
    }

    // ── Module splitting: split oversized modules ──
    {
      const newModules: any[] = [];
      for (const mod of roadmap.modules || []) {
        const resources = mod.resources || [];
        const modMaxRes = getMaxResourcesForModule(Number(mod.estimated_hours || 1));
        if (resources.length >= modMaxRes && (mod.estimated_hours || 0) > 4) {
          const mid = Math.ceil(resources.length / 2);
          const part1Resources = resources.slice(0, mid);
          const part2Resources = resources.slice(mid);
          const part1Minutes = part1Resources.reduce((s: number, r: any) => s + (r.estimated_minutes || 0), 0);
          const part2Minutes = part2Resources.reduce((s: number, r: any) => s + (r.estimated_minutes || 0), 0);

          newModules.push({
            ...mod,
            id: mod.id,
            title: `${mod.title} (Part 1)`,
            resources: part1Resources,
            estimated_hours: Math.round((part1Minutes / 60) * 100) / 100,
          });
          newModules.push({
            ...mod,
            id: `${mod.id}_pt2`,
            title: `${mod.title} (Part 2)`,
            resources: part2Resources,
            estimated_hours: Math.round((part2Minutes / 60) * 100) / 100,
          });
          console.log(`Split module "${mod.title}" (${resources.length} resources, ${mod.estimated_hours}h) into two parts.`);
        } else {
          newModules.push(mod);
        }
      }
      roadmap.modules = newModules;
    }

    // ── Roadmap-level diversity pass ──
    {
      const allResources = (roadmap.modules || []).flatMap((m: any) => m.resources || []);
      const videoCount = allResources.filter((r: Resource) => r.type === "video").length;
      const totalCount = allResources.length;
      const videoRatio = totalCount > 0 ? videoCount / totalCount : 0;
      const targetMaxVideoRatio = 0.62;

      if (videoRatio > targetMaxVideoRatio && totalCount >= 3) {
        const videosToReplace = Math.ceil(videoCount - totalCount * targetMaxVideoRatio);
        let replaced = 0;
        console.log(`Roadmap diversity: ${videoCount}/${totalCount} resources are videos (${Math.round(videoRatio * 100)}%). Swapping up to ${videosToReplace} for articles/docs.`);

        const sortedModules = [...(roadmap.modules || [])]
          .filter((m: any) => (m.resources?.length || 0) >= 2)
          .sort((a: any, b: any) => (b.resources?.length || 0) - (a.resources?.length || 0));

        for (const mod of sortedModules) {
          if (replaced >= videosToReplace) break;
          const resources = mod.resources as Resource[];
          const moduleVideos = resources.filter((r: Resource) => r.type === "video");
          if (moduleVideos.length < 2) continue;

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

    roadmap._pipeline_diag = pipelineDiag;

    return new Response(JSON.stringify(roadmap), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("generate-roadmap error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
