import { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, CheckSquare, Square, ThumbsUp, Minus, ThumbsDown, Save, Target, BookOpen, StickyNote, MessageCircleQuestion, Video, FileText, BookMarked, Code2, Dumbbell, Undo2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { QuizModal } from "@/components/QuizModal";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Module, ModuleProgress } from "@/lib/types";
import confetti from "canvas-confetti";

interface ModuleDetailProps {
  module: Module;
  progress?: ModuleProgress;
  onClose: () => void;
  onComplete: (moduleId: string, selfReport: string, quizScore: number | null, quizAnswers: any) => void;
  onUpdateResourcesAndNotes?: (moduleId: string, completedResources: string[], notes: string) => void;
  onUpdateCompletedModule?: (moduleId: string, selfReport: string, notes: string) => void;
  onMarkNotComplete?: (moduleId: string) => void;
  roadmapId?: string;
  roadmapTopic?: string;
  onGenerateQuiz?: (moduleId: string) => Promise<void>;
}

const RESOURCE_ICONS: Record<string, React.ElementType> = {
  video: Video,
  article: FileText,
  documentation: BookMarked,
  tutorial: Code2,
  practice: Dumbbell,
};

const RESOURCE_COLORS: Record<string, string> = {
  video: "text-accent",
  article: "text-primary",
  documentation: "text-secondary",
  tutorial: "text-warning",
  practice: "text-success",
};

function formatViewCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}
export function ModuleDetail({
  module,
  progress,
  onClose,
  onComplete,
  onUpdateResourcesAndNotes,
  onUpdateCompletedModule,
  onMarkNotComplete,
  roadmapId,
  roadmapTopic,
  onGenerateQuiz,
}: ModuleDetailProps) {
  const { user } = useAuth();
  const [selfReport, setSelfReport] = useState<string | null>(progress?.self_report ?? null);
  const [quizOpen, setQuizOpen] = useState(false);
  const [quizScore, setQuizScore] = useState<number | null>(progress?.quiz_score ?? null);
  const [quizAnswers, setQuizAnswers] = useState<any>(progress?.quiz_answers ?? null);
  const [completedResources, setCompletedResources] = useState<string[]>(progress?.completed_resources ?? []);
  const [notes, setNotes] = useState<string>(progress?.notes ?? "");
  const isCompleted = progress?.status === "completed";
  const [saved, setSaved] = useState(false);
  const [generatingQuiz, setGeneratingQuiz] = useState(false);
  const [quizGenerationError, setQuizGenerationError] = useState<string | null>(null);
  const [feedbackByUrl, setFeedbackByUrl] = useState<Record<string, { liked: boolean | null; relevant: boolean | null }>>({});

  const resources = module.resources ?? [];
  const learningObjectives = module.learning_objectives ?? [];
  const quiz = module.quiz ?? [];

  const normalizeTopicKey = (raw: string) =>
    raw
      .toLowerCase()
      .replace(/[^a-z0-9\s+#./-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  useEffect(() => {
    const loadFeedback = async () => {
      if (!user || !roadmapId || resources.length === 0) return;
      const urls = resources.map((r) => r.url);
      const { data, error } = await supabase
        .from("resource_feedback")
        .select("resource_url,relevant,liked")
        .eq("user_id", user.id)
        .eq("roadmap_id", roadmapId)
        .eq("module_id", module.id)
        .in("resource_url", urls);
      if (error || !data) return;
      const next: Record<string, { liked: boolean | null; relevant: boolean | null }> = {};
      for (const row of data) {
        next[row.resource_url] = { liked: row.liked, relevant: row.relevant };
      }
      setFeedbackByUrl(next);
    };
    void loadFeedback();
  }, [user, roadmapId, module.id, resources]);

  const totalResourceMinutes = resources.reduce((sum, r) => sum + (r.estimated_minutes || 0), 0);

  const resourceProgress = resources.length > 0
    ? Math.round((completedResources.length / resources.length) * 100)
    : 0;

  const toggleResource = (resourceTitle: string) => {
    const updated = completedResources.includes(resourceTitle)
      ? completedResources.filter((r) => r !== resourceTitle)
      : [...completedResources, resourceTitle];
    setCompletedResources(updated);
    onUpdateResourcesAndNotes?.(module.id, updated, notes);
  };

  const handleNotesChange = (value: string) => {
    setNotes(value);
  };

  const handleNotesSave = () => {
    onUpdateResourcesAndNotes?.(module.id, completedResources, notes);
  };

  const handleComplete = () => {
    confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
    onComplete(module.id, selfReport ?? "not_rated", quizScore, quizAnswers);
  };

  const handleSaveCompletedModule = () => {
    onUpdateCompletedModule?.(module.id, selfReport ?? "not_rated", notes);
    onUpdateResourcesAndNotes?.(module.id, completedResources, notes);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const upsertFeedback = async (resourceUrl: string, next: { liked: boolean | null; relevant: boolean | null }) => {
    if (!user || !roadmapId) return;
    setFeedbackByUrl((prev) => ({ ...prev, [resourceUrl]: next }));
    await supabase.from("resource_feedback").upsert({
      user_id: user.id,
      roadmap_id: roadmapId,
      module_id: module.id,
      module_title: module.title,
      topic_key: normalizeTopicKey(roadmapTopic || module.title),
      resource_url: resourceUrl,
      relevant: next.relevant,
      liked: next.liked,
    }, {
      onConflict: "user_id,roadmap_id,module_id,resource_url",
    });
  };

  const toggleLiked = async (resourceUrl: string) => {
    const current = feedbackByUrl[resourceUrl] || { liked: null, relevant: null };
    const liked = current.liked === true ? null : true;
    const relevant = liked ? true : current.relevant;
    await upsertFeedback(resourceUrl, { liked, relevant });
  };

  const toggleNotRelevant = async (resourceUrl: string) => {
    const current = feedbackByUrl[resourceUrl] || { liked: null, relevant: null };
    const relevant = current.relevant === false ? null : false;
    const liked = relevant === false ? null : current.liked;
    await upsertFeedback(resourceUrl, { liked, relevant });
  };

  const handleGenerateQuiz = async () => {
    if (!onGenerateQuiz) return;
    setGeneratingQuiz(true);
    setQuizGenerationError(null);
    try {
      await onGenerateQuiz(module.id);
    } catch (e: any) {
      setQuizGenerationError(e?.message || "Failed to generate quiz.");
    } finally {
      setGeneratingQuiz(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background overflow-y-auto">
      {/* Top bar */}
      <div className="sticky top-0 z-10 flex items-center gap-3 p-4 border-b border-white/10 bg-background/90 backdrop-blur-lg">
        <button onClick={onClose} className="p-2 text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-white/5">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h3 className="font-heading font-bold text-lg truncate">{module.title}</h3>
          <p className="text-base text-muted-foreground">Day {module.day_start}-{module.day_end} · {module.estimated_hours}h study time</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-8">
        <div className="glass-blue p-5 space-y-8">
        <p className="text-base text-muted-foreground">{module.description}</p>

        <div className="flex flex-wrap gap-3">
          <span className="text-sm font-heading px-3 py-1.5 rounded-lg bg-accent/10 text-accent border border-accent/20">
            Resource time: ~{totalResourceMinutes} min
          </span>
          <span className="text-sm font-heading px-3 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
            Recommended study: {module.estimated_hours}h
          </span>
        </div>

        {/* Learning Objectives */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Target className="w-5 h-5 text-primary" />
            <h4 className="font-heading font-bold text-lg gradient-text">Learning Objectives</h4>
          </div>
          <ul className="space-y-2">
            {learningObjectives.map((obj, i) => (
              <li key={i} className="text-base text-muted-foreground flex gap-3 items-start glass p-3">
                <span className="text-primary font-bold mt-0.5">→</span>
                <span>{obj}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Resources */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-accent" />
              <h4 className="font-heading font-bold text-lg gradient-text">Resources</h4>
            </div>
            {resources.length > 0 && (
              <span className="text-base text-muted-foreground font-heading">
                {completedResources.length}/{resources.length} done
                {resourceProgress > 0 && ` · ${resourceProgress}%`}
              </span>
            )}
          </div>
          <div className="space-y-3">
            {resources.map((r, i) => {
              const isChecked = completedResources.includes(r.title);
              const IconComponent = RESOURCE_ICONS[r.type] ?? FileText;
              const iconColor = RESOURCE_COLORS[r.type] ?? "text-primary";
              return (
                <div
                  key={i}
                  className={`glass-strong p-4 flex items-start gap-3 transition-all border ${isChecked ? "opacity-50 border-success/20" : "border-white/10 hover:border-primary/30"}`}
                >
                  <button
                    onClick={() => toggleResource(r.title)}
                    className="mt-0.5 text-muted-foreground hover:text-primary transition-colors shrink-0"
                  >
                    {isChecked ? <CheckSquare className="w-5 h-5 text-success" /> : <Square className="w-5 h-5" />}
                  </button>
                  <div className={`mt-0.5 shrink-0 ${iconColor}`}>
                    <IconComponent className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:opacity-80 transition-opacity block"
                    >
                    <p className={`text-base font-heading font-semibold flex items-center gap-2 ${isChecked ? "line-through" : ""}`}>
                      {(r as any).is_continuation && (
                        <span className="text-xs bg-accent/20 text-accent px-1.5 py-0.5 rounded font-normal shrink-0">Continue watching</span>
                      )}
                      {(r as any).span_plan && !(r as any).is_continuation && (
                        <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded font-normal shrink-0">Spans modules</span>
                      )}
                      {r.title} <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    </p>
                    {(r as any).channel && (r as any).view_count ? (
                      <p className="text-sm text-accent mt-1 flex items-center gap-1">
                        🎬 {(r as any).channel} · {r.estimated_minutes} min · {formatViewCount((r as any).view_count)} views
                      </p>
                    ) : null}
                    <p className="text-base text-muted-foreground mt-1">
                      {(r as any).channel ? `${r.estimated_minutes} min · ` : `~${r.estimated_minutes} min · `}{r.description}
                    </p>
                    </a>
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        onClick={() => { void toggleLiked(r.url); }}
                        className={`text-xs px-2 py-1 rounded border transition-colors ${feedbackByUrl[r.url]?.liked ? "border-success/40 text-success bg-success/10" : "border-white/10 text-muted-foreground hover:text-foreground"}`}
                      >
                        Like
                      </button>
                      <button
                        onClick={() => { void toggleNotRelevant(r.url); }}
                        className={`text-xs px-2 py-1 rounded border transition-colors ${feedbackByUrl[r.url]?.relevant === false ? "border-destructive/40 text-destructive bg-destructive/10" : "border-white/10 text-muted-foreground hover:text-foreground"}`}
                      >
                        Not relevant
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Notes */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <StickyNote className="w-5 h-5 text-warning" />
            <h4 className="font-heading font-bold text-lg gradient-text">Your Notes</h4>
          </div>
          <Textarea
            value={notes}
            onChange={(e) => handleNotesChange(e.target.value)}
            onBlur={handleNotesSave}
            placeholder="Write your notes here — what was easy, difficult, or anything for your reference..."
            className="min-h-[120px] bg-white/5 border-white/10 focus:border-primary resize-y text-base"
          />
        </div>

        <hr className="border-white/10" />

        {/* Check-in */}
        {isCompleted ? (
          <div className="space-y-4">
            <div className="glass-strong p-4 border border-success/20">
              <p className="text-base text-muted-foreground">
                Completed · Felt: <span className="font-heading font-semibold text-foreground">{progress?.self_report ?? "not rated"}</span>
                {progress?.quiz_score != null && <> · Quiz: <span className="font-heading font-semibold text-foreground">{progress.quiz_score}%</span></>}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <MessageCircleQuestion className="w-5 h-5 text-secondary" />
              <h4 className="font-heading font-bold text-lg gradient-text">Update Difficulty Rating</h4>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: "easy", icon: ThumbsUp, label: "Easy", color: "bg-success/20 text-success border-success/30" },
                { value: "medium", icon: Minus, label: "Medium", color: "bg-warning/20 text-warning border-warning/30" },
                { value: "hard", icon: ThumbsDown, label: "Hard", color: "bg-destructive/20 text-destructive border-destructive/30" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSelfReport(opt.value)}
                  className={`p-3 rounded-xl border text-center transition-all ${selfReport === opt.value ? opt.color : "glass hover:bg-white/5"}`}
                >
                  <opt.icon className="w-7 h-7 mx-auto" />
                  <span className="text-base mt-1 block font-heading">{opt.label}</span>
                </button>
              ))}
            </div>

            <Button
              onClick={handleSaveCompletedModule}
              className="w-full h-12 gradient-primary text-primary-foreground font-heading font-bold"
            >
              <Save className="mr-2 h-4 w-4" />
              {saved ? "Saved ✓" : "Save Changes"}
            </Button>

            <Button
              variant="outline"
              onClick={() => onMarkNotComplete?.(module.id)}
              className="w-full border-white/10 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 text-muted-foreground"
            >
              <Undo2 className="mr-2 h-4 w-4" />
              Mark Not Complete
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <MessageCircleQuestion className="w-5 h-5 text-secondary" />
              <h4 className="font-heading font-bold text-lg gradient-text">How Did This Module Feel?</h4>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: "easy", icon: ThumbsUp, label: "Easy", color: "bg-success/20 text-success border-success/30" },
                { value: "medium", icon: Minus, label: "Medium", color: "bg-warning/20 text-warning border-warning/30" },
                { value: "hard", icon: ThumbsDown, label: "Hard", color: "bg-destructive/20 text-destructive border-destructive/30" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSelfReport(opt.value)}
                  className={`p-3 rounded-xl border text-center transition-all ${selfReport === opt.value ? opt.color : "glass hover:bg-white/5"}`}
                >
                  <opt.icon className="w-7 h-7 mx-auto" />
                  <span className="text-base mt-1 block font-heading">{opt.label}</span>
                </button>
              ))}
            </div>

            {quiz.length > 0 && (
              <div>
                <Button
                  variant="outline"
                  onClick={() => setQuizOpen(true)}
                  className="w-full border-white/10 hover:bg-white/5 text-base"
                >
                  {quizScore != null ? `Quiz Score: ${quizScore}% — Retake` : "Take Quiz"}
                </Button>
                <p className="text-base text-muted-foreground mt-1 text-center">
                  Taking the quiz helps Pathfinder adapt better to your needs
                </p>
              </div>
            )}
            {quiz.length === 0 && (
              <div>
                <Button
                  variant="outline"
                  onClick={handleGenerateQuiz}
                  disabled={generatingQuiz}
                  className="w-full border-white/10 hover:bg-white/5 text-base"
                >
                  {generatingQuiz ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  {generatingQuiz ? "Generating Quiz..." : "Generate Quiz"}
                </Button>
                {quizGenerationError ? (
                  <p className="text-sm text-destructive mt-1 text-center">{quizGenerationError}</p>
                ) : (
                  <p className="text-base text-muted-foreground mt-1 text-center">
                    Quiz generation is optional and created on demand.
                  </p>
                )}
              </div>
            )}

            <Button
              onClick={handleComplete}
              className="w-full h-12 gradient-primary text-primary-foreground font-heading font-bold hover:glow-primary transition-all"
            >
              Complete Module ✅
            </Button>
          </div>
        )}
      </div>

      </div>

      {quizOpen && (
        <QuizModal
          quiz={quiz}
          moduleTitle={module.title}
          onClose={() => setQuizOpen(false)}
          onDone={(score, answers) => {
            setQuizScore(score);
            setQuizAnswers(answers);
            setQuizOpen(false);
          }}
        />
      )}
    </div>
  );
}
