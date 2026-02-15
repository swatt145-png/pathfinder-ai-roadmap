import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { X, Loader2, Star } from "lucide-react";
import type { RoadmapData, ModuleProgress, AdaptOption, AdaptResult } from "@/lib/types";

interface Props {
  roadmapData: RoadmapData;
  progressMap: Record<string, ModuleProgress>;
  roadmapId: string;
  onClose: () => void;
  onApply: (updatedRoadmap: RoadmapData) => void;
}

export function AdaptPlanModal({ roadmapData, progressMap, roadmapId, onClose, onApply }: Props) {
  const completedCount = Object.values(progressMap).filter((p) => p.status === "completed").length;
  const [timelineUnit, setTimelineUnit] = useState<"days" | "weeks">("days");
  const [newDays, setNewDays] = useState(roadmapData.timeline_weeks * 7);
  const [newWeeks, setNewWeeks] = useState(roadmapData.timeline_weeks);
  const [newHours, setNewHours] = useState(roadmapData.hours_per_day);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AdaptResult | null>(null);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const effectiveWeeks = timelineUnit === "days" ? Math.max(Math.ceil(newDays / 7), 1) : newWeeks;

  const handleRecalculate = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("adapt-roadmap", {
        body: {
          roadmap_data: roadmapData,
          all_progress: Object.values(progressMap),
          new_timeline_weeks: effectiveWeeks,
          new_hours_per_day: newHours,
          adjustment_type: "manual",
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
    if (opt) onApply(opt.updated_roadmap);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass-strong max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto animate-fade-in">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-heading font-bold text-lg">Need to adjust your plan?</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <p className="text-sm text-muted-foreground mb-6">
          You've completed {completedCount} of {roadmapData.modules.length} modules.
        </p>

        {!result ? (
          <div className="space-y-4">
            <div>
              <Label className="text-sm text-muted-foreground mb-2 block">Timeline</Label>
              <div className="flex gap-2 mb-3">
                <button
                  onClick={() => setTimelineUnit("days")}
                  className={`flex-1 py-1.5 text-xs font-heading font-bold rounded-lg transition-all ${timelineUnit === "days" ? "gradient-primary text-primary-foreground" : "glass text-muted-foreground hover:bg-white/5"}`}
                >Days</button>
                <button
                  onClick={() => setTimelineUnit("weeks")}
                  className={`flex-1 py-1.5 text-xs font-heading font-bold rounded-lg transition-all ${timelineUnit === "weeks" ? "gradient-primary text-primary-foreground" : "glass text-muted-foreground hover:bg-white/5"}`}
                >Weeks</button>
              </div>
              {timelineUnit === "days" ? (
                <>
                  <Label className="text-sm text-muted-foreground mb-2 block">
                    Number of days: <span className="text-primary font-heading font-bold">{newDays}</span>
                  </Label>
                  <input type="range" min={0} max={90} value={newDays} onChange={(e) => setNewDays(Number(e.target.value))} className="w-full accent-primary" />
                </>
              ) : (
                <>
                  <Label className="text-sm text-muted-foreground mb-2 block">
                    Number of weeks: <span className="text-primary font-heading font-bold">{newWeeks}</span>
                  </Label>
                  <input type="range" min={1} max={16} value={newWeeks} onChange={(e) => setNewWeeks(Number(e.target.value))} className="w-full accent-primary" />
                </>
              )}
            </div>
            <div>
              <Label className="text-sm text-muted-foreground mb-2 block">
                Hours/day: <span className="text-primary font-heading font-bold">{newHours}</span>
              </Label>
              <input type="range" min={0.5} max={8} step={0.5} value={newHours} onChange={(e) => setNewHours(Number(e.target.value))} className="w-full accent-primary" />
            </div>

            {error && <p className="text-destructive text-sm">{error}</p>}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={loading}
                className="flex-1 border-white/10 hover:bg-white/5"
              >
                Skip for now
              </Button>
              <Button onClick={handleRecalculate} disabled={loading} className="flex-1 gradient-primary text-primary-foreground font-heading font-bold h-12">
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
                className={`w-full text-left glass p-4 transition-all ${selectedOption === opt.id ? "border-primary bg-primary/10 glow-primary" : "hover:bg-white/5"}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-heading font-bold text-sm">{opt.label}</span>
                  {opt.id === result.recommendation && <Star className="w-4 h-4 text-warning fill-warning" />}
                </div>
                <p className="text-xs text-muted-foreground mb-2">{opt.description}</p>
                <div className="flex gap-3 text-xs text-muted-foreground">
                  <span>{opt.timeline_weeks}w</span>
                  <span>{opt.hours_per_day}h/day</span>
                  <span>{opt.modules_kept} modules</span>
                </div>
                <p className="text-xs text-muted-foreground/70 mt-1 italic">{opt.tradeoff}</p>
              </button>
            ))}

            <p className="text-xs text-muted-foreground">💡 {result.recommendation_reason}</p>

            <Button onClick={handleApply} disabled={!selectedOption} className="w-full gradient-primary text-primary-foreground font-heading font-bold h-12 disabled:opacity-50">
              Apply This Plan
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
