import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
    const result = JSON.parse(content);

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("adapt-roadmap error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
