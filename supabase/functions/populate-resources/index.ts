import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import {
  // Types
  type SerperVideoResult,
  type SerperWebResult,
  type CandidateResource,
  type Resource,
  type ResourceSegment,
  type ModuleContext,
  type YouTubeMetadata,

  // Constants
  TIMEOUTS_MS,
  PIPELINE_LIMITS,

  // Utilities
  isAbortError,
  fetchWithTimeout,
  extractYouTubeVideoId,
  normalizeResourceUrl,
  extractResourceHost,
  isExcludedResource,
  isAllowedResourceUrl,
  detectCertificationIntent,
  getMaxResourcesForModule,

  // Tokenization & Similarity
  computeHybridSimilarity,

  // Filtering
  isGarbage,
  generateModuleAnchors,
  applyStage4Filter,
  applyDiversityCaps,
  looksLikeListingPage,
  isDiscussionOrMetaResource,

  // Scoring
  computeLightAuthorityBump,
  computeContextFitScoreFallback,

  // Search
  searchSerper,
  getGoalSearchConfig,
  fetchTopicAnchors,
  fetchModuleResults,
  fetchYouTubeMetadata,

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

const ROADMAP_MODEL_AGENT2 = Deno.env.get("ROADMAP_MODEL_AGENT2") || "google/gemini-2.5-flash";

// ─── JSON Parsing Helpers ────────────────────────────────────────────────────

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

function normalizeTopicKey(raw: string): string {
  return (raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s+#./-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── LLM Call Helper ─────────────────────────────────────────────────────────

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
      console.warn(`Direct Gemini failed: ${e}, falling back to gateway...`);
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

// ─── Agent 2: Per-Module AI Scoring ──────────────────────────────────────────

interface ModuleScoringResult {
  moduleId: string;
  success: boolean;
  selections: string[];
}

interface Agent2Result {
  success: boolean;
  selections: Map<string, string[]>;
}

async function scoreModuleResources(
  mod: any,
  candidates: CandidateResource[],
  topic: string,
  goal: string,
  level: string,
  apiKey: string,
): Promise<ModuleScoringResult> {
  const moduleId = mod.id;
  const emptyResult: ModuleScoringResult = { moduleId, success: false, selections: [] };

  const sorted = [...candidates].sort((a, b) => b.context_fit_score - a.context_fit_score);
  const top = applyDiversityCaps(sorted, PIPELINE_LIMITS.agent2CandidatesPerModule, goal, topic);
  if (top.length === 0) return emptyResult;

  const scoringCandidates = top.map((c, i) => ({
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
  }));

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
${JSON.stringify(scoringCandidates, null, 1)}

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
  apiKey: string,
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

// ─── Spanning Resource Negotiation ───────────────────────────────────────────

function negotiateSpanningResources(
  allModuleCandidates: Map<string, CandidateResource[]>,
  modules: any[],
  effectiveHoursPerDay: number,
  totalUsableMinutes: number,
  topic: string,
): Map<string, CandidateResource[]> {
  if (modules.length < 2) return allModuleCandidates;

  const spanCandidates: Array<{ resource: CandidateResource; sourceModuleIndex: number; qualityScore: number }> = [];

  for (let i = 0; i < modules.length; i++) {
    const mod = modules[i];
    const candidates = allModuleCandidates.get(mod.id) || [];
    const moduleMinutes = Math.floor((mod.estimated_hours || 1) * 60);

    for (const c of candidates) {
      if (c.estimated_minutes > moduleMinutes * 1.1 && c.estimated_minutes <= totalUsableMinutes) {
        if (c.context_fit_score >= 30) {
          spanCandidates.push({ resource: c, sourceModuleIndex: i, qualityScore: c.context_fit_score });
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

    if (minutesRemaining > 0) continue;
    if (segments.length < 2) continue;

    console.log(`Negotiation: Spanning "${resource.title}" (${resourceMinutes}min) across ${segments.length} modules`);
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

// ═════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═════════════════════════════════════════════════════════════════════════════

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
    const SERPER_API_KEY = Deno.env.get("SERPER_API_KEY") || "";
    const YOUTUBE_API_KEY = Deno.env.get("YOUTUBE_API_KEY") || "";

    if (!SERPER_API_KEY) {
      return new Response(JSON.stringify({ error: "SERPER_API_KEY not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: authUser }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !authUser) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { roadmap_id } = await req.json();
    if (!roadmap_id) {
      return new Response(JSON.stringify({ error: "roadmap_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseAdmin = SUPABASE_SERVICE_ROLE_KEY
      ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
      : supabaseAuth;

    // Read roadmap from DB
    const { data: roadmapRow, error: readErr } = await supabaseAdmin
      .from("roadmaps")
      .select("roadmap_data, user_id, learning_goal, topic")
      .eq("id", roadmap_id)
      .single();

    if (readErr || !roadmapRow) {
      return new Response(JSON.stringify({ error: "Roadmap not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (roadmapRow.user_id !== authUser.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const roadmapData = roadmapRow.roadmap_data as any;
    if (!roadmapData?.modules?.length) {
      return new Response(JSON.stringify({ error: "No modules in roadmap" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const topic = roadmapData.topic || roadmapRow.topic || "Learning Topic";
    const level = roadmapData.skill_level || "beginner";
    const goal = roadmapRow.learning_goal || roadmapData.learning_goal || "hands_on";
    const modules = roadmapData.modules;
    const totalHours = Number(roadmapData.total_hours || 10);
    const hoursPerDay = Number(roadmapData.hours_per_day || 2);
    const totalHoursNum = Number(totalHours);
    const FAST_MODE_MAX_HOURS = 40;
    const fastMode = totalHoursNum <= FAST_MODE_MAX_HOURS;

    console.log(`[populate-resources] Starting for roadmap ${roadmap_id}: ${modules.length} modules, topic="${topic}", goal="${goal}", fastMode=${fastMode}`);
    const t0 = Date.now();

    // Read module progress to know which are completed
    const { data: progressRows } = await supabaseAdmin
      .from("progress")
      .select("module_id, status")
      .eq("roadmap_id", roadmap_id)
      .eq("status", "completed");

    const completedModuleIds = new Set<string>(
      (progressRows || []).map((p: any) => p.module_id)
    );

    // Modules that need resources (not completed AND no existing resources)
    const modulesNeedingResources = modules.filter((mod: any) =>
      !completedModuleIds.has(mod.id) && (!mod.resources || mod.resources.length === 0)
    );

    if (modulesNeedingResources.length === 0) {
      console.log(`[populate-resources] No modules need resources. Clearing pending flag.`);
      roadmapData.resources_pending = false;
      await supabaseAdmin.from("roadmaps").update({ roadmap_data: roadmapData }).eq("id", roadmap_id);
      return new Response(JSON.stringify({ success: true, total_resources: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const certificationIntent = detectCertificationIntent(topic);

    // Load resource feedback exclusions (user's thumbs-down)
    const excludedUrls = new Set<string>();
    const excludedDomains = new Set<string>();
    try {
      const topicKey = normalizeTopicKey(topic);
      const { data: feedbackRows } = await supabaseAdmin
        .from("resource_feedback")
        .select("resource_url")
        .eq("user_id", authUser.id)
        .eq("topic_key", topicKey)
        .eq("relevant", false);
      for (const row of (feedbackRows || [])) {
        if (!row.resource_url) continue;
        const raw = String(row.resource_url);
        const normalized = normalizeResourceUrl(raw);
        excludedUrls.add(normalized);
        const host = extractResourceHost(raw);
        if (host) {
          const baseHost = host.replace(/^www\./, "");
          if (/^google\./.test(baseHost)) excludedDomains.add(baseHost);
          if (baseHost === "coursera.org" || baseHost.endsWith(".coursera.org")) excludedDomains.add("*.coursera.org");
          if (baseHost === "coursera.com" || baseHost.endsWith(".coursera.com")) excludedDomains.add("*.coursera.com");
        }
      }
    } catch (e) {
      console.warn("Failed to load resource feedback exclusions:", e);
    }
    const allowCacheWrite = excludedUrls.size === 0;

    // ════════════════════════════════════════════════════════════════════════
    // STAGE 2: Fetch module results + topic anchors in parallel
    // ════════════════════════════════════════════════════════════════════════
    const totalAvailableMinutes = totalHours * 60;
    const allModuleCandidates = new Map<string, CandidateResource[]>();

    console.log(`Stage 2: Fetching resources for ${modulesNeedingResources.length} modules (fastMode=${fastMode})...`);
    const t2Start = Date.now();

    const moduleResultsPromises = modulesNeedingResources.map((mod: any) =>
      fetchModuleResults(mod, topic, level, goal, certificationIntent, SERPER_API_KEY, supabaseAdmin, allowCacheWrite, fastMode)
    );
    const topicAnchorPromise = fetchTopicAnchors(topic, level, goal, certificationIntent, SERPER_API_KEY, supabaseAdmin, allowCacheWrite, fastMode);

    const [allModuleResults, topicAnchors] = await Promise.all([
      Promise.all(moduleResultsPromises),
      topicAnchorPromise,
    ]);

    console.log(`Stage 2: retrieval done in ${Date.now() - t2Start} ms`);

    for (let i = 0; i < modulesNeedingResources.length; i++) {
      const mod = modulesNeedingResources[i];
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

    const totalCandidates = [...allModuleCandidates.values()].reduce((sum, c) => sum + c.length, 0);
    console.log(`Stage 2: ${totalCandidates} total candidates across ${modulesNeedingResources.length} modules`);

    if (totalCandidates === 0) {
      console.error("CRITICAL: Resource search returned 0 candidates for ALL modules.");
      roadmapData.resources_pending = false;
      await supabaseAdmin.from("roadmaps").update({ roadmap_data: roadmapData }).eq("id", roadmap_id);
      return new Response(JSON.stringify({ success: true, total_resources: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    // STAGE 3: YouTube API Enrichment
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
    if (allVideoIds.size > 0 && YOUTUBE_API_KEY) {
      const tYT = Date.now();
      ytMap = await fetchYouTubeMetadata([...allVideoIds], YOUTUBE_API_KEY, supabaseAdmin);
      console.log(`[TIMING] YouTube enrichment: ${Date.now() - tYT} ms (${ytMap.size} hits)`);
    }

    // ════════════════════════════════════════════════════════════════════════
    // STAGES 4-5: Enhanced Hard Filter + Light Authority + Enrichment
    // ════════════════════════════════════════════════════════════════════════
    const tFilter = Date.now();
    const moduleRescuePools = new Map<string, CandidateResource[]>();

    for (const mod of modulesNeedingResources) {
      const candidates = allModuleCandidates.get(mod.id) || [];
      const anchorTerms = generateModuleAnchors(mod, topic);
      const ctx: ModuleContext = {
        topic,
        moduleTitle: mod.title,
        moduleDescription: mod.description || "",
        learningObjectives: mod.learning_objectives || [],
        goal,
        level,
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
    // STAGE 6: Parallel Agent 2 AI Scoring + Spanning Negotiation
    // ════════════════════════════════════════════════════════════════════════
    const usableMinutesForNegotiation = totalHours * 60 * 0.85;
    const negotiationInput = new Map<string, CandidateResource[]>();
    for (const [moduleId, candidates] of allModuleCandidates.entries()) {
      negotiationInput.set(moduleId, candidates.map(c => ({ ...c })));
    }

    const enableAgent2 = !!LOVABLE_API_KEY;
    const [agent2Result, negotiatedCandidates] = await Promise.all([
      enableAgent2
        ? parallelModuleAIScoring(allModuleCandidates, modulesNeedingResources, topic, goal, level, LOVABLE_API_KEY)
        : Promise.resolve({ success: false, selections: new Map<string, string[]>() } as Agent2Result),
      Promise.resolve(
        negotiateSpanningResources(negotiationInput, modulesNeedingResources, hoursPerDay, usableMinutesForNegotiation, topic)
      ),
    ]);

    // Merge negotiated spanning resources back with scored candidates
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
      console.log(`Agent 2: AI scoring complete — heuristic scores overridden.`);
    } else {
      console.warn(`Agent 2: AI scoring failed or disabled — using heuristic scores.`);
    }

    // ════════════════════════════════════════════════════════════════════════
    // STAGE 9: Final Assembly (full 10-stage from generate-roadmap)
    // ════════════════════════════════════════════════════════════════════════
    const usedResourceUrls = new Set<string>();
    const usedVideoIds = new Set<string>();
    const usedChannelTitles = new Map<string, Set<string>>();
    const usableMinutes = totalHours * 60 * 0.85;
    let totalRoadmapMinutes = 0;
    const selectedPrimaryUrls = new Set<string>();

    // Collect already-used URLs from completed modules
    for (const mod of modules) {
      if (!completedModuleIds.has(mod.id)) continue;
      for (const r of (mod.resources || [])) {
        const normalized = normalizeResourceUrl(String(r.url || ""));
        if (normalized) usedResourceUrls.add(normalized);
        const vid = extractYouTubeVideoId(normalized);
        if (vid) usedVideoIds.add(vid);
      }
    }

    for (const mod of modulesNeedingResources) {
      const candidates = allModuleCandidates.get(mod.id) || [];
      const moduleMinutes = Math.floor((mod.estimated_hours || 1) * 60);
      const dailyCapMinutes = hoursPerDay * 60 * 1.1;
      const dayStart = Number(mod.day_start || 1);
      const dayEnd = Number(mod.day_end || dayStart);
      const moduleDays = Math.max(1, dayEnd - dayStart + 1);
      const windowBudgetCap = moduleDays * dailyCapMinutes;
      const moduleBudgetCap = Math.min(moduleMinutes * 1.15, windowBudgetCap);
      const maxResources = getMaxResourcesForModule(Number(mod.estimated_hours || 1));
      const ctx: ModuleContext = {
        topic,
        moduleTitle: mod.title,
        moduleDescription: mod.description || "",
        learningObjectives: mod.learning_objectives || [],
        goal,
        level,
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

      // Constraint 1: Global uniqueness enforcement
      const uniqueResources: CandidateResource[] = [];
      for (const c of finalResources) {
        const normalizedUrl = c.url.split("&")[0];
        const videoId = extractYouTubeVideoId(normalizedUrl);

        if (c.is_continuation && c.continuation_of) {
          const baseUrl = c.continuation_of.split("&")[0];
          if (!selectedPrimaryUrls.has(baseUrl)) continue;
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

      // Constraint 2: Hard time budget enforcement
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

      // Constraint 3: Video requirement
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

      // Constraint 4: Coverage recovery
      const coverageTarget = moduleMinutes * 0.75;
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

      // Constraint 5: Rescue pool for 0-resource modules
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

      // Constraint 6: Clean excluded/disallowed resources
      const cleanedResources = budgetedResources.filter(c =>
        !isExcludedResource(c.url, excludedUrls, excludedDomains) &&
        isAllowedResourceUrl(c.url) &&
        !looksLikeListingPage(c.url, c.title, c.description) &&
        !isDiscussionOrMetaResource(c.url, c.title, c.description)
      );

      // Constraint 7: Video diversity cap
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

      // Constraint 8: Hard coverage top-up
      let finalizedMinutes = finalizedResources.reduce((sum, r) => sum + Number(r.estimated_minutes || 0), 0);
      const hardCoverageTarget = Math.min(moduleBudgetCap, Math.max(30, moduleMinutes * 0.65));

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

      // Constraint 9: Final video ratio enforcement
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

      // Constraint 10: Max resources trim
      if (finalizedResources.length > maxResources) {
        finalizedResources.sort((a, b) => (b.context_fit_score + b.authority_score) - (a.context_fit_score + a.authority_score));
        finalizedResources = finalizedResources.slice(0, maxResources);
        finalizedMinutes = finalizedResources.reduce((sum, r) => sum + Number(r.estimated_minutes || 0), 0);
      }

      // Track used URLs
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

      // Write resources into module
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
      }));

      // Filter search engine URLs
      if (mod.resources && mod.resources.length > 0) {
        mod.resources = mod.resources.filter((r: any) => {
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

      console.log(`Module "${mod.title}": ${mod.resources.length} resources assigned`);
    }

    // ════════════════════════════════════════════════════════════════════════
    // BACKFILL STAGE: Fetch additional resources for under-filled modules
    // If any module has < 85% of its time budget filled, run new Serper
    // searches with broader/different queries and add resources.
    // ════════════════════════════════════════════════════════════════════════
    const BACKFILL_COVERAGE_THRESHOLD = 0.85;
    const underfilledModules: any[] = [];

    for (const mod of modulesNeedingResources) {
      const moduleMinutes = Math.floor((mod.estimated_hours || 1) * 60);
      const filledMinutes = (mod.resources || []).reduce((sum: number, r: any) => sum + Number(r.estimated_minutes || 0), 0);
      if (filledMinutes < moduleMinutes * BACKFILL_COVERAGE_THRESHOLD) {
        underfilledModules.push(mod);
        console.log(`Backfill needed: "${mod.title}" has ${filledMinutes}/${moduleMinutes} min (${Math.round(filledMinutes / moduleMinutes * 100)}%)`);
      }
    }

    if (underfilledModules.length > 0) {
      console.log(`Backfill: ${underfilledModules.length} under-filled modules, fetching additional resources...`);
      const tBackfill = Date.now();

      // Build broader queries using learning objectives and different search terms
      const backfillPromises = underfilledModules.map(async (mod: any) => {
        const objectives = (mod.learning_objectives || []).filter((o: string) => typeof o === "string" && o.length > 0);
        const goalConfig = getGoalSearchConfig(goal, `${topic} ${mod.title}`);

        // Use different queries than the first round: objective-based + broader topic queries
        const backfillQueries: string[] = [];
        if (objectives.length > 0) {
          backfillQueries.push(`${mod.title} ${objectives[0]} ${goalConfig.intentTokens[0] || "tutorial"}`);
        }
        backfillQueries.push(`${topic} ${mod.title} ${goalConfig.queryModifiers[1] || "guide"} ${level}`);
        if (objectives.length > 1) {
          backfillQueries.push(`${objectives[1]} ${topic} ${goalConfig.intentTokens[1] || "explained"}`);
        }

        // Fetch videos + web for each query in parallel
        const fetchPromises: Promise<any>[] = [];
        for (const q of backfillQueries) {
          fetchPromises.push(searchSerper(q, SERPER_API_KEY, "videos", goalConfig.videoCount, supabaseAdmin, true));
          fetchPromises.push(searchSerper(q, SERPER_API_KEY, "search", goalConfig.webCount, supabaseAdmin, true));
        }
        const results = await Promise.all(fetchPromises);

        const videos: SerperVideoResult[] = [];
        const web: SerperWebResult[] = [];
        for (let i = 0; i < results.length; i++) {
          if (i % 2 === 0) videos.push(...(results[i] as SerperVideoResult[]));
          else web.push(...(results[i] as SerperWebResult[]));
        }

        return { moduleId: mod.id, videos, web };
      });

      const backfillResults = await Promise.all(backfillPromises);

      // Enrich new candidates with YouTube metadata
      const backfillVideoIds = new Set<string>();
      for (const { videos } of backfillResults) {
        for (const v of videos) {
          const vid = extractYouTubeVideoId(v.link);
          if (vid && !ytMap.has(vid)) backfillVideoIds.add(vid);
        }
      }

      if (backfillVideoIds.size > 0 && YOUTUBE_API_KEY) {
        const backfillYtMap = await fetchYouTubeMetadata([...backfillVideoIds], YOUTUBE_API_KEY, supabaseAdmin);
        for (const [k, v] of backfillYtMap) ytMap.set(k, v);
      }

      // Process backfill results and add to under-filled modules
      for (const { moduleId, videos, web } of backfillResults) {
        const mod = modulesNeedingResources.find((m: any) => m.id === moduleId);
        if (!mod) continue;

        const moduleMinutes = Math.floor((mod.estimated_hours || 1) * 60);
        const existingMinutes = (mod.resources || []).reduce((sum: number, r: any) => sum + Number(r.estimated_minutes || 0), 0);
        const targetMinutes = moduleMinutes * BACKFILL_COVERAGE_THRESHOLD;
        const maxResources = getMaxResourcesForModule(Number(mod.estimated_hours || 1));
        const moduleBudgetCap = moduleMinutes * 1.15;

        if (existingMinutes >= targetMinutes) continue;

        const ctx: ModuleContext = {
          topic, moduleTitle: mod.title, moduleDescription: mod.description || "",
          learningObjectives: mod.learning_objectives || [], goal, level, moduleMinutes,
        };

        // Merge and deduplicate new candidates
        const existingUrlsForMerge = new Set<string>((mod.resources || []).map((r: any) => normalizeResourceUrl(r.url)));
        const newCandidates = mergeAndDeduplicate({ videos: [], web: [] }, { videos, web }, mod.title, moduleMinutes, existingUrlsForMerge, new Set<string>());
        enrichCandidatesWithYouTube(newCandidates, ytMap, ctx);

        // Filter and score
        const existingUrls = new Set((mod.resources || []).map((r: any) => normalizeResourceUrl(r.url)));
        const filtered = newCandidates.filter(c => {
          if (isGarbage(c)) return false;
          if (!isAllowedResourceUrl(c.url)) return false;
          if (looksLikeListingPage(c.url, c.title, c.description)) return false;
          if (isDiscussionOrMetaResource(c.url, c.title, c.description)) return false;
          if (isExcludedResource(c.url, excludedUrls, excludedDomains)) return false;
          const normalized = normalizeResourceUrl(c.url);
          if (existingUrls.has(normalized) || usedResourceUrls.has(normalized)) return false;
          const videoId = extractYouTubeVideoId(normalized);
          if (videoId && usedVideoIds.has(videoId)) return false;
          return true;
        });

        for (const c of filtered) {
          computeLightAuthorityBump(c);
          computeContextFitScoreFallback(c, ctx);
        }

        // Sort by combined score and add until we hit 85% or maxResources
        filtered.sort((a, b) => (b.context_fit_score + b.authority_score) - (a.context_fit_score + a.authority_score));

        let addedMinutes = existingMinutes;
        let addedCount = (mod.resources || []).length;

        for (const c of filtered) {
          if (addedMinutes >= targetMinutes) break;
          if (addedCount >= maxResources) break;
          if (addedMinutes + c.estimated_minutes > moduleBudgetCap) continue;

          mod.resources.push({
            title: c.title, url: c.url, type: c.type,
            estimated_minutes: c.estimated_minutes, description: c.description,
            source: c.source, channel: c.channel,
            view_count: c.view_count, like_count: c.like_count,
            quality_signal: c.quality_signal,
            span_plan: c.span_plan, is_continuation: c.is_continuation,
            continuation_of: c.continuation_of,
          });

          addedMinutes += c.estimated_minutes;
          addedCount++;
          usedResourceUrls.add(normalizeResourceUrl(c.url));
          const videoId = extractYouTubeVideoId(normalizeResourceUrl(c.url));
          if (videoId) usedVideoIds.add(videoId);
        }

        console.log(`Backfill "${mod.title}": ${existingMinutes} → ${addedMinutes} min (${addedCount} resources)`);
      }

      console.log(`[TIMING] Backfill stage: ${Date.now() - tBackfill} ms`);
    }

    // ── Roadmap-level video diversity pass ──
    {
      const allResources = modules.flatMap((m: any) => m.resources || []);
      const videoCount = allResources.filter((r: any) => r.type === "video").length;
      const totalCount = allResources.length;
      const videoRatio = totalCount > 0 ? videoCount / totalCount : 0;
      const targetMaxVideoRatio = 0.62;

      if (videoRatio > targetMaxVideoRatio && totalCount >= 3) {
        const videosToReplace = Math.ceil(videoCount - totalCount * targetMaxVideoRatio);
        let replaced = 0;
        console.log(`Roadmap diversity: ${videoCount}/${totalCount} videos (${Math.round(videoRatio * 100)}%). Swapping up to ${videosToReplace}.`);

        const sortedModules = [...modules]
          .filter((m: any) => (m.resources?.length || 0) >= 2)
          .sort((a: any, b: any) => (b.resources?.length || 0) - (a.resources?.length || 0));

        for (const mod of sortedModules) {
          if (replaced >= videosToReplace) break;
          const resources = mod.resources as any[];
          const moduleVideos = resources.filter((r: any) => r.type === "video");
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
            const idx = resources.findIndex((r: any) => r.url === weakestVideo.url);
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
              };
              usedResourceUrls.add(normalizeResourceUrl(bestNonVideo.url));
              replaced++;
            }
          }
        }
        console.log(`Roadmap diversity: Replaced ${replaced}/${videosToReplace} videos with non-video resources.`);
      }
    }

    // Clear resources_pending flag
    roadmapData.resources_pending = false;

    // Write updated roadmap back to DB
    const { error: writeErr } = await supabaseAdmin
      .from("roadmaps")
      .update({ roadmap_data: roadmapData })
      .eq("id", roadmap_id);

    if (writeErr) {
      console.error(`[populate-resources] DB write failed:`, writeErr);
      return new Response(JSON.stringify({ error: "Failed to save resources" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const totalResources = modules.reduce((sum: number, m: any) => sum + (m.resources?.length || 0), 0);
    console.log(`[populate-resources] Done in ${Date.now() - t0}ms: ${totalResources} resources across ${modules.length} modules`);

    return new Response(JSON.stringify({ success: true, total_resources: totalResources }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("populate-resources error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
