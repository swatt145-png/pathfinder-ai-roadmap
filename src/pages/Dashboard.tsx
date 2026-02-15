import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppBar } from "@/components/AppBar";
import { ModuleDetail } from "@/components/ModuleDetail";
import { AdaptPlanModal } from "@/components/AdaptPlanModal";
import { AdaptationNotification } from "@/components/AdaptationNotification";
import { Button } from "@/components/ui/button";
import { Loader2, Flame, Clock, BookOpen, Settings2 } from "lucide-react";
import type { RoadmapData, ModuleProgress, Module, AdaptationResult } from "@/lib/types";

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [roadmap, setRoadmap] = useState<any>(null);
  const [roadmapData, setRoadmapData] = useState<RoadmapData | null>(null);
  const [progressMap, setProgressMap] = useState<Record<string, ModuleProgress>>({});
  const [loading, setLoading] = useState(true);
  const [selectedModule, setSelectedModule] = useState<Module | null>(null);
  const [adaptOpen, setAdaptOpen] = useState(false);
  const [adaptationNotif, setAdaptationNotif] = useState<AdaptationResult | null>(null);

  const fetchData = async () => {
    if (!user) return;
    const { data: rm } = await supabase
      .from("roadmaps")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();

    if (!rm) {
      navigate("/new");
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

  const completedCount = Object.values(progressMap).filter((p) => p.status === "completed").length;
  const totalModules = roadmapData?.modules.length ?? 0;
  const progressPercent = totalModules ? Math.round((completedCount / totalModules) * 100) : 0;

  const totalHours = roadmapData?.modules.reduce((s, m) => s + m.estimated_hours, 0) ?? 0;
  const completedHours = roadmapData?.modules
    .filter((m) => progressMap[m.id]?.status === "completed")
    .reduce((s, m) => s + m.estimated_hours, 0) ?? 0;

  const handleModuleComplete = async (moduleId: string, selfReport: string, quizScore: number | null, quizAnswers: any) => {
    if (!user || !roadmap || !roadmapData) return;

    const mod = roadmapData.modules.find((m) => m.id === moduleId);

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
    const newCompleted = completedCount + 1;
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

    // Call check-in
    const allProg = Object.values(progressMap);
    allProg.push({
      id: "", roadmap_id: roadmap.id, user_id: user.id,
      module_id: moduleId, module_title: mod?.title ?? null,
      status: "completed", self_report: selfReport as any,
      quiz_score: quizScore, quiz_answers: quizAnswers,
      time_spent_minutes: null, completed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
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

      if (checkInResult?.needs_adaptation && checkInResult?.updated_roadmap) {
        // Save adaptation
        await supabase.from("adaptations").insert({
          roadmap_id: roadmap.id,
          user_id: user.id,
          trigger_reason: `self_report_${selfReport}`,
          changes_summary: checkInResult.changes_summary,
          previous_roadmap: roadmapData as any,
          new_roadmap: checkInResult.updated_roadmap as any,
        });

        await supabase.from("roadmaps").update({
          roadmap_data: checkInResult.updated_roadmap as any,
          total_modules: checkInResult.updated_roadmap.modules.length,
        }).eq("id", roadmap.id);

        setAdaptationNotif(checkInResult as AdaptationResult);
      }
    } catch (e) {
      console.error("Check-in error:", e);
    }

    setSelectedModule(null);
    fetchData();
  };

  const handleArchive = async () => {
    if (!roadmap) return;
    if (!confirm("This will archive your current roadmap. You can't undo this. Continue?")) return;
    await supabase.from("roadmaps").update({ status: "archived" }).eq("id", roadmap.id);
    navigate("/new");
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
                {roadmap.current_streak > 0 ? `🔥 ${roadmap.current_streak}-day streak` : "Start your streak!"}
              </span>
            </div>
          </div>
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
        <div className="mt-8 flex flex-col sm:flex-row gap-3">
          <Button variant="outline" onClick={() => setAdaptOpen(true)} className="flex-1 border-white/10 hover:bg-white/5">
            <Settings2 className="mr-2 h-4 w-4" /> Adapt My Plan
          </Button>
          <button onClick={handleArchive} className="text-sm text-muted-foreground hover:text-destructive transition-colors">
            Start New Roadmap
          </button>
        </div>
      </div>

      {/* Module Detail Slide-over */}
      {selectedModule && (
        <ModuleDetail
          module={selectedModule}
          progress={progressMap[selectedModule.id]}
          onClose={() => setSelectedModule(null)}
          onComplete={handleModuleComplete}
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
      {adaptationNotif && (
        <AdaptationNotification
          result={adaptationNotif}
          onDismiss={() => setAdaptationNotif(null)}
        />
      )}
    </>
  );
}
