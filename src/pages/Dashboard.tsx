import { useEffect, useState } from "react";
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
import { Loader2, Flame, Clock, BookOpen, Settings2, ArrowRight, Sparkles } from "lucide-react";
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
  const [reviewOpen, setReviewOpen] = useState(false);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [revertConfirmOpen, setRevertConfirmOpen] = useState(false);
  const [reverting, setReverting] = useState(false);

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

    // Close module view and refresh persisted progress.
    setSelectedModule(null);
    await fetchData();

    // Call check-in
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
        },
      });

      const suggestion = checkInResult?.needs_adaptation && checkInResult?.updated_roadmap
        ? (checkInResult as AdaptationResult)
        : null;

      setCompletionActions({
        completedModuleTitle: mod?.title ?? "this module",
        nextModule,
        suggestedAdaptation: suggestion,
      });
    } catch (e) {
      console.error("Check-in error:", e);
      setCompletionActions({
        completedModuleTitle: mod?.title ?? "this module",
        nextModule,
        suggestedAdaptation: null,
      });
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

  const handleArchiveAndNew = async () => {
    if (!roadmap) return;
    await supabase.from("roadmaps").update({ status: "archived" }).eq("id", roadmap.id);
    setArchiveConfirmOpen(false);
    navigate("/my-roadmaps");
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
        setRevertConfirmOpen(false);
        return;
      }

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

  const firstIncomplete = roadmapData.modules.find((m) => getModuleStatus(m) !== "completed");

  return (
    <>
      <AppBar />
      <div className="min-h-screen pt-16 pb-24 px-4 max-w-2xl mx-auto">
        {/* Summary Card */}
        <div className="glass-strong p-6 mb-6 animate-fade-in">
          <h2 className="font-heading text-xl md:text-2xl font-bold mb-1">{roadmapData.topic}</h2>
          <div className="flex flex-wrap gap-2 mb-4">
            <span className="px-2 py-0.5 text-xs font-heading rounded-full bg-primary/20 text-primary">{roadmapData.skill_level}</span>
          </div>

          {/* Progress bar */}
          <div className="mb-4">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-muted-foreground">{completedCount} of {totalModules} modules</span>
              <span className="text-primary font-heading font-bold">{progressPercent}%</span>
            </div>
            <div className="h-2 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full gradient-primary rounded-full transition-all duration-500" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 text-center text-sm">
            <div className="glass p-3">
              <Clock className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{completedHours.toFixed(0)}h / {totalHours.toFixed(0)}h</span>
            </div>
            <div className="glass p-3">
              <BookOpen className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Week {Math.min(Math.ceil((Date.now() - new Date(roadmap.created_at).getTime()) / 604800000) || 1, roadmapData.timeline_weeks)} of {roadmapData.timeline_weeks}</span>
            </div>
            <div className="glass p-3">
              <Flame className="w-4 h-4 mx-auto mb-1 text-warning" />
              <span className="text-xs text-muted-foreground">
                {(roadmap.current_streak ?? 0) > 1 ? `🔥 ${roadmap.current_streak}-day streak` : (roadmap.last_activity_date === new Date().toISOString().split("T")[0] ? "🔥 Active today" : "Start your streak!")}
              </span>
            </div>
          </div>
        </div>

        {/* Next Step */}
        <div className="mb-6">
          {firstIncomplete ? (
            <Button
              type="button"
              onClick={() => setSelectedModule(firstIncomplete)}
              className="w-full gradient-primary text-primary-foreground font-heading font-bold"
            >
              Continue to Next Module: {firstIncomplete.title}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : (
          <div className="space-y-2">
            <div className="glass-strong p-4 text-center">
              <p className="font-heading font-bold text-success mb-2">🎉 All Modules Complete!</p>
              <p className="text-sm text-muted-foreground mb-3">You've finished your entire roadmap. Ready for the next challenge?</p>
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
                className={`w-full text-left glass p-4 flex items-center gap-4 transition-all hover:bg-white/5 ${isUpNext ? "border-primary/40 glow-primary" : ""} ${status === "completed" ? "opacity-60" : ""}`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-heading font-bold shrink-0 ${
                  status === "completed" ? "bg-success/20 text-success" :
                  status === "in_progress" ? "bg-primary/20 text-primary" :
                  "bg-white/5 text-muted-foreground"
                }`}>
                  {status === "completed" ? "✓" : i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-heading font-semibold text-sm truncate">{mod.title}</p>
                  <p className="text-xs text-muted-foreground">Day {mod.day_start}-{mod.day_end} · {mod.estimated_hours}h · {mod.resources.length} resources</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full shrink-0 font-heading ${
                  status === "completed" ? "bg-success/20 text-success" :
                  status === "in_progress" ? "bg-primary/20 text-primary" :
                  "bg-white/5 text-muted-foreground"
                }`}>
                  {status === "completed" ? "Completed ✓" : status === "in_progress" ? "In Progress" : isUpNext ? "Up Next" : "Not Started"}
                </span>
              </button>
            );
          })}
        </div>

        {/* Bottom Actions */}
        <div className="mt-8 space-y-3">
          <Button variant="outline" onClick={() => setAdaptOpen(true)} className="w-full border-white/10 hover:bg-white/5">
            <Settings2 className="mr-2 h-4 w-4" /> Adapt My Plan
          </Button>
          <Button variant="outline" onClick={() => setRevertConfirmOpen(true)} className="w-full border-white/10 hover:bg-white/5">
            Revert to Previous Plan
          </Button>
          <Button
            variant="ghost"
            onClick={() => setArchiveConfirmOpen(true)}
            className="w-full text-destructive hover:text-destructive hover:bg-destructive/10 text-sm"
          >
            Abandon Roadmap & Start New
          </Button>
        </div>
      </div>

      {/* Module Detail Full Page */}
      {selectedModule && (
        <ModuleDetail
          module={selectedModule}
          progress={progressMap[selectedModule.id]}
          onClose={() => setSelectedModule(null)}
          onComplete={handleModuleComplete}
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
          onProceedNext={handleProceedToNextModule}
          onReviewRoadmap={handleReviewCurrentRoadmap}
          onAdaptRoadmap={handleAdaptFromCompletion}
          onClose={() => setCompletionActions(null)}
        />
      )}

      {reviewOpen && roadmapData && roadmap && (
        <RoadmapReviewModal
          roadmapData={roadmapData}
          completedCount={completedCount}
          createdAt={roadmap.created_at}
          onClose={() => setReviewOpen(false)}
        />
      )}

      <Dialog open={archiveConfirmOpen} onOpenChange={setArchiveConfirmOpen}>
        <DialogContent className="glass-strong border-white/10">
          <DialogHeader>
            <DialogTitle className="font-heading">Archive this roadmap?</DialogTitle>
            <DialogDescription>
              This will archive your current roadmap. You can't undo this.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setArchiveConfirmOpen(false)} className="border-white/10">
              Cancel
            </Button>
            <Button onClick={handleArchiveAndNew} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Archive & Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={revertConfirmOpen} onOpenChange={setRevertConfirmOpen}>
        <DialogContent className="glass-strong border-white/10">
          <DialogHeader>
            <DialogTitle className="font-heading">Revert to previous plan?</DialogTitle>
            <DialogDescription>
              This will undo the last plan adaptation and restore your previous roadmap. Your progress on completed modules is kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRevertConfirmOpen(false)} className="border-white/10" disabled={reverting}>
              Cancel
            </Button>
            <Button onClick={handleRevertToPreviousPlan} disabled={reverting} className="gradient-primary text-primary-foreground font-heading font-bold">
              {reverting ? "Reverting..." : "Revert Plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
