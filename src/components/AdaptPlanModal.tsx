import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X, Loader2, Star, BookOpenCheck, Code2, Zap, GraduationCap } from "lucide-react";
import type { RoadmapData, ModuleProgress, AdaptOption, AdaptResult } from "@/lib/types";

const LEARNING_GOALS = [
  { id: "conceptual", label: "Conceptual", icon: BookOpenCheck, desc: "Lectures, theory, explainers" },
  { id: "hands_on", label: "Hands-On", icon: Code2, desc: "Tutorials, exercises, projects" },
  { id: "quick_overview", label: "Quick Overview", icon: Zap, desc: "Crash courses, summaries" },
  { id: "deep_mastery", label: "Deep Mastery", icon: GraduationCap, desc: "Comprehensive, advanced" },
] as const;

const SKILL_LEVELS = [
  { id: "beginner", label: "Beginner" },
  { id: "intermediate", label: "Intermediate" },
  { id: "advanced", label: "Advanced" },
] as const;

interface Props {
  roadmapData: RoadmapData;
  progressMap: Record<string, ModuleProgress>;
  roadmapId: string;
  learningGoal?: string;
  onClose: () => void;
  onApply: (updatedRoadmap: RoadmapData, meta?: { topic?: string; skill_level?: string; learning_goal?: string }) => void;
}

export function AdaptPlanModal({ roadmapData, progressMap, roadmapId, learningGoal, onClose, onApply }: Props) {
  const completedModules = Object.values(progressMap).filter((p) => p.status === "completed");
  const completedCount = completedModules.length;
  const completedModuleIds = new Set(completedModules.map((p) => p.module_id));
  const completedModulesData = roadmapData.modules.filter((m) => completedModuleIds.has(m.id));

  // Days completed = max day_end of completed modules, with fallback
  const totalRoadmapDays = Math.round((roadmapData as any).timeline_days || roadmapData.timeline_weeks * 7);
  const dayEndMax = completedModulesData.reduce((max, m) => Math.max(max, Number(m.day_end || 0)), 0);
  const daysCompleted = Math.round(dayEndMax > 0
    ? dayEndMax
    : completedCount > 0
      ? (completedCount / roadmapData.modules.length) * totalRoadmapDays
      : 0);
  const daysRemaining = Math.max(1, totalRoadmapDays - daysCompleted);

  const [timelineUnit, setTimelineUnit] = useState<"days" | "weeks">("days");
  const [newValue, setNewValue] = useState(daysRemaining);
  const [newHours, setNewHours] = useState(roadmapData.hours_per_day);
  const [newTopic, setNewTopic] = useState(roadmapData.topic || "");
  const [newGoal, setNewGoal] = useState(learningGoal || "hands_on");
  const [newSkillLevel, setNewSkillLevel] = useState(roadmapData.skill_level || "beginner");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AdaptResult | null>(null);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const topicChanged = newTopic.trim() !== (roadmapData.topic || "").trim();
  const goalChanged = newGoal !== (learningGoal || "hands_on");
  const skillChanged = newSkillLevel !== (roadmapData.skill_level || "beginner");

  const totalDays = timelineUnit === "weeks" ? newValue * 7 : newValue;

  const handleRecalculate = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("adapt-roadmap", {
        body: {
          roadmap_data: roadmapData,
          all_progress: Object.values(progressMap),
          new_timeline_days: totalDays,
          new_hours_per_day: newHours,
          adjustment_type: "manual",
          learning_goal: newGoal,
          ...(topicChanged ? { new_topic: newTopic.trim() } : {}),
          ...(skillChanged ? { new_skill_level: newSkillLevel } : {}),
        },
      });
      if (fnErr) throw new Error(fnErr.message);
      if (data?.error) throw new Error(data.error);
      setResult(data as AdaptResult);
      if (data?.recommendation) setSelectedOption(data.recommendation);
    } catch (e: any) {
      setError(e.message || "Failed to recalculate");
    }
    setLoading(false);
  };

  const handleApply = () => {
    if (!result || !selectedOption) return;
    const opt = result.options.find((o) => o.id === selectedOption);
    if (!opt) return;

    const completedModuleIds = new Set(
      Object.values(progressMap)
        .filter((p) => p.status === "completed")
        .map((p) => p.module_id)
    );
    const originalCompletedModules = roadmapData.modules.filter((m) => completedModuleIds.has(m.id));
    const aiAdaptedModules = (opt.updated_roadmap.modules || []).filter(
      (m: any) => !completedModuleIds.has(m.id)
    );

    const mergedRoadmap: RoadmapData = {
      ...opt.updated_roadmap,
      skill_level: newSkillLevel,
      modules: [...originalCompletedModules, ...aiAdaptedModules],
    };

    const meta: { topic?: string; skill_level?: string; learning_goal?: string } = {};
    if (topicChanged) meta.topic = newTopic.trim();
    if (skillChanged) meta.skill_level = newSkillLevel;
    if (goalChanged) meta.learning_goal = newGoal;

    onApply(mergedRoadmap, Object.keys(meta).length > 0 ? meta : undefined);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass-strong max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto animate-fade-in">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-heading font-bold text-lg">Need to adjust your plan?</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <p className="text-sm text-muted-foreground mb-2">
          You've completed {completedCount} of {roadmapData.modules.length} modules ({daysCompleted} {daysCompleted === 1 ? "day" : "days"} done, {daysRemaining} {daysRemaining === 1 ? "day" : "days"} remaining).
        </p>
        <p className="text-xs text-muted-foreground/70 mb-6">
          Original roadmap: <span className="font-semibold text-foreground/80">{totalRoadmapDays} days</span>, <span className="font-semibold text-foreground/80">{roadmapData.hours_per_day}h/day</span>
        </p>

        {!result ? (
          <div className="space-y-4">
            {/* Topic */}
            <div>
              <Label className="text-sm text-muted-foreground mb-2 block">Topic</Label>
              <Input
                value={newTopic}
                onChange={(e) => setNewTopic(e.target.value)}
                placeholder="e.g. Digital Marketing Fundamentals"
                className="bg-background/50 border-border"
              />
              <p className="text-[11px] text-muted-foreground/70 mt-1">Keep as-is, add keywords, or change entirely</p>
            </div>

            {/* Learning Goal */}
            <div>
              <Label className="text-sm text-muted-foreground mb-2 block">Learning Goal</Label>
              <div className="grid grid-cols-2 gap-1.5">
                {LEARNING_GOALS.map((g) => {
                  const Icon = g.icon;
                  return (
                    <button
                      key={g.id}
                      onClick={() => setNewGoal(g.id)}
                      className={`p-2 rounded-lg text-left transition-all border ${newGoal === g.id ? "border-primary bg-primary/15 ring-1 ring-primary/40" : "border-transparent glass hover:bg-muted/30"}`}
                    >
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <Icon className={`w-3.5 h-3.5 ${newGoal === g.id ? "text-primary" : "text-muted-foreground"}`} />
                        <span className={`text-xs font-heading font-bold ${newGoal === g.id ? "text-primary" : ""}`}>{g.label}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground leading-tight">{g.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Proficiency */}
            <div>
              <Label className="text-sm text-muted-foreground mb-2 block">Proficiency Level</Label>
              <div className="grid grid-cols-3 gap-1 p-1 glass rounded-xl">
                {SKILL_LEVELS.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setNewSkillLevel(s.id)}
                    className={`py-2 px-3 rounded-lg text-sm font-heading font-bold transition-all ${newSkillLevel === s.id ? "gradient-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Timeline unit toggle */}
            <div>
              <Label className="text-sm text-muted-foreground mb-2 block">Timeline</Label>
              <div className="grid grid-cols-2 gap-1 p-1 glass rounded-xl mb-3">
                <button
                  onClick={() => { setTimelineUnit("days"); setNewValue(totalDays); }}
                  className={`py-2 px-3 rounded-lg text-sm font-heading font-bold transition-all ${timelineUnit === "days" ? "gradient-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Days
                </button>
                <button
                  onClick={() => { setTimelineUnit("weeks"); setNewValue(Math.max(1, Math.round(totalDays / 7))); }}
                  className={`py-2 px-3 rounded-lg text-sm font-heading font-bold transition-all ${timelineUnit === "weeks" ? "gradient-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Weeks
                </button>
              </div>

              <Label className="text-sm text-muted-foreground mb-2 block">
                Remaining target {timelineUnit === "days" ? "days" : "weeks"}: <span className="text-primary font-heading font-bold">{newValue}</span>
              </Label>
              <input
                type="range"
                min={1}
                max={timelineUnit === "days" ? 90 : 12}
                value={newValue}
                onChange={(e) => setNewValue(Number(e.target.value))}
                className="w-full accent-primary"
              />
            </div>
            <div>
              <Label className="text-sm text-muted-foreground mb-2 block">
                How many hours a day can you study? <span className="text-primary font-heading font-bold">{newHours}</span>
              </Label>
              <input type="range" min={0.5} max={8} step={0.5} value={newHours} onChange={(e) => setNewHours(Number(e.target.value))} className="w-full accent-primary" />
              <p className="text-xs text-muted-foreground mt-2">
                Total target hours: <span className="text-primary font-heading font-bold">{(totalDays * newHours).toFixed(1)}h</span>
              </p>
            </div>

            {error && <p className="text-destructive text-sm">{error}</p>}

            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={loading}
                className="w-full sm:flex-1 border-border hover:bg-muted"
              >
                Skip for now
              </Button>
              <Button onClick={handleRecalculate} disabled={loading} className="w-full sm:flex-1 gradient-primary text-primary-foreground font-heading font-bold h-12 transition-all">
                {loading ? <><Loader2 className="animate-spin mr-2" /> Recalculating...</> : "Recalculate"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{result.analysis}</p>

            {result.options.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setSelectedOption(opt.id)}
                className={`w-full text-left p-4 transition-all rounded-xl border-2 ${selectedOption === opt.id ? "border-primary bg-primary/20 shadow-lg shadow-primary/30 ring-2 ring-primary/40" : "glass border-transparent hover:bg-muted"}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`font-heading font-bold text-sm ${selectedOption === opt.id ? "text-primary" : ""}`}>{opt.label}</span>
                  {opt.id === result.recommendation && <Star className="w-4 h-4 text-warning fill-warning" />}
                </div>
                <p className="text-xs text-muted-foreground mb-2">{opt.description}</p>
                <div className="flex gap-3 text-xs text-muted-foreground">
                  <span>{opt.timeline_days != null ? `${opt.timeline_days}d` : `${opt.timeline_weeks}w`}</span>
                  <span>{opt.hours_per_day}h/day</span>
                  <span>{opt.modules_kept} modules</span>
                </div>
                <p className="text-xs text-muted-foreground/70 mt-1 italic">{opt.tradeoff}</p>
              </button>
            ))}

            <button
              onClick={() => setSelectedOption("keep_current")}
              className={`w-full text-left p-4 transition-all rounded-xl border-2 ${selectedOption === "keep_current" ? "border-primary bg-primary/20 shadow-lg shadow-primary/30 ring-2 ring-primary/40" : "glass border-transparent hover:bg-muted"}`}
            >
              <span className={`font-heading font-bold text-sm ${selectedOption === "keep_current" ? "text-primary" : ""}`}>Keep Current Plan</span>
              <p className="text-xs text-muted-foreground mt-1">No changes — continue with your existing roadmap as-is.</p>
            </button>

            <p className="text-xs text-muted-foreground">💡 {result.recommendation_reason}</p>

            {selectedOption === "keep_current" ? (
              <Button onClick={onClose} className="w-full gradient-primary text-primary-foreground font-heading font-bold h-12 transition-all">
                Keep My Plan
              </Button>
            ) : (
              <Button onClick={handleApply} disabled={!selectedOption} className="w-full gradient-primary text-primary-foreground font-heading font-bold h-12 disabled:opacity-50 transition-all">
                Apply Adapted Plan
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
