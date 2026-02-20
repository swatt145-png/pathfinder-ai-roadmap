import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import {
  type SerperVideoResult,
  type SerperWebResult,
  type CandidateResource,
  type ModuleContext,
  type YouTubeMetadata,

  extractYouTubeVideoId,
  normalizeResourceUrl,
  isAllowedResourceUrl,
  detectCertificationIntent,
  getMaxResourcesForModule,

  computeHybridSimilarity,

  isGarbage,
  generateModuleAnchors,
  applyStage4Filter,
  looksLikeListingPage,
  isDiscussionOrMetaResource,

  computeLightAuthorityBump,
  computeContextFitScoreFallback,

  fetchTopicAnchors,
  fetchModuleResults,
  fetchYouTubeMetadata,

  mergeAndDeduplicate,
  enrichCandidatesWithYouTube,
} from "../_shared/resource-pipeline.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: authUser }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !authUser) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { roadmap_id } = await req.json();
    if (!roadmap_id) {
      return new Response(JSON.stringify({ error: "roadmap_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const SERPER_API_KEY = Deno.env.get("SERPER_API_KEY") || "";
    const YOUTUBE_API_KEY = Deno.env.get("YOUTUBE_API_KEY") || "";
    if (!SERPER_API_KEY) {
      return new Response(JSON.stringify({ error: "SERPER_API_KEY not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseAdmin = SUPABASE_SERVICE_ROLE_KEY
      ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
      : supabaseAuth;

    // Read roadmap from DB
    const { data: roadmapRow, error: readErr } = await supabaseAdmin
      .from("roadmaps")
      .select("roadmap_data, user_id, learning_goal")
      .eq("id", roadmap_id)
      .single();

    if (readErr || !roadmapRow) {
      return new Response(JSON.stringify({ error: "Roadmap not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Verify ownership
    if (roadmapRow.user_id !== authUser.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const roadmapData = roadmapRow.roadmap_data as any;
    if (!roadmapData?.modules?.length) {
      return new Response(JSON.stringify({ error: "No modules in roadmap" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const topic = roadmapData.topic || "Learning Topic";
    const level = roadmapData.skill_level || "beginner";
    const goal = roadmapRow.learning_goal || roadmapData.learning_goal || "hands_on";
    const modules = roadmapData.modules;
    const totalHours = Number(roadmapData.total_hours || 10);
    const hoursPerDay = Number(roadmapData.hours_per_day || 2);

    // Read module progress to know which are completed
    const { data: progressRows } = await supabaseAdmin
      .from("progress")
      .select("module_id, status")
      .eq("roadmap_id", roadmap_id)
      .eq("status", "completed");

    const completedModuleIds = new Set<string>(
      (progressRows || []).map((p: any) => p.module_id)
    );

    const certificationIntent = detectCertificationIntent(topic);
    const excludedUrls = new Set<string>();
    const excludedDomains = new Set<string>();

    console.log(`[populate-resources] Starting for roadmap ${roadmap_id}: ${modules.length} modules, topic="${topic}"`);
    const t0 = Date.now();

    // Fetch topic anchors + module results in parallel
    const [topicAnchors, ...moduleResults] = await Promise.all([
      fetchTopicAnchors(topic, level, goal, certificationIntent, SERPER_API_KEY, supabaseAdmin, true, false),
      ...modules.map((mod: any) => completedModuleIds.has(mod.id)
        ? Promise.resolve({ videos: [] as SerperVideoResult[], web: [] as SerperWebResult[] })
        : fetchModuleResults(mod, topic, level, goal, certificationIntent, SERPER_API_KEY, supabaseAdmin, true, false)),
    ]);

    // Collect used URLs from completed modules
    const usedUrls = new Set<string>();
    const usedVideoIds = new Set<string>();
    for (const mod of modules) {
      if (!completedModuleIds.has(mod.id)) continue;
      for (const r of (mod.resources || [])) {
        const normalized = normalizeResourceUrl(String(r.url || ""));
        if (normalized) usedUrls.add(normalized);
        const vid = extractYouTubeVideoId(normalized);
        if (vid) usedVideoIds.add(vid);
      }
    }

    // Build per-module candidate lists and collect video IDs
    const totalAvailableMinutes = totalHours * 60;
    const allVideoIds = new Set<string>();
    const moduleCandidatesMap = new Map<number, CandidateResource[]>();

    for (let i = 0; i < modules.length; i++) {
      if (completedModuleIds.has(modules[i].id)) continue;
      const candidates = mergeAndDeduplicate(
        topicAnchors, moduleResults[i], modules[i].title || "",
        totalAvailableMinutes, excludedUrls, excludedDomains
      );
      moduleCandidatesMap.set(i, candidates);
      for (const c of candidates) {
        if (c.type === "video") {
          const id = extractYouTubeVideoId(c.url);
          if (id) allVideoIds.add(id);
        }
      }
    }

    // YouTube enrichment
    let ytMap = new Map<string, YouTubeMetadata>();
    if (allVideoIds.size > 0 && YOUTUBE_API_KEY) {
      ytMap = await fetchYouTubeMetadata([...allVideoIds], YOUTUBE_API_KEY, supabaseAdmin);
      console.log(`[populate-resources] YouTube: ${ytMap.size}/${allVideoIds.size} hits`);
    }

    // Pass 1: Score every candidate against every module
    interface ScoredEntry {
      candidate: CandidateResource;
      moduleIndex: number;
      score: number;
    }
    const allScores: ScoredEntry[] = [];

    for (let i = 0; i < modules.length; i++) {
      if (completedModuleIds.has(modules[i].id)) continue;
      const mod = modules[i];
      const rawCandidates = moduleCandidatesMap.get(i) || [];
      const anchorTerms = generateModuleAnchors(mod, topic);
      const moduleMinutes = Math.floor((mod.estimated_hours || 1) * 60);
      const ctx: ModuleContext = {
        topic,
        moduleTitle: mod.title || "",
        moduleDescription: mod.description || "",
        learningObjectives: mod.learning_objectives || [],
        goal, level, moduleMinutes, anchorTerms,
      };

      const enriched = enrichCandidatesWithYouTube(rawCandidates, ytMap, ctx);
      for (const c of enriched) {
        if (c.type !== "video") {
          computeLightAuthorityBump(c);
          c.context_fit_score = computeContextFitScoreFallback(c, ctx);
        }
      }

      const filtered = applyStage4Filter(enriched, ctx);
      const clean = filtered.filter(c => !isGarbage(c));
      for (const c of clean) {
        allScores.push({ candidate: c, moduleIndex: i, score: c.context_fit_score + c.authority_score });
      }
    }

    // Pass 2: Assign by best fit
    allScores.sort((a, b) => b.score - a.score);
    const moduleAssignments = new Map<number, CandidateResource[]>();
    const moduleMinutesUsed = new Map<number, number>();
    const assignedUrls = new Set<string>(usedUrls);
    const assignedVideoIds = new Set<string>(usedVideoIds);
    const usableMinutes = totalHours * 60 * 0.85;
    let totalRoadmapMinutes = 0;

    for (let i = 0; i < modules.length; i++) {
      if (!completedModuleIds.has(modules[i].id)) {
        moduleAssignments.set(i, []);
        moduleMinutesUsed.set(i, 0);
      }
    }

    for (const { candidate, moduleIndex } of allScores) {
      const normalizedUrl = normalizeResourceUrl(candidate.url);
      if (assignedUrls.has(normalizedUrl)) continue;
      const videoId = extractYouTubeVideoId(normalizedUrl);
      if (videoId && assignedVideoIds.has(videoId)) continue;

      const mod = modules[moduleIndex];
      const maxResources = getMaxResourcesForModule(Number(mod.estimated_hours || 1));
      const assigned = moduleAssignments.get(moduleIndex) || [];
      if (assigned.length >= maxResources) continue;

      const moduleMinutes = Math.floor((mod.estimated_hours || 1) * 60);
      const moduleBudgetCap = moduleMinutes * 1.05;
      const currentModuleMinutes = moduleMinutesUsed.get(moduleIndex) || 0;
      if (currentModuleMinutes + candidate.estimated_minutes > moduleBudgetCap) continue;
      if (totalRoadmapMinutes + candidate.estimated_minutes > usableMinutes) continue;

      assigned.push(candidate);
      moduleAssignments.set(moduleIndex, assigned);
      moduleMinutesUsed.set(moduleIndex, currentModuleMinutes + candidate.estimated_minutes);
      totalRoadmapMinutes += candidate.estimated_minutes;
      assignedUrls.add(normalizedUrl);
      if (videoId) assignedVideoIds.add(videoId);
    }

    // Pass 3: Coverage repair + video diversity
    for (let i = 0; i < modules.length; i++) {
      if (completedModuleIds.has(modules[i].id)) continue;
      const mod = modules[i];
      const assigned = moduleAssignments.get(i) || [];
      const moduleMinutes = Math.floor((mod.estimated_hours || 1) * 60);
      const moduleBudgetCap = moduleMinutes * 1.05;
      const maxResources = getMaxResourcesForModule(Number(mod.estimated_hours || 1));
      let currentModuleMinutes = moduleMinutesUsed.get(i) || 0;

      // Ensure at least one video
      if (!assigned.some(r => r.type === "video")) {
        const videoCandidates = allScores
          .filter(s => s.moduleIndex === i && s.candidate.type === "video")
          .sort((a, b) => b.score - a.score);
        for (const { candidate } of videoCandidates) {
          const normalizedUrl = normalizeResourceUrl(candidate.url);
          if (assignedUrls.has(normalizedUrl)) continue;
          const videoId = extractYouTubeVideoId(normalizedUrl);
          if (videoId && assignedVideoIds.has(videoId)) continue;
          if (currentModuleMinutes + candidate.estimated_minutes > moduleBudgetCap) continue;
          if (totalRoadmapMinutes + candidate.estimated_minutes > usableMinutes) continue;
          if (assigned.length >= maxResources) break;
          assigned.push(candidate);
          currentModuleMinutes += candidate.estimated_minutes;
          totalRoadmapMinutes += candidate.estimated_minutes;
          assignedUrls.add(normalizedUrl);
          if (videoId) assignedVideoIds.add(videoId);
          break;
        }
      }

      // Fill if coverage < 60%
      const coverageTarget = moduleMinutes * 0.6;
      if (currentModuleMinutes < coverageTarget) {
        const fillCandidates = allScores.filter(s => s.moduleIndex === i).sort((a, b) => b.score - a.score);
        for (const { candidate } of fillCandidates) {
          if (assigned.length >= maxResources || currentModuleMinutes >= coverageTarget) break;
          const normalizedUrl = normalizeResourceUrl(candidate.url);
          if (assignedUrls.has(normalizedUrl)) continue;
          const videoId = extractYouTubeVideoId(normalizedUrl);
          if (videoId && assignedVideoIds.has(videoId)) continue;
          if (currentModuleMinutes + candidate.estimated_minutes > moduleBudgetCap) continue;
          if (totalRoadmapMinutes + candidate.estimated_minutes > usableMinutes) continue;
          assigned.push(candidate);
          currentModuleMinutes += candidate.estimated_minutes;
          totalRoadmapMinutes += candidate.estimated_minutes;
          assignedUrls.add(normalizedUrl);
          if (videoId) assignedVideoIds.add(videoId);
        }
      }

      // Rescue for 0-resource modules
      if (assigned.length === 0) {
        const rawCandidates = moduleCandidatesMap.get(i) || [];
        const rescuePool = rawCandidates
          .filter(c => !isGarbage(c) && isAllowedResourceUrl(c.url))
          .filter(c => !looksLikeListingPage(c.url, c.title, c.description))
          .filter(c => !isDiscussionOrMetaResource(c.url, c.title, c.description))
          .sort((a, b) => (b.context_fit_score + b.authority_score) - (a.context_fit_score + a.authority_score));
        for (const c of rescuePool) {
          if (assigned.length >= 2) break;
          const normalizedUrl = normalizeResourceUrl(c.url);
          if (assignedUrls.has(normalizedUrl)) continue;
          assigned.push(c);
          assignedUrls.add(normalizedUrl);
          totalRoadmapMinutes += c.estimated_minutes;
        }
      }

      moduleAssignments.set(i, assigned);
    }

    // Write assignments back to roadmap data
    for (let i = 0; i < modules.length; i++) {
      if (completedModuleIds.has(modules[i].id)) continue;
      const assigned = moduleAssignments.get(i) || [];
      const cleaned = assigned.filter(c =>
        isAllowedResourceUrl(c.url) &&
        !looksLikeListingPage(c.url, c.title, c.description) &&
        !isDiscussionOrMetaResource(c.url, c.title, c.description)
      );
      modules[i].resources = cleaned.map(c => ({
        title: c.title,
        url: c.url,
        type: c.type,
        estimated_minutes: c.estimated_minutes,
        description: c.description,
        source: c.source,
        channel: c.channel,
        view_count: c.view_count,
        like_count: c.like_count,
        quality_signal: c.quality_signal,
      }));
    }

    // Remove resources_pending flag
    roadmapData.resources_pending = false;

    // Write updated roadmap back to DB
    const { error: writeErr } = await supabaseAdmin
      .from("roadmaps")
      .update({ roadmap_data: roadmapData })
      .eq("id", roadmap_id);

    if (writeErr) {
      console.error(`[populate-resources] DB write failed:`, writeErr);
      return new Response(JSON.stringify({ error: "Failed to save resources" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const totalResources = modules.reduce((sum: number, m: any) => sum + (m.resources?.length || 0), 0);
    console.log(`[populate-resources] Done in ${Date.now() - t0}ms: ${totalResources} resources across ${modules.length} modules`);

    return new Response(JSON.stringify({ success: true, total_resources: totalResources }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("populate-resources error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
