import { useState, useEffect } from "react";
import NeonDogAnimation from "@/components/NeonDogAnimation";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppBar } from "@/components/AppBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, BookOpen, Layers, BookOpenCheck, Code2, Zap, GraduationCap } from "lucide-react";
import type { RoadmapData } from "@/lib/types";

const SKILLS = [
  { value: "beginner", label: "Beginner", desc: "I'm starting from scratch" },
  { value: "intermediate", label: "Intermediate", desc: "I know the basics" },
  { value: "advanced", label: "Advanced", desc: "I want to go deeper" },
];

const LEARNING_GOALS = [
  { value: "conceptual", label: "Conceptual", icon: BookOpenCheck, desc: "Understand the theory, concepts, and mental models" },
  { value: "hands_on", label: "Hands-On", icon: Code2, desc: "Build things, write code, solve problems" },
  { value: "quick_overview", label: "Quick Overview", icon: Zap, desc: "Fast high-level understanding for a demo or meeting" },
  { value: "deep_mastery", label: "Deep Mastery", icon: GraduationCap, desc: "Comprehensive, in-depth expertise" },
];

const QUICK_STARTS = [
  { label: "SQL in 2 weeks", topic: "SQL", weeks: 2, hours: 1, skill: "beginner", goal: "hands_on" },
  { label: "Python in 1 month", topic: "Python", weeks: 4, hours: 1, skill: "beginner", goal: "hands_on" },
  { label: "Cybersecurity in 3 weeks", topic: "Cybersecurity", weeks: 3, hours: 1, skill: "beginner", goal: "conceptual" },
  { label: "React in 10 days", topic: "React", weeks: 1.5, hours: 1.5, skill: "intermediate", goal: "hands_on" },
  { label: "Docker in 1 week", topic: "Docker", weeks: 1, hours: 1, skill: "beginner", goal: "quick_overview" },
];

const LOADING_STEPS = [
  "Understanding your learning goal...",
  "Designing your curriculum...",
  "Curating the best resources...",
  "Building assessment quizzes...",
  "Finalizing your personalized roadmap...",
];

const extractTopicKeywords = (input: string): string => {
  const cleaned = input
    .replace(/^(i\s+(want|need|would like)\s+to\s+(learn|study|understand|master|know)\s+(about|more about|how to)?)\s*/i, "")
    .replace(/^(teach me|help me learn|show me)\s+(about\s+)?\s*/i, "")
    .replace(/^(how to|learn|study|understand|master)\s+/i, "")
    .trim();
  return cleaned || input;
};

const LOADING_MESSAGES = [
  "Great choice! Let's build your roadmap 🚀",
  "Crafting a personalized curriculum just for you...",
  "Finding the best resources from top educators...",
  "Building assessment quizzes to track your progress...",
  "Almost done — your learning journey is taking shape! ✨",
];


export default function NewRoadmap() {
  const { user, profile, isGuest } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const reviseState = location.state as {
    replaceRoadmapId?: string;
    topic?: string;
    skill_level?: string;
    learning_goal?: string;
    timeline_weeks?: number;
    hours_per_day?: number;
    hard_deadline?: boolean;
    deadline_date?: string;
  } | null;

  const [topic, setTopic] = useState(reviseState?.topic ?? "");
  const [skillLevel, setSkillLevel] = useState(reviseState?.skill_level ?? "beginner");
  const [learningGoal, setLearningGoal] = useState(reviseState?.learning_goal ?? "hands_on");
  const [timelineUnit, setTimelineUnit] = useState<"weeks" | "days">("weeks");
  const [timelineValue, setTimelineValue] = useState(reviseState?.timeline_weeks ?? 4);
  const [hoursPerDay, setHoursPerDay] = useState(reviseState?.hours_per_day ?? 1);
  const [hardDeadline, setHardDeadline] = useState(reviseState?.hard_deadline ?? false);
  const [deadlineDate, setDeadlineDate] = useState(reviseState?.deadline_date ?? "");
  const [includeWeekends, setIncludeWeekends] = useState(true);
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
  const timelineDays = timelineUnit === "days" ? timelineValue : timelineValue * 7;

  const applyQuickStart = (qs: typeof QUICK_STARTS[0]) => {
    setTopic(qs.topic);
    setTimelineUnit("weeks");
    setTimelineValue(qs.weeks);
    setHoursPerDay(qs.hours);
    setSkillLevel(qs.skill);
    setLearningGoal(qs.goal);
  };

  const handleGenerate = async () => {
    if (!topic.trim() || !user || activeCount >= 10) return;
    if (hardDeadline && deadlineDate) {
      const selected = new Date(deadlineDate);
      const minDate = new Date();
      minDate.setDate(minDate.getDate() + timelineDays - 1);
      minDate.setHours(0, 0, 0, 0);
      selected.setHours(0, 0, 0, 0);
      if (selected < minDate) {
        setError(`Please choose a date on or after ${minDate.toLocaleDateString()} (${timelineDays} days from today, inclusive), or reduce your target timeline.`);
        return;
      }
    }
    setLoading(true);
    setError(null);
    setLoadingStep(0);

    const stepInterval = setInterval(() => {
      setLoadingStep((s) => Math.min(s + 1, LOADING_STEPS.length - 1));
    }, 4500);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("generate-roadmap", {
        body: { topic, skill_level: skillLevel, learning_goal: learningGoal, timeline_weeks: timelineWeeks, hours_per_day: hoursPerDay, hard_deadline: hardDeadline, deadline_date: deadlineDate || null, include_weekends: includeWeekends },
      });

      clearInterval(stepInterval);

      if (fnError) throw new Error(fnError.message);
      if (data?.error) throw new Error(data.error);

      const roadmapData = data as RoadmapData;

      const { error: insertError } = await supabase.from("roadmaps").insert({
        user_id: user.id,
        topic: roadmapData.topic,
        skill_level: roadmapData.skill_level,
        learning_goal: learningGoal,
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
        <div className="flex min-h-screen items-center justify-center px-6 pt-14 overflow-hidden">
          <div className="text-center w-full max-w-md animate-fade-in">
            <NeonDogAnimation />
            <p className="text-primary font-heading font-semibold text-lg mb-6 animate-breathe">
              {LOADING_MESSAGES[Math.min(loadingStep, LOADING_MESSAGES.length - 1)]}
            </p>
            <div className="space-y-3 mb-8">
              {LOADING_STEPS.map((step, i) => (
                <p
                  key={step}
                  className={`text-base transition-all duration-500 ${i === loadingStep ? "text-foreground animate-breathe font-medium" : i < loadingStep ? "text-muted-foreground/50" : "text-muted-foreground/20"}`}
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
      <div className="min-h-screen pt-20 pb-10 px-4 md:px-12 max-w-7xl mx-auto">
        <div className="animate-fade-in">
          {/* Header row with greeting + nav buttons */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="font-heading text-2xl md:text-3xl font-bold mb-2">
                Hey {isGuest ? "there" : (profile?.display_name ?? "there")}!
              </h2>
              <p className="text-muted-foreground text-base">What do you want to learn?</p>
            </div>
            {/* Desktop navigation buttons - horizontal, right-aligned */}
            <div className="hidden md:flex items-center gap-3">
              {activeCount > 0 && (
                <Button
                  onClick={() => navigate("/my-roadmaps")}
                  className="h-12 px-6 text-sm font-heading font-bold gradient-primary text-primary-foreground transition-all hover:scale-[1.02] hover:glow-primary"
                >
                  <BookOpen className="mr-2 h-4 w-4" />
                  My Roadmaps
                </Button>
              )}
              <Button
                onClick={() => navigate("/flashcards")}
                className="h-12 px-6 text-sm font-heading font-bold gradient-primary text-primary-foreground transition-all hover:scale-[1.02] hover:glow-primary"
              >
                <Layers className="mr-2 h-4 w-4" />
                Flashcards
              </Button>
            </div>
          </div>

          {/* Main content - full width */}
          <div className="w-full">

            <div className="space-y-6">
              <div>
                <Input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g., SQL, Python, Cybersecurity, Docker, React..."
                  className="h-14 text-xl glass-blue border-accent/15 focus:border-primary font-body"
                />
              </div>

              {/* Learning Goal */}
              <div>
                <Label className="text-muted-foreground text-base mb-3 block">Learning Goal</Label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {LEARNING_GOALS.map((g) => (
                    <button
                      key={g.value}
                      onClick={() => setLearningGoal(g.value)}
                      className={`glass-blue p-3 text-center transition-all ${learningGoal === g.value ? "border-primary bg-primary/10 glow-primary" : "hover:bg-accent/10"}`}
                    >
                      <g.icon className={`w-5 h-5 mx-auto mb-1 ${learningGoal === g.value ? "text-primary" : "text-muted-foreground"}`} />
                      <span className="block text-xs sm:text-sm font-heading font-semibold">{g.label}</span>
                      {learningGoal === g.value && (
                        <span className="block text-xs text-muted-foreground mt-1 animate-fade-in">{g.desc}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-muted-foreground text-base mb-3 block">Skill Level</Label>
                <div className="grid grid-cols-3 gap-2">
                  {SKILLS.map((s) => (
                    <button
                      key={s.value}
                      onClick={() => setSkillLevel(s.value)}
                      className={`glass-blue p-3 text-center transition-all ${skillLevel === s.value ? "border-primary bg-primary/10 glow-primary" : "hover:bg-accent/10"}`}
                    >
                      <span className="block text-xs sm:text-base font-heading font-semibold truncate">{s.label}</span>
                      {skillLevel === s.value && <span className="block text-xs sm:text-sm text-muted-foreground mt-1">{s.desc}</span>}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-muted-foreground text-base">
                    How many {timelineUnit}? <span className="text-primary font-heading font-bold">{timelineValue}</span>
                  </Label>
                  <div className="flex rounded-lg overflow-hidden border border-white/10">
                    <button
                      onClick={() => { setTimelineUnit("days"); setTimelineValue(7); }}
                      className={`px-3 py-1 text-sm font-heading transition-colors ${timelineUnit === "days" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-white/5"}`}
                    >Days</button>
                    <button
                      onClick={() => { setTimelineUnit("weeks"); setTimelineValue(4); }}
                      className={`px-3 py-1 text-sm font-heading transition-colors ${timelineUnit === "weeks" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-white/5"}`}
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
                <Label className="text-muted-foreground text-base mb-2 block">
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

              <div className="flex items-center justify-between glass-blue p-4">
                <Label className="text-base">Is this a hard deadline?</Label>
                <Switch checked={hardDeadline} onCheckedChange={(v) => { setHardDeadline(v); if (!v) setError(null); }} />
              </div>

              {hardDeadline && (
                <div>
                  <Input
                    type="date"
                    value={deadlineDate}
                    onChange={(e) => {
                      const selected = new Date(e.target.value);
                      const minDate = new Date();
                      minDate.setDate(minDate.getDate() + timelineDays - 1);
                      minDate.setHours(0, 0, 0, 0);
                      selected.setHours(0, 0, 0, 0);
                      if (selected < minDate) {
                        setError(`Please choose a date on or after ${minDate.toLocaleDateString()} (${timelineDays} days from today, inclusive), or reduce your target timeline.`);
                        setDeadlineDate(e.target.value);
                      } else {
                        setError(null);
                        setDeadlineDate(e.target.value);
                      }
                    }}
                    className="bg-white/5 border-white/10"
                  />
                  {error && error.includes("choose a date") && (
                    <p className="text-destructive text-sm mt-1">{error}</p>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between glass-blue p-4">
                <div>
                  <Label className="text-base">Include weekends?</Label>
                  <p className="text-sm text-muted-foreground mt-0.5">Study on Saturday & Sunday too</p>
                </div>
                <Switch checked={includeWeekends} onCheckedChange={setIncludeWeekends} />
              </div>

              {error && <p className="text-destructive text-base">{error}</p>}

              {activeCount >= 10 ? (
                <div className="glass-blue p-4 border-warning/30 bg-warning/5">
                  <p className="text-base text-warning font-medium mb-2">⚠️ You've reached the limit of 10 active roadmaps</p>
                  <p className="text-sm text-muted-foreground mb-3">Archive an existing roadmap to create a new one.</p>
                </div>
              ) : (
                <Button
                  onClick={handleGenerate}
                  disabled={!topic.trim()}
                  className="w-full h-16 text-xl font-heading font-bold gradient-primary text-primary-foreground hover:glow-primary transition-all hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100"
                >
                  Generate My Roadmap ✨
                </Button>
              )}

              <div>
                <p className="text-sm text-muted-foreground mb-3">Quick start:</p>
                <div className="flex flex-wrap gap-2">
                  {QUICK_STARTS.map((qs) => (
                    <button
                      key={qs.label}
                      onClick={() => applyQuickStart(qs)}
                      className="glass-blue px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/10 transition-all"
                    >
                      {qs.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Mobile navigation buttons */}
              <div className="flex md:hidden gap-2">
                {activeCount > 0 && (
                  <Button
                    onClick={() => navigate("/my-roadmaps")}
                    className="flex-1 h-12 text-sm font-heading font-bold gradient-primary text-primary-foreground transition-all hover:scale-[1.02] hover:glow-primary"
                  >
                    <BookOpen className="mr-2 h-4 w-4" />
                    My Roadmaps
                  </Button>
                )}
                <Button
                  onClick={() => navigate("/flashcards")}
                  className="flex-1 h-12 text-sm font-heading font-bold gradient-primary text-primary-foreground transition-all hover:scale-[1.02] hover:glow-primary"
                >
                  <Layers className="mr-2 h-4 w-4" />
                  Flashcards
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}