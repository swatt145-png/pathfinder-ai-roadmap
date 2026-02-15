import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppBar } from "@/components/AppBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, ArrowRight, Archive } from "lucide-react";
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

const getTopicMessages = (topic: string, skillLevel: string) => {
  const level = skillLevel === "beginner" ? "from the ground up" : skillLevel === "advanced" ? "at an advanced level" : "with practical depth";
  return [
    `Great choice to learn ${topic}! 🎯`,
    `We're crafting your personalized ${topic} roadmap ${level}...`,
    `Finding the best ${topic} resources from top educators...`,
    `Building quizzes to test your ${topic} knowledge...`,
    `Almost done — your ${topic} learning journey is taking shape! ✨`,
  ];
};

interface RoadmapRow {
  id: string;
  topic: string;
  skill_level: string;
  timeline_weeks: number;
  hours_per_day: number;
  status: string;
  created_at: string;
  completed_modules: number | null;
  total_modules: number | null;
  current_streak: number | null;
  roadmap_data: unknown;
}

export default function NewRoadmap() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [topic, setTopic] = useState("");
  const [skillLevel, setSkillLevel] = useState("beginner");
  const [timelineUnit, setTimelineUnit] = useState<"weeks" | "days">("weeks");
  const [timelineValue, setTimelineValue] = useState(4);
  const [hoursPerDay, setHoursPerDay] = useState(1);
  const [hardDeadline, setHardDeadline] = useState(false);
  const [deadlineDate, setDeadlineDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [activeCount, setActiveCount] = useState(0);
  const [checkingActive, setCheckingActive] = useState(true);
  const [roadmaps, setRoadmaps] = useState<RoadmapRow[]>([]);

  const fetchRoadmaps = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("roadmaps")
      .select("id, topic, skill_level, timeline_weeks, hours_per_day, status, created_at, completed_modules, total_modules, current_streak, roadmap_data")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false });
    const rows = (data as RoadmapRow[]) ?? [];
    setRoadmaps(rows);
    setActiveCount(rows.length);
    setCheckingActive(false);
  };

  useEffect(() => { fetchRoadmaps(); }, [user]);

  const timelineWeeks = timelineUnit === "weeks" ? timelineValue : Math.ceil(timelineValue / 7);

  const applyQuickStart = (qs: typeof QUICK_STARTS[0]) => {
    setTopic(qs.topic);
    setTimelineUnit("weeks");
    setTimelineValue(qs.weeks);
    setHoursPerDay(qs.hours);
    setSkillLevel(qs.skill);
  };

  const handleArchive = async (id: string) => {
    const confirmed = window.confirm("Archive this roadmap? This can't be undone.");
    if (!confirmed) return;
    await supabase.from("roadmaps").update({ status: "archived" }).eq("id", id);
    fetchRoadmaps();
  };

  const handleGenerate = async () => {
    if (!topic.trim() || !user || activeCount >= 5) return;
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

      const { data: newRm } = await supabase
        .from("roadmaps")
        .select("id")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1);
      const newId = newRm?.[0]?.id;
      navigate(newId ? `/dashboard/${newId}` : "/my-roadmaps");
    } catch (err: any) {
      clearInterval(stepInterval);
      setError(err.message || "Failed to generate roadmap");
      setLoading(false);
    }
  };

  const topicMessages = getTopicMessages(topic, skillLevel);

  if (checkingActive) {
    return (
      <>
        <AppBar />
        <div className="flex min-h-screen items-center justify-center pt-14">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      </>
    );
  }

  if (loading) {
    return (
      <>
        <AppBar />
        <div className="flex min-h-screen items-center justify-center px-4 pt-14">
          <div className="text-center max-w-md animate-fade-in">
            <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-8" />
            <p className="text-primary font-heading font-semibold text-base mb-6 animate-breathe">
              {topicMessages[Math.min(loadingStep, topicMessages.length - 1)]}
            </p>
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
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <AppBar />
      <div className="min-h-screen pt-20 pb-10 px-4">
        <div className="max-w-6xl mx-auto flex flex-col lg:flex-row gap-8 animate-fade-in">
          {/* Main: Roadmap Generator */}
          <div className="flex-1 max-w-lg">
            <h2 className="font-heading text-2xl md:text-3xl font-bold mb-2">
              Hey {profile?.display_name ?? "there"}! 👋
            </h2>
            <p className="text-muted-foreground mb-6">What do you want to learn?</p>

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
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-muted-foreground text-sm">
                    How many {timelineUnit}? <span className="text-primary font-heading font-bold">{timelineValue}</span>
                  </Label>
                  <div className="flex rounded-lg overflow-hidden border border-white/10">
                    <button
                      onClick={() => { setTimelineUnit("days"); setTimelineValue(7); }}
                      className={`px-3 py-1 text-xs font-heading transition-colors ${timelineUnit === "days" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-white/5"}`}
                    >Days</button>
                    <button
                      onClick={() => { setTimelineUnit("weeks"); setTimelineValue(4); }}
                      className={`px-3 py-1 text-xs font-heading transition-colors ${timelineUnit === "weeks" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-white/5"}`}
                    >Weeks</button>
                  </div>
                </div>
                <input
                  type="range"
                  min={timelineUnit === "days" ? 1 : 1}
                  max={timelineUnit === "days" ? 90 : 12}
                  value={timelineValue}
                  onChange={(e) => setTimelineValue(Number(e.target.value))}
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
                  max={8}
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

              {activeCount >= 5 ? (
                <div className="glass p-4 border-warning/30 bg-warning/5">
                  <p className="text-sm text-warning font-medium mb-2">⚠️ You've reached the limit of 5 active roadmaps</p>
                  <p className="text-xs text-muted-foreground mb-3">Archive an existing roadmap to create a new one.</p>
                </div>
              ) : (
                <Button
                  onClick={handleGenerate}
                  disabled={!topic.trim()}
                  className="w-full h-14 text-lg font-heading font-bold gradient-primary text-primary-foreground glow-primary transition-all hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100"
                >
                  Generate My Roadmap ✨
                </Button>
              )}

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

          {/* Right Sidebar: Existing Roadmaps */}
          {roadmaps.length > 0 && (
            <div className="lg:w-80 xl:w-96 shrink-0">
              <h3 className="font-heading text-lg font-bold mb-4">My Roadmaps ({roadmaps.length})</h3>
              <div className="space-y-3">
                {roadmaps.map((rm) => {
                  const completed = rm.completed_modules ?? 0;
                  const total = rm.total_modules ?? 0;
                  const pct = total ? Math.round((completed / total) * 100) : 0;
                  const rd = rm.roadmap_data as unknown as RoadmapData;

                  return (
                    <div key={rm.id} className="glass-strong p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h4 className="font-heading font-bold text-sm">{rm.topic}</h4>
                          <p className="text-xs text-muted-foreground">
                            {rm.skill_level} · {rm.timeline_weeks}w · {rm.hours_per_day}h/day
                          </p>
                        </div>
                        <span className="px-2 py-0.5 text-xs font-heading rounded-full bg-primary/20 text-primary">
                          {pct}%
                        </span>
                      </div>

                      {rd?.summary && (
                        <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{rd.summary}</p>
                      )}

                      <div className="mb-3">
                        <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                          <div className="h-full gradient-primary rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{completed}/{total} modules</p>
                      </div>

                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => navigate(`/dashboard/${rm.id}`)}
                          className="flex-1 gradient-primary text-primary-foreground font-heading font-bold text-xs"
                        >
                          Continue <ArrowRight className="ml-1 h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleArchive(rm.id)}
                          className="border-white/10 hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Archive className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
