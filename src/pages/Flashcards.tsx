import { useEffect, useState } from "react";
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

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("roadmaps")
        .select("id, topic, skill_level, timeline_weeks, hours_per_day, roadmap_data")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("created_at", { ascending: false });
      setRoadmaps((data as RoadmapRow[]) ?? []);
      setLoading(false);
    })();
  }, [user]);

  if (loading) {
    return (
      <>
        <AppBar />
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
        <div className="min-h-screen pt-20 pb-10 px-4 md:px-12 max-w-6xl mx-auto animate-fade-in">
          <div className="flex items-center gap-3 mb-8">
            <Button variant="ghost" size="icon" onClick={() => setSelectedRoadmap(null)}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h2 className="font-heading text-2xl md:text-3xl font-bold">{selectedRoadmap.topic}</h2>
              <p className="text-sm text-muted-foreground">{cards.length} flashcards · {selectedRoadmap.skill_level}</p>
            </div>
          </div>
          {cards.length === 0 ? (
            <div className="glass-blue p-8 text-center">
              <p className="text-muted-foreground">No flashcards available for this roadmap yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {cards.map((card, i) => (
                <button
                  key={i}
                  onClick={() => { setSelectedCard(i); setFlipped(false); }}
                  className="group relative rounded-xl overflow-hidden bg-card border border-white/10 hover:border-primary/40 transition-all hover:shadow-lg hover:shadow-primary/10 hover:-translate-y-1 text-left"
                >
                  <div className={`bg-gradient-to-r ${gradient} px-4 py-2.5 flex items-center justify-between`}>
                    <span className="text-sm font-heading font-bold text-white truncate max-w-[70%]">{card.module}</span>
                    <span className="text-xs text-white/70 shrink-0">#{i + 1}</span>
                  </div>
                  <div className="p-4 min-h-[100px] flex flex-col justify-between">
                    <p className="font-heading font-semibold text-sm text-foreground line-clamp-3 mb-3">{card.front}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2">{card.back.split("\n")[0]}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </>
    );
  }

  // === View 1: Roadmap/topic picker ===
  return (
    <>
      <AppBar />
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
                const cardCount = generateFlashcards(rm.roadmap_data as unknown as RoadmapData).length;
                const grad = CARD_COLORS[i % CARD_COLORS.length];
                return (
                  <button
                    key={rm.id}
                    onClick={() => setSelectedRoadmap(rm)}
                    className="group rounded-xl overflow-hidden bg-card border border-white/10 hover:border-primary/40 transition-all hover:shadow-lg hover:shadow-primary/10 hover:-translate-y-1 text-left"
                  >
                    <div className={`bg-gradient-to-r ${grad} px-5 py-4 h-16 flex items-center`}>
                      <h3 className="font-heading font-bold text-lg text-white line-clamp-2">{rm.topic}</h3>
                    </div>
                    <div className="p-5">
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>{rm.skill_level} · {rm.timeline_weeks}w · {rm.hours_per_day}h/day</span>
                        <span className="px-2 py-0.5 rounded-full bg-primary/20 text-primary font-heading font-semibold">
                          {cardCount} cards
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
