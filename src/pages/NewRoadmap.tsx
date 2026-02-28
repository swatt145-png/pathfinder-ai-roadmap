import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppBar } from "@/components/AppBar";
import WavyBackground from "@/components/WavyBackground";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, BookOpen, Layers, BookOpenCheck, Code2, Zap, GraduationCap } from "lucide-react";
import type { RoadmapData } from "@/lib/types";
import bookKnowledgeImg from "@/assets/loading/book-knowledge-new.png";
import stageGoalImg from "@/assets/loading/stage-goal.jpg";
import stageCurriculumImg from "@/assets/loading/stage-curriculum.jpg";
import stageResourcesImg from "@/assets/loading/stage-resources.jpg";
import stageQuizImg from "@/assets/loading/stage-quiz.jpg";
import stageFinalizeImg from "@/assets/loading/stage-finalize.jpg";

const SKILLS = [
  { value: "beginner", label: "Beginner", desc: "I'm starting from scratch" },
  { value: "intermediate", label: "Intermediate", desc: "I know the basics" },
  { value: "advanced", label: "Advanced", desc: "I want to go deeper" },
];

const LEARNING_GOALS = [
  { value: "conceptual", label: "Conceptual", icon: BookOpenCheck, desc: "Understand the theory, concepts, and mental models" },
  { value: "hands_on", label: "Practice", icon: Code2, desc: "Build things, write code, solve problems" },
  { value: "quick_overview", label: "Quick Overview", icon: Zap, desc: "Fast high-level understanding for a demo or meeting" },
  { value: "deep_mastery", label: "Deep Mastery", icon: GraduationCap, desc: "Comprehensive, in-depth expertise" },
];

const QUICK_STARTS = [
  { label: "Machine Learning in 1 month", topic: "Machine Learning", weeks: 4, hours: 1.5, skill: "intermediate", goal: "hands_on" },
  { label: "Product Management in 2 weeks", topic: "Product Management", weeks: 2, hours: 1, skill: "beginner", goal: "conceptual" },
  { label: "Finance & Investing in 3 weeks", topic: "Finance & Investing", weeks: 3, hours: 1, skill: "beginner", goal: "conceptual" },
  { label: "Digital Marketing in 14 days", topic: "Digital Marketing", days: 14, hours: 1, skill: "beginner", goal: "hands_on" },
  { label: "Creating AI Agents in 5 days", topic: "Creating AI Agents", days: 5, hours: 1, skill: "beginner", goal: "hands_on" },
];

const LOADING_STEPS = [
  "Understanding your learning goal...",
  "Designing your curriculum...",
  "Curating the best resources...",
  "Preparing optional quizzes...",
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
  "Setting up optional quizzes for later...",
  "Almost done — your learning journey is taking shape! ✨",
];

const isTransientRelayError = (message: string): boolean =>
  /Failed to send a request|FunctionsRelayError|NetworkError|fetch failed/i.test(message);

async function generateAllQuizzesInBackground(
  roadmapId: string,
  roadmapData: RoadmapData,
  learningGoal: string,
  supabaseClient: typeof supabase,
) {
  const modules = roadmapData.modules || [];
  const CONCURRENCY = 2;

  for (let i = 0; i < modules.length; i += CONCURRENCY) {
    const batch = modules.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((mod) =>
        supabaseClient.functions.invoke("generate-module-quiz", {
          body: {
            topic: roadmapData.topic,
            skill_level: roadmapData.skill_level,
            learning_goal: learningGoal,
            module: {
              title: mod.title,
              description: mod.description,
              learning_objectives: mod.learning_objectives,
            },
          },
        })
      )
    );

    // Read latest roadmap_data, merge quiz results, write back
    const { data: current } = await supabaseClient
      .from("roadmaps")
      .select("roadmap_data")
      .eq("id", roadmapId)
      .single();

    if (!current?.roadmap_data) continue;
    const updatedData = current.roadmap_data as unknown as RoadmapData;

    for (let j = 0; j < batch.length; j++) {
      const result = results[j];
      if (result.status !== "fulfilled") continue;
      const { data, error } = result.value;
      if (error || !data?.quiz) continue;

      const moduleIndex = i + j;
      if (updatedData.modules?.[moduleIndex]) {
        updatedData.modules[moduleIndex].quiz = data.quiz;
      }
    }

    await supabaseClient
      .from("roadmaps")
      .update({ roadmap_data: updatedData as any })
      .eq("id", roadmapId);
  }
  console.log(`[Flashcards] Background quiz generation complete for roadmap ${roadmapId}`);
}

const extractFunctionErrorMessage = async (fnError: any): Promise<string> => {
  const fallback = typeof fnError?.message === "string" ? fnError.message : "";
  const context = fnError?.context;

  if (context?.json) {
    try {
      const body = await context.json();
      if (typeof body?.error === "string" && body.error.trim()) return body.error;
      if (typeof body?.message === "string" && body.message.trim()) return body.message;
    } catch {
      // ignore and use fallback
    }
  }

  if (context?.text) {
    try {
      const raw = await context.text();
      if (raw?.trim()) {
        try {
          const parsed = JSON.parse(raw);
          if (typeof parsed?.error === "string" && parsed.error.trim()) return parsed.error;
          if (typeof parsed?.message === "string" && parsed.message.trim()) return parsed.message;
        } catch {
          return raw;
        }
      }
    } catch {
      // ignore and use fallback
    }
  }

  return fallback || "Failed to generate roadmap. Please try again.";
};


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
  } | null;

  const [topic, setTopic] = useState(reviseState?.topic ?? "");
  const [skillLevel, setSkillLevel] = useState(reviseState?.skill_level ?? "beginner");
  const [learningGoal, setLearningGoal] = useState(reviseState?.learning_goal ?? "hands_on");
  const [timelineUnit, setTimelineUnit] = useState<"weeks" | "days" | "hours">("days");
  const [timelineValue, setTimelineValue] = useState(reviseState?.timeline_weeks ? reviseState.timeline_weeks : 14);
  const [hoursPerDay, setHoursPerDay] = useState(reviseState?.hours_per_day ?? 1);
  const [totalHoursOnly, setTotalHoursOnly] = useState(3);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [activeCount, setActiveCount] = useState(0);
  const [checkingActive, setCheckingActive] = useState(true);
  const isReviseMode = Boolean(reviseState?.replaceRoadmapId);

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

  const computedTimelineWeeks = timelineUnit === "weeks" ? timelineValue : timelineUnit === "days" ? timelineValue / 7 : totalHoursOnly / (hoursPerDay || 1) / 7;
  const computedTimelineDays = timelineUnit === "days" ? timelineValue : timelineUnit === "weeks" ? timelineValue * 7 : Math.max(1, Math.ceil(totalHoursOnly / (hoursPerDay || 1)));
  const computedHoursPerDay = timelineUnit === "hours" ? totalHoursOnly : hoursPerDay;
  const computedTotalHours = timelineUnit === "hours" ? totalHoursOnly : computedTimelineDays * hoursPerDay;

  const applyQuickStart = (qs: typeof QUICK_STARTS[0]) => {
    setTopic(qs.topic);
    if ('days' in qs) {
      setTimelineUnit("days");
      setTimelineValue((qs as any).days);
    } else {
      setTimelineUnit("weeks");
      setTimelineValue(qs.weeks);
    }
    setHoursPerDay(qs.hours);
    setSkillLevel(qs.skill);
    setLearningGoal(qs.goal);
  };

  const handleGenerate = async () => {
    if (!topic.trim() || !user || activeCount >= 10) return;
    setLoading(true);
    setError(null);
    setLoadingStep(0);

    const stepInterval = setInterval(() => {
      setLoadingStep((s) => Math.min(s + 1, LOADING_STEPS.length - 1));
    }, 3000);

    const MAX_RETRIES = 2;
    const requestBody = { user_id: user.id, topic, skill_level: skillLevel, learning_goal: learningGoal, timeline_weeks: computedTimelineWeeks, timeline_days: computedTimelineDays, hours_per_day: computedHoursPerDay, total_hours: computedTotalHours, hard_deadline: false, deadline_date: null, include_weekends: true, timeline_mode: timelineUnit };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`Retrying roadmap generation (attempt ${attempt + 1}/${MAX_RETRIES + 1})...`);
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }

        const { data, error: fnError } = await supabase.functions.invoke("generate-roadmap", {
          body: requestBody,
        });

        clearInterval(stepInterval);

        if (fnError) {
          const detailedMessage = await extractFunctionErrorMessage(fnError);
          const err = new Error(detailedMessage);
          if (isTransientRelayError(detailedMessage) && attempt < MAX_RETRIES) {
            lastError = err;
            continue;
          }
          throw err;
        }
        if (data?.error) {
          const err = new Error(data.error);
          if (isTransientRelayError(data.error) && attempt < MAX_RETRIES) {
            lastError = err;
            continue;
          }
          throw err;
        }

        const roadmapData = data as RoadmapData;

        // Log pipeline diagnostics for debugging resource issues
        if ((data as any)?._pipeline_diag) {
          console.log("[Roadmap Pipeline Diagnostics]", (data as any)._pipeline_diag);
        }
        const totalRes = roadmapData.modules?.reduce((s, m) => s + (m.resources?.length || 0), 0) || 0;
        if (totalRes === 0) {
          console.warn("[Roadmap] WARNING: Generated roadmap has 0 resources across all modules!", (data as any)?._pipeline_diag);
        }

        const { data: insertedRows, error: insertError } = await supabase.from("roadmaps").insert({
          user_id: user.id,
          topic: roadmapData.topic,
          skill_level: roadmapData.skill_level,
          learning_goal: learningGoal,
          timeline_weeks: roadmapData.timeline_weeks,
          hours_per_day: roadmapData.hours_per_day,
          hard_deadline: false,
          deadline_date: null,
          roadmap_data: roadmapData as any,
          original_roadmap_data: roadmapData as any,
          total_modules: roadmapData.modules.length,
          status: "active",
        }).select("id");

        if (insertError) throw insertError;

        if (reviseState?.replaceRoadmapId) {
          const oldRoadmapId = reviseState.replaceRoadmapId;
          // Fire cleanup in parallel — no need to await sequentially
          await Promise.all([
            supabase.from("progress").delete().eq("roadmap_id", oldRoadmapId).eq("user_id", user.id),
            supabase.from("adaptations").delete().eq("roadmap_id", oldRoadmapId).eq("user_id", user.id),
            supabase.from("roadmaps").delete().eq("id", oldRoadmapId).eq("user_id", user.id),
          ]);
        }

        const newId = insertedRows?.[0]?.id;
        // Schedule background quiz generation after navigation completes
        // Using setTimeout ensures the async work isn't cancelled by React unmount
        if (newId) {
          const quizArgs = { roadmapId: newId, roadmapData, learningGoal, supabaseClient: supabase };
          setTimeout(() => {
            generateAllQuizzesInBackground(quizArgs.roadmapId, quizArgs.roadmapData, quizArgs.learningGoal, quizArgs.supabaseClient).catch((err) =>
              console.warn("[Flashcards] Background quiz generation failed:", err)
            );
          }, 500);
        }
        navigate(newId ? `/dashboard/${newId}` : "/my-roadmaps");
        return;
      } catch (err: any) {
        const msg = err.message || "";
        if (isTransientRelayError(msg) && attempt < MAX_RETRIES) {
          lastError = err;
          continue;
        }
        clearInterval(stepInterval);
        if (isTransientRelayError(msg)) {
          setError("Our servers are busy right now. Please try again in a moment.");
        } else {
          setError(msg || "Failed to generate roadmap. Please try again.");
        }
        setLoading(false);
        return;
      }
    }

    // All retries exhausted
    clearInterval(stepInterval);
    setError("Our servers are busy right now. Please try again in a moment.");
    setLoading(false);
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

  const CIRCULAR_STEPS = [
    { image: stageGoalImg, label: "Analyzing goal" },
    { image: stageCurriculumImg, label: "Building curriculum" },
    { image: stageResourcesImg, label: "Curating resources" },
    { image: stageQuizImg, label: "Quiz setup" },
    { image: stageFinalizeImg, label: "Finalizing roadmap" },
  ];

  if (loading) {
    const isMobileView = typeof window !== 'undefined' && window.innerWidth < 640;
    const radius = isMobileView ? 120 : 240;
    const startAngle = -90;

    return (
      <>
        <AppBar />
        <WavyBackground />
        <div className="flex min-h-screen items-center justify-center px-4 pt-14 overflow-hidden">
          <div className="flex flex-col items-center animate-fade-in w-full max-w-[320px] sm:max-w-[480px] md:max-w-[620px]">
            <div className="relative w-full" style={{ aspectRatio: "1/1" }}>
            {/* Center book image */}
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <img src={bookKnowledgeImg} alt="Knowledge book" className="w-20 h-20 sm:w-36 sm:h-36 md:w-64 md:h-64 rounded-full object-cover shadow-2xl shadow-primary/20 border-2 border-primary/20" />
            </div>

            {/* Connecting circle track + arrows */}
            <svg className="absolute inset-0 w-full h-full" viewBox="-300 -300 600 600">
              <circle cx="0" cy="0" r={radius} fill="none" stroke="hsl(var(--primary) / 0.1)" strokeWidth="1.5" strokeDasharray="6 6" />
              {CIRCULAR_STEPS.map((_, i) => {
                const angle1 = (startAngle + (i * 360) / 5) * (Math.PI / 180);
                const angle2 = (startAngle + ((i + 1) * 360) / 5) * (Math.PI / 180);
                const midAngle = (angle1 + angle2) / 2;
                const x1 = Math.cos(angle1) * radius;
                const y1 = Math.sin(angle1) * radius;
                const x2 = Math.cos(angle2) * radius;
                const y2 = Math.sin(angle2) * radius;
                const arrowX = Math.cos(midAngle) * radius;
                const arrowY = Math.sin(midAngle) * radius;
                const arrowAngle = (midAngle * 180) / Math.PI + 90;
                const isActive = i <= loadingStep;
                return (
                  <g key={i}>
                    <path
                      d={`M ${x1 * 0.88 + (x2 - x1) * 0.15} ${y1 * 0.88 + (y2 - y1) * 0.15} Q ${Math.cos(midAngle) * (radius * 1.02)} ${Math.sin(midAngle) * (radius * 1.02)} ${x2 * 0.88 + (x1 - x2) * 0.15} ${y2 * 0.88 + (y1 - y2) * 0.15}`}
                      fill="none"
                      stroke={isActive ? "hsl(var(--primary) / 0.5)" : "hsl(var(--primary) / 0.12)"}
                      strokeWidth="1.5"
                      className="transition-all duration-700"
                    />
                    <g transform={`translate(${arrowX * 0.92}, ${arrowY * 0.92}) rotate(${arrowAngle})`}>
                      <polygon
                        points="0,-4 3,2 -3,2"
                        fill={isActive ? "hsl(var(--primary) / 0.6)" : "hsl(var(--primary) / 0.15)"}
                        className="transition-all duration-700"
                      />
                    </g>
                  </g>
                );
              })}
            </svg>

            {/* Step images in circle */}
            {CIRCULAR_STEPS.map((step, i) => {
              const angle = (startAngle + (i * 360) / 5) * (Math.PI / 180);
              const x = Math.cos(angle) * radius;
              const y = Math.sin(angle) * radius;
              const isDone = i < loadingStep;
              const isActive = i === loadingStep;

              return (
                <div
                  key={i}
                  className="absolute flex flex-col items-center gap-1 z-20"
                  style={{
                    left: `calc(50% + ${x}px)`,
                    top: `calc(50% + ${y}px)`,
                    transform: "translate(-50%, -50%)",
                  }}
                >
                  <div
                    className={`w-10 h-10 sm:w-14 sm:h-14 md:w-24 md:h-24 rounded-full overflow-hidden transition-all duration-700 ${
                      isDone
                        ? "border-2 border-primary shadow-[0_0_12px_hsl(var(--primary)/0.4)]"
                        : isActive
                        ? "border-2 border-primary animate-pulse shadow-[0_0_18px_hsl(var(--primary)/0.5)]"
                        : "border border-muted-foreground/20 opacity-40"
                    }`}
                  >
                    <img src={step.image} alt={step.label} className="w-full h-full object-cover" />
                  </div>
                  <span
                    className={`text-[10px] sm:text-xs md:text-sm font-heading font-semibold text-center whitespace-nowrap transition-all duration-700 ${
                      isDone ? "text-primary/70" : isActive ? "text-primary" : "text-muted-foreground/25"
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
              );
            })}

            </div>
            {/* Messages below the circular loader */}
            <div className="mt-8 text-center">
              <p className="text-primary font-heading font-semibold text-base animate-pulse">
                {LOADING_MESSAGES[Math.min(loadingStep, LOADING_MESSAGES.length - 1)]}
              </p>
              <p className="text-muted-foreground text-sm mt-2">This may take a minute</p>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <AppBar />
      <WavyBackground />
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
                  className="h-12 px-6 text-sm font-heading font-bold gradient-primary text-primary-foreground transition-all hover:scale-[1.02] hover:shadow-md"
                >
                  <BookOpen className="mr-2 h-4 w-4" />
                  My Roadmaps
                </Button>
              )}
              <Button
                onClick={() => navigate("/flashcards")}
                className="h-12 px-6 text-sm font-heading font-bold gradient-primary text-primary-foreground transition-all hover:scale-[1.02] hover:shadow-md"
              >
                <Layers className="mr-2 h-4 w-4" />
                Flashcards
              </Button>
            </div>
          </div>

          {/* Main content - full width */}
          <div className="w-full">
            {isReviseMode && (
              <div className="glass-blue p-3 mb-4 border border-primary/30">
                <p className="text-sm text-muted-foreground">
                  Revise mode: generating this roadmap will replace your current roadmap after successful creation.
                </p>
              </div>
            )}

            <div className="space-y-6">
              <div>
                <Input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Python for data science in 2 weeks, Product Management in 2 weeks"
                  className="h-14 text-xl glass-blue border-accent/15 focus:border-primary font-body"
                />
                <div className="mt-3">
                  <p className="text-sm text-muted-foreground mb-2">Quick start:</p>
                  <div className="flex flex-wrap gap-2">
                    {QUICK_STARTS.map((qs) => (
                      <button
                        key={qs.label}
                        onClick={() => applyQuickStart(qs)}
                        className="glass-blue px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:border-primary/30 hover:shadow-sm hover:scale-[1.02] transition-all"
                      >
                        {qs.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Learning Goal */}
              <div>
                <Label className="text-muted-foreground text-base mb-3 block">Learning Goal</Label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {LEARNING_GOALS.map((g) => (
                    <button
                      key={g.value}
                      onClick={() => setLearningGoal(g.value)}
                      className={`glass-blue p-3 text-center ${learningGoal === g.value ? "glass-blue-selected" : ""}`}
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
                      className={`glass-blue p-3 text-center ${skillLevel === s.value ? "glass-blue-selected" : ""}`}
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
                    {timelineUnit === "hours" ? (
                      <>Total hours? <span className="text-primary font-heading font-bold">{totalHoursOnly}</span></>
                    ) : (
                      <>Target {timelineUnit}: <span className="text-primary font-heading font-bold">{timelineValue}</span></>
                    )}
                  </Label>
                  <div className="flex rounded-lg overflow-hidden border border-border">
                    <button
                      onClick={() => { setTimelineUnit("hours"); setTotalHoursOnly(3); }}
                      className={`px-3 py-1 text-sm font-heading transition-all ${timelineUnit === "hours" ? "bg-primary text-primary-foreground font-bold" : "text-muted-foreground hover:bg-primary/15"}`}
                    >Hours</button>
                    <button
                      onClick={() => { setTimelineUnit("days"); setTimelineValue(7); }}
                      className={`px-3 py-1 text-sm font-heading transition-all ${timelineUnit === "days" ? "bg-primary text-primary-foreground font-bold" : "text-muted-foreground hover:bg-primary/15"}`}
                    >Days</button>
                    <button
                      onClick={() => { setTimelineUnit("weeks"); setTimelineValue(4); }}
                      className={`px-3 py-1 text-sm font-heading transition-all ${timelineUnit === "weeks" ? "bg-primary text-primary-foreground font-bold" : "text-muted-foreground hover:bg-primary/15"}`}
                    >Weeks</button>
                  </div>
                </div>
                {timelineUnit === "hours" ? (
                  <input
                    type="range"
                    min={1}
                    max={30}
                    step={0.5}
                    value={totalHoursOnly}
                    onChange={(e) => setTotalHoursOnly(Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                ) : (
                  <input
                    type="range"
                    min={1}
                    max={timelineUnit === "days" ? 30 : 12}
                    value={timelineValue}
                    onChange={(e) => setTimelineValue(Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                )}
                {timelineUnit === "hours" && (
                  <p className="text-xs text-muted-foreground mt-1">
                    A single focused session — no multi-day schedule needed.
                  </p>
                )}
              </div>

              {timelineUnit !== "hours" && (
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
              )}

              {/* Summary of total time */}
              <div className="glass-blue p-3">
                <p className="text-sm text-muted-foreground">
                  Total study time: <span className="text-primary font-heading font-bold">{computedTotalHours} hours</span>
                  {timelineUnit !== "hours" && (
                    <> across <span className="text-primary font-heading font-bold">{computedTimelineDays} day{computedTimelineDays !== 1 ? "s" : ""}</span></>
                  )}
                </p>
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
                  className="w-full h-16 text-xl font-heading font-bold gradient-primary text-primary-foreground hover:shadow-md transition-all hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100"
                >
                  Generate My Roadmap ✨
                </Button>
              )}


              {/* Mobile navigation buttons */}
              <div className="flex md:hidden gap-2">
                {activeCount > 0 && (
                  <Button
                    onClick={() => navigate("/my-roadmaps")}
                    className="flex-1 h-12 text-sm font-heading font-bold gradient-primary text-primary-foreground transition-all hover:scale-[1.02] hover:shadow-md"
                  >
                    <BookOpen className="mr-2 h-4 w-4" />
                    My Roadmaps
                  </Button>
                )}
                <Button
                  onClick={() => navigate("/flashcards")}
                  className="flex-1 h-12 text-sm font-heading font-bold gradient-primary text-primary-foreground transition-all hover:scale-[1.02] hover:shadow-md"
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
