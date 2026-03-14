import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// ─── Import shared resource pipeline (only what Agent 1 structure needs) ─────
import {
  TIMEOUTS_MS,
  sleep,
  isAbortError,
  fetchWithTimeout,
} from "../_shared/resource-pipeline.ts";

import { getCorsHeaders } from "../_shared/cors.ts";
import { sanitizePromptInput } from "../_shared/sanitize.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";

// ─── Helpers (generate-roadmap specific) ─────────────────────────────────────

const FAST_MODE_MAX_HOURS = 40;
const FAST_MODE_MAX_MODULES = 8;
const ROADMAP_MODEL_AGENT1 = Deno.env.get("ROADMAP_MODEL_AGENT1") || "google/gemini-3-pro-preview";

function extractJsonObject(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const unfenced = fenceMatch?.[1]?.trim() || trimmed;
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return unfenced.slice(start, end + 1);
}

function parsePossiblyMalformedJson(value: unknown): any | null {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    const extracted = extractJsonObject(value);
    if (!extracted) return null;
    try {
      return JSON.parse(extracted);
    } catch {
      return null;
    }
  }
}

function buildFallbackRoadmap(
  topic: string,
  skillLevel: string,
  timelineWeeks: number,
  hoursPerDay: number,
  totalHours: number,
  daysInTimeline: number,
): any {
  const total = Math.max(1, Number(totalHours || 1));
  const bounds = getModuleBounds(total, daysInTimeline);
  const moduleCount = Math.min(bounds.max, Math.max(1, total <= 2 ? 1 : total <= 6 ? 2 : Math.floor(total / 2)));
  const moduleHours = Math.max(0.5, Math.round((total / moduleCount) * 10) / 10);
  const modules = Array.from({ length: moduleCount }).map((_, i) => {
    const dayStart = Math.max(1, Math.floor((i * daysInTimeline) / moduleCount) + 1);
    const nextStart = Math.max(dayStart, Math.floor(((i + 1) * daysInTimeline) / moduleCount));
    const dayEnd = i === moduleCount - 1 ? Math.max(dayStart, daysInTimeline) : Math.max(dayStart, nextStart);
    const moduleIndex = i + 1;
    return {
      id: `mod_${moduleIndex}`,
      title: `Module ${moduleIndex}: ${topic}`,
      description: `Focused learning block ${moduleIndex} for ${topic}.`,
      estimated_hours: moduleHours,
      day_start: dayStart,
      day_end: dayEnd,
      week: Math.max(1, Math.ceil(dayStart / 7)),
      prerequisites: [],
      learning_objectives: [
        `Understand core concepts for module ${moduleIndex}`,
        `Apply key ideas in practice for module ${moduleIndex}`,
      ],
      resources: [],
      anchor_terms: [topic.toLowerCase(), "tutorial", "practice"],
      quiz: [],
    };
  });

  return {
    topic,
    skill_level: skillLevel,
    timeline_weeks: Math.max(0.1, Number(timelineWeeks || 0.1)),
    hours_per_day: Math.max(0.5, Number(hoursPerDay || 1)),
    total_hours: Math.round(modules.reduce((sum: number, m: any) => sum + Number(m.estimated_hours || 0), 0) * 10) / 10,
    summary: `A concise, practical roadmap for ${topic} tailored to your available time.`,
    modules,
    tips: "Stay consistent, complete each module in order, and review key takeaways after every session.",
  };
}

async function callLLM(
  model: string,
  messages: Array<{ role: string; content: string }>,
  apiKey: string,
  geminiKey: string | undefined,
  timeoutMs: number,
  jsonMode = true,
): Promise<Response> {
  const geminiModel = model.replace(/^google\//, "");

  if (geminiKey) {
    const directTimeout = Math.min(timeoutMs, TIMEOUTS_MS.geminiDirect);
    try {
      const res = await fetchWithTimeout(
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${geminiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: geminiModel,
            messages,
            ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
          }),
        },
        directTimeout,
      );
      if (res.ok) return res;
      console.warn(`Direct Gemini returned ${res.status}, falling back to gateway...`);
    } catch (e) {
      console.warn(`Direct Gemini failed: ${isAbortError(e) ? "timeout" : e}, falling back to gateway...`);
    }
  }

  return fetchWithTimeout(
    "https://ai.gateway.lovable.dev/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    },
    timeoutMs,
  );
}

function getModuleBounds(totalHours: number, _daysInTimeline: number): { min: number; max: number } {
  const N = Math.max(1, totalHours);
  let max: number;
  if (N <= 12) max = Math.max(1, Math.floor(N / 2));
  else if (N <= 50) max = Math.max(4, Math.floor(N / 3));
  else if (N <= 70) max = Math.max(6, Math.floor(N / 4));
  else max = Math.max(8, Math.floor(N / 4));
  return { min: 1, max };
}

function normalizeModulePlan(roadmap: any, totalHours: number, daysInTimeline: number): void {
  if (!roadmap || !Array.isArray(roadmap.modules) || roadmap.modules.length === 0) return;
  const modules = roadmap.modules as any[];
  const bounds = getModuleBounds(totalHours, daysInTimeline);

  while (modules.length > bounds.max) {
    const idx = modules.length - 2;
    const left = modules[idx];
    const right = modules[idx + 1];
    left.title = `${left.title} + ${right.title}`;
    left.description = `${left.description || ""} ${right.description || ""}`.trim();
    left.estimated_hours = Number(left.estimated_hours || 0) + Number(right.estimated_hours || 0);
    left.day_start = Math.min(Number(left.day_start || 1), Number(right.day_start || 1));
    left.day_end = Math.max(Number(left.day_end || left.day_start || 1), Number(right.day_end || right.day_start || 1));
    left.week = Math.ceil((Number(left.day_start || 1)) / 7);
    left.learning_objectives = [...new Set([...(left.learning_objectives || []), ...(right.learning_objectives || [])])].slice(0, 8);
    left.prerequisites = [...new Set([...(left.prerequisites || []), ...(right.prerequisites || [])])].slice(0, 8);
    left.quiz = [...(left.quiz || []), ...(right.quiz || [])].slice(0, 5);
    left.anchor_terms = [...new Set([...(left.anchor_terms || []), ...(right.anchor_terms || [])])].slice(0, 8);
    left.id = `mod_${idx + 1}`;
    modules.splice(idx + 1, 1);
  }

  if (modules.length < bounds.min) {
    console.log(`Module planner: keeping ${modules.length} modules (suggested minimum ${bounds.min}) to avoid artificial splitting.`);
  }

  const sum = modules.reduce((acc, m) => acc + Number(m.estimated_hours || 0), 0);
  const target = Math.max(totalHours * 0.85, 0.5);
  const factor = sum > 0 ? target / sum : 1;
  let consumedDays = 0;
  for (let i = 0; i < modules.length; i++) {
    const m = modules[i];
    m.id = `mod_${i + 1}`;
    m.estimated_hours = Math.max(0.5, Math.round((Number(m.estimated_hours || 1) * factor) * 10) / 10);
    const remainingModules = modules.length - i;
    const remainingDays = Math.max(daysInTimeline - consumedDays, remainingModules);
    const span = Math.max(1, Math.floor(remainingDays / remainingModules));
    m.day_start = consumedDays + 1;
    m.day_end = Math.min(daysInTimeline, consumedDays + span);
    m.week = Math.max(1, Math.ceil(m.day_start / 7));
    consumedDays = m.day_end;
  }
}

function enforceModuleTimeWindowConsistency(modules: any[], hoursPerDay: number): void {
  if (!Array.isArray(modules) || modules.length === 0) return;
  const safeHoursPerDay = Math.max(Number(hoursPerDay || 0), 0.1);

  for (const mod of modules) {
    const dayStart = Math.max(1, Number(mod.day_start || 1));
    const dayEnd = Math.max(dayStart, Number(mod.day_end || dayStart));
    const moduleDays = Math.max(1, dayEnd - dayStart + 1);
    const windowHours = moduleDays * safeHoursPerDay;
    const capHours = Math.max(0.5, Math.round(windowHours * 10) / 10);
    const est = Number(mod.estimated_hours || 0.5);

    if (est > capHours * 1.05) {
      mod.estimated_hours = capHours;
    } else if (est < 0.5) {
      mod.estimated_hours = 0.5;
    }

    mod.day_start = dayStart;
    mod.day_end = dayEnd;
    mod.week = Math.max(1, Math.ceil(dayStart / 7));
  }
}

// ─── System Prompt Builder ───────────────────────────────────────────────────

function buildSystemPrompt(totalHours: number, learningGoal: string, skillLevel: string): string {
  const goalBlock = getGoalPromptBlock(learningGoal);
  const levelBlock = getLevelPromptBlock(skillLevel);
  const interactionBlock = getInteractionBlock(learningGoal, skillLevel);

  const totalMinutes = totalHours * 60;
  const usableMinutes = Math.floor(totalMinutes * 0.85);

  return `You are WayVion, an expert learning curriculum designer. You create personalized, structured, and realistic learning roadmaps.

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
- Usable minutes (85% of total): ${usableMinutes}
- NEVER assign more total hours than available. If the roadmap would exceed available time, CUT content from the bottom (advanced/optional) not the top (fundamentals).
- Each module's estimated_hours must be realistic and proportional.
- If not enough time for full topic coverage, be honest in the summary about what's covered and what would need more time.

=== FLEXIBLE STRUCTURE RULES (MANDATORY) ===

1. MODULE COUNT IS BASED ON TOTAL HOURS (N = total available hours):
   - If N ≤ 12: maximum modules = floor(N / 2) (e.g., 6 hours → max 3 modules, 12 hours → max 6)
   - If 12 < N ≤ 50: maximum modules = floor(N / 3) (e.g., 24 hours → max 8 modules)
   - If N > 50: maximum modules = floor(N / 4) (e.g., 60 hours → max 15 modules)
   - Never create more modules than this formula allows. Fewer is fine if the topic doesn't need that many.
   - If total time ≤ 2 hours: default to 1 module.

2. RESOURCES PER MODULE — leave resources as empty arrays (fetched separately), but plan module duration accordingly:
   - Do NOT add extra resources as filler. Each must add unique value.
   - If a module would require more than 4 hours, split it into focused sub-modules of 2-4 hours each.

3. SHORT TIMELINE COMPRESSION: If total time < 5 hours, reduce module count, increase density, avoid over-fragmentation and repeated introductory content. Prefer fewer, stronger anchors.

=== GLOBAL ROADMAP CONSTRAINTS (MANDATORY) ===

1. RESOURCE UNIQUENESS: No resource URL may appear in more than one module.
2. TIME BUDGET: Sum of all module estimated_hours must not exceed ${usableMinutes} minutes. No module may exceed its budget by >5%.
3. STACK CONSISTENCY: If user does not specify a language/framework/tool — for conceptual goals use tool-agnostic resources; for hands-on goals declare ONE stack and use it consistently across all modules.
4. COVERAGE BEFORE REDUNDANCY: Maximize coverage of learning objectives. Never have two modules teaching identical content.
5. FINAL VALIDATION: Before outputting JSON, verify: no duplicate resources, all modules respect time budget, stack consistency.

RULES:
- Break the topic into sequential modules. Module count is VARIABLE based on time and complexity.
- Each module must logically build on the previous one.
- DO NOT include any resources or URLs — leave resources as empty arrays. Resources will be fetched separately.
- Do NOT include placeholder actions like "search Google", "look up resources", or "find videos online" in module descriptions/objectives/tips.
- Leave quiz as an empty array for each module. Quizzes are generated later on demand.
- Assign each module to specific days within the timeline.
- Generate a concise "topic" field summarizing the user's input as a proper title (capitalize, remove filler like "I want to learn").
- For each module, generate 3-8 "anchor_terms" — concrete technical terms/entities specific to that module (NOT generic words). These are used for resource filtering.`;
}

function getGoalPromptBlock(goal: string): string {
  switch (goal) {
    case "conceptual": return `CONCEPTUAL learning goal selected.
- Focus on "why" and "how it works" — mental models, comparisons, theory
- Resource style target: mix explainer videos with concept-focused study articles/docs.
- Module count: VARIABLE based on time budget. Fewer modules for short timelines.
- Time split: 80% consuming content, 20% reflection/quizzes
- Assessment style (generated later): Definition-based, concept checks, "explain why X works this way"`;
    case "hands_on": return `HANDS-ON learning goal selected.
- Every module MUST have a "build something" or "try this" component
- Resource style target: mostly practical videos/tutorials/labs that show how to build or implement.
- Module count: VARIABLE based on time budget. Fewer modules for short timelines.
- Time split: 30% learning, 70% doing
- Assessment style (generated later): Code-oriented, "what would this output", practical scenarios`;
    case "quick_overview": return `QUICK OVERVIEW learning goal selected.
- Hit key points fast, no deep dives, focus on "what you need to know"
- Resource style target: concise end-to-end material (crash course, full guide, start-to-finish, top takeaways).
- Module count: Keep MINIMAL — as few modules as possible to cover essentials.
- Even if the user has weeks available, keep it concise. Use extra time for review, not more content.
- Time split: 100% efficient consumption, no lengthy exercises
- Assessment style (generated later): Quick recall, key terminology`;
    case "deep_mastery": return `DEEP MASTERY learning goal selected.
- Thorough coverage including edge cases, best practices, architecture patterns, real-world scenarios
- Resource style target: advanced deep-dive mix (research papers, technical articles/docs, long-form video explanations).
- Module count: VARIABLE — use more modules for longer timelines, but never pad unnecessarily.
- Time split: 40% learning, 40% practice, 20% review
- Assessment style (generated later): Advanced nuance, tradeoffs, "when would you use X vs Y", design decisions`;
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

function sanitizeRoadmapText(value: string): string {
  if (!value || typeof value !== "string") return value;
  const cleaned = value
    .replace(/\[([^\]]+)\]\((https?:\/\/(?:www\.)?google\.[^)]+)\)/gi, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/(?:www\.)?youtube\.com\/results[^)]*)\)/gi, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/(?:www\.)?(?:[^)\s]+\.)?coursera\.(?:org|com)[^)]*)\)/gi, "$1")
    .replace(/https?:\/\/(?:www\.)?google\.[^\s)]+/gi, "")
    .replace(/https?:\/\/(?:www\.)?youtube\.com\/results[^\s)]+/gi, "")
    .replace(/https?:\/\/(?:www\.)?(?:[^\s)]+\.)?coursera\.(?:org|com)[^\s)]*/gi, "")
    .replace(/\b(?:google|youtube)\s+(?:search\s+)?link\b/gi, "")
    .replace(/\bcoursera\s+(?:link|course)\b/gi, "")
    .replace(/\b(?:google|youtube)\s+(?:it|this|that)\b/gi, "")
    .replace(/\b(?:search|google|look up|find)\s+(?:on\s+)?(?:google|youtube|coursera|online|the web)\b[^.]*[.]?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || value;
}

function sanitizeRoadmapPlaceholders(roadmap: any): void {
  if (!roadmap || typeof roadmap !== "object") return;
  if (typeof roadmap.summary === "string") roadmap.summary = sanitizeRoadmapText(roadmap.summary);
  if (typeof roadmap.tips === "string") roadmap.tips = sanitizeRoadmapText(roadmap.tips);
  if (!Array.isArray(roadmap.modules)) return;
  for (const mod of roadmap.modules) {
    if (typeof mod?.description === "string") mod.description = sanitizeRoadmapText(mod.description);
    if (Array.isArray(mod?.learning_objectives)) {
      mod.learning_objectives = mod.learning_objectives
        .filter((o: any) => typeof o === "string")
        .map((o: string) => sanitizeRoadmapText(o))
        .filter((o: string) => o.trim().length > 0);
    }
  }
}

// ─── Main Handler ────────────────────────────────────────────────────────────

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supabaseAuthClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: authUser }, error: authError } = await supabaseAuthClient.auth.getUser();
    if (authError || !authUser) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!checkRateLimit(authUser.id, "generate-roadmap", 10)) {
      return new Response(JSON.stringify({ error: "Too many requests. Please wait before creating another roadmap." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const topic = sanitizePromptInput(body.topic, 200);
    const skill_level = sanitizePromptInput(body.skill_level, 50);
    const learning_goal = sanitizePromptInput(body.learning_goal, 50);
    const { user_id, timeline_weeks, timeline_days, hours_per_day, total_hours: providedTotalHours, hard_deadline, deadline_date, include_weekends, timeline_mode } = body;
    const effectiveGoal = learning_goal || "hands_on";

    const isHoursOnly = timeline_mode === "hours";
    const daysInTimeline = isHoursOnly ? 1 : (timeline_days || (timeline_weeks * 7));
    const studyDays = isHoursOnly ? 1 : (include_weekends === false ? Math.round(daysInTimeline * 5 / 7) : daysInTimeline);
    const totalHours = providedTotalHours || (studyDays * hours_per_day);
    const effectiveHoursPerDay = isHoursOnly ? totalHours : hours_per_day;
    const effectiveTimelineWeeks = isHoursOnly ? Math.round((totalHours / (effectiveHoursPerDay || 1) / 7) * 100) / 100 : (timeline_days ? Math.round((timeline_days / 7) * 10) / 10 : timeline_weeks);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

    // ════════════════════════════════════════════════════════════════════════
    // STEP 1: Generate roadmap structure via AI (Agent 1)
    // ════════════════════════════════════════════════════════════════════════

    const systemPrompt = buildSystemPrompt(totalHours, effectiveGoal, skill_level);

    const userPrompt = `Create a learning roadmap for: "${topic}"
Skill level: ${skill_level}
Learning Goal: ${effectiveGoal}
${isHoursOnly ? `Timeline: Single session of ${totalHours} hours total. All modules happen on day 1.` : `Timeline: ${daysInTimeline} day${daysInTimeline === 1 ? '' : 's'} (${studyDays} study day${studyDays === 1 ? '' : 's'}${include_weekends === false ? ", weekends excluded" : ""})`}
Hours per day: ${effectiveHoursPerDay}
Total available hours: ${totalHours}
${hard_deadline && deadline_date ? `Hard deadline: ${deadline_date} — be extra conservative, plan for ${Math.round(totalHours * 0.8)} hours of content.` : ""}
${isHoursOnly ? `IMPORTANT: This is a single-session roadmap (${totalHours} hours total). All modules must have day_start=1 and day_end=1 and week=1. Keep module count low (2-4 max). The total estimated hours across all modules must not exceed ${totalHours}.` : (daysInTimeline <= 3 ? `IMPORTANT: This is a very short timeline (${daysInTimeline} day${daysInTimeline === 1 ? '' : 's'}). All modules must fit within ${daysInTimeline} day${daysInTimeline === 1 ? '' : 's'}. day_start and day_end must be between 1 and ${daysInTimeline}. Keep module count low (2-4 max).` : "")}

Return ONLY valid JSON with this exact structure:
{
  "topic": "concise clean title",
  "skill_level": "${skill_level}",
  "timeline_weeks": ${effectiveTimelineWeeks},
  "hours_per_day": ${effectiveHoursPerDay},
  "total_hours": ${totalHours},
  "summary": "2-3 sentence overview.",
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
      "anchor_terms": ["term1", "term2", "term3"],
      "quiz": []
    }
  ],
  "tips": "2-3 practical tips"
}

IMPORTANT for anchor_terms: For each module, provide 3-8 concrete technical terms that are specific to that module's content. These should be specific entities (e.g., "lambda", "serverless", "faas") NOT generic words (e.g., "learn", "understand"). They will be used for precise resource filtering.
IMPORTANT: Do NOT write placeholder tasks like "Google this", "search YouTube", or "find resources online" anywhere in modules or tips.`;

    const t0 = Date.now();
    console.log(`Generating roadmap: topic="${topic}", goal=${effectiveGoal}, level=${skill_level}, hours=${totalHours}`);

    let response: Response | null = null;
    const agent1Attempts = 1;
    for (let attempt = 1; attempt <= agent1Attempts; attempt++) {
      try {
        const agent1Timeout = TIMEOUTS_MS.agent1Base + TIMEOUTS_MS.agent1PerWeek * Math.max(0, Math.ceil(daysInTimeline / 7) - 1);
        response = await callLLM(
          ROADMAP_MODEL_AGENT1,
          [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
          LOVABLE_API_KEY,
          GEMINI_API_KEY,
          agent1Timeout,
        );
        break;
      } catch (e) {
        if (attempt < agent1Attempts) {
          const reason = isAbortError(e) ? "timed out" : "failed";
          console.warn(`Agent 1 ${reason}; retrying once...`);
          await sleep(300);
          continue;
        }
        if (isAbortError(e)) {
          throw new Error("AI generation timed out. Please try again.");
        }
        throw e;
      }
    }

    if (!response) throw new Error("AI generation failed");

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

    const responseText = await response.text();
    if (!responseText || responseText.trim().length === 0) {
      throw new Error("AI returned an empty response. Please try again.");
    }
    const data = parsePossiblyMalformedJson(responseText);
    const content = data?.choices?.[0]?.message?.content ?? responseText;

    let roadmap;
    roadmap = parsePossiblyMalformedJson(content);
    if (!roadmap || !Array.isArray(roadmap.modules)) {
      console.error("Failed to parse roadmap JSON from content:", String(content).substring(0, 500));
      roadmap = buildFallbackRoadmap(
        topic,
        skill_level,
        effectiveTimelineWeeks,
        effectiveHoursPerDay,
        totalHours,
        daysInTimeline
      );
      console.warn("Using fallback roadmap structure due to malformed Agent 1 output.");
    }

    sanitizeRoadmapPlaceholders(roadmap);
    normalizeModulePlan(roadmap, totalHours, daysInTimeline);
    enforceModuleTimeWindowConsistency(roadmap.modules || [], effectiveHoursPerDay);
    console.log(`[TIMING] Agent 1 (structure): ${Date.now() - t0} ms`);

    // Ensure empty resources & quiz arrays, compute total_hours
    if (Array.isArray(roadmap.modules)) {
      for (const mod of roadmap.modules) {
        mod.resources = [];
        mod.quiz = [];
      }
      roadmap.total_hours = Math.round(
        roadmap.modules.reduce((sum: number, m: any) => sum + Number(m.estimated_hours || 0), 0) * 10
      ) / 10;
    }

    // Mark resources as pending — populate-resources will fill them in background
    roadmap.resources_pending = true;

    console.log(`[TIMING] Total generate-roadmap (structure only): ${Date.now() - t0} ms`);
    console.log("Roadmap structure generation complete. Resources will be populated by populate-resources.");

    return new Response(JSON.stringify(roadmap), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("generate-roadmap error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
