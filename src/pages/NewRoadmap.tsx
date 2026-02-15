import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppBar } from "@/components/AppBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import type { RoadmapData } from "@/lib/types";

const SKILLS = [
  { value: "beginner", label: "Beginner", desc: "I'm starting from scratch" },
  { value: "intermediate", label: "Intermediate", desc: "I know the basics" },
  { value: "advanced", label: "Advanced", desc: "I want to go deeper" },
];

const QUICK_STARTS = [
  { label: "SQL in 2 weeks", topic: "SQL", weeks: 2, hours: 1.5, skill: "beginner" },
  { label: "Python in 1 month", topic: "Python", weeks: 4, hours: 1, skill: "beginner" },
  { label: "Cybersecurity in 3 weeks", topic: "Cybersecurity", weeks: 3, hours: 2, skill: "intermediate" },
  { label: "React in 10 days", topic: "React", weeks: 2, hours: 2, skill: "intermediate" },
  { label: "Docker in 1 week", topic: "Docker", weeks: 1, hours: 2, skill: "beginner" },
];

const LOADING_STEPS = [
  "Understanding your learning goal...",
  "Designing your curriculum...",
  "Curating the best resources...",
  "Building assessment quizzes...",
  "Finalizing your personalized roadmap...",
];

const LOADING_MESSAGES = [
  "Great things take a moment...",
  "Your roadmap is being personalized...",
  "Almost there...",
];

export default function NewRoadmap() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [topic, setTopic] = useState("");
  const [skillLevel, setSkillLevel] = useState("beginner");
  const [timelineWeeks, setTimelineWeeks] = useState(4);
  const [hoursPerDay, setHoursPerDay] = useState(1);
  const [hardDeadline, setHardDeadline] = useState(false);
  const [deadlineDate, setDeadlineDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const applyQuickStart = (qs: typeof QUICK_STARTS[0]) => {
    setTopic(qs.topic);
    setTimelineWeeks(qs.weeks);
    setHoursPerDay(qs.hours);
    setSkillLevel(qs.skill);
  };

  const handleGenerate = async () => {
    if (!topic.trim() || !user) return;
    setLoading(true);
    setError(null);
    setLoadingStep(0);

    const stepInterval = setInterval(() => {
      setLoadingStep((s) => Math.min(s + 1, LOADING_STEPS.length - 1));
    }, 4500);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("generate-roadmap", {
        body: { topic, skill_level: skillLevel, timeline_weeks: timelineWeeks, hours_per_day: hoursPerDay, hard_deadline: hardDeadline, deadline_date: deadlineDate || null },
      });

      clearInterval(stepInterval);

      if (fnError) throw new Error(fnError.message);
      if (data?.error) throw new Error(data.error);

      const roadmapData = data as RoadmapData;

      const { error: insertError } = await supabase.from("roadmaps").insert({
        user_id: user.id,
        topic: roadmapData.topic,
        skill_level: roadmapData.skill_level,
        timeline_weeks: roadmapData.timeline_weeks,
        hours_per_day: roadmapData.hours_per_day,
        hard_deadline: hardDeadline,
        deadline_date: deadlineDate || null,
        roadmap_data: roadmapData as any,
        original_roadmap_data: roadmapData as any,
        total_modules: roadmapData.modules.length,
        status: "active",
      });

      if (insertError) throw insertError;
      navigate("/dashboard");
    } catch (err: any) {
      clearInterval(stepInterval);
      setError(err.message || "Failed to generate roadmap");
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <>
        <AppBar />
        <div className="flex min-h-screen items-center justify-center px-4 pt-14">
          <div className="text-center max-w-md animate-fade-in">
            <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-8" />
            <div className="space-y-3 mb-8">
              {LOADING_STEPS.map((step, i) => (
                <p
                  key={step}
                  className={`text-sm transition-all duration-500 ${i === loadingStep ? "text-foreground animate-breathe font-medium" : i < loadingStep ? "text-muted-foreground/50" : "text-muted-foreground/20"}`}
                >
                  {i < loadingStep ? "✓ " : i === loadingStep ? "● " : "○ "}{step}
                </p>
              ))}
            </div>
            <p className="text-xs text-muted-foreground animate-breathe">
              {LOADING_MESSAGES[loadingStep % LOADING_MESSAGES.length]}
            </p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <AppBar />
      <div className="min-h-screen pt-20 pb-10 px-4 max-w-lg mx-auto animate-fade-in">
        <h2 className="font-heading text-2xl md:text-3xl font-bold mb-2">
          Hey {profile?.display_name ?? "there"}! 👋
        </h2>
        <p className="text-muted-foreground mb-8">What do you want to learn?</p>

        <div className="space-y-6">
          <div>
            <Input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g., SQL, Python, Cybersecurity, Docker, React..."
              className="h-14 text-lg bg-white/5 border-white/10 focus:border-primary font-body"
            />
          </div>

          <div>
            <Label className="text-muted-foreground text-sm mb-3 block">Skill Level</Label>
            <div className="grid grid-cols-3 gap-2">
              {SKILLS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setSkillLevel(s.value)}
                  className={`glass p-3 text-center transition-all ${skillLevel === s.value ? "border-primary bg-primary/10 glow-primary" : "hover:bg-white/5"}`}
                >
                  <span className="block text-sm font-heading font-semibold">{s.label}</span>
                  {skillLevel === s.value && <span className="block text-xs text-muted-foreground mt-1">{s.desc}</span>}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-muted-foreground text-sm mb-2 block">
              How many weeks? <span className="text-primary font-heading font-bold">{timelineWeeks}</span>
            </Label>
            <input
              type="range"
              min={1}
              max={12}
              value={timelineWeeks}
              onChange={(e) => setTimelineWeeks(Number(e.target.value))}
              className="w-full accent-primary"
            />
          </div>

          <div>
            <Label className="text-muted-foreground text-sm mb-2 block">
              Hours per day? <span className="text-primary font-heading font-bold">{hoursPerDay}</span>
            </Label>
            <input
              type="range"
              min={0.5}
              max={4}
              step={0.5}
              value={hoursPerDay}
              onChange={(e) => setHoursPerDay(Number(e.target.value))}
              className="w-full accent-primary"
            />
          </div>

          <div className="flex items-center justify-between glass p-4">
            <Label className="text-sm">Is this a hard deadline?</Label>
            <Switch checked={hardDeadline} onCheckedChange={setHardDeadline} />
          </div>

          {hardDeadline && (
            <Input
              type="date"
              value={deadlineDate}
              onChange={(e) => setDeadlineDate(e.target.value)}
              className="bg-white/5 border-white/10"
            />
          )}

          {error && <p className="text-destructive text-sm">{error}</p>}

          <Button
            onClick={handleGenerate}
            disabled={!topic.trim()}
            className="w-full h-14 text-lg font-heading font-bold gradient-primary text-primary-foreground glow-primary transition-all hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100"
          >
            Generate My Roadmap ✨
          </Button>

          <div>
            <p className="text-xs text-muted-foreground mb-3">Quick start:</p>
            <div className="flex flex-wrap gap-2">
              {QUICK_STARTS.map((qs) => (
                <button
                  key={qs.label}
                  onClick={() => applyQuickStart(qs)}
                  className="glass px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-white/10 transition-all"
                >
                  {qs.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
