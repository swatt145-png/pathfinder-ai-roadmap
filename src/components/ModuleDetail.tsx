import { useState } from "react";
import { X, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QuizModal } from "@/components/QuizModal";
import type { Module, ModuleProgress } from "@/lib/types";
import confetti from "canvas-confetti";

interface ModuleDetailProps {
  module: Module;
  progress?: ModuleProgress;
  onClose: () => void;
  onComplete: (moduleId: string, selfReport: string, quizScore: number | null, quizAnswers: any) => void;
}

const RESOURCE_ICONS: Record<string, string> = {
  video: "🎬", article: "📄", documentation: "📚", tutorial: "💻", practice: "🏋️",
};

export function ModuleDetail({ module, progress, onClose, onComplete }: ModuleDetailProps) {
  const [selfReport, setSelfReport] = useState<string | null>(progress?.self_report ?? null);
  const [quizOpen, setQuizOpen] = useState(false);
  const [quizScore, setQuizScore] = useState<number | null>(progress?.quiz_score ?? null);
  const [quizAnswers, setQuizAnswers] = useState<any>(progress?.quiz_answers ?? null);
  const isCompleted = progress?.status === "completed";

  const handleComplete = () => {
    if (!selfReport) return;
    confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
    onComplete(module.id, selfReport, quizScore, quizAnswers);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-card border-l border-white/10 overflow-y-auto animate-slide-up md:animate-none md:translate-x-0">
        <div className="sticky top-0 z-10 flex items-center justify-between p-4 border-b border-white/10 bg-card/90 backdrop-blur-lg">
          <h3 className="font-heading font-bold text-lg truncate pr-4">{module.title}</h3>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-6">
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

          {/* Resources */}
          <div>
            <h4 className="font-heading font-semibold text-sm mb-3">Resources</h4>
            <div className="space-y-2">
              {module.resources.map((r, i) => (
                <a
                  key={i}
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="glass p-3 flex items-start gap-3 hover:bg-white/10 transition-colors block"
                >
                  <span className="text-lg">{RESOURCE_ICONS[r.type] ?? "📄"}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium flex items-center gap-1">
                      {r.title} <ExternalLink className="w-3 h-3 text-muted-foreground" />
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">~{r.estimated_minutes} min · {r.description}</p>
                  </div>
                </a>
              ))}
            </div>
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
