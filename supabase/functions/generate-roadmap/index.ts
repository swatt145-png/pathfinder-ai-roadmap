import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface SerperWebResult { title: string; link: string; snippet: string; }
interface SerperVideoResult { title: string; link: string; duration?: string; }
interface Resource {
  title: string;
  url: string;
  type: "video" | "article" | "documentation" | "tutorial" | "practice";
  estimated_minutes: number;
  description: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function detectResourceType(url: string): Resource["type"] {
  const lower = url.toLowerCase();
  const docDomains = ["docs.", "developer.", "devdocs.", "wiki.", "reference.", "documentation"];
  const practiceDomains = ["leetcode", "hackerrank", "codewars", "exercism", "codecademy.com/learn", "freecodecamp.org/learn"];
  const tutorialDomains = ["freecodecamp", "w3schools", "tutorialspoint", "geeksforgeeks", "codecademy", "khanacademy", "realpython"];
  if (practiceDomains.some(d => lower.includes(d))) return "practice";
  if (docDomains.some(d => lower.includes(d))) return "documentation";
  if (tutorialDomains.some(d => lower.includes(d))) return "tutorial";
  return "article";
}

function parseDurationToMinutes(duration?: string): number {
  if (!duration) return 15;
  const hms = duration.match(/(\d+):(\d+):(\d+)/);
  if (hms) return parseInt(hms[1]) * 60 + parseInt(hms[2]);
  const ms = duration.match(/(\d+):(\d+)/);
  if (ms) return parseInt(ms[1]);
  const min = duration.match(/(\d+)\s*min/i);
  if (min) return parseInt(min[1]);
  return 15;
}

function isDisqualified(title: string, url: string): boolean {
  const courseKeywords = /\b(full course|complete course|crash course.*\d+ hours|bootcamp|playlist|lessons? \d+-\d+|parts? \d+-\d+|\d+ lessons|\d{2,}\s*hours)\b/i;
  const spamSignals = /\b(top \d+ best|best \d+|you won't believe|clickbait)\b/i;
  if (courseKeywords.test(title) || url.includes("playlist") || url.includes("/learn/")) return true;
  if (spamSignals.test(title)) return true;
  return false;
}

function estimateArticleMinutes(snippet: string): number {
  const wordCount = snippet ? snippet.split(/\s+/).length : 0;
  if (wordCount > 80) return 15;
  return 10;
}

async function searchSerper(query: string, apiKey: string, type: "search" | "videos", num: number) {
  const url = type === "videos" ? "https://google.serper.dev/videos" : "https://google.serper.dev/search";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num }),
    });
    if (!res.ok) { console.error(`Serper ${type} error: ${res.status}`); return []; }
    const data = await res.json();
    return type === "videos" ? (data.videos || []) : (data.organic || []);
  } catch (e) { console.error(`Serper ${type} fetch failed:`, e); return []; }
}

// ─── Goal-Aware Search Config ────────────────────────────────────────────────

interface GoalSearchConfig {
  queryModifiers: string[];
  platformBoost: string[];       // domains to boost in ranking
  videoCount: number;
  webCount: number;
  targetMix: { videos: number; articles: number; practice: number };
  maxResourcesPerModule: number;
  minResourcesPerModule: number;
}

function getGoalSearchConfig(goal: string): GoalSearchConfig {
  switch (goal) {
    case "conceptual":
      return {
        queryModifiers: ["explained", "how does it work", "concepts", "theory", "lecture", "introduction"],
        platformBoost: ["khanacademy.org", "ocw.mit.edu", "edx.org", "coursera.org", "youtube.com"],
        videoCount: 8, webCount: 6,
        targetMix: { videos: 2, articles: 2, practice: 0 },
        maxResourcesPerModule: 5, minResourcesPerModule: 3,
      };
    case "hands_on":
      return {
        queryModifiers: ["tutorial", "build", "project", "practice", "exercise", "hands-on", "step by step", "code along"],
        platformBoost: ["freecodecamp.org", "codecademy.com", "leetcode.com", "hackerrank.com", "youtube.com"],
        videoCount: 6, webCount: 8,
        targetMix: { videos: 1, articles: 1, practice: 1 },
        maxResourcesPerModule: 5, minResourcesPerModule: 3,
      };
    case "quick_overview":
      return {
        queryModifiers: ["crash course", "in 10 minutes", "quick guide", "overview", "cheat sheet", "essentials"],
        platformBoost: ["youtube.com", "dev.to", "medium.com", "freecodecamp.org"],
        videoCount: 6, webCount: 4,
        targetMix: { videos: 1, articles: 1, practice: 0 },
        maxResourcesPerModule: 3, minResourcesPerModule: 2,
      };
    case "deep_mastery":
      return {
        queryModifiers: ["complete guide", "comprehensive", "advanced", "in depth", "best practices", "full course", "masterclass"],
        platformBoost: ["coursera.org", "udemy.com", "ocw.mit.edu", "realpython.com", "freecodecamp.org"],
        videoCount: 6, webCount: 8,
        targetMix: { videos: 2, articles: 1, practice: 1 },
        maxResourcesPerModule: 5, minResourcesPerModule: 3,
      };
    default:
      return {
        queryModifiers: ["tutorial", "guide"],
        platformBoost: [],
        videoCount: 6, webCount: 6,
        targetMix: { videos: 1, articles: 1, practice: 0 },
        maxResourcesPerModule: 5, minResourcesPerModule: 3,
      };
  }
}

function getLevelSearchModifier(level: string): string {
  switch (level) {
    case "beginner": return "for beginners introduction";
    case "intermediate": return "intermediate practical patterns";
    case "advanced": return "advanced best practices optimization";
    default: return "";
  }
}

// ─── Resource Scoring & Selection ────────────────────────────────────────────

function scoreResource(
  res: Resource,
  moduleTitle: string,
  goal: string,
  level: string,
  config: GoalSearchConfig,
  moduleMinutes: number
): number {
  let score = 0;

  // CRITERION 1: RELEVANCE — title/description must relate to module
  const titleLower = res.title.toLowerCase();
  const moduleLower = moduleTitle.toLowerCase();
  const moduleWords = moduleLower.split(/\s+/).filter(w => w.length > 3);
  const matchingWords = moduleWords.filter(w => titleLower.includes(w));
  score += matchingWords.length * 15; // relevance boost

  // Goal fit: video for conceptual, practice for hands_on, etc.
  if (goal === "conceptual" && (res.type === "video" || res.type === "documentation")) score += 10;
  if (goal === "hands_on" && (res.type === "tutorial" || res.type === "practice")) score += 10;
  if (goal === "quick_overview" && res.estimated_minutes <= 20) score += 10;
  if (goal === "deep_mastery" && res.estimated_minutes >= 20) score += 10;

  // Level fit: beginners prefer videos, advanced prefer docs
  if (level === "beginner" && res.type === "video") score += 5;
  if (level === "advanced" && (res.type === "documentation" || res.type === "article")) score += 5;

  // CRITERION 2: QUALITY — platform boost
  const urlLower = res.url.toLowerCase();
  if (config.platformBoost.some(p => urlLower.includes(p))) score += 8;

  // CRITERION 3: TIME FIT — prefer resources that fit well within module budget
  const ratio = res.estimated_minutes / moduleMinutes;
  if (ratio >= 0.1 && ratio <= 0.5) score += 10; // sweet spot
  else if (ratio > 0.5 && ratio <= 0.8) score += 5;
  else if (ratio > 0.8) score -= 5; // too long for a single resource in a module

  return score;
}

function selectResources(
  candidates: Resource[],
  moduleTitle: string,
  goal: string,
  level: string,
  config: GoalSearchConfig,
  moduleMinutes: number
): Resource[] {
  // Score all candidates
  const scored = candidates.map(r => ({
    resource: r,
    score: scoreResource(r, moduleTitle, goal, level, config, moduleMinutes),
  }));
  scored.sort((a, b) => b.score - a.score);

  const selected: Resource[] = [];
  let totalMinutes = 0;
  const typeCounts: Record<string, number> = { video: 0, article: 0, documentation: 0, tutorial: 0, practice: 0 };

  for (const { resource } of scored) {
    if (selected.length >= config.maxResourcesPerModule) break;
    if (totalMinutes + resource.estimated_minutes > moduleMinutes * 1.15) continue;

    // Enforce mix: don't over-index on one type
    const typeGroup = resource.type === "documentation" || resource.type === "tutorial" ? "articles" : resource.type === "practice" ? "practice" : "videos";
    const targetForType = (config.targetMix as any)[typeGroup] || 2;
    const currentOfType = typeGroup === "articles"
      ? (typeCounts["article"] + typeCounts["documentation"] + typeCounts["tutorial"])
      : typeGroup === "videos" ? typeCounts["video"] : typeCounts["practice"];
    if (currentOfType >= targetForType + 1) continue; // allow 1 extra

    selected.push(resource);
    totalMinutes += resource.estimated_minutes;
    typeCounts[resource.type] = (typeCounts[resource.type] || 0) + 1;
  }

  // If we're underfilled, scale resource estimates to fill ~85% of module time
  if (selected.length > 0 && totalMinutes < moduleMinutes * 0.6) {
    const scale = Math.min(moduleMinutes * 0.85 / totalMinutes, 3);
    for (const res of selected) {
      res.estimated_minutes = Math.round(res.estimated_minutes * scale);
    }
  }

  // If still below minimum, take top remaining candidates regardless of mix
  if (selected.length < config.minResourcesPerModule) {
    for (const { resource } of scored) {
      if (selected.includes(resource)) continue;
      if (selected.length >= config.minResourcesPerModule) break;
      selected.push(resource);
    }
  }

  return selected;
}

// ─── Fetch Resources for a Module ────────────────────────────────────────────

async function fetchResourcesForModule(
  moduleTitle: string,
  topic: string,
  skillLevel: string,
  apiKey: string,
  moduleHours: number,
  learningGoal: string
): Promise<Resource[]> {
  const config = getGoalSearchConfig(learningGoal);
  const moduleMinutes = Math.floor(moduleHours * 60);
  const levelMod = getLevelSearchModifier(skillLevel);
  const goalMod = config.queryModifiers.slice(0, 3).join(" ");

  const webQuery = `${moduleTitle} ${topic} ${levelMod} ${goalMod}`;
  const videoQuery = `${moduleTitle} ${topic} ${goalMod} ${levelMod}`;

  const [webResults, videoResults] = await Promise.all([
    searchSerper(webQuery, apiKey, "search", config.webCount),
    searchSerper(videoQuery, apiKey, "videos", config.videoCount),
  ]);

  const candidates: Resource[] = [];

  for (const v of videoResults as SerperVideoResult[]) {
    if (!v.link) continue;
    const title = v.title || "Video Tutorial";
    if (isDisqualified(title, v.link)) continue;
    const mins = parseDurationToMinutes(v.duration);
    if (mins > moduleMinutes * 0.8) continue; // single resource shouldn't dominate
    candidates.push({
      title,
      url: v.link,
      type: "video",
      estimated_minutes: mins,
      description: `Video tutorial on ${moduleTitle}`,
    });
  }

  for (const r of webResults as SerperWebResult[]) {
    if (!r.link) continue;
    const title = r.title || "Learning Resource";
    if (isDisqualified(title, r.link)) continue;
    const mins = estimateArticleMinutes(r.snippet || "");
    candidates.push({
      title,
      url: r.link,
      type: detectResourceType(r.link),
      estimated_minutes: mins,
      description: r.snippet || `Resource for learning ${moduleTitle}`,
    });
  }

  return selectResources(candidates, moduleTitle, learningGoal, skillLevel, config, moduleMinutes);
}

// ─── System Prompt Builder ───────────────────────────────────────────────────

function buildSystemPrompt(totalHours: number, learningGoal: string, skillLevel: string): string {
  const goalBlock = getGoalPromptBlock(learningGoal);
  const levelBlock = getLevelPromptBlock(skillLevel);
  const interactionBlock = getInteractionBlock(learningGoal, skillLevel);

  return `You are Pathfinder, an expert learning curriculum designer. You create personalized, structured, and realistic learning roadmaps.

PRIORITY 1 — TOPIC UNDERSTANDING (do this FIRST):
Before creating the roadmap, analyze the topic:
1. What domain does this belong to? (programming language, framework, cybersecurity, data science, DevOps, cloud, networking, databases, interview prep, etc.)
2. What are the essential subtopics and in what order should they be learned?
3. What are the prerequisites for each subtopic?
4. Is this topic primarily theoretical, practical, or a mix?
This analysis informs every subsequent decision.

PRIORITY 2 — LEARNING GOAL:
${goalBlock}

PRIORITY 3 — PROFICIENCY LEVEL:
${levelBlock}

PRIORITY 2+3 INTERACTION:
${interactionBlock}

PRIORITY 4 — TIME CONSTRAINTS:
- Total available hours: ${totalHours}
- NEVER assign more total hours than available. If the roadmap would exceed available time, CUT content from the bottom (advanced/optional) not the top (fundamentals).
- Build in a 10-15% buffer. Plan for ~${Math.round(totalHours * 0.88)} hours of content.
- Each module's estimated_hours must be realistic and proportional.
- If not enough time for full topic coverage, be honest in the summary about what's covered and what would need more time.

RULES:
- Break the topic into sequential modules. Module count depends on learning goal.
- Each module must logically build on the previous one.
- DO NOT include any resources or URLs — leave resources as empty arrays. Resources will be fetched separately.
- Generate 3-5 multiple-choice quiz questions per module that test understanding appropriate to the learning goal and level.
- Each quiz question must have exactly 4 options with one correct answer and a clear explanation.
- Assign each module to specific days within the timeline.
- Generate a concise "topic" field summarizing the user's input as a proper title (capitalize, remove filler like "I want to learn").`;
}

function getGoalPromptBlock(goal: string): string {
  switch (goal) {
    case "conceptual": return `CONCEPTUAL learning goal selected.
- Focus on "why" and "how it works" — mental models, comparisons, theory
- Module count: 5-7 modules, moderate depth
- Time split: 80% consuming content, 20% reflection/quizzes
- Quiz style: Definition-based, concept checks, "explain why X works this way"`;
    case "hands_on": return `HANDS-ON learning goal selected.
- Every module MUST have a "build something" or "try this" component
- Module count: 5-8 modules, practice-heavy
- Time split: 30% learning, 70% doing
- Quiz style: Code-oriented, "what would this output", practical scenarios`;
    case "quick_overview": return `QUICK OVERVIEW learning goal selected.
- Hit key points fast, no deep dives, focus on "what you need to know"
- Module count: 3-5 modules MAXIMUM. Each completable in 1-2 hours.
- Even if the user has weeks available, keep it concise. Use extra time for review, not more content.
- Time split: 100% efficient consumption, no lengthy exercises
- Quiz style: Quick recall, key terminology`;
    case "deep_mastery": return `DEEP MASTERY learning goal selected.
- Thorough coverage including edge cases, best practices, architecture patterns, real-world scenarios
- Module count: 7-10 modules, includes prerequisites and advanced topics
- Time split: 40% learning, 40% practice, 20% review
- Quiz style: Advanced nuance, tradeoffs, "when would you use X vs Y", design decisions`;
    default: return "";
  }
}

function getLevelPromptBlock(level: string): string {
  switch (level) {
    case "beginner": return `BEGINNER level.
- Start from absolute fundamentals, assume zero prior knowledge
- Use simpler language, more hand-holding in early modules
- Include "what is X" and "why does X matter" before "how to do X"
- Quiz difficulty: Definition-based, basic concept checks
- Pacing: More time per concept, smaller steps between modules`;
    case "intermediate": return `INTERMEDIATE level.
- Skip "what is X" basics — assume familiarity with fundamentals
- Focus on practical patterns, common use cases, connecting concepts
- Optional brief refresher module (30 min) then dive into intermediate topics
- Quiz difficulty: Application-based, "when would you use X vs Y"
- Pacing: Moderate, cover more ground per module`;
    case "advanced": return `ADVANCED level.
- Skip fundamentals AND intermediate patterns — go straight to advanced topics
- Focus on optimization, architecture, edge cases, performance, design patterns
- Include real-world case studies and production scenarios
- Quiz difficulty: Nuanced tradeoffs, "what's wrong with this approach", design decisions
- Pacing: Fast, complex topics in fewer modules`;
    default: return "";
  }
}

function getInteractionBlock(goal: string, level: string): string {
  const key = `${level}_${goal}`;
  const interactions: Record<string, string> = {
    "beginner_quick_overview": "Crash course for absolute beginners — simplest explanation of essentials only.",
    "beginner_deep_mastery": "From zero to expert — more modules, starting from basics going all the way to advanced.",
    "beginner_conceptual": "Foundational theory — build mental models from scratch, no assumptions.",
    "beginner_hands_on": "Guided project-based learning — hold their hand through every step.",
    "advanced_conceptual": "Deep theoretical understanding — architecture docs, design philosophy, academic depth.",
    "advanced_hands_on": "Advanced projects and challenges — skip tutorials, complex builds and coding challenges.",
    "advanced_quick_overview": "Executive summary of advanced topics — what experts need to know, fast.",
    "advanced_deep_mastery": "Expert-level mastery — edge cases, performance tuning, system design.",
    "intermediate_quick_overview": "Practical refresher — key patterns and tools, skip the basics.",
    "intermediate_deep_mastery": "Comprehensive intermediate-to-advanced journey.",
    "intermediate_conceptual": "Deepen understanding of patterns and principles behind what they already use.",
    "intermediate_hands_on": "Build real projects applying intermediate patterns.",
  };
  return interactions[key] || "Balance the learning goal with the proficiency level appropriately.";
}

// ─── Main Handler ────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { topic, skill_level, learning_goal, timeline_weeks, hours_per_day, hard_deadline, deadline_date, include_weekends } = await req.json();
    const effectiveGoal = learning_goal || "hands_on";
    const daysInTimeline = timeline_weeks * 7;
    const studyDays = include_weekends === false ? Math.round(daysInTimeline * 5 / 7) : daysInTimeline;
    const totalHours = studyDays * hours_per_day;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
    const SERPER_API_KEY = Deno.env.get("SERPER_API_KEY");
    if (!SERPER_API_KEY) throw new Error("SERPER_API_KEY not configured");

    // Step 1: Generate roadmap structure via AI
    const systemPrompt = buildSystemPrompt(totalHours, effectiveGoal, skill_level);

    const userPrompt = `Create a learning roadmap for: "${topic}"
Skill level: ${skill_level}
Learning Goal: ${effectiveGoal}
Timeline: ${timeline_weeks} weeks (${studyDays} study days${include_weekends === false ? ", weekends excluded" : ", including weekends"})
Hours per day: ${hours_per_day}
Total available hours: ${totalHours}
${hard_deadline && deadline_date ? `Hard deadline: ${deadline_date} — be extra conservative, plan for ${Math.round(totalHours * 0.8)} hours of content.` : ""}

Return ONLY valid JSON with this exact structure:
{
  "topic": "concise clean title (e.g. 'Docker Basics in 2 Days', 'Machine Learning Models', 'Python Libraries Intermediate')",
  "skill_level": "${skill_level}",
  "timeline_weeks": ${timeline_weeks},
  "hours_per_day": ${hours_per_day},
  "total_hours": ${totalHours},
  "summary": "2-3 sentence overview. If the topic can't be fully covered in the available time, mention what's covered and what would need more time.",
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

    console.log(`Generating roadmap: topic="${topic}", goal=${effectiveGoal}, level=${skill_level}, hours=${totalHours}`);

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

    // Step 2: Fetch real resources via Serper (parallelized)
    console.log(`Fetching resources for ${roadmap.modules?.length || 0} modules (goal: ${effectiveGoal}, level: ${skill_level})...`);

    const resourcePromises = (roadmap.modules || []).map((mod: any) =>
      fetchResourcesForModule(mod.title, topic, skill_level, SERPER_API_KEY, mod.estimated_hours || hours_per_day, effectiveGoal)
    );
    const allResources = await Promise.all(resourcePromises);

    // Step 3: Inject resources
    for (let i = 0; i < (roadmap.modules || []).length; i++) {
      roadmap.modules[i].resources = allResources[i] || [];
    }

    console.log("Roadmap generation complete.");
    return new Response(JSON.stringify(roadmap), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("generate-roadmap error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
