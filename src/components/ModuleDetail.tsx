import { useState } from "react";
import { ArrowLeft, ExternalLink, CheckSquare, Square } from "lucide-react";
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
}

const RESOURCE_ICONS: Record<string, string> = {
  video: "🎬", article: "📄", documentation: "📚", tutorial: "💻", practice: "🏋️",
};

export function ModuleDetail({ module, progress, onClose, onComplete, onUpdateResourcesAndNotes }: ModuleDetailProps) {
  const [selfReport, setSelfReport] = useState<string | null>(progress?.self_report ?? null);
  const [quizOpen, setQuizOpen] = useState(false);
  const [quizScore, setQuizScore] = useState<number | null>(progress?.quiz_score ?? null);
  const [quizAnswers, setQuizAnswers] = useState<any>(progress?.quiz_answers ?? null);
  const [completedResources, setCompletedResources] = useState<string[]>(progress?.completed_resources ?? []);
  const [notes, setNotes] = useState<string>(progress?.notes ?? "");
  const isCompleted = progress?.status === "completed";

  const resourceProgress = module.resources.length > 0
    ? Math.round((completedResources.length / module.resources.length) * 100)
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
    // Debounce-like: save on blur instead
  };

  const handleNotesSave = () => {
    onUpdateResourcesAndNotes?.(module.id, completedResources, notes);
  };

  const handleComplete = () => {
    if (!selfReport) return;
    confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
    onComplete(module.id, selfReport, quizScore, quizAnswers);
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
          <p className="text-xs text-muted-foreground">Day {module.day_start}-{module.day_end} · {module.estimated_hours}h</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-8">
        <p className="text-sm text-muted-foreground">{module.description}</p>

        {/* Learning Objectives */}
        <div>
          <h4 className="font-heading font-semibold text-sm mb-2">Learning Objectives</h4>
          <ul className="space-y-1">
            {module.learning_objectives.map((obj, i) => (
              <li key={i} className="text-sm text-muted-foreground flex gap-2">
                <span className="text-primary">•</span> {obj}
              </li>
            ))}
          </ul>
        </div>

        {/* Resources with checkboxes */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-heading font-semibold text-sm">Resources</h4>
            {module.resources.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {completedResources.length}/{module.resources.length} done
                {resourceProgress > 0 && ` · ${resourceProgress}%`}
              </span>
            )}
          </div>
          <div className="space-y-2">
            {module.resources.map((r, i) => {
              const isChecked = completedResources.includes(r.title);
              return (
                <div
                  key={i}
                  className={`glass p-3 flex items-start gap-3 transition-colors ${isChecked ? "opacity-60" : ""}`}
                >
                  <button
                    onClick={() => toggleResource(r.title)}
                    className="mt-0.5 text-muted-foreground hover:text-primary transition-colors shrink-0"
                  >
                    {isChecked ? <CheckSquare className="w-5 h-5 text-success" /> : <Square className="w-5 h-5" />}
                  </button>
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 min-w-0 hover:opacity-80 transition-opacity"
                  >
                    <p className={`text-sm font-medium flex items-center gap-1 ${isChecked ? "line-through" : ""}`}>
                      <span>{RESOURCE_ICONS[r.type] ?? "📄"}</span>
                      {r.title} <ExternalLink className="w-3 h-3 text-muted-foreground" />
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">~{r.estimated_minutes} min · {r.description}</p>
                  </a>
                </div>
              );
            })}
          </div>
        </div>

        {/* Notes */}
        <div>
          <h4 className="font-heading font-semibold text-sm mb-2">Your Notes</h4>
          <Textarea
            value={notes}
            onChange={(e) => handleNotesChange(e.target.value)}
            onBlur={handleNotesSave}
            placeholder="Write your notes here — what was easy, difficult, or anything for your reference..."
            className="min-h-[120px] bg-white/5 border-white/10 focus:border-primary resize-y"
          />
        </div>

        <hr className="border-white/10" />

        {/* Check-in */}
        {isCompleted ? (
          <div className="glass p-4">
            <p className="text-sm text-muted-foreground">
              Completed · Felt: <span className="font-medium text-foreground">{progress?.self_report}</span>
              {progress?.quiz_score != null && <> · Quiz: <span className="font-medium text-foreground">{progress.quiz_score}%</span></>}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <h4 className="font-heading font-semibold text-sm">How did this module feel?</h4>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: "easy", emoji: "😊", label: "Easy", color: "bg-success/20 text-success border-success/30" },
                { value: "medium", emoji: "😐", label: "Medium", color: "bg-warning/20 text-warning border-warning/30" },
                { value: "hard", emoji: "😓", label: "Hard", color: "bg-destructive/20 text-destructive border-destructive/30" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSelfReport(opt.value)}
                  className={`p-3 rounded-xl border text-center transition-all ${selfReport === opt.value ? opt.color : "glass hover:bg-white/5"}`}
                >
                  <span className="text-2xl block">{opt.emoji}</span>
                  <span className="text-xs mt-1 block">{opt.label}</span>
                </button>
              ))}
            </div>

            {module.quiz.length > 0 && (
              <div>
                <Button
                  variant="outline"
                  onClick={() => setQuizOpen(true)}
                  className="w-full border-white/10 hover:bg-white/5"
                >
                  {quizScore != null ? `Quiz Score: ${quizScore}% — Retake` : "Take Quiz"}
                </Button>
                <p className="text-xs text-muted-foreground mt-1 text-center">
                  Taking the quiz helps Pathfinder adapt better to your needs
                </p>
              </div>
            )}

            <Button
              onClick={handleComplete}
              disabled={!selfReport}
              className="w-full h-12 gradient-primary text-primary-foreground font-heading font-bold glow-primary disabled:opacity-50"
            >
              Complete Module ✅
            </Button>
          </div>
        )}
      </div>

      {quizOpen && (
        <QuizModal
          quiz={module.quiz}
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
