import { useState } from "react";
import { ArrowLeft, ExternalLink, CheckSquare, Square, ThumbsUp, Minus, ThumbsDown, Save, Target, BookOpen, StickyNote, MessageCircleQuestion, Video, FileText, BookMarked, Code2, Dumbbell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { QuizModal } from "@/components/QuizModal";
import type { Module, ModuleProgress } from "@/lib/types";
import confetti from "canvas-confetti";

interface ModuleDetailProps {
  module: Module;
  progress?: ModuleProgress;
  onClose: () => void;
  onComplete: (moduleId: string, selfReport: string, quizScore: number | null, quizAnswers: any) => void;
  onUpdateResourcesAndNotes?: (moduleId: string, completedResources: string[], notes: string) => void;
  onUpdateCompletedModule?: (moduleId: string, selfReport: string, notes: string) => void;
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

export function ModuleDetail({ module, progress, onClose, onComplete, onUpdateResourcesAndNotes, onUpdateCompletedModule }: ModuleDetailProps) {
  const [selfReport, setSelfReport] = useState<string | null>(progress?.self_report ?? null);
  const [quizOpen, setQuizOpen] = useState(false);
  const [quizScore, setQuizScore] = useState<number | null>(progress?.quiz_score ?? null);
  const [quizAnswers, setQuizAnswers] = useState<any>(progress?.quiz_answers ?? null);
  const [completedResources, setCompletedResources] = useState<string[]>(progress?.completed_resources ?? []);
  const [notes, setNotes] = useState<string>(progress?.notes ?? "");
  const isCompleted = progress?.status === "completed";
  const [saved, setSaved] = useState(false);

  const resources = module.resources ?? [];
  const learningObjectives = module.learning_objectives ?? [];
  const quiz = module.quiz ?? [];

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

  return (
    <div className="fixed inset-0 z-50 bg-background overflow-y-auto">
      {/* Top bar */}
      <div className="sticky top-0 z-10 flex items-center gap-3 p-4 border-b border-white/10 bg-background/90 backdrop-blur-lg">
        <button onClick={onClose} className="p-2 text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-white/5">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h3 className="font-heading font-bold text-lg truncate">{module.title}</h3>
          <p className="text-base text-muted-foreground">Day {module.day_start}-{module.day_end} · {module.estimated_hours}h</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-8">
        <p className="text-base text-muted-foreground">{module.description}</p>

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
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 min-w-0 hover:opacity-80 transition-opacity"
                  >
                    <p className={`text-base font-heading font-semibold flex items-center gap-2 ${isChecked ? "line-through" : ""}`}>
                      {r.title} <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    </p>
                    <p className="text-base text-muted-foreground mt-1">~{r.estimated_minutes} min · {r.description}</p>
                  </a>
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

            <Button
              onClick={handleComplete}
              className="w-full h-12 gradient-primary text-primary-foreground font-heading font-bold glow-primary"
            >
              Complete Module ✅
            </Button>
          </div>
        )}
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
