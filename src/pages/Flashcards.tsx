import { useEffect, useState, useCallback } from "react";
import WavyBackground from "@/components/WavyBackground";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppBar } from "@/components/AppBar";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, ArrowRight, RotateCcw, ChevronLeft } from "lucide-react";
import type { RoadmapData } from "@/lib/types";

interface FlashCard {
  front: string;
  back: string;
  module: string;
}

function generateFlashcards(roadmap: RoadmapData): FlashCard[] {
  const cards: FlashCard[] = [];
  for (const mod of (roadmap.modules ?? [])) {
    for (const q of (mod.quiz ?? [])) {
      cards.push({
        front: q.question,
        back: `${q.correct_answer}\n\n${q.explanation}`,
        module: mod.title,
      });
    }
  }
  return cards;
}

interface RoadmapRow {
  id: string;
  topic: string;
  skill_level: string;
  timeline_weeks: number;
  hours_per_day: number;
  roadmap_data: unknown;
  learning_goal?: string;
}

const CARD_COLORS = [
  "from-primary/80 to-emerald-400/80",
  "from-primary/60 to-cyan-500/80",
  "from-accent/80 to-primary/60",
  "from-emerald-500/80 to-primary/80",
  "from-cyan-400/80 to-primary/60",
  "from-primary/70 to-teal-400/80",
];

export default function Flashcards() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [roadmaps, setRoadmaps] = useState<RoadmapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRoadmap, setSelectedRoadmap] = useState<RoadmapRow | null>(null);
  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [generatingQuizzes, setGeneratingQuizzes] = useState(false);
  const [generationProgress, setGenerationProgress] = useState("");

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("roadmaps")
        .select("id, topic, skill_level, timeline_weeks, hours_per_day, roadmap_data, learning_goal")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("created_at", { ascending: false });
      setRoadmaps((data as RoadmapRow[]) ?? []);
      setLoading(false);
    })();
  }, [user]);

  const handleSelectRoadmap = useCallback(async (rm: RoadmapRow) => {
    const roadmapData = rm.roadmap_data as unknown as RoadmapData;
    const modulesWithoutQuiz = (roadmapData.modules ?? []).filter(
      (m) => !m.quiz || m.quiz.length === 0
    );

    if (modulesWithoutQuiz.length === 0) {
      setSelectedRoadmap(rm);
      return;
    }

    // Generate quizzes for all modules missing them
    setSelectedRoadmap(rm);
    setGeneratingQuizzes(true);
    setGenerationProgress(`Generating flashcards... 0/${modulesWithoutQuiz.length} modules`);

    const updatedModules = [...(roadmapData.modules ?? [])];
    let completed = 0;

    // Process in batches of 3 to avoid rate limits
    const batchSize = 3;
    for (let i = 0; i < modulesWithoutQuiz.length; i += batchSize) {
      const batch = modulesWithoutQuiz.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (mod) => {
          const { data, error } = await supabase.functions.invoke("generate-module-quiz", {
            body: {
              topic: roadmapData.topic,
              skill_level: roadmapData.skill_level,
              learning_goal: rm.learning_goal || "hands_on",
              module: {
                id: mod.id,
                title: mod.title,
                description: mod.description,
                learning_objectives: mod.learning_objectives || [],
              },
            },
          });
          if (error) throw error;
          return { moduleId: mod.id, quiz: Array.isArray(data?.quiz) ? data.quiz : [] };
        })
      );

      for (const result of results) {
        if (result.status === "fulfilled" && result.value.quiz.length > 0) {
          const idx = updatedModules.findIndex((m) => m.id === result.value.moduleId);
          if (idx !== -1) updatedModules[idx] = { ...updatedModules[idx], quiz: result.value.quiz };
        }
        completed++;
      }
      setGenerationProgress(`Generating flashcards... ${completed}/${modulesWithoutQuiz.length} modules`);
    }

    // Update roadmap data in state
    const updatedRoadmapData: RoadmapData = { ...roadmapData, modules: updatedModules };
    const updatedRm = { ...rm, roadmap_data: updatedRoadmapData as unknown };
    setSelectedRoadmap(updatedRm);
    setRoadmaps((prev) => prev.map((r) => (r.id === rm.id ? updatedRm : r)));

    // Persist to DB
    await supabase
      .from("roadmaps")
      .update({ roadmap_data: updatedRoadmapData as any })
      .eq("id", rm.id);

    setGeneratingQuizzes(false);
    setGenerationProgress("");
  }, []);

  if (loading) {
    return (
      <>
        <AppBar />
        <WavyBackground />
        <div className="flex min-h-screen items-center justify-center pt-14">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      </>
    );
  }

  const cards = selectedRoadmap
    ? generateFlashcards(selectedRoadmap.roadmap_data as unknown as RoadmapData)
    : [];
  const colorIndex = selectedRoadmap ? roadmaps.findIndex(r => r.id === selectedRoadmap.id) : 0;
  const gradient = CARD_COLORS[colorIndex % CARD_COLORS.length];

  // === View 3: Single card focused ===
  if (selectedRoadmap && selectedCard !== null) {
    const card = cards[selectedCard];
    return (
      <>
        <AppBar />
        <WavyBackground />
        <div className="min-h-screen pt-20 pb-10 px-4 md:px-12 max-w-5xl mx-auto animate-fade-in">
          <div className="flex items-center gap-3 mb-6">
            <Button variant="ghost" size="sm" onClick={() => { setSelectedCard(null); setFlipped(false); }}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Back to deck
            </Button>
            <span className="text-sm text-muted-foreground ml-auto">{selectedCard + 1} / {cards.length}</span>
          </div>
          <p className="text-xs text-muted-foreground mb-2">{card.module}</p>
          <button
            onClick={() => setFlipped(!flipped)}
            className="w-full min-h-[220px] glass-blue p-8 text-center transition-all hover:bg-accent/10 cursor-pointer flex items-center justify-center rounded-xl"
          >
            <p className="text-lg whitespace-pre-line">{flipped ? card.back : card.front}</p>
          </button>
          <p className="text-xs text-center text-muted-foreground mt-3">
            {flipped ? "Answer" : "Question"} — tap to flip
          </p>
          <div className="flex items-center justify-between mt-4">
            <Button variant="ghost" size="sm" disabled={selectedCard === 0}
              onClick={() => { setSelectedCard(selectedCard - 1); setFlipped(false); }}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Prev
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setSelectedCard(0); setFlipped(false); }} className="text-muted-foreground">
              <RotateCcw className="h-3 w-3 mr-1" /> Reset
            </Button>
            <Button variant="ghost" size="sm" disabled={selectedCard === cards.length - 1}
              onClick={() => { setSelectedCard(selectedCard + 1); setFlipped(false); }}>
              Next <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      </>
    );
  }

  // === View 2: Cards grid for selected roadmap ===
  if (selectedRoadmap) {
    return (
      <>
        <AppBar />
        <WavyBackground />
        <div className="min-h-screen pt-20 pb-10 px-4 md:px-12 max-w-6xl mx-auto animate-fade-in">
          <div className="flex items-center gap-3 mb-8">
            <Button variant="ghost" size="icon" onClick={() => { setSelectedRoadmap(null); setGeneratingQuizzes(false); }}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h2 className="font-heading text-2xl md:text-3xl font-bold">{selectedRoadmap.topic}</h2>
              <p className="text-sm text-muted-foreground">
                {generatingQuizzes ? generationProgress : `${cards.length} flashcards · ${selectedRoadmap.skill_level}`}
              </p>
            </div>
          </div>
          {generatingQuizzes ? (
            <div className="glass-blue p-8 text-center">
              <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto mb-4" />
              <p className="text-muted-foreground">{generationProgress}</p>
              <p className="text-xs text-muted-foreground mt-2">This may take a moment — generating quiz questions for all modules...</p>
              {cards.length > 0 && (
                <div className="mt-4">
                  <p className="text-sm text-muted-foreground mb-2">{cards.length} cards ready so far</p>
                </div>
              )}
            </div>
          ) : cards.length === 0 ? (
            <div className="glass-blue p-8 text-center">
              <p className="text-muted-foreground">No flashcards available for this roadmap yet.</p>
            </div>
          ) : (
            (() => {
              // Group cards by module
              const moduleGroups: { module: string; cards: { card: FlashCard; globalIndex: number }[] }[] = [];
              cards.forEach((card, i) => {
                const existing = moduleGroups.find(g => g.module === card.module);
                if (existing) {
                  existing.cards.push({ card, globalIndex: i });
                } else {
                  moduleGroups.push({ module: card.module, cards: [{ card, globalIndex: i }] });
                }
              });

              return (
                <div className="space-y-8">
                  {moduleGroups.map((group, gi) => {
                    const moduleGradient = CARD_COLORS[gi % CARD_COLORS.length];
                    return (
                      <div key={group.module}>
                        <h3 className="font-heading font-bold text-lg text-foreground mb-3">{group.module}</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                          {group.cards.map(({ card, globalIndex }) => (
                            <button
                              key={globalIndex}
                              onClick={() => { setSelectedCard(globalIndex); setFlipped(false); }}
                              className="group relative rounded-xl overflow-hidden bg-card border border-border hover:border-primary/40 transition-all hover:shadow-lg hover:shadow-primary/10 hover:-translate-y-1 text-left"
                            >
                              <div className={`bg-gradient-to-r ${moduleGradient} px-4 py-2.5 flex items-center justify-between`}>
                                <span className="text-sm font-heading font-bold text-primary-foreground truncate max-w-[70%]">{card.module}</span>
                                <span className="text-xs text-primary-foreground/70 shrink-0">#{globalIndex + 1}</span>
                              </div>
                              <div className="p-4 min-h-[100px] flex flex-col justify-between">
                                <p className="font-heading font-semibold text-sm text-foreground line-clamp-3 mb-3">{card.front}</p>
                                <p className="text-xs text-muted-foreground line-clamp-2">{card.back.split("\n")[0]}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()
          )}
        </div>
      </>
    );
  }

  // === View 1: Roadmap/topic picker ===
  return (
    <>
      <AppBar />
      <WavyBackground />
      <div className="min-h-screen pt-20 pb-10 px-4 md:px-12 max-w-6xl mx-auto animate-fade-in">
        <div className="flex items-center gap-3 mb-8">
          <Button variant="ghost" size="icon" onClick={() => navigate("/home")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h2 className="font-heading text-2xl md:text-3xl font-bold">Flashcards</h2>
        </div>

        {roadmaps.length === 0 ? (
          <div className="glass-strong p-8 text-center">
            <p className="text-muted-foreground mb-4">No active roadmaps yet. Create one to get flashcards!</p>
            <Button onClick={() => navigate("/home")} className="gradient-primary text-primary-foreground font-heading font-bold">
              Create a Roadmap
            </Button>
          </div>
        ) : (
          <>
            <p className="text-muted-foreground mb-6">Choose a roadmap to study its flashcards</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {roadmaps.map((rm, i) => {
                const roadmapData = rm.roadmap_data as unknown as RoadmapData;
                const existingCards = generateFlashcards(roadmapData).length;
                const totalModules = (roadmapData.modules ?? []).length;
                const modulesWithQuiz = (roadmapData.modules ?? []).filter(m => m.quiz && m.quiz.length > 0).length;
                const grad = CARD_COLORS[i % CARD_COLORS.length];
                return (
                  <button
                    key={rm.id}
                    onClick={() => handleSelectRoadmap(rm)}
                    disabled={generatingQuizzes}
                    className="group rounded-xl overflow-hidden bg-card border border-border hover:border-primary/40 transition-all hover:shadow-lg hover:shadow-primary/10 hover:-translate-y-1 text-left disabled:opacity-50"
                  >
                    <div className={`bg-gradient-to-r ${grad} px-5 py-4 h-16 flex items-center`}>
                      <h3 className="font-heading font-bold text-lg text-primary-foreground line-clamp-2">{rm.topic}</h3>
                    </div>
                    <div className="p-5">
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>{rm.skill_level} · {rm.timeline_weeks}w · {rm.hours_per_day}h/day</span>
                        <span className="px-2 py-0.5 rounded-full bg-primary/20 text-primary font-heading font-semibold">
                          {modulesWithQuiz < totalModules
                            ? `~${totalModules * 4} cards`
                            : `${existingCards} cards`}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </>
  );
}
