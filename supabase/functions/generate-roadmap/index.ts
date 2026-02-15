import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { topic, skill_level, timeline_weeks, hours_per_day, hard_deadline, deadline_date } = await req.json();
    const total_hours = timeline_weeks * 7 * hours_per_day;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const systemPrompt = `You are Pathfinder, an expert learning curriculum designer for technical topics. You create personalized, structured, and realistic learning roadmaps. Given a topic, skill level, timeline, and available hours, design a comprehensive learning path.

RULES:
- Break the topic into 5-8 sequential modules depending on complexity and timeline
- Each module must logically build on the previous one
- Total estimated hours across all modules must not exceed the student's available hours (${total_hours} hours)
- For each module, recommend 2-4 specific, real learning resources from well-known sources
- Include actual URLs you are confident exist
- Generate 3-5 multiple-choice quiz questions per module that test conceptual understanding
- Each quiz question must have exactly 4 options with one correct answer and a clear explanation
- Assign each module to specific days within the timeline
- Be realistic about what can be learned in the given time

SKILL LEVEL GUIDE:
- Beginner: Start from absolute fundamentals, assume no prior knowledge, favor video tutorials
- Intermediate: Skip basics, focus on practical application and common patterns
- Advanced: Deep dives into edge cases, performance, best practices, architecture patterns`;

    const userPrompt = `Create a learning roadmap for: "${topic}"
Skill level: ${skill_level}
Timeline: ${timeline_weeks} weeks
Hours per day: ${hours_per_day}
Total available hours: ${total_hours}
${hard_deadline && deadline_date ? `Hard deadline: ${deadline_date}` : ""}

Return ONLY valid JSON with this exact structure:
{
  "topic": "${topic}",
  "skill_level": "${skill_level}",
  "timeline_weeks": ${timeline_weeks},
  "hours_per_day": ${hours_per_day},
  "total_hours": ${total_hours},
  "summary": "2-3 sentence overview",
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
      "resources": [
        { "title": "name", "url": "https://...", "type": "video|article|documentation|tutorial|practice", "estimated_minutes": number, "description": "why recommended" }
      ],
      "quiz": [
        { "id": "q1", "question": "question text", "options": ["A", "B", "C", "D"], "correct_answer": "exact text of correct option", "explanation": "why correct" }
      ]
    }
  ],
  "tips": "2-3 practical tips"
}`;

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

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("No response from AI");

    const roadmap = JSON.parse(content);
    return new Response(JSON.stringify(roadmap), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("generate-roadmap error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
