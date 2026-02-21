import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
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
    const { createClient } = await import("npm:@supabase/supabase-js@2");
    const supabaseAuth = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: authUser }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !authUser) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

    const { topic, skill_level, learning_goal, module } = await req.json();
    if (!topic || !module?.title) {
      return new Response(JSON.stringify({ error: "topic and module are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = `Generate a module quiz JSON only.

Learner context:
- Topic: ${topic}
- Skill level: ${skill_level || "beginner"}
- Learning goal: ${learning_goal || "hands_on"}

Module:
- Title: ${module.title}
- Description: ${module.description || ""}
- Learning objectives: ${JSON.stringify(module.learning_objectives || [])}

Rules:
- Generate 3-5 multiple-choice questions.
- Each question must have exactly 4 options.
- Exactly one correct answer.
- Questions must test practical understanding for hands_on goals; conceptual understanding for conceptual goals.
- Keep explanations concise and instructional.

Return ONLY valid JSON:
{
  "quiz": [
    {
      "id": "q1",
      "question": "text",
      "options": ["A", "B", "C", "D"],
      "correct_answer": "one option exactly",
      "explanation": "short explanation"
    }
  ]
}`;

    const model = "gemini-2.5-flash-lite";
    const messages = [{ role: "user", content: prompt }];
    const bodyPayload = {
      model,
      messages,
      response_format: { type: "json_object" },
    };

    let response: Response | null = null;

    // Try Gemini direct first (faster, no proxy hop)
    if (GEMINI_API_KEY) {
      try {
        response = await fetchWithTimeout(
          "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${GEMINI_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(bodyPayload),
          },
          15000,
        );
        if (!response.ok) {
          console.warn(`Direct Gemini quiz returned ${response.status}, falling back to gateway...`);
          response = null;
        }
      } catch (e: any) {
        console.warn(`Direct Gemini quiz failed: ${e.name === "AbortError" ? "timeout" : e}, falling back to gateway...`);
        response = null;
      }
    }

    // Fallback to gateway
    if (!response) {
      response = await fetchWithTimeout("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...bodyPayload, model: `google/${model}` }),
      }, 20000);
    }

    if (!response.ok) {
      const t = await response.text();
      console.error("Quiz generation LLM error:", response.status, t);
      throw new Error("Quiz generation failed");
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("Quiz generation returned empty content");
    const parsed = JSON.parse(content);
    const quiz = Array.isArray(parsed?.quiz) ? parsed.quiz : [];

    return new Response(JSON.stringify({ quiz }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Unexpected error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
