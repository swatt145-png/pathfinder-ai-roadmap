import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppBar } from "@/components/AppBar";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, ArrowRight, RotateCcw, ChevronDown, ChevronUp } from "lucide-react";
import type { RoadmapData, Module } from "@/lib/types";

interface FlashCard {
  front: string;
  back: string;
  module: string;
}

function generateFlashcards(roadmap: RoadmapData): FlashCard[] {
  const cards: FlashCard[] = [];
  for (const mod of roadmap.modules) {
    // One card per learning objective
    for (const obj of mod.learning_objectives) {
      cards.push({
        front: obj,
        back: `Key concept from "${mod.title}" — ${mod.description.slice(0, 120)}${mod.description.length > 120 ? "…" : ""}`,
        module: mod.title,
      });
    }
    // One card per quiz question
    for (const q of mod.quiz) {
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
  roadmap_data: unknown;
}

function FlashcardDeck({ cards, topic }: { cards: FlashCard[]; topic: string }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const card = cards[index];

  return (
    <div className="glass-strong p-5 mb-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between mb-3"
      >
        <h3 className="font-heading font-bold text-lg">{topic}</h3>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{cards.length} cards</span>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </button>

      {expanded && card && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{card.module}</p>
          <button
            onClick={() => setFlipped(!flipped)}
            className="w-full min-h-[160px] glass p-6 text-center transition-all hover:bg-white/5 cursor-pointer flex items-center justify-center"
          >
            <p className="text-base whitespace-pre-line">
              {flipped ? card.back : card.front}
            </p>
          </button>
          <p className="text-xs text-center text-muted-foreground">
            {flipped ? "Answer" : "Question"} — tap to flip
          </p>
          <div className="flex items-center justify-between">
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
          <div className="flex justify-center">
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
      )}
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
        .select("id, topic, roadmap_data")
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
          roadmaps.map((rm) => {
            const rd = rm.roadmap_data as unknown as RoadmapData;
            const cards = generateFlashcards(rd);
            if (cards.length === 0) return null;
            return <FlashcardDeck key={rm.id} cards={cards} topic={rm.topic} />;
          })
        )}
      </div>
    </>
  );
}
