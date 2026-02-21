import { useState } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import type { QuizQuestion } from "@/lib/types";

interface QuizModalProps {
  quiz: QuizQuestion[];
  moduleTitle: string;
  onClose: () => void;
  onDone: (score: number, answers: Record<string, string>) => void;
}

export function QuizModal({ quiz, moduleTitle, onClose, onDone }: QuizModalProps) {
  const [currentQ, setCurrentQ] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [finished, setFinished] = useState(false);

  const q = quiz[currentQ];
  const isCorrect = submitted && selected === q?.correct_answer;
  const isWrong = submitted && selected !== q?.correct_answer;

  const handleSubmit = () => {
    if (!selected || !q) return;
    setSubmitted(true);
    setAnswers((prev) => ({ ...prev, [q.id]: selected }));
  };

  const handleNext = () => {
    if (currentQ < quiz.length - 1) {
      setCurrentQ((c) => c + 1);
      setSelected(null);
      setSubmitted(false);
    } else {
      setFinished(true);
    }
  };

  if (finished) {
    const correct = quiz.filter((q) => answers[q.id] === q.correct_answer).length;
    const score = Math.round((correct / quiz.length) * 100);

    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
        <div className="relative glass-strong max-w-md w-full p-6 max-h-[85vh] overflow-y-auto animate-fade-in">
          <h3 className="font-heading font-bold text-lg text-center mb-4">Quiz Results</h3>
          <div className="text-center mb-6">
            <p className="text-5xl font-heading font-extrabold gradient-text mb-2">{score}%</p>
            <p className="text-sm text-muted-foreground">
              {score >= 80 ? "Great job! You've got a solid understanding." :
               score >= 60 ? "Good effort! A few concepts to review." :
               "Some concepts need more attention. WayVion will help adjust your plan."}
            </p>
          </div>

          <div className="space-y-4 mb-6">
            {quiz.map((q) => {
              const userAnswer = answers[q.id];
              const correct = userAnswer === q.correct_answer;
              return (
                <div key={q.id} className="glass p-3 text-sm">
                  <p className="font-medium mb-1">{q.question}</p>
                  <p className={correct ? "text-success" : "text-destructive"}>
                    Your answer: {userAnswer} {correct ? "✓" : "✗"}
                  </p>
                  {!correct && <p className="text-success text-xs">Correct: {q.correct_answer}</p>}
                  <p className="text-xs text-muted-foreground mt-1">{q.explanation}</p>
                </div>
              );
            })}
          </div>

          <Button onClick={() => onDone(score, answers)} className="w-full gradient-primary text-primary-foreground font-heading font-bold">
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass-strong max-w-md w-full p-6 animate-fade-in">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Close quiz"
        >
          <X className="h-4 w-4" />
        </button>
        <h3 className="font-heading font-bold text-sm mb-1 pr-8">{moduleTitle} Quiz</h3>
        <div className="h-1 bg-muted/50 rounded-full mb-6 overflow-hidden">
          <div className="h-full gradient-primary transition-all" style={{ width: `${((currentQ + 1) / quiz.length) * 100}%` }} />
        </div>

        <p className="text-sm font-medium mb-4">{q.question}</p>

        <div className="space-y-2 mb-6">
          {q.options.map((opt) => {
            let cls = "glass p-3 text-sm text-left w-full transition-all hover:bg-muted/50";
            if (submitted) {
              if (opt === q.correct_answer) cls = "border border-success bg-success/10 p-3 text-sm text-left w-full rounded-2xl";
              else if (opt === selected && isWrong) cls = "border border-destructive bg-destructive/10 p-3 text-sm text-left w-full rounded-2xl";
              else cls = "glass p-3 text-sm text-left w-full opacity-50";
            } else if (opt === selected) {
              cls = "border border-primary bg-primary/10 p-3 text-sm text-left w-full rounded-2xl";
            }
            return (
              <button key={opt} onClick={() => !submitted && setSelected(opt)} className={cls} disabled={submitted}>
                {opt}
              </button>
            );
          })}
        </div>

        {submitted && <p className="text-xs text-muted-foreground mb-4">{q.explanation}</p>}

        {!submitted ? (
          <Button onClick={handleSubmit} disabled={!selected} className="w-full gradient-primary text-primary-foreground font-heading disabled:opacity-50">
            Submit Answer
          </Button>
        ) : (
          <Button onClick={handleNext} className="w-full gradient-primary text-primary-foreground font-heading">
            {currentQ < quiz.length - 1 ? "Next Question →" : "See Results"}
          </Button>
        )}
      </div>
    </div>
  );
}
