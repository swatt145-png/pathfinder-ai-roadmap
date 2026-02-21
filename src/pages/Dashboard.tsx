import { useEffect, useState } from "react";
import WavyBackground from "@/components/WavyBackground";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppBar } from "@/components/AppBar";
import { ModuleDetail } from "@/components/ModuleDetail";
import { AdaptPlanModal } from "@/components/AdaptPlanModal";
import { AdaptationNotification } from "@/components/AdaptationNotification";
import { ModuleCompletionActionsModal } from "@/components/ModuleCompletionActionsModal";
import { RoadmapReviewModal } from "@/components/RoadmapReviewModal";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Flame, Clock, BookOpen, Settings2, ArrowRight, Sparkles, ArrowLeft, BookOpenCheck, Code2, Zap, GraduationCap } from "lucide-react";
import type { RoadmapData, ModuleProgress, Module, AdaptationResult } from "@/lib/types";

interface CompletionActionState {
  completedModuleTitle: string;
  nextModule: Module | null;
  suggestedAdaptation: AdaptationResult | null;
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { roadmapId } = useParams<{ roadmapId?: string }>();
  const [roadmap, setRoadmap] = useState<any>(null);
  const [roadmapData, setRoadmapData] = useState<RoadmapData | null>(null);
  const [progressMap, setProgressMap] = useState<Record<string, ModuleProgress>>({});
  const [loading, setLoading] = useState(true);
  const [selectedModule, setSelectedModule] = useState<Module | null>(null);
  const [adaptOpen, setAdaptOpen] = useState(false);
  const [adaptationNotif, setAdaptationNotif] = useState<AdaptationResult | null>(null);
  const [applyingAdaptation, setApplyingAdaptation] = useState(false);
  const [completionActions, setCompletionActions] = useState<CompletionActionState | null>(null);
  const [checkInLoading, setCheckInLoading] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [revertConfirmOpen, setRevertConfirmOpen] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [revertMessage, setRevertMessage] = useState<string | null>(null);
  
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchData = async () => {
    if (!user) return;

    let rm: any = null;
    if (roadmapId) {
      const { data } = await supabase
        .from("roadmaps")
        .select("*")
        .eq("id", roadmapId)
        .eq("user_id", user.id)
        .maybeSingle();
      rm = data;
    } else {
      // Legacy fallback: pick the most recent active roadmap
      const { data } = await supabase
        .from("roadmaps")
        .select("*")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1);
      rm = data?.[0] ?? null;
    }

    if (!rm) {
      navigate("/my-roadmaps");
      return;
    }

    setRoadmap(rm);
    setRoadmapData(rm.roadmap_data as unknown as RoadmapData);

    const { data: prog } = await supabase
      .from("progress")
      .select("*")
      .eq("roadmap_id", rm.id);

    const map: Record<string, ModuleProgress> = {};
    (prog || []).forEach((p: any) => { map[p.module_id] = p as ModuleProgress; });
    setProgressMap(map);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [user]);

  // Only count completed modules that exist in the current roadmap
  const currentModuleIds = new Set(roadmapData?.modules.map((m) => m.id) ?? []);
  const completedCount = Object.values(progressMap).filter((p) => p.status === "completed" && currentModuleIds.has(p.module_id)).length;
  const totalModules = roadmapData?.modules.length ?? 0;
  const progressPercent = totalModules ? Math.min(Math.round((completedCount / totalModules) * 100), 100) : 0;

  const totalHours = roadmapData?.modules.reduce((s, m) => s + m.estimated_hours, 0) ?? 0;
  const completedHours = roadmapData?.modules
    .filter((m) => progressMap[m.id]?.status === "completed")
    .reduce((s, m) => s + m.estimated_hours, 0) ?? 0;

  const handleModuleComplete = async (moduleId: string, selfReport: string, quizScore: number | null, quizAnswers: any) => {
    if (!user || !roadmap || !roadmapData) return;

    const mod = roadmapData.modules.find((m) => m.id === moduleId);
    const currentModuleIndex = roadmapData.modules.findIndex((m) => m.id === moduleId);
    const nextModule = currentModuleIndex >= 0 ? (roadmapData.modules[currentModuleIndex + 1] ?? null) : null;

    // Upsert progress
    const existing = progressMap[moduleId];
    if (existing) {
      await supabase.from("progress").update({
        status: "completed",
        self_report: selfReport,
        quiz_score: quizScore,
        quiz_answers: quizAnswers,
        completed_at: new Date().toISOString(),
      }).eq("id", existing.id);
    } else {
      await supabase.from("progress").insert({
        roadmap_id: roadmap.id,
        user_id: user.id,
        module_id: moduleId,
        module_title: mod?.title ?? null,
        status: "completed",
        self_report: selfReport,
        quiz_score: quizScore,
        quiz_answers: quizAnswers,
        completed_at: new Date().toISOString(),
      });
    }

    // Update roadmap completed count + streak
    const newCompleted = Object.values(progressMap).filter(p => p.status === "completed" && currentModuleIds.has(p.module_id)).length + (currentModuleIds.has(moduleId) ? 1 : 0);
    const today = new Date().toISOString().split("T")[0];
    const lastActivity = roadmap.last_activity_date;
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    let newStreak = roadmap.current_streak || 0;
    if (lastActivity === today) {
      // same day, no change
    } else if (lastActivity === yesterday) {
      newStreak += 1;
    } else {
      newStreak = 1;
    }

    await supabase.from("roadmaps").update({
      completed_modules: newCompleted,
      current_streak: newStreak,
      last_activity_date: today,
    }).eq("id", roadmap.id);

    // Optimistically update local state so streak & count render immediately
    setRoadmap((prev: any) => ({ ...prev, completed_modules: newCompleted, current_streak: newStreak, last_activity_date: today }));
    setProgressMap((prev) => ({
      ...prev,
      [moduleId]: {
        ...(prev[moduleId] || {}),
        module_id: moduleId,
        status: "completed",
        self_report: selfReport as any,
        quiz_score: quizScore,
        quiz_answers: quizAnswers,
        completed_at: new Date().toISOString(),
      } as ModuleProgress,
    }));

    // Close module view and show completion popup immediately
    setSelectedModule(null);

    // Show popup right away before async check-in
    const immediateNextModule = currentModuleIndex >= 0 ? (roadmapData.modules[currentModuleIndex + 1] ?? null) : null;
    setCompletionActions({
      completedModuleTitle: mod?.title ?? "this module",
      nextModule: immediateNextModule,
      suggestedAdaptation: null,
    });

    // Start check-in loading indicator immediately (visible in completion popup)
    setCheckInLoading(true);

    await fetchData();

    // Call check-in in background
    const allProg = Object.values(progressMap);
    allProg.push({
      id: "", roadmap_id: roadmap.id, user_id: user.id,
      module_id: moduleId, module_title: mod?.title ?? null,
      status: "completed", self_report: selfReport as any,
      quiz_score: quizScore, quiz_answers: quizAnswers,
      time_spent_minutes: null, completed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      completed_resources: [], notes: "",
    });

    try {
      const { data: checkInResult } = await supabase.functions.invoke("check-in", {
        body: {
          roadmap_data: roadmapData,
          module_id: moduleId,
          module_title: mod?.title,
          self_report: selfReport,
          quiz_score: quizScore,
          quiz_answers: quizAnswers,
          all_progress: allProg,
          learning_goal: roadmap?.learning_goal || "hands_on",
        },
      });

      console.log("[check-in] result:", JSON.stringify({
        needs_adaptation: checkInResult?.needs_adaptation,
        adaptation_type: checkInResult?.adaptation_type,
        has_updated_roadmap: !!checkInResult?.updated_roadmap,
        reason: checkInResult?.reason,
        message: checkInResult?.message_to_student,
        error: checkInResult?.error,
      }));

      const suggestion = checkInResult?.needs_adaptation && checkInResult?.updated_roadmap
        ? (checkInResult as AdaptationResult)
        : null;

      // Update popup with adaptation suggestion, or show standalone notification if popup was dismissed
      if (suggestion) {
        setCompletionActions(prev => {
          if (prev) return { ...prev, suggestedAdaptation: suggestion };
          // Popup already closed — show as standalone notification
          setAdaptationNotif(suggestion);
          return null;
        });
      }
    } catch (e) {
      console.error("Check-in error:", e);
    } finally {
      setCheckInLoading(false);
    }
  };

  const handleAdaptApply = async (updatedRoadmap: RoadmapData) => {
    if (!roadmap || !user) return;
    await supabase.from("adaptations").insert({
      roadmap_id: roadmap.id,
      user_id: user.id,
      trigger_reason: "manual_adjustment",
      changes_summary: "Manual plan adaptation",
      previous_roadmap: roadmapData as any,
      new_roadmap: updatedRoadmap as any,
    });

    await supabase.from("roadmaps").update({
      roadmap_data: updatedRoadmap as any,
      total_modules: updatedRoadmap.modules.length,
      timeline_weeks: updatedRoadmap.timeline_weeks,
      hours_per_day: updatedRoadmap.hours_per_day,
    }).eq("id", roadmap.id);

    setAdaptOpen(false);
    fetchData();

    // Populate resources in the background (modules are already visible)
    if (updatedRoadmap.resources_pending) {
      supabase.functions.invoke("populate-resources", {
        body: { roadmap_id: roadmap.id },
      }).then(() => {
        fetchData();
      }).catch((err) => {
        console.error("populate-resources error:", err);
        fetchData();
      });
    }
  };

  const handleAcceptCheckInAdaptation = async (preserveSchedule = false) => {
    if (!adaptationNotif?.updated_roadmap || !roadmap || !user || !roadmapData) return;
    setApplyingAdaptation(true);
    const suggestedRoadmap = adaptationNotif.updated_roadmap;
    const updatedRoadmap: RoadmapData = preserveSchedule
      ? {
          ...suggestedRoadmap,
          timeline_weeks: roadmapData.timeline_weeks,
        }
      : suggestedRoadmap;
    try {
      await supabase.from("adaptations").insert({
        roadmap_id: roadmap.id,
        user_id: user.id,
        trigger_reason: preserveSchedule ? "self_report_adaptation_no_schedule_change" : "self_report_adaptation",
        changes_summary: preserveSchedule
          ? `${adaptationNotif.changes_summary} (Accepted with no schedule change)`
          : adaptationNotif.changes_summary,
        previous_roadmap: roadmapData as any,
        new_roadmap: updatedRoadmap as any,
      });

      await supabase.from("roadmaps").update({
        roadmap_data: updatedRoadmap as any,
        total_modules: updatedRoadmap.modules.length,
        timeline_weeks: updatedRoadmap.timeline_weeks,
        hours_per_day: updatedRoadmap.hours_per_day,
      }).eq("id", roadmap.id);

      setAdaptationNotif(null);
      setCompletionActions(null);
      fetchData();
    } finally {
      setApplyingAdaptation(false);
    }
  };

  const handleKeepCurrentRoadmap = () => {
    setAdaptationNotif(null);
  };

  const handleProceedToNextModule = () => {
    const nextModule = completionActions?.nextModule ?? null;
    setCompletionActions(null);
    if (nextModule) setSelectedModule(nextModule);
  };

  const handleReviewCurrentRoadmap = () => {
    setCompletionActions(null);
    setReviewOpen(true);
  };

  const handleGenerateQuizForModule = async (moduleId: string) => {
    if (!roadmapData || !roadmap) throw new Error("Roadmap data unavailable.");
    const targetModule = roadmapData.modules.find((m) => m.id === moduleId);
    if (!targetModule) throw new Error("Module not found.");

    const { data, error } = await supabase.functions.invoke("generate-module-quiz", {
      body: {
        topic: roadmapData.topic,
        skill_level: roadmapData.skill_level,
        learning_goal: roadmap.learning_goal || "hands_on",
        module: {
          id: targetModule.id,
          title: targetModule.title,
          description: targetModule.description,
          learning_objectives: targetModule.learning_objectives || [],
        },
      },
    });

    if (error) throw new Error(error.message || "Quiz generation failed.");
    const generatedQuiz = Array.isArray(data?.quiz) ? data.quiz : [];
    if (generatedQuiz.length === 0) throw new Error("No quiz was generated.");

    const updatedRoadmap: RoadmapData = {
      ...roadmapData,
      modules: roadmapData.modules.map((m) => (
        m.id === moduleId ? { ...m, quiz: generatedQuiz } : m
      )),
    };

    const updatedModule = updatedRoadmap.modules.find((m) => m.id === moduleId) || null;
    setRoadmapData(updatedRoadmap);
    if (updatedModule) setSelectedModule(updatedModule);

    await supabase.from("roadmaps").update({
      roadmap_data: updatedRoadmap as any,
    }).eq("id", roadmap.id);
  };

  const handleArchiveAndNew = async () => {
    if (!roadmap) return;
    await supabase.from("roadmaps").update({ status: "archived" }).eq("id", roadmap.id);
    setArchiveConfirmOpen(false);
    navigate("/my-roadmaps");
  };

  const handleDeleteRoadmap = async () => {
    if (!roadmap || !user) return;
    setDeleting(true);
    try {
      // Delete progress first, then the roadmap
      await supabase.from("progress").delete().eq("roadmap_id", roadmap.id);
      await supabase.from("adaptations").delete().eq("roadmap_id", roadmap.id);
      await supabase.from("roadmaps").delete().eq("id", roadmap.id);
      setDeleteConfirmOpen(false);
      navigate("/my-roadmaps");
    } finally {
      setDeleting(false);
    }
  };

  const handleRevertToPreviousPlan = async () => {
    if (!roadmap || !user) return;
    setReverting(true);
    try {
      const { data: lastAdaptation } = await supabase
        .from("adaptations")
        .select("*")
        .eq("roadmap_id", roadmap.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!lastAdaptation?.previous_roadmap) {
        setReverting(false);
        setRevertMessage("This is the original roadmap — no previous plan to revert to.");
        return;
      }
      setRevertMessage(null);

      const previousRoadmap = lastAdaptation.previous_roadmap as unknown as RoadmapData;

      // Log this revert as a new adaptation
      await supabase.from("adaptations").insert({
        roadmap_id: roadmap.id,
        user_id: user.id,
        trigger_reason: "revert_to_previous",
        changes_summary: "Reverted to previous plan",
        previous_roadmap: roadmapData as any,
        new_roadmap: previousRoadmap as any,
      });

      await supabase.from("roadmaps").update({
        roadmap_data: previousRoadmap as any,
        total_modules: previousRoadmap.modules.length,
        timeline_weeks: previousRoadmap.timeline_weeks,
        hours_per_day: previousRoadmap.hours_per_day,
      }).eq("id", roadmap.id);

      setRevertConfirmOpen(false);
      fetchData();
    } finally {
      setReverting(false);
    }
  };

  const handleAdaptFromCompletion = () => {
    const suggested = completionActions?.suggestedAdaptation ?? null;
    setCompletionActions(null);
    if (suggested?.updated_roadmap) {
      setAdaptationNotif(suggested);
      return;
    }
    setAdaptOpen(true);
  };

  if (loading) {
    return (
      <>
        <AppBar />
        <div className="flex min-h-screen items-center justify-center pt-14">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      </>
    );
  }

  if (!roadmapData) return null;

  const getModuleStatus = (mod: Module) => progressMap[mod.id]?.status ?? "not_started";
  const getNextModule = (current: Module | null): Module | null => {
    if (!current || !roadmapData?.modules?.length) return null;
    const byId = roadmapData.modules.findIndex((m) => m.id === current.id);
    if (byId >= 0) return roadmapData.modules[byId + 1] ?? null;

    const ordered = [...roadmapData.modules].sort((a, b) => {
      const dayStartDiff = Number(a.day_start || 0) - Number(b.day_start || 0);
      if (dayStartDiff !== 0) return dayStartDiff;
      return a.title.localeCompare(b.title);
    });
    const byTitle = ordered.findIndex((m) => m.title === current.title);
    if (byTitle >= 0) return ordered[byTitle + 1] ?? null;
    return null;
  };

  const getPrevModule = (current: Module | null): Module | null => {
    if (!current || !roadmapData?.modules?.length) return null;
    const byId = roadmapData.modules.findIndex((m) => m.id === current.id);
    if (byId > 0) return roadmapData.modules[byId - 1] ?? null;

    const ordered = [...roadmapData.modules].sort((a, b) => {
      const dayStartDiff = Number(a.day_start || 0) - Number(b.day_start || 0);
      if (dayStartDiff !== 0) return dayStartDiff;
      return a.title.localeCompare(b.title);
    });
    const byTitle = ordered.findIndex((m) => m.title === current.title);
    if (byTitle > 0) return ordered[byTitle - 1] ?? null;
    return null;
  };

  // All modules are clickable regardless of order — firstIncomplete is just for the "Continue" CTA
  const firstIncomplete = roadmapData.modules.find((m) => getModuleStatus(m) !== "completed");

  return (
    <>
      <AppBar />
      <WavyBackground />
      <div className="min-h-screen pt-16 pb-24 px-4 md:px-12">
        <div className="md:mr-[220px]">
        {/* Main content */}
        <div className="w-full">
        {/* Summary Card */}
        <div className="glass-blue p-6 mb-6 animate-fade-in">
          <div className="flex items-center gap-3 mb-1">
            <Button variant="ghost" size="icon" onClick={() => navigate("/my-roadmaps")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h2 className="font-heading text-xl md:text-2xl font-bold">{roadmapData.topic}</h2>
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            <span className="px-2 py-0.5 text-sm font-heading rounded-full bg-primary/20 text-primary">{roadmapData.skill_level}</span>
            {roadmap?.learning_goal && (() => {
              const goalMap: Record<string, { icon: React.ElementType; label: string }> = {
                conceptual: { icon: BookOpenCheck, label: "Conceptual" },
                hands_on: { icon: Code2, label: "Hands-On" },
                quick_overview: { icon: Zap, label: "Quick Overview" },
                deep_mastery: { icon: GraduationCap, label: "Deep Mastery" },
              };
              const g = goalMap[roadmap.learning_goal];
              if (!g) return null;
              const GoalIcon = g.icon;
              return (
                <span className="px-2 py-0.5 text-sm font-heading rounded-full bg-accent/20 text-accent-foreground inline-flex items-center gap-1">
                  <GoalIcon className="w-3.5 h-3.5" /> {g.label}
                </span>
              );
            })()}
          </div>

          {/* Progress bar */}
          <div className="mb-4">
            <div className="flex justify-between text-base mb-1">
              <span className="text-muted-foreground">{completedCount} of {totalModules} modules</span>
              <span className="text-primary font-heading font-bold">{progressPercent}%</span>
            </div>
            <div className="h-2 bg-muted/50 rounded-full overflow-hidden">
              <div className="h-full gradient-primary rounded-full transition-all duration-500" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 text-center text-base">
            <div className="glass-blue p-3">
              <div className="icon-circle mx-auto mb-1"><Clock className="w-5 h-5 text-primary" /></div>
              <span className="text-sm text-muted-foreground">{completedHours.toFixed(0)}h / {totalHours.toFixed(0)}h</span>
            </div>
            <div className="glass-blue p-3">
              <div className="icon-circle mx-auto mb-1"><BookOpen className="w-5 h-5 text-primary" /></div>
              <span className="text-sm text-muted-foreground">
                {(() => {
                  const totalDays = roadmapData.timeline_weeks * 7;
                  const elapsed = Math.max(Math.floor((Date.now() - new Date(roadmap.created_at).getTime()) / 86400000), 0);
                  if (totalDays <= 1) {
                    return "Day 1 of 1";
                  } else if (roadmapData.timeline_weeks < 1.5) {
                    return `Day ${Math.min(elapsed + 1, Math.round(totalDays))} of ${Math.round(totalDays)}`;
                  } else {
                    const currentWeek = Math.min(Math.ceil((elapsed + 1) / 7) || 1, Math.ceil(roadmapData.timeline_weeks));
                    return `Week ${currentWeek} of ${Math.ceil(roadmapData.timeline_weeks)}`;
                  }
                })()}
              </span>
            </div>
            <div className="glass-blue p-3">
              <div className="icon-circle mx-auto mb-1" style={{ background: 'hsl(var(--warning) / 0.1)', borderColor: 'hsl(var(--warning) / 0.2)' }}><Flame className="w-5 h-5 text-warning" /></div>
              <span className="text-sm text-muted-foreground">
                {completedCount > 0 ? `${completedCount} module streak 🔥` : "Start your streak!"}
              </span>
            </div>
          </div>
        </div>

        {/* Mobile: inline action buttons */}
        {!selectedModule && (
        <div className="flex md:hidden flex-wrap gap-2 mb-6">
          {roadmap?.status === "archived" ? (
            <>
              <Button onClick={async () => { await supabase.from("roadmaps").update({ status: "active" }).eq("id", roadmap.id); navigate("/my-roadmaps"); }} size="sm" className="gradient-primary text-primary-foreground font-heading font-bold text-xs h-9 flex-1">
                <Settings2 className="mr-1.5 h-3.5 w-3.5" /> Restore
              </Button>
              <Button onClick={() => setDeleteConfirmOpen(true)} size="sm" className="bg-destructive/10 text-destructive hover:bg-destructive/20 font-heading font-bold text-xs h-9 flex-1">Delete</Button>
            </>
          ) : (
            <>
              <Button onClick={() => setAdaptOpen(true)} size="sm" className="gradient-primary text-primary-foreground font-heading font-bold text-xs h-9 flex-1 min-w-[45%]"><Settings2 className="mr-1 h-3.5 w-3.5" /> Adapt Plan</Button>
              <Button onClick={() => setRevertConfirmOpen(true)} size="sm" className="gradient-primary text-primary-foreground font-heading font-bold text-xs h-9 flex-1 min-w-[45%]">Revert to Previous</Button>
              
              <Button onClick={() => setArchiveConfirmOpen(true)} size="sm" className="gradient-primary text-primary-foreground font-heading font-bold text-xs h-9 flex-1 min-w-[45%]">Archive Roadmap</Button>
              <Button onClick={() => navigate("/new")} size="sm" className="gradient-primary text-primary-foreground font-heading font-bold text-xs h-9 flex-1 min-w-[45%]">Create New Roadmap</Button>
              <Button onClick={() => setDeleteConfirmOpen(true)} size="sm" className="bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/20 font-heading font-bold text-xs h-9 flex-1 min-w-[45%]">Delete</Button>
            </>
          )}
        </div>
        )}

        {/* Next Step */}
        <div className="mb-6">
          {firstIncomplete ? (
            <Button
              type="button"
              onClick={() => setSelectedModule(firstIncomplete)}
              className="w-full gradient-primary text-primary-foreground font-heading font-bold truncate overflow-hidden transition-all"
            >
              <span className="truncate min-w-0">Continue to Next Module: {firstIncomplete.title}</span>
              <ArrowRight className="ml-2 h-4 w-4 shrink-0" />
            </Button>
          ) : (
          <div className="space-y-2">
            <div className="glass-blue p-4 text-center">
              <p className="font-heading font-bold text-success mb-2">All Modules Complete!</p>
              <p className="text-base text-muted-foreground mb-3">You've finished your entire roadmap. Ready for the next challenge?</p>
              <Button
                type="button"
                onClick={() => setArchiveConfirmOpen(true)}
                className="w-full gradient-primary text-primary-foreground font-heading font-bold"
              >
                Archive & Start New Roadmap
                <Sparkles className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
          )}
        </div>

        {/* Module List */}
        <div className="space-y-3">
          {roadmapData.modules.map((mod, i) => {
            const status = getModuleStatus(mod);
            const isUpNext = mod.id === firstIncomplete?.id;
            return (
              <button
                key={mod.id}
                onClick={() => setSelectedModule(mod)}
                className={`w-full text-left glass-blue p-4 flex items-center gap-4 transition-all hover:bg-accent/10 ${isUpNext ? "border-2 border-primary/60 bg-primary/10 shadow-lg shadow-primary/20 ring-1 ring-primary/30" : ""} ${status === "completed" ? "opacity-60" : ""}`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-heading font-bold shrink-0 ${
                  status === "completed" ? "bg-success/20 text-success" :
                  status === "in_progress" ? "bg-primary/20 text-primary" :
                  "bg-muted/50 text-muted-foreground"
                }`}>
                  {status === "completed" ? "✓" : i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-heading font-semibold text-base break-words">{mod.title}</p>
                  <p className="text-sm text-muted-foreground">Day {mod.day_start}-{mod.day_end} · {mod.estimated_hours}h · {roadmapData?.resources_pending && (mod.resources || []).length === 0 ? "Loading resources..." : `${(mod.resources || []).length} resources`}</p>
                </div>
                <span className={`text-sm px-2 py-1 rounded-full shrink-0 font-heading font-semibold ${
                  status === "completed" ? "bg-success/20 text-success" :
                  isUpNext ? "bg-primary/20 text-primary border border-primary/40" :
                  status === "in_progress" ? "bg-primary/20 text-primary" :
                  "bg-muted/50 text-muted-foreground"
                }`}>
                  {status === "completed" ? "Completed ✓" : isUpNext ? "Up Next →" : status === "in_progress" ? "In Progress" : "Not Started"}
                </span>
              </button>
            );
          })}
        </div>

        </div> {/* end main content */}
        {/* Desktop: fixed right column */}
        {!selectedModule && (
        <div className="hidden md:flex fixed top-20 right-6 z-40 flex-col gap-2 w-[160px]">
          {roadmap?.status === "archived" ? (
            <>
              <Button onClick={async () => { await supabase.from("roadmaps").update({ status: "active" }).eq("id", roadmap.id); navigate("/my-roadmaps"); }} size="sm" className="gradient-primary text-primary-foreground font-heading font-bold text-xs h-9 transition-all glow-primary w-full">
                <Settings2 className="mr-1.5 h-3.5 w-3.5" /> Restore
              </Button>
              <Button onClick={() => setDeleteConfirmOpen(true)} size="sm" className="bg-destructive/10 text-destructive hover:bg-destructive/20 font-heading font-bold text-xs h-9 w-full">Delete</Button>
            </>
          ) : (
            <>
              <Button onClick={() => setAdaptOpen(true)} size="sm" className="gradient-primary text-primary-foreground font-heading font-bold text-xs h-9 transition-all glow-primary w-full"><Settings2 className="mr-1.5 h-3.5 w-3.5" /> Adapt Plan</Button>
              <Button onClick={() => setRevertConfirmOpen(true)} size="sm" className="gradient-primary text-primary-foreground font-heading font-bold text-xs h-9 transition-all w-full">Revert to Previous</Button>
              
              <Button onClick={() => setArchiveConfirmOpen(true)} size="sm" className="gradient-primary text-primary-foreground font-heading font-bold text-xs h-9 transition-all w-full">Archive Roadmap</Button>
              <Button onClick={() => navigate("/new")} size="sm" className="gradient-primary text-primary-foreground font-heading font-bold text-xs h-9 transition-all w-full">Create New Roadmap</Button>
              <Button onClick={() => setDeleteConfirmOpen(true)} size="sm" className="bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/20 font-heading font-bold text-xs h-9 w-full">Delete</Button>
            </>
          )}
        </div>
        )}
      </div> {/* end container */}
      </div>

      {/* Module Detail Full Page */}
      {selectedModule && (
        <ModuleDetail
          module={selectedModule}
          progress={progressMap[selectedModule.id]}
          nextModuleTitle={getNextModule(selectedModule)?.title}
          prevModuleTitle={getPrevModule(selectedModule)?.title}
          onGoToNextModule={(() => {
            const nextModule = getNextModule(selectedModule);
            if (!nextModule) return undefined;
            return () => setSelectedModule(nextModule);
          })()}
          onGoToPrevModule={(() => {
            const prevModule = getPrevModule(selectedModule);
            if (!prevModule) return undefined;
            return () => setSelectedModule(prevModule);
          })()}
          roadmapId={roadmap?.id}
          roadmapTopic={roadmapData?.topic}
          resourcesPending={roadmapData?.resources_pending}
          onGenerateQuiz={handleGenerateQuizForModule}
          onClose={() => setSelectedModule(null)}
          onComplete={handleModuleComplete}
          onUpdateCompletedModule={async (moduleId, selfReport, updatedNotes) => {
            if (!user || !roadmap) return;
            const existing = progressMap[moduleId];
            if (existing) {
              await supabase.from("progress").update({
                self_report: selfReport,
                notes: updatedNotes,
              }).eq("id", existing.id);
              fetchData();
            }
          }}
          onMarkNotComplete={async (moduleId) => {
            if (!user || !roadmap) return;
            const existing = progressMap[moduleId];
            if (existing) {
              await supabase.from("progress").update({
                status: "not_started",
                completed_at: null,
                self_report: null,
                quiz_score: null,
                quiz_answers: null,
              }).eq("id", existing.id);
              // Decrement completed_modules count
              const currentCompleted = roadmap.completed_modules ?? 0;
              await supabase.from("roadmaps").update({
                completed_modules: Math.max(0, currentCompleted - 1),
              }).eq("id", roadmap.id);
              setSelectedModule(null);
              fetchData();
            }
          }}
          onUpdateResourcesAndNotes={async (moduleId, completedResources, notes) => {
            if (!user || !roadmap) return;
            const existing = progressMap[moduleId];
            if (existing) {
              await supabase.from("progress").update({
                completed_resources: completedResources,
                notes,
              }).eq("id", existing.id);
            } else {
              await supabase.from("progress").insert({
                roadmap_id: roadmap.id,
                user_id: user.id,
                module_id: moduleId,
                module_title: roadmapData?.modules.find(m => m.id === moduleId)?.title ?? null,
                status: "in_progress",
                completed_resources: completedResources,
                notes,
              });
              fetchData();
            }
          }}
        />
      )}

      {/* Adapt Plan Modal */}
      {adaptOpen && roadmapData && (
        <AdaptPlanModal
          roadmapData={roadmapData}
          progressMap={progressMap}
          roadmapId={roadmap.id}
          learningGoal={roadmap?.learning_goal}
          onClose={() => setAdaptOpen(false)}
          onApply={handleAdaptApply}
        />
      )}

      {/* Adaptation Notification */}
      {adaptationNotif && roadmapData && (
        <AdaptationNotification
          result={adaptationNotif}
          currentRoadmap={roadmapData}
          onAccept={() => handleAcceptCheckInAdaptation(false)}
          onAcceptNoScheduleChange={() => handleAcceptCheckInAdaptation(true)}
          onKeepCurrent={handleKeepCurrentRoadmap}
          saving={applyingAdaptation}
        />
      )}

      {completionActions && (
        <ModuleCompletionActionsModal
          completedModuleTitle={completionActions.completedModuleTitle}
          nextModule={completionActions.nextModule}
          suggestedAdaptation={completionActions.suggestedAdaptation}
          checkInLoading={checkInLoading}
          onProceedNext={handleProceedToNextModule}
          onReturnToRoadmap={() => { setCompletionActions(null); setSelectedModule(null); }}
          onAcceptAdaptation={() => handleAdaptFromCompletion()}
          onAcceptNoScheduleChange={() => {
            const suggested = completionActions.suggestedAdaptation;
            setCompletionActions(null);
            if (suggested?.updated_roadmap) {
              setAdaptationNotif(suggested);
              handleAcceptCheckInAdaptation(true);
            }
          }}
          onClose={() => setCompletionActions(null)}
        />
      )}

      {reviewOpen && roadmapData && roadmap && (
        <RoadmapReviewModal
          roadmapData={roadmapData}
          completedCount={completedCount}
          createdAt={roadmap.created_at}
          progressMap={progressMap}
          onClose={() => setReviewOpen(false)}
        />
      )}

      <Dialog open={archiveConfirmOpen} onOpenChange={setArchiveConfirmOpen}>
        <DialogContent className="glass-strong border-border">
          <DialogHeader>
            <DialogTitle className="font-heading">Archive this roadmap?</DialogTitle>
            <DialogDescription>
              This will archive your current roadmap. You can't undo this.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setArchiveConfirmOpen(false)} className="border-border">
              Cancel
            </Button>
            <Button onClick={handleArchiveAndNew} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Archive & Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={revertConfirmOpen} onOpenChange={(open) => { setRevertConfirmOpen(open); if (!open) setRevertMessage(null); }}>
        <DialogContent className="glass-strong border-border">
          <DialogHeader>
            <DialogTitle className="font-heading">{revertMessage ? "No previous plan" : "Revert to previous plan?"}</DialogTitle>
            <DialogDescription>
              {revertMessage || "This will undo the last plan adaptation and restore your previous roadmap. Your progress on completed modules is kept."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            {revertMessage ? (
              <Button variant="outline" onClick={() => { setRevertConfirmOpen(false); setRevertMessage(null); }} className="border-border">
                OK
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setRevertConfirmOpen(false)} className="border-border" disabled={reverting}>
                  Cancel
                </Button>
                <Button onClick={handleRevertToPreviousPlan} disabled={reverting} className="gradient-primary text-primary-foreground font-heading font-bold">
                  {reverting ? "Reverting..." : "Revert Plan"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>


      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="glass-strong border-border">
          <DialogHeader>
            <DialogTitle className="font-heading">Permanently delete this roadmap?</DialogTitle>
            <DialogDescription>
              This will permanently delete the roadmap and all its progress. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)} className="border-border" disabled={deleting}>
              Cancel
            </Button>
            <Button onClick={handleDeleteRoadmap} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? "Deleting..." : "Delete Permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
