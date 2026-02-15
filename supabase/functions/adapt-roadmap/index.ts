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
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }

      if (ch === "\\") {
        out += ch;
        escaped = true;
        continue;
      }

      if (ch === "\"") {
        out += ch;
        inString = false;
        continue;
      }

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

      out += ch;
      continue;
    }

    if (ch === "\"") {
      inString = true;
    }
    out += ch;
  }

  return out;
}

function extractJsonCandidate(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return content.slice(firstBrace, lastBrace + 1);
  }

  return content;
}

function parseAiJson(content: unknown): any {
  if (typeof content === "object" && content !== null) return content;
  if (typeof content !== "string") throw new Error("AI returned unexpected response format");

  const attempts: string[] = [];
  attempts.push(content);

  const extracted = extractJsonCandidate(content);
  if (extracted !== content) attempts.push(extracted);

  const sanitized = sanitizeControlCharsInJson(content);
  if (sanitized !== content) attempts.push(sanitized);

  const extractedSanitized = sanitizeControlCharsInJson(extracted);
  if (!attempts.includes(extractedSanitized)) attempts.push(extractedSanitized);

  let lastErr: unknown = null;
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch (e) {
      lastErr = e;
    }
  }

  throw new Error(`Unable to parse AI JSON response: ${lastErr instanceof Error ? lastErr.message : "Unknown parse error"}`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { roadmap_data, all_progress, new_timeline_weeks, new_hours_per_day, adjustment_type } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const completedModules = all_progress?.filter((p: any) => p.status === "completed") || [];

    const systemPrompt = `You are Pathfinder's replanning engine. The student's time constraints have changed and the roadmap needs to be restructured.

RULES:
- Never remove or modify completed modules — they're done
- Calculate remaining content vs remaining available hours
- Always provide 2-3 realistic options for the student to choose from
- Be honest about tradeoffs

OPTION TYPES:
- 'Keep Everything': Extend timeline or increase daily hours to fit all content
- 'Focus on Essentials': Cut optional/advanced modules, keep core concepts
- 'Balanced': Slight timeline extension + some scope reduction`;

    const userPrompt = `Student has completed ${completedModules.length} of ${roadmap_data.modules.length} modules.
New timeline: ${new_timeline_weeks} weeks
New hours per day: ${new_hours_per_day}

Current roadmap: ${JSON.stringify(roadmap_data)}
Progress: ${JSON.stringify(all_progress)}

Return ONLY valid JSON:
{
  "analysis": "brief assessment",
  "options": [
    {
      "id": "option_a",
      "label": "Keep Everything",
      "description": "plain English description",
      "timeline_weeks": number,
      "hours_per_day": number,
      "total_remaining_hours": number,
      "modules_kept": number,
      "modules_removed": [],
      "modules_added": [],
      "tradeoff": "what student gains/gives up",
      "updated_roadmap": { full roadmap JSON with same structure }
    }
  ],
  "recommendation": "option_a|option_b|option_c",
  "recommendation_reason": "why this is best"
}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
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
    } catch (parseError) {
      console.error("adapt-roadmap parse error:", parseError);
      result = {
        analysis: "Could not fully parse adaptation options, so we preserved your current roadmap as a safe fallback.",
        options: [
          {
            id: "option_a",
            label: "Keep Current Plan",
            description: "Continue with your current roadmap and adjust later.",
            timeline_weeks: Number(new_timeline_weeks ?? roadmap_data?.timeline_weeks ?? 0),
            hours_per_day: Number(new_hours_per_day ?? roadmap_data?.hours_per_day ?? 0),
            total_remaining_hours: 0,
            modules_kept: Array.isArray(roadmap_data?.modules) ? roadmap_data.modules.length : 0,
            modules_removed: [],
            modules_added: [],
            tradeoff: "No automatic scope adjustment was applied.",
            updated_roadmap: roadmap_data,
          },
        ],
        recommendation: "option_a",
        recommendation_reason: "Fallback option to avoid interruption.",
      };
    }

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("adapt-roadmap error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
