import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// No resource pipeline imports needed — adapt-roadmap returns structure only;
// resources are populated asynchronously by the populate-resources edge function.

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

function stripModuleQuizzes(roadmap: any): void {
  if (!roadmap || !Array.isArray(roadmap.modules)) return;
  for (const mod of roadmap.modules) {
    mod.quiz = [];
  }
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

          // Clear stale/placeholder resources from non-completed modules
          // Resources will be populated asynchronously by populate-resources edge function
          if (Array.isArray(opt.updated_roadmap.modules)) {
            for (const mod of opt.updated_roadmap.modules) {
              if (!completedModuleIdSet.has(mod.id)) {
                mod.resources = [];
                // Ensure anchor_terms exist so populate-resources can build good queries
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

    // Mark resources as pending — client will call populate-resources to fill them (skip for fallback)
    if (result.options && !isFallback) {
      for (const opt of result.options) {
        if (opt.updated_roadmap) {
          opt.updated_roadmap.resources_pending = true;
        }
      }
    }

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("adapt-roadmap error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
