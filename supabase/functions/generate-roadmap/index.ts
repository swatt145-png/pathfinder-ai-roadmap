import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface SerperWebResult {
  title: string;
  link: string;
  snippet: string;
}

interface SerperVideoResult {
  title: string;
  link: string;
  duration?: string;
}

function detectResourceType(url: string): "article" | "documentation" | "tutorial" {
  const docDomains = ["docs.", "developer.", "devdocs.", "wiki.", "reference."];
  const tutorialDomains = ["freecodecamp", "w3schools", "tutorialspoint", "geeksforgeeks", "codecademy", "khanacademy"];
  const lower = url.toLowerCase();
  if (docDomains.some(d => lower.includes(d))) return "documentation";
  if (tutorialDomains.some(d => lower.includes(d))) return "tutorial";
  return "article";
}

function parseDurationToMinutes(duration?: string): number {
  if (!duration) return 15;
  const hmsMatch = duration.match(/(\d+):(\d+):(\d+)/);
  if (hmsMatch) return parseInt(hmsMatch[1]) * 60 + parseInt(hmsMatch[2]);
  const msMatch = duration.match(/(\d+):(\d+)/);
  if (msMatch) return parseInt(msMatch[1]);
  const minMatch = duration.match(/(\d+)\s*min/i);
  if (minMatch) return parseInt(minMatch[1]);
  return 15;
}

async function searchSerper(query: string, apiKey: string, type: "search" | "videos", num: number) {
  const url = type === "videos"
    ? "https://google.serper.dev/videos"
    : "https://google.serper.dev/search";

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num }),
    });
    if (!res.ok) {
      console.error(`Serper ${type} error: ${res.status}`);
      return [];
    }
    const data = await res.json();
    return type === "videos" ? (data.videos || []) : (data.organic || []);
  } catch (e) {
    console.error(`Serper ${type} fetch failed:`, e);
    return [];
  }
}

function isLikelyCourseOrPlaylist(title: string, url: string): boolean {
  const courseKeywords = /\b(full course|complete course|crash course|bootcamp|playlist|lessons? \d+-\d+|parts? \d+-\d+|\d+ lessons|\d+ hours)\b/i;
  return courseKeywords.test(title) || url.includes("playlist") || url.includes("/learn/");
}

function estimateArticleMinutes(snippet: string): number {
  const wordCount = snippet ? snippet.split(/\s+/).length : 0;
  if (wordCount > 80) return 15;
  return 10;
}

function getSearchSuffix(learningGoal: string): string {
  switch (learningGoal) {
    case "conceptual": return "explained how it works theory concepts lecture";
    case "hands_on": return "tutorial build project hands-on practice exercise step by step";
    case "quick_overview": return "crash course quick guide 10 minutes overview cheat sheet summary";
    case "deep_mastery": return "complete guide advanced in depth best practices comprehensive";
    default: return "tutorial";
  }
}

async function fetchResourcesForModule(
  moduleTitle: string,
  topic: string,
  skillLevel: string,
  apiKey: string,
  moduleHours: number,
  learningGoal: string
) {
  const maxMinutes = Math.floor(moduleHours * 60);
  const goalSuffix = getSearchSuffix(learningGoal);
  const webQuery = `${moduleTitle} ${topic} ${skillLevel} ${goalSuffix}`;
  const videoQuery = `${moduleTitle} ${topic} ${goalSuffix} ${skillLevel}`;

  const [webResults, videoResults] = await Promise.all([
    searchSerper(webQuery, apiKey, "search", 6),
    searchSerper(videoQuery, apiKey, "videos", 6),
  ]);

  const candidates: any[] = [];

  for (const v of videoResults as SerperVideoResult[]) {
    if (!v.link) continue;
    const mins = parseDurationToMinutes(v.duration);
    const title = v.title || "Video Tutorial";
    if (isLikelyCourseOrPlaylist(title, v.link)) continue;
    if (mins > maxMinutes * 0.8) continue;
    candidates.push({
      title,
      url: v.link,
      type: "video" as const,
      estimated_minutes: mins,
      description: `Video tutorial on ${moduleTitle}`,
    });
  }

  for (const r of webResults as SerperWebResult[]) {
    if (!r.link) continue;
    const title = r.title || "Learning Resource";
    if (isLikelyCourseOrPlaylist(title, r.link)) continue;
    const mins = estimateArticleMinutes(r.snippet || "");
    candidates.push({
      title,
      url: r.link,
      type: detectResourceType(r.link),
      estimated_minutes: mins,
      description: r.snippet || `Resource for learning ${moduleTitle}`,
    });
  }

  candidates.sort((a, b) => b.estimated_minutes - a.estimated_minutes);

  const selected: any[] = [];
  let totalMinutes = 0;

  // First pass: pick longer resources first to fill module time
  for (const res of candidates) {
    if (selected.length >= 6) break;
    if (totalMinutes + res.estimated_minutes > maxMinutes * 1.2) continue;
    selected.push(res);
    totalMinutes += res.estimated_minutes;
  }

  // If we still have capacity, add shorter ones
  if (totalMinutes < maxMinutes * 0.6) {
    for (const res of candidates) {
      if (selected.includes(res)) continue;
      if (selected.length >= 8) break;
      selected.push(res);
      totalMinutes += res.estimated_minutes;
    }
  }

  // Scale up resource estimates to reasonably fill the module time
  if (selected.length > 0 && totalMinutes < maxMinutes * 0.7) {
    const scale = Math.min(maxMinutes * 0.85 / totalMinutes, 4);
    for (const res of selected) {
      res.estimated_minutes = Math.round(res.estimated_minutes * scale);
    }
    totalMinutes = selected.reduce((s: number, r: any) => s + r.estimated_minutes, 0);
  }

  if (selected.length === 0 && candidates.length > 0) {
    const best = candidates[0];
    best.estimated_minutes = Math.min(best.estimated_minutes, maxMinutes);
    selected.push(best);
  }

  return selected;
}

function getLearningGoalInstructions(learningGoal: string): string {
  switch (learningGoal) {
    case "conceptual":
      return `LEARNING GOAL: Conceptual
- Focus on "why" and "how it works" rather than "how to do it"
- Quiz style: Test understanding of concepts, definitions, tradeoffs, comparisons
- Time allocation: More time on reading and watching, less on exercises
- Module style: Theory-first, with diagrams and mental models
- Aim for 5-8 modules with conceptual depth`;
    case "hands_on":
      return `LEARNING GOAL: Hands-On
- Every module should have a "build something" or "try this" component
- Quiz style: Code-oriented questions, "what would this code output", practical scenarios
- Time allocation: 30% learning, 70% doing
- Module style: Project-based, practical exercises
- Aim for 5-8 modules with practical focus`;
    case "quick_overview":
      return `LEARNING GOAL: Quick Overview
- Condensed content, hit the key points fast, skip deep dives
- Quiz style: Quick recall, key terminology, "which tool is used for what"
- Time allocation: Short focused bursts, no lengthy content
- Module style: Summary-oriented, essentials only
- IMPORTANT: Use only 3-5 modules (fewer than normal). Each module should be shorter. The entire roadmap should feel fast and punchy.`;
    case "deep_mastery":
      return `LEARNING GOAL: Deep Mastery
- Deep dives with prerequisites clearly mapped, includes edge cases and best practices
- Quiz style: Advanced questions testing nuance, tradeoffs, "when would you use X vs Y", design decisions
- Time allocation: More modules, longer per module, includes review modules
- Module style: Comprehensive with advanced topics
- IMPORTANT: Use 7-10 modules with more depth per module.`;
    default:
      return "";
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { topic, skill_level, learning_goal, timeline_weeks, hours_per_day, hard_deadline, deadline_date, include_weekends } = await req.json();
    const effectiveGoal = learning_goal || "hands_on";
    const days_in_timeline = timeline_weeks * 7;
    const study_days = include_weekends === false ? Math.round(days_in_timeline * 5 / 7) : days_in_timeline;
    const total_hours = study_days * hours_per_day;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const SERPER_API_KEY = Deno.env.get("SERPER_API_KEY");
    if (!SERPER_API_KEY) throw new Error("SERPER_API_KEY not configured");

    const goalInstructions = getLearningGoalInstructions(effectiveGoal);

    const systemPrompt = `You are Pathfinder, an expert learning curriculum designer for technical topics. You create personalized, structured, and realistic learning roadmaps. Given a topic, skill level, learning goal, timeline, and available hours, design a comprehensive learning path.

RULES:
- Break the topic into sequential modules (number depends on learning goal — see below)
- Each module must logically build on the previous one
- Total estimated hours across all modules must not exceed the student's available hours (${total_hours} hours)
- DO NOT include any resources or URLs - leave resources as empty arrays. Resources will be fetched separately.
- Generate 3-5 multiple-choice quiz questions per module that test conceptual understanding
- Each quiz question must have exactly 4 options with one correct answer and a clear explanation
- Assign each module to specific days within the timeline
- Be realistic about what can be learned in the given time
- Generate a concise, clean "topic" field that summarizes the user's input as a proper title (capitalize first letter, remove filler words like "I want to learn", include skill context if relevant). Examples: "Docker Basics in 2 Days", "Machine Learning Models", "Python Libraries Intermediate"

${goalInstructions}

SKILL LEVEL GUIDE:
- Beginner: Start from absolute fundamentals, assume no prior knowledge, favor video tutorials
- Intermediate: Skip basics, focus on practical application and common patterns
- Advanced: Deep dives into edge cases, performance, best practices, architecture patterns`;

    const userPrompt = `Create a learning roadmap for: "${topic}"
Skill level: ${skill_level}
Learning Goal: ${effectiveGoal}
Timeline: ${timeline_weeks} weeks (${study_days} study days${include_weekends === false ? ", weekends excluded" : ", including weekends"})
Hours per day: ${hours_per_day}
Total available hours: ${total_hours}
${hard_deadline && deadline_date ? `Hard deadline: ${deadline_date}` : ""}

Return ONLY valid JSON with this exact structure:
{
  "topic": "concise clean title summarizing the learning goal (e.g. 'Docker Basics in 2 Days', 'Machine Learning Models', 'Python Libraries Intermediate')",
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
      "resources": [],
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
        model: "google/gemini-3-pro-preview",
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

    // Step 2: Fetch real resources via Serper API (parallelized across all modules)
    console.log(`Fetching resources for ${roadmap.modules?.length || 0} modules via Serper (goal: ${effectiveGoal})...`);

    const resourcePromises = (roadmap.modules || []).map((mod: any) =>
      fetchResourcesForModule(mod.title, topic, skill_level, SERPER_API_KEY, mod.estimated_hours || hours_per_day, effectiveGoal)
    );
    const allResources = await Promise.all(resourcePromises);

    // Step 3: Inject resources into modules
    for (let i = 0; i < (roadmap.modules || []).length; i++) {
      roadmap.modules[i].resources = allResources[i] || [];
    }

    console.log("Roadmap generation with real resources complete.");
    return new Response(JSON.stringify(roadmap), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("generate-roadmap error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
