import { Button } from "@/components/ui/button";
import type { AdaptationResult, RoadmapData } from "@/lib/types";

interface Props {
  result: AdaptationResult;
  currentRoadmap: RoadmapData;
  onAccept: () => void;
  onAcceptNoScheduleChange: () => void;
  onKeepCurrent: () => void;
  saving?: boolean;
}

function formatDelta(delta: number, unit: string) {
  if (delta === 0) return `No change in ${unit}`;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta} ${unit}`;
}

function toNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getTotalHours(roadmap: RoadmapData | null | undefined) {
  if (!roadmap) return 0;
  const fromModules = Array.isArray(roadmap.modules)
    ? roadmap.modules.reduce((sum, mod) => sum + toNumber(mod.estimated_hours, 0), 0)
    : 0;
  if (fromModules > 0) return Number(fromModules.toFixed(2));
  return Number(toNumber(roadmap.total_hours, 0).toFixed(2));
}

export function AdaptationNotification({
  result,
  currentRoadmap,
  onAccept,
  onAcceptNoScheduleChange,
  onKeepCurrent,
  saving = false,
}: Props) {
  const proposed = result.updated_roadmap;
  const currentTimelineWeeks = toNumber(currentRoadmap.timeline_weeks, 0);
  const currentTimelineDays = currentTimelineWeeks * 7;
  const proposedTimelineWeeks = toNumber(proposed?.timeline_weeks, currentTimelineWeeks);
  const proposedTimelineDays = proposedTimelineWeeks * 7;
  const timelineDeltaDays = proposedTimelineDays - currentTimelineDays;

  const currentTotalHours = getTotalHours(currentRoadmap);
  const proposedTotalHours = getTotalHours(proposed ?? currentRoadmap);
  const totalHoursDelta = Number((proposedTotalHours - currentTotalHours).toFixed(2));

  const baseHoursPerDay = toNumber(currentRoadmap.hours_per_day, 0);
  const currentDaysForDailyLoad = Math.max(currentTimelineDays, 1);
  const requiredHoursPerDayNoSchedule = Number((proposedTotalHours / currentDaysForDailyLoad).toFixed(2));
  const extraDailyHoursNoSchedule = Number((requiredHoursPerDayNoSchedule - baseHoursPerDay).toFixed(2));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => { if (!saving) onKeepCurrent(); }} />
      <div className="relative glass-strong max-w-lg w-full p-6 animate-fade-in">
        <h3 className="font-heading font-bold text-lg mb-2">Pathfinder Suggests a Roadmap Update</h3>
        
        <div className="glass p-4 mb-4">
          <p className="text-sm text-muted-foreground italic">{result.message_to_student}</p>
        </div>

        <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 mb-6">
          <p className="text-sm mb-3">{result.changes_summary}</p>
          <div className="space-y-2 text-xs text-muted-foreground">
            <p>
              Timeline: {currentTimelineDays} days ({currentTimelineWeeks} weeks) → {proposedTimelineDays} days ({proposedTimelineWeeks} weeks)
            </p>
            <p>Impact: {formatDelta(timelineDeltaDays, "days")}</p>
            <p>
              Total effort: {currentTotalHours}h → {proposedTotalHours}h
            </p>
            <p>Impact: {formatDelta(totalHoursDelta, "hours")}</p>
            <p>
              No schedule change option: {requiredHoursPerDayNoSchedule}h/day
              {" "}({formatDelta(extraDailyHoursNoSchedule, "hours/day")} vs current)
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onKeepCurrent}
            disabled={saving}
            className="border-white/10 hover:bg-white/5"
          >
            Continue Current Plan
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onAcceptNoScheduleChange}
            disabled={saving || !proposed}
            className="border-white/10 hover:bg-white/5"
          >
            {saving ? "Applying..." : "Accept Update (No Schedule Change)"}
          </Button>
          <Button
            type="button"
            onClick={onAccept}
            disabled={saving || !proposed}
            className="gradient-primary text-primary-foreground font-heading font-bold"
          >
            {saving ? "Applying..." : "Accept Updated Roadmap"}
          </Button>
        </div>
      </div>
    </div>
  );
}
