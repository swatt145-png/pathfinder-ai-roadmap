import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// ─── Import shared resource pipeline ─────────────────────────────────────────
import {
  type CandidateResource,
  type Resource,
  type YouTubeMetadata,
  type ModuleContext,
  PIPELINE_LIMITS,
  TIMEOUTS_MS,
  isAbortError,
  fetchWithTimeout,
  extractYouTubeVideoId,
  normalizeResourceUrl,
  extractResourceHost,
  isExcludedResource,
  isAllowedResourceUrl,
  detectCertificationIntent,
  getMaxResourcesForModule,
  computeHybridSimilarity,
  isGarbage,
  generateModuleAnchors,
  applyStage4Filter,
  applyDiversityCaps,
  looksLikeListingPage,
  isDiscussionOrMetaResource,
  fetchYouTubeMetadata,
  fetchTopicAnchors,
  fetchModuleResults,
  computeLightAuthorityBump,
  computeContextFitScoreFallback,
  mergeAndDeduplicate,
  enrichCandidatesWithYouTube,
  clusterAndDiversify,
} from "../_shared/resource-pipeline.ts";

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

function fixThirdPersonLanguage(text: string): string {
  if (!text || typeof text !== "string") return text;
  return text
    .replace(/\bthe user has\b/gi, "you have")
    .replace(/\bthe user's\b/gi, "your")
    .replace(/\bthe user is\b/gi, "you are")
    .replace(/\bthe user\b/gi, "you")
    .replace(/\bthe student has\b/gi, "you have")
    .replace(/\bthe student's\b/gi, "your")
    .replace(/\bthe student is\b/gi, "you are")
    .replace(/\bthe student\b/gi, "you")
    .replace(/\bthe learner has\b/gi, "you have")
    .replace(/\bthe learner's\b/gi, "your")
    .replace(/\bthe learner\b/gi, "you")
    .replace(/\bUser has\b/g, "You have")
    .replace(/\bUser's\b/g, "Your");
}

function stripModuleQuizzes(roadmap: any): void {
  if (!roadmap || !Array.isArray(roadmap.modules)) return;
  for (const mod of roadmap.modules) {
    mod.quiz = [];
  }
}

// ─── LLM Helpers (mirrored from generate-roadmap) ───────────────────────────

const ROADMAP_MODEL_AGENT2 = "google/gemini-2.5-flash";

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

  const scoringInput = {
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
1. SEMANTIC RELEVANCE (0-40): Does this resource actually teach what this module needs?
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
- LOW-VIEW PENALTY: If a YouTube video has fewer than 1,000 views from an unknown channel, only select it if no better alternative exists.
- Avoid redundancy — don't pick 3 similar videos.
- DIVERSITY PREFERENCE: When quality is comparable, prefer a mix of resource types.
- Time budget is a HARD CONSTRAINT: total selected minutes must not exceed ${Math.round((mod.estimated_hours || 1) * 60)} minutes.
- Prefer one long high-quality resource over multiple short ones when it fits the budget.
- Exclude discussion threads and search-result/listing pages.
- If a candidate title contains "(Continue: X–Y min)", it's a continuation resource — ALWAYS select it.

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

interface Agent2Result {
  success: boolean;
  selections: Map<string, string[]>;
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

function redistributeDayRanges(
  modules: any[],
  totalDays: number,
  hoursPerDay: number,
  completedModuleIds: Set<string>
): void {
  if (!Array.isArray(modules) || modules.length === 0) return;
  const safeHoursPerDay = Math.max(Number(hoursPerDay || 0), 0.5);

  let completedDaysUsed = 0;
  for (const mod of modules) {
    if (completedModuleIds.has(String(mod.id || ""))) {
      completedDaysUsed = Math.max(completedDaysUsed, Number(mod.day_end || 0));
    }
  }

  const remainingDays = Math.max(1, totalDays - completedDaysUsed);
  const remainingModules = modules.filter(m => !completedModuleIds.has(String(m.id || "")));
  if (remainingModules.length === 0) return;

  const rawDayNeeds = remainingModules.map(m => {
    const hrs = Math.max(0.5, Number(m.estimated_hours || 1));
    return Math.max(1, Math.round(hrs / safeHoursPerDay));
  });

  const totalRawDays = rawDayNeeds.reduce((a, b) => a + b, 0);

  let scaledDays: number[];
  if (totalRawDays <= remainingDays) {
    const scale = remainingDays / totalRawDays;
    scaledDays = rawDayNeeds.map(d => Math.max(1, Math.round(d * scale)));
  } else {
    const scale = remainingDays / totalRawDays;
    scaledDays = rawDayNeeds.map(d => Math.max(1, Math.round(d * scale)));
  }

  let assignedTotal = scaledDays.reduce((a, b) => a + b, 0);
  while (assignedTotal > remainingDays && scaledDays.length > 0) {
    let maxIdx = 0;
    for (let i = 1; i < scaledDays.length; i++) {
      if (scaledDays[i] > scaledDays[maxIdx]) maxIdx = i;
    }
    if (scaledDays[maxIdx] <= 1) break;
    scaledDays[maxIdx]--;
    assignedTotal--;
  }
  while (assignedTotal < remainingDays) {
    let minIdx = 0;
    for (let i = 1; i < scaledDays.length; i++) {
      if (scaledDays[i] < scaledDays[minIdx]) minIdx = i;
    }
    scaledDays[minIdx]++;
    assignedTotal++;
  }

  let currentDay = completedDaysUsed + 1;
  for (let i = 0; i < remainingModules.length; i++) {
    const mod = remainingModules[i];
    const days = scaledDays[i];
    mod.day_start = currentDay;
    mod.day_end = currentDay + days - 1;
    mod.week = Math.max(1, Math.ceil(mod.day_start / 7));
    currentDay = mod.day_end + 1;
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
    const supabaseAuth = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: authUser }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !authUser) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { roadmap_data, all_progress, new_timeline_weeks, new_timeline_days, new_hours_per_day, learning_goal } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
    const SERPER_API_KEY = Deno.env.get("SERPER_API_KEY");
    const YOUTUBE_API_KEY = Deno.env.get("YOUTUBE_API_KEY");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAdmin = (Deno.env.get("SUPABASE_URL") && SUPABASE_SERVICE_ROLE_KEY)
      ? createClient(Deno.env.get("SUPABASE_URL")!, SUPABASE_SERVICE_ROLE_KEY)
      : null;

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

    // Calculate days completed based on actual day_end values of completed modules
    const daysCompleted = completedModulesData.reduce((max: number, m: any) => Math.max(max, Number(m.day_end || 0)), 0);

    // Build summary of what was already covered
    const completedTopicsSummary = completedModulesData.map((m: any) =>
      `- "${m.title}": ${m.description || ""}${m.learning_objectives?.length ? ` (covered: ${m.learning_objectives.join(", ")})` : ""}`
    ).join("\n");

    // Build summary of remaining/uncovered topics from original modules
    const remainingTopicsSummary = remainingModules.map((m: any) =>
      `- "${m.title}": ${m.description || ""}${m.anchor_terms?.length ? ` [terms: ${m.anchor_terms.join(", ")}]` : ""}`
    ).join("\n");

    const goalContext = effectiveGoal === "conceptual"
      ? "Learning goal: CONCEPTUAL — prefer lectures, explainer videos, and theory."
      : effectiveGoal === "hands_on"
      ? "Learning goal: HANDS-ON — prefer coding tutorials, exercises, and project-based content."
      : effectiveGoal === "quick_overview"
      ? "Learning goal: QUICK OVERVIEW — prefer crash courses, cheat sheets, and summaries."
      : effectiveGoal === "deep_mastery"
      ? "Learning goal: DEEP MASTERY — prefer comprehensive courses, official docs, and advanced tutorials."
      : "";

    const systemPrompt = `You are an expert learning-plan designer. Address the user directly ("you/your"). Keep all text crisp — no filler.

Your job: generate a FRESH set of modules to cover topics the user hasn't completed yet, fitted to their new time budget. Do NOT restructure or redistribute old modules — design new ones from scratch based on what still needs to be learned.

${goalContext}

RULES:
1. The updated_roadmap MUST include completed modules FIRST (unchanged), then your NEW modules.
2. Completed modules (IDs: ${JSON.stringify(completedModuleIds)}) MUST appear exactly as provided — same id, title, description, resources, estimated_hours, day_start, day_end, week. Do NOT modify them.
3. For NEW modules, generate fresh content covering topics NOT yet completed. Each module needs:
   - id: "mod_N" format (sequential after completed modules)
   - title: clear, specific module title
   - description: 2-3 sentences explaining what this module covers
   - estimated_hours: realistic hours for the content
   - day_start / day_end: sequential within the remaining timeline (days ${daysCompleted + 1} to ${daysCompleted + displayDays})
   - week: ceil(day_start / 7)
   - prerequisites: array of module ids this depends on
   - learning_objectives: 2-4 specific, measurable objectives
   - anchor_terms: 3-8 concrete technical terms specific to this module (e.g., "closure", "event-loop", "promise") — NOT generic words
   - resources: [] (leave empty — resources are populated separately)
   - quiz: []
4. Time budget: ${displayDays} day(s) at ${hrsPerDay}h/day = ${totalAvailableHours}h total for new modules. The sum of all new modules' estimated_hours MUST equal ${totalAvailableHours}h.
5. Day numbering for new modules starts at day ${daysCompleted + 1}.
6. MODULE COUNT LIMIT based on remaining hours (R = ${totalAvailableHours}):
   ${totalAvailableHours <= 12 ? `- R ≤ 12: max ${Math.max(1, Math.floor(totalAvailableHours / 2))} modules` : totalAvailableHours <= 50 ? `- 12 < R ≤ 50: max ${Math.max(4, Math.floor(totalAvailableHours / 3))} modules` : `- R > 50: max ${Math.max(6, Math.floor(totalAvailableHours / 4))} modules`}
   - Minimum module duration: 1 hour.
7. timeline_days = ${daysCompleted + displayDays}
8. timeline_weeks = ${Math.ceil((daysCompleted + displayDays) / 7)}
9. hours_per_day = ${hrsPerDay}
10. total_hours = ${totalCompletedHours} (completed) + new module hours
11. Keep analysis to 1-2 sentences`;

    const userPrompt = `The user is learning: "${roadmap_data.title || roadmap_data.topic || "this subject"}"

COMPLETED TOPICS (${completedModules.length} modules, ${totalCompletedHours}h):
${completedTopicsSummary || "(none)"}

REMAINING/UNCOVERED TOPICS from original plan (${remainingModules.length} modules):
${remainingTopicsSummary || "(none)"}

NEW TIME BUDGET: ${displayDays} day(s), ${hrsPerDay}h/day (${totalAvailableHours}h total)

Generate a fresh module plan covering the uncovered topics above, fitted to the new time budget. Prioritize the most important uncovered topics if time is tight.

Completed modules to include unchanged: ${JSON.stringify(completedModulesData.map((m: any) => ({
      id: m.id, title: m.title, description: m.description,
      estimated_hours: m.estimated_hours, day_start: m.day_start, day_end: m.day_end,
      week: m.week, prerequisites: m.prerequisites, learning_objectives: m.learning_objectives,
      anchor_terms: m.anchor_terms, resources: m.resources, quiz: m.quiz || [],
    })))}

Return ONLY valid JSON:
{
  "analysis": "1-2 sentence summary of what your adapted plan covers",
  "options": [
    {
      "id": "adapted_plan",
      "label": "Adapted Plan",
      "description": "1 sentence describing the new module plan",
      "timeline_days": ${daysCompleted + displayDays},
      "hours_per_day": ${hrsPerDay},
      "total_remaining_hours": ${totalAvailableHours},
      "modules_kept": number (completed + new),
      "modules_removed": [],
      "modules_added": ["list of new module titles"],
      "tradeoff": "1 sentence about what changed",
      "updated_roadmap": {
        "title": "${roadmap_data.title || ""}",
        "topic": "${roadmap_data.topic || ""}",
        "summary": "updated 1-2 sentence summary",
        "tips": "1-2 practical tips",
        "timeline_days": ${daysCompleted + displayDays},
        "timeline_weeks": ${Math.ceil((daysCompleted + displayDays) / 7)},
        "hours_per_day": ${hrsPerDay},
        "total_hours": number,
        "modules": [ ...completed modules unchanged, ...new fresh modules ]
      }
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
    let isFallback = false;
    try {
      result = parseAiJson(content);
    } catch {
      isFallback = true;
      result = {
        analysis: "Couldn't generate a new plan automatically. Your current plan is preserved with all resources intact.",
        options: [{
          id: "keep_current", label: "Keep Current Plan",
          description: "Continue with your current roadmap — no changes applied.",
          timeline_days: roadmap_data.timeline_days || (roadmap_data.timeline_weeks * 7),
          hours_per_day: roadmap_data.hours_per_day || Number(new_hours_per_day),
          total_remaining_hours: remainingHours,
          modules_kept: Array.isArray(roadmap_data?.modules) ? roadmap_data.modules.length : 0,
          modules_removed: [], modules_added: [],
          tradeoff: "No changes — your existing plan and resources are preserved.",
          updated_roadmap: { ...roadmap_data, resources_pending: false },
        }],
        recommendation: "keep_current",
        recommendation_reason: "Your current plan is preserved because the AI couldn't generate a new one.",
      };
    }

    // Post-process adapted roadmap structure (skip for fallback — original data is already correct)
    const completedModuleIdSet = new Set<string>(completedModuleIds);

    if (result.options && !isFallback) {
      for (const opt of result.options) {
        if (opt.updated_roadmap) {
          stripModuleQuizzes(opt.updated_roadmap);
          sanitizeRoadmapPlaceholders(opt.updated_roadmap);
          redistributeDayRanges(
            opt.updated_roadmap.modules || [],
            opt.updated_roadmap.timeline_days || displayDays,
            hrsPerDay,
            completedModuleIdSet
          );
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
          // Enforce module count limit on remaining modules
          if (Array.isArray(opt.updated_roadmap.modules)) {
            const remainingMods = opt.updated_roadmap.modules.filter((m: any) => !completedModuleIdSet.has(m.id));
            const remainingHrs = remainingMods.reduce((sum: number, m: any) => sum + Number(m.estimated_hours || 0), 0);
            let maxRemaining: number;
            if (remainingHrs <= 12) maxRemaining = Math.max(1, Math.floor(remainingHrs / 2));
            else if (remainingHrs <= 50) maxRemaining = Math.max(4, Math.floor(remainingHrs / 3));
            else maxRemaining = Math.max(6, Math.floor(remainingHrs / 4));

            if (remainingMods.length > maxRemaining) {
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

            // Enforce minimum 1h per remaining module
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

            opt.updated_roadmap.total_hours = Math.round(
              opt.updated_roadmap.modules.reduce((sum: number, m: any) => sum + Number(m.estimated_hours || 0), 0) * 10
            ) / 10;
          }

          // Ensure anchor_terms exist for new modules (needed for resource search)
          if (Array.isArray(opt.updated_roadmap.modules)) {
            for (const mod of opt.updated_roadmap.modules) {
              if (!completedModuleIdSet.has(mod.id)) {
                mod.resources = [];
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

    // ════════════════════════════════════════════════════════════════════════
    // RESOURCE PIPELINE: Populate resources for new modules inline
    // ════════════════════════════════════════════════════════════════════════
    if (result.options && !isFallback && SERPER_API_KEY && YOUTUBE_API_KEY) {
      const topic = roadmap_data.title || roadmap_data.topic || "";
      const skillLevel = roadmap_data.skill_level || "beginner";
      const certificationIntent = detectCertificationIntent(topic);

      // Load user feedback exclusions
      const excludedUrls = new Set<string>();
      const excludedDomains = new Set<string>();
      if (supabaseAdmin && authUser?.id && topic) {
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
            const normalized = normalizeResourceUrl(String(row.resource_url));
            excludedUrls.add(normalized);
            const host = extractResourceHost(String(row.resource_url));
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
      }
      const allowCacheWrite = excludedUrls.size === 0;

      for (const opt of result.options) {
        if (!opt.updated_roadmap || !Array.isArray(opt.updated_roadmap.modules)) continue;

        const newModules = opt.updated_roadmap.modules.filter((m: any) => !completedModuleIdSet.has(m.id));
        if (newModules.length === 0) continue;

        console.log(`Resource pipeline: populating ${newModules.length} new modules for option "${opt.id || opt.label}"...`);
        const tPipeline = Date.now();

        try {
          // ── Stage 2: Parallel Serper fetch ──
          const topicAnchorPromise = fetchTopicAnchors(topic, skillLevel, effectiveGoal, certificationIntent, SERPER_API_KEY, supabaseAdmin, allowCacheWrite, true);
          const moduleResultsPromises = newModules.map((mod: any) =>
            fetchModuleResults(mod, topic, skillLevel, effectiveGoal, certificationIntent, SERPER_API_KEY, supabaseAdmin, allowCacheWrite, true)
          );

          const [topicAnchors, ...allModuleResults] = await Promise.all([
            topicAnchorPromise,
            ...moduleResultsPromises,
          ]);
          console.log(`[TIMING] Stage 2 retrieval: ${Date.now() - tPipeline} ms`);

          // ── Merge & deduplicate per module ──
          const allModuleCandidates = new Map<string, CandidateResource[]>();
          const totalAvailableMinutes = totalAvailableHours * 60;

          for (let i = 0; i < newModules.length; i++) {
            const mod = newModules[i];
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

          // ── Stage 3: YouTube enrichment ──
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
            ytMap = await fetchYouTubeMetadata([...allVideoIds], YOUTUBE_API_KEY, supabaseAdmin);
            console.log(`[TIMING] YouTube enrichment: ${Date.now() - tYT} ms (${ytMap.size} hits)`);
          }

          // ── Stages 4-5: Filtering + authority scoring ──
          const moduleRescuePools = new Map<string, CandidateResource[]>();
          for (const mod of newModules) {
            const candidates = allModuleCandidates.get(mod.id) || [];
            const anchorTerms = generateModuleAnchors(mod, topic);
            const ctx: ModuleContext = {
              topic,
              moduleTitle: mod.title,
              moduleDescription: mod.description || "",
              learningObjectives: mod.learning_objectives || [],
              goal: effectiveGoal,
              level: skillLevel,
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
              stage5Filtered = rescuePool.slice(0, 8);
            }
            stage5Filtered = [...stage5Filtered]
              .sort((a, b) => (b.context_fit_score + b.authority_score) - (a.context_fit_score + a.authority_score))
              .slice(0, 18);

            allModuleCandidates.set(mod.id, stage5Filtered);
          }

          // ── Stage 6: Parallel Agent 2 scoring ──
          const agent2Result = await parallelModuleAIScoring(
            allModuleCandidates,
            newModules,
            topic,
            effectiveGoal,
            skillLevel,
            LOVABLE_API_KEY,
          );
          const rerankerSelections = agent2Result.selections;

          // ── Final Assembly ──
          const usedResourceUrls = new Set<string>();
          const usedVideoIds = new Set<string>();

          for (const mod of newModules) {
            const candidates = allModuleCandidates.get(mod.id) || [];
            const moduleMinutes = Math.floor((mod.estimated_hours || 1) * 60);
            const moduleBudgetCap = moduleMinutes * 1.05;
            const maxResources = getMaxResourcesForModule(Number(mod.estimated_hours || 1));
            const ctx: ModuleContext = {
              topic,
              moduleTitle: mod.title,
              moduleDescription: mod.description || "",
              learningObjectives: mod.learning_objectives || [],
              goal: effectiveGoal,
              level: skillLevel,
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

            // Global uniqueness
            const uniqueResources: CandidateResource[] = [];
            for (const c of finalResources) {
              const normalizedUrl = normalizeResourceUrl(c.url);
              const videoId = extractYouTubeVideoId(normalizedUrl);
              if (usedResourceUrls.has(normalizedUrl)) continue;
              if (videoId && usedVideoIds.has(videoId)) continue;
              uniqueResources.push(c);
            }

            // Time budget enforcement
            const budgetedResources: CandidateResource[] = [];
            let moduleTotal = 0;
            for (const c of uniqueResources) {
              if (moduleTotal + c.estimated_minutes > moduleBudgetCap) continue;
              budgetedResources.push(c);
              moduleTotal += c.estimated_minutes;
            }

            if (budgetedResources.length === 0 && uniqueResources.length > 0) {
              const shortest = [...uniqueResources]
                .filter(c => c.estimated_minutes <= moduleBudgetCap * 1.1)
                .sort((a, b) => a.estimated_minutes - b.estimated_minutes)[0];
              if (shortest) {
                budgetedResources.push(shortest);
                moduleTotal = shortest.estimated_minutes;
              }
            }

            // Coverage recovery from rescue pool
            const coverageTarget = moduleMinutes * 0.6;
            if (moduleTotal < coverageTarget) {
              const rescuePool = moduleRescuePools.get(mod.id) || [];
              for (const c of rescuePool) {
                if (budgetedResources.length >= maxResources) break;
                if (budgetedResources.some(b => b.url === c.url)) continue;
                const normalized = normalizeResourceUrl(c.url);
                const videoId = extractYouTubeVideoId(normalized);
                if (usedResourceUrls.has(normalized)) continue;
                if (videoId && usedVideoIds.has(videoId)) continue;
                if (moduleTotal + c.estimated_minutes > moduleBudgetCap) continue;
                budgetedResources.push(c);
                moduleTotal += c.estimated_minutes;
                if (moduleTotal >= coverageTarget) break;
              }
            }

            // Clean and apply
            const cleanedResources = budgetedResources.filter(c =>
              !isExcludedResource(c.url, excludedUrls, excludedDomains) &&
              isAllowedResourceUrl(c.url) &&
              !looksLikeListingPage(c.url, c.title, c.description) &&
              !isDiscussionOrMetaResource(c.url, c.title, c.description)
            );

            // Video diversity cap
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

            if (finalizedResources.length > maxResources) {
              finalizedResources.sort((a, b) => (b.context_fit_score + b.authority_score) - (a.context_fit_score + a.authority_score));
              finalizedResources = finalizedResources.slice(0, maxResources);
            }

            // Track used URLs
            for (const c of finalizedResources) {
              usedResourceUrls.add(normalizeResourceUrl(c.url));
              const videoId = extractYouTubeVideoId(c.url);
              if (videoId) usedVideoIds.add(videoId);
            }

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
            } as Resource));

            console.log(`Module "${mod.title}": ${mod.resources.length} resources assigned`);
          }

          console.log(`[TIMING] Full resource pipeline: ${Date.now() - tPipeline} ms`);
        } catch (e) {
          console.error("Resource pipeline error (adapt-roadmap):", e);
          // Non-fatal: modules will have empty resources, but structure is intact
        }

        // Resources are populated (or failed gracefully) — not pending
        opt.updated_roadmap.resources_pending = false;
      }
    } else if (result.options && !isFallback) {
      // Missing API keys — mark as not pending (resources will be empty but no async call needed)
      console.warn("Resource pipeline skipped: SERPER_API_KEY or YOUTUBE_API_KEY not configured");
      for (const opt of result.options) {
        if (opt.updated_roadmap) {
          opt.updated_roadmap.resources_pending = false;
        }
      }
    }

    // Fix third-person language in all user-facing text
    if (result.analysis) result.analysis = fixThirdPersonLanguage(result.analysis);
    if (result.recommendation_reason) result.recommendation_reason = fixThirdPersonLanguage(result.recommendation_reason);
    if (result.options) {
      for (const opt of result.options) {
        if (opt.description) opt.description = fixThirdPersonLanguage(opt.description);
        if (opt.tradeoff) opt.tradeoff = fixThirdPersonLanguage(opt.tradeoff);
      }
    }

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("adapt-roadmap error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
