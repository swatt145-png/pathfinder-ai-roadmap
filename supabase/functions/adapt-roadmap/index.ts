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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { roadmap_data, all_progress, new_timeline_weeks, new_timeline_days, new_hours_per_day } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Support both days and weeks input; prefer days
    // 0 days means "finish today" — user still has hours available today
    const rawDays = new_timeline_days != null ? Number(new_timeline_days) : (Number(new_timeline_weeks) * 7);
    const hrsPerDay = Number(new_hours_per_day);
    const totalAvailableHours = rawDays === 0 ? hrsPerDay : rawDays * hrsPerDay;
    const displayDays = rawDays === 0 ? 1 : rawDays; // "today" counts as 1 day of work

    const completedModules = all_progress?.filter((p: any) => p.status === "completed") || [];
    const remainingModules = roadmap_data.modules.filter((m: any) =>
      !completedModules.some((p: any) => p.module_id === m.id)
    );
    const remainingHours = remainingModules.reduce((sum: number, m: any) => sum + (m.estimated_hours || 0), 0);

    // Build the list of completed module IDs for the prompt
    const completedModuleIds = completedModules.map((p: any) => p.module_id);
    const completedModulesData = roadmap_data.modules.filter((m: any) => completedModuleIds.includes(m.id));
    const totalCompletedHours = completedModulesData.reduce((sum: number, m: any) => sum + (m.estimated_hours || 0), 0);
    const totalDaysCompleted = completedModulesData.length; // 1 module ≈ 1 day

    // Determine the adaptation strategy deterministically in code
    const isCrashCourse = totalAvailableHours < remainingHours;
    const isSplit = !isCrashCourse && hrsPerDay < remainingHours && displayDays > 1;
    // isCrashCourse: user has LESS total time → condense resources
    // isSplit: user has enough total time but fewer hrs/day → split modules into daily chunks
    // else: just redistribute

    let strategyInstruction: string;
    if (isCrashCourse) {
      strategyInstruction = `STRATEGY: CRASH COURSE (user has ${totalAvailableHours}h but needs ${remainingHours}h — LESS time available).
You MUST condense all remaining modules to fit within exactly ${totalAvailableHours}h total.
- REPLACE the resources in each remaining module with shorter crash-course alternatives (summary videos, cheat sheets, quick tutorials) covering the SAME topics.
- The total estimated_hours of ALL remaining modules combined MUST equal ${totalAvailableHours}h (not more).
- The number of remaining modules stays the SAME (${remainingModules.length}) — do NOT split or add modules.
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

    const systemPrompt = `You are a concise learning-plan optimizer. Address the user directly ("you/your"). Keep all text crisp — no filler.

RULES:
- The updated_roadmap MUST include ALL modules: both completed and adapted. Do NOT omit completed modules.
- Completed modules (IDs: ${JSON.stringify(completedModuleIds)}) MUST appear first in the modules array, completely unchanged — same id, title, resources, estimated_hours, day_start, day_end, week.
${strategyInstruction}
- total_hours in updated_roadmap = ${totalCompletedHours} (completed) + adapted remaining hours
- timeline_weeks = ceil(total_days / 7)
- hours_per_day = ${hrsPerDay}
- modules_kept = total number of modules in the final roadmap (completed + adapted)
- Keep analysis to 1-2 sentences`;

    const userPrompt = `Completed: ${completedModules.length}/${roadmap_data.modules.length} modules (${remainingModules.length} remaining, ~${remainingHours}h of content).
Available: ${displayDays} day(s), ${hrsPerDay}h/day (${totalAvailableHours}h total).

Current roadmap: ${JSON.stringify(roadmap_data)}
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
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        response_format: { type: "json_object" },
      }),
    });

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

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("adapt-roadmap error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
