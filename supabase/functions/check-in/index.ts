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

function stripModuleQuizzes(roadmap: any): void {
  if (!roadmap || !Array.isArray(roadmap.modules)) return;
  for (const mod of roadmap.modules) {
    mod.quiz = [];
  }
}

// ─── YouTube API Enrichment ──────────────────────────────────────────────────

function parseISO8601Duration(iso8601: string): number {
  const match = iso8601.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  return parseInt(match?.[1] || '0') * 60 + parseInt(match?.[2] || '0') + (parseInt(match?.[3] || '0') > 0 ? 1 : 0);
}

function extractYouTubeVideoId(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
  return match ? match[1] : null;
}

function formatViewCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

const TECH_RELEVANCE_KEYWORDS = [
  "programming", "coding", "software", "developer", "engineer", "tutorial",
  "course", "learn", "code", "tech", "computer", "science", "data",
  "web", "app", "design", "system", "algorithm", "database", "server",
  "cloud", "devops", "api", "framework", "python", "javascript", "java",
  "react", "node", "sql", "html", "css", "machine learning", "ai",
  "network", "security", "linux", "docker", "kubernetes", "git",
  "interview", "architecture", "scalab", "distribut", "microservice",
  "load balanc", "cache", "proxy", "freecodecamp", "traversy", "fireship",
  "mosh", "sentdex", "corey schafer", "tech with tim", "net ninja", "cs50",
];

function isVideoRelevant(title: string, channel: string, moduleTitle: string, topic: string): boolean {
  const combined = `${title} ${channel}`.toLowerCase();
  const searchContext = `${moduleTitle} ${topic}`.toLowerCase();
  const topicWords = searchContext.split(/\s+/).filter(w => w.length > 3);
  const matchCount = topicWords.filter(w => combined.includes(w)).length;
  if (matchCount >= 2) return true;
  const hasTechSignal = TECH_RELEVANCE_KEYWORDS.some(kw => combined.includes(kw));
  if (hasTechSignal && matchCount >= 1) return true;
  if (matchCount === 0 && !hasTechSignal) return false;
  return true;
}

async function enrichRoadmapYouTube(roadmap: any, apiKey: string): Promise<void> {
  if (!roadmap?.modules || !apiKey) return;
  const topic = roadmap.topic || "";
  const videoIds = new Set<string>();
  for (const mod of roadmap.modules) {
    for (const r of (mod.resources || [])) {
      if (r.type === "video" || (r.url && r.url.includes("youtube"))) {
        const id = extractYouTubeVideoId(r.url);
        if (id) videoIds.add(id);
      }
    }
  }
  if (videoIds.size === 0) return;

  const ids = [...videoIds];
  const metaMap = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50).join(",");
    try {
      const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${batch}&key=${apiKey}`);
      if (!res.ok) { console.warn(`YouTube API error: ${res.status}`); return; }
      const data = await res.json();
      for (const item of (data.items || [])) {
        metaMap.set(item.id, {
          title: item.snippet?.title, channel: item.snippet?.channelTitle,
          durationMinutes: parseISO8601Duration(item.contentDetails?.duration || "PT0S"),
          viewCount: parseInt(item.statistics?.viewCount || "0"),
          likeCount: parseInt(item.statistics?.likeCount || "0"),
        });
      }
    } catch (e) { console.error("YouTube API error in check-in:", e); return; }
  }

  for (const mod of roadmap.modules) {
    mod.resources = (mod.resources || []).filter((r: any) => {
      const id = extractYouTubeVideoId(r.url);
      if (!id) return true;
      const meta = metaMap.get(id);
      if (!meta) return false;
      if (!isVideoRelevant(meta.title, meta.channel, mod.title, topic)) {
        console.warn(`Excluding off-topic video: "${meta.title}" by ${meta.channel}`);
        return false;
      }
      r.title = meta.title || r.title;
      r.estimated_minutes = meta.durationMinutes || r.estimated_minutes;
      r.channel = meta.channel;
      r.view_count = meta.viewCount;
      r.like_count = meta.likeCount;
      r.source = "YouTube";
      r.quality_signal = `${formatViewCount(meta.viewCount)} views · ${meta.channel} · ${meta.durationMinutes} min`;
      return true;
    });
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
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { roadmap_data, module_id, module_title, self_report, quiz_score, quiz_answers, all_progress, learning_goal } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
    const YOUTUBE_API_KEY = Deno.env.get("YOUTUBE_API_KEY") || "";

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

    const effectiveGoal = learning_goal || "hands_on";
    const goalContext = effectiveGoal === "conceptual"
      ? "The student's learning goal is CONCEPTUAL — they want theory, concepts, and mental models. If adapting, add more explanatory/lecture resources, not coding exercises."
      : effectiveGoal === "hands_on"
      ? "The student's learning goal is HANDS-ON — they want to build things and practice. If adapting, add more practice exercises and project-based resources, not lectures."
      : effectiveGoal === "quick_overview"
      ? "The student's learning goal is QUICK OVERVIEW — they want fast, high-level understanding. If adapting, use crash courses and summary content, keep it short."
      : effectiveGoal === "deep_mastery"
      ? "The student's learning goal is DEEP MASTERY — they want comprehensive, in-depth expertise. If adapting, add thorough review modules with advanced content."
      : "";

    const systemPrompt = `You are Pathfinder's intelligent adaptation engine. A student is progressing through a learning roadmap and has just checked in on a module. Analyze their performance and determine if the remaining roadmap needs adjustment.

${goalContext}

ADAPTATION LOGIC:
- If the module was HARD and quiz score < 60%: Insert a focused review module. Adjust timeline.
- If the module was HARD but quiz score >= 60%: Add 1-2 supplementary resources to next module. No structural change.
- If the module was EASY and quiz score > 90%: Check if next modules can be compressed.

TIMELINE CALCULATION (CRITICAL - you MUST follow this):
- The roadmap has a fixed hours_per_day the student can dedicate.
- new_total_hours = sum of all module estimated_hours (including any added modules).
- new_timeline_days = ceil(new_total_hours / hours_per_day).
- new_timeline_weeks = ceil(new_timeline_days / 7).
- Example: 14h total at 1h/day = 14 days. Add 3h review module → 17h at 1h/day = 17 days = 3 weeks.
- Example: 14h total at 2h/day = 7 days. Add 3h → 17h at 2h/day = 9 days = 2 weeks.
- NEVER just add a full week for small changes. Always derive timeline from total_hours / hours_per_day.
- Update total_hours in the roadmap to match the sum of all module estimated_hours.

OTHER RULES:
- Never modify completed modules
- Keep total hours realistic
- Maintain the same JSON structure as the original roadmap
- Do NOT pre-generate quizzes. Set every module's quiz to an empty array []`;

    const userPrompt = `Student just completed module "${module_title}" (${module_id}).
Self-report: ${self_report}
Quiz score: ${quiz_score ?? "not taken"}
${quiz_answers ? `Wrong answers: ${JSON.stringify(quiz_answers)}` : ""}
Learning Goal: ${effectiveGoal}

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
        model: "google/gemini-3-pro-preview",
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
    const result = parseAiJson(content);
    if (result?.updated_roadmap) stripModuleQuizzes(result.updated_roadmap);

    // Enrich any YouTube URLs in adapted roadmap
    if (result.updated_roadmap && YOUTUBE_API_KEY) {
      await enrichRoadmapYouTube(result.updated_roadmap, YOUTUBE_API_KEY);
    }

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("check-in error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
