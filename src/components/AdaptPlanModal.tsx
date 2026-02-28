import { useState } from "react";
import { supabase } from "@/lib/supabase-safe";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { X, Loader2, Star } from "lucide-react";
import type { RoadmapData, ModuleProgress, AdaptOption, AdaptResult } from "@/lib/types";

interface Props {
  roadmapData: RoadmapData;
  progressMap: Record<string, ModuleProgress>;
  roadmapId: string;
  learningGoal?: string;
  onClose: () => void;
  onApply: (updatedRoadmap: RoadmapData) => void;
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
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AdaptResult | null>(null);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          learning_goal: learningGoal || "hands_on",
          skip_resources: true,
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
      modules: [...originalCompletedModules, ...aiAdaptedModules],
    };

    onApply(mergedRoadmap);
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

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={loading}
                className="flex-1 border-border hover:bg-muted"
              >
                Skip for now
              </Button>
              <Button onClick={handleRecalculate} disabled={loading} className="flex-1 gradient-primary text-primary-foreground font-heading font-bold h-12 transition-all">
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
