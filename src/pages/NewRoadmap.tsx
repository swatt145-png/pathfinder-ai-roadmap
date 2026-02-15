import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppBar } from "@/components/AppBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, BookOpen } from "lucide-react";
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
    `Great choice to learn ${topic}!`,
    `We're crafting your personalized ${topic} roadmap ${level}...`,
    `Finding the best ${topic} resources from top educators...`,
    `Building quizzes to test your ${topic} knowledge...`,
    `Almost done — your ${topic} learning journey is taking shape! ✨`,
  ];
};


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

  const checkActive = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("roadmaps")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "active");
    setActiveCount(data?.length ?? 0);
    setCheckingActive(false);
  };

  useEffect(() => { checkActive(); }, [user]);

  const timelineWeeks = timelineUnit === "weeks" ? timelineValue : Math.ceil(timelineValue / 7);

  const applyQuickStart = (qs: typeof QUICK_STARTS[0]) => {
    setTopic(qs.topic);
    setTimelineUnit("weeks");
    setTimelineValue(qs.weeks);
    setHoursPerDay(qs.hours);
    setSkillLevel(qs.skill);
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
      <div className="min-h-screen pt-20 pb-10 px-4 md:px-8">
        <div className="flex justify-between animate-fade-in">
          {/* Main content - 70% */}
          <div className="w-[70%]">
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

          {/* Right sidebar - 20% */}
          <div className="hidden md:flex flex-col gap-3 w-[20%] min-w-[180px] pt-1">
            {activeCount > 0 && (
              <Button
                onClick={() => navigate("/my-roadmaps")}
                className="w-full h-12 text-sm font-heading font-bold gradient-primary text-primary-foreground glow-primary transition-all hover:scale-[1.02]"
              >
                <BookOpen className="mr-2 h-4 w-4" />
                My Roadmaps ({activeCount})
              </Button>
            )}
            {/* Future buttons go here */}
          </div>
        </div>
      </div>
    </>
  );
}
