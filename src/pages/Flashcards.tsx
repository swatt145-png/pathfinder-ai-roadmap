import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppBar } from "@/components/AppBar";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, ArrowRight, RotateCcw } from "lucide-react";
import type { RoadmapData, Module } from "@/lib/types";

interface FlashCard {
  front: string;
  back: string;
  module: string;
}

function generateFlashcards(roadmap: RoadmapData): FlashCard[] {
  const cards: FlashCard[] = [];
  for (const mod of (roadmap.modules ?? [])) {
    for (const obj of (mod.learning_objectives ?? [])) {
      cards.push({
        front: obj,
        back: `Key concept from "${mod.title}" — ${(mod.description ?? "").slice(0, 120)}${(mod.description ?? "").length > 120 ? "…" : ""}`,
        module: mod.title,
      });
    }
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

function FlashcardDeck({ rm }: { rm: RoadmapRow }) {
  const rd = rm.roadmap_data as unknown as RoadmapData;
  const cards = generateFlashcards(rd);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  if (cards.length === 0) return null;

  const card = cards[index];

  return (
    <div className="glass-blue p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-heading font-bold text-lg">{rm.topic}</h3>
          <p className="text-sm text-muted-foreground">
            {rm.skill_level} · {rm.timeline_weeks} weeks · {rm.hours_per_day}h/day
          </p>
        </div>
        <span className="px-2 py-0.5 text-sm font-heading rounded-full bg-primary/20 text-primary">
          {cards.length} cards
        </span>
      </div>

      <p className="text-xs text-muted-foreground mb-2">{card.module}</p>
      <button
        onClick={() => setFlipped(!flipped)}
        className="w-full min-h-[140px] glass-blue p-6 text-center transition-all hover:bg-accent/10 cursor-pointer flex items-center justify-center"
      >
        <p className="text-base whitespace-pre-line">
          {flipped ? card.back : card.front}
        </p>
      </button>
      <p className="text-xs text-center text-muted-foreground mt-2">
        {flipped ? "Answer" : "Question"} — tap to flip
      </p>

      <div className="flex items-center justify-between mt-3">
        <Button
          variant="ghost"
          size="sm"
          disabled={index === 0}
          onClick={() => { setIndex(index - 1); setFlipped(false); }}
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Prev
        </Button>
        <span className="text-sm text-muted-foreground">
          {index + 1} / {cards.length}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={index === cards.length - 1}
          onClick={() => { setIndex(index + 1); setFlipped(false); }}
        >
          Next <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
      <div className="flex justify-center mt-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setIndex(0); setFlipped(false); }}
          className="text-muted-foreground"
        >
          <RotateCcw className="h-3 w-3 mr-1" /> Reset
        </Button>
      </div>
    </div>
  );
}

export default function Flashcards() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [roadmaps, setRoadmaps] = useState<RoadmapRow[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <>
      <AppBar />
      <div className="min-h-screen pt-20 pb-10 px-4 max-w-2xl mx-auto animate-fade-in">
        <div className="flex items-center gap-3 mb-6">
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
          <div className="space-y-4">
            {roadmaps.map((rm) => (
              <FlashcardDeck key={rm.id} rm={rm} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
