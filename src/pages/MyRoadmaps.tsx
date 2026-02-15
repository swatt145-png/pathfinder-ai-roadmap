import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppBar } from "@/components/AppBar";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, ArrowRight, Archive } from "lucide-react";
import type { RoadmapData } from "@/lib/types";

interface RoadmapRow {
  id: string;
  topic: string;
  skill_level: string;
  timeline_weeks: number;
  hours_per_day: number;
  status: string;
  created_at: string;
  completed_modules: number | null;
  total_modules: number | null;
  current_streak: number | null;
  roadmap_data: unknown;
}

export default function MyRoadmaps() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [roadmaps, setRoadmaps] = useState<RoadmapRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRoadmaps = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("roadmaps")
      .select("id, topic, skill_level, timeline_weeks, hours_per_day, status, created_at, completed_modules, total_modules, current_streak, roadmap_data")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false });
    setRoadmaps((data as RoadmapRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchRoadmaps(); }, [user]);

  const handleArchive = async (id: string) => {
    const confirmed = window.confirm("Archive this roadmap? This can't be undone.");
    if (!confirmed) return;
    await supabase.from("roadmaps").update({ status: "archived" }).eq("id", id);
    fetchRoadmaps();
  };

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
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-heading text-2xl md:text-3xl font-bold">My Roadmaps</h2>
          {roadmaps.length < 10 && (
            <Button
              onClick={() => navigate("/new")}
              className="gradient-primary text-primary-foreground font-heading font-bold"
            >
              <Plus className="mr-2 h-4 w-4" /> New Roadmap
            </Button>
          )}
        </div>

        {roadmaps.length === 0 ? (
          <div className="glass-strong p-8 text-center">
            <p className="text-muted-foreground mb-4">You don't have any active roadmaps yet.</p>
            <Button onClick={() => navigate("/new")} className="gradient-primary text-primary-foreground font-heading font-bold">
              <Plus className="mr-2 h-4 w-4" /> Create Your First Roadmap
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {roadmaps.map((rm) => {
              const completed = rm.completed_modules ?? 0;
              const total = rm.total_modules ?? 0;
              const pct = total ? Math.round((completed / total) * 100) : 0;
              const rd = rm.roadmap_data as unknown as RoadmapData;

              return (
                <div key={rm.id} className="glass-blue p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-heading font-bold text-lg">{rm.topic}</h3>
                      <p className="text-sm text-muted-foreground">
                        {rm.skill_level} · {rm.timeline_weeks} weeks · {rm.hours_per_day}h/day
                      </p>
                    </div>
                    <span className="px-2 py-0.5 text-sm font-heading rounded-full bg-primary/20 text-primary">
                      {pct}%
                    </span>
                  </div>

                  {rd?.summary && (
                    <p className="text-base text-muted-foreground mb-3 line-clamp-2">{rd.summary}</p>
                  )}

                  <div className="mb-3">
                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full gradient-primary rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{completed} of {total} modules completed</p>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={() => navigate(`/dashboard/${rm.id}`)}
                      className="flex-1 gradient-primary text-primary-foreground font-heading font-bold"
                    >
                      Continue <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleArchive(rm.id)}
                      className="border-white/10 hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Archive className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {roadmaps.length >= 10 && (
          <p className="text-sm text-muted-foreground text-center mt-4">
            You've reached the maximum of 10 active roadmaps. Archive one to create a new one.
          </p>
        )}
      </div>
    </>
  );
}
