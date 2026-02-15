import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { roadmap_data, module_id, module_title, self_report, quiz_score, quiz_answers, all_progress } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Determine if adaptation needed
    let needsCheck = false;
    if (self_report === "hard" && (quiz_score === null || quiz_score < 60)) needsCheck = true;
    else if (self_report === "hard" && quiz_score >= 60) needsCheck = true;
    else if (self_report === "easy" && quiz_score !== null && quiz_score > 90) needsCheck = true;

    if (!needsCheck) {
      return new Response(JSON.stringify({
        needs_adaptation: false,
        adaptation_type: "none",
        reason: "Performance is on track. No changes needed.",
        changes_summary: "",
        message_to_student: "Great progress! Keep going at this pace. 💪",
        updated_roadmap: null,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const systemPrompt = `You are Pathfinder's intelligent adaptation engine. A student is progressing through a learning roadmap and has just checked in on a module. Analyze their performance and determine if the remaining roadmap needs adjustment.

ADAPTATION LOGIC:
- If the module was HARD and quiz score < 60%: Insert a focused review module. Adjust timeline.
- If the module was HARD but quiz score >= 60%: Add 1-2 supplementary resources to next module. No structural change.
- If the module was EASY and quiz score > 90%: Check if next modules can be compressed.

CRITICAL RULES:
- Never modify completed modules
- Keep total hours realistic
- Maintain the same JSON structure as the original roadmap
- New modules should have resources and quiz questions too`;

    const userPrompt = `Student just completed module "${module_title}" (${module_id}).
Self-report: ${self_report}
Quiz score: ${quiz_score ?? "not taken"}
${quiz_answers ? `Wrong answers: ${JSON.stringify(quiz_answers)}` : ""}

Current roadmap: ${JSON.stringify(roadmap_data)}
All progress: ${JSON.stringify(all_progress)}

Return ONLY valid JSON:
{
  "needs_adaptation": boolean,
  "adaptation_type": "none|minor|major",
  "reason": "explanation",
  "changes_summary": "human-readable summary of changes",
  "message_to_student": "encouraging personalized message",
  "updated_roadmap": { full roadmap JSON with same structure } or null
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
    console.error("check-in error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
