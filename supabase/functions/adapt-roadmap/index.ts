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
    const totalDays = new_timeline_days != null ? Number(new_timeline_days) : (Number(new_timeline_weeks) * 7);
    const totalAvailableHours = totalDays * Number(new_hours_per_day);

    const completedModules = all_progress?.filter((p: any) => p.status === "completed") || [];

    const systemPrompt = `You are a concise learning-plan optimizer. Speak directly to the user (use "you/your", never "the student"). Keep all text short and actionable — no filler.

RULES:
- Never remove or modify completed modules
- The user has exactly ${totalDays} day(s) and ${new_hours_per_day} hour(s)/day = ${totalAvailableHours} total hours remaining
- Provide 2-3 realistic options with clear tradeoffs
- Keep analysis to 1-2 sentences max
- Keep descriptions and tradeoffs to 1 sentence each
- Use "timeline_days" (not weeks) in the response`;

    const userPrompt = `Completed: ${completedModules.length}/${roadmap_data.modules.length} modules.
Remaining time: ${totalDays} day(s), ${new_hours_per_day}h/day (${totalAvailableHours}h total).

Current roadmap: ${JSON.stringify(roadmap_data)}
Progress: ${JSON.stringify(all_progress)}

Return ONLY valid JSON:
{
  "analysis": "1-2 sentence summary addressing the user directly",
  "options": [
    {
      "id": "option_a",
      "label": "Keep Everything",
      "description": "1 sentence",
      "timeline_days": number,
      "hours_per_day": number,
      "total_remaining_hours": number,
      "modules_kept": number,
      "modules_removed": [],
      "modules_added": [],
      "tradeoff": "1 sentence",
      "updated_roadmap": { full roadmap JSON with same structure }
    }
  ],
  "recommendation": "option_a|option_b|option_c",
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
          timeline_days: totalDays, hours_per_day: Number(new_hours_per_day),
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
