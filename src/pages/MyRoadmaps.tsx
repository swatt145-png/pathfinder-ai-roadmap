import { useEffect, useState } from "react";
import WavyBackground from "@/components/WavyBackground";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppBar } from "@/components/AppBar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, ArrowRight, Archive, ArrowLeft, Share2 } from "lucide-react";
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
  const [archivedRoadmaps, setArchivedRoadmaps] = useState<RoadmapRow[]>([]);
  const [sharedCount, setSharedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [unarchiveConfirmId, setUnarchiveConfirmId] = useState<string | null>(null);
  const [archiveConfirmId, setArchiveConfirmId] = useState<string | null>(null);

  const fetchRoadmaps = async () => {
    if (!user) return;
    const [{ data: active }, { data: archived }] = await Promise.all([
      supabase
        .from("roadmaps")
        .select("id, topic, skill_level, timeline_weeks, hours_per_day, status, created_at, completed_modules, total_modules, current_streak, roadmap_data")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("created_at", { ascending: false }),
      supabase
        .from("roadmaps")
        .select("id, topic, skill_level, timeline_weeks, hours_per_day, status, created_at, completed_modules, total_modules, current_streak, roadmap_data")
        .eq("user_id", user.id)
        .eq("status", "archived")
        .order("created_at", { ascending: false }),
    ]);
    setRoadmaps((active as RoadmapRow[]) ?? []);
    setArchivedRoadmaps((archived as RoadmapRow[]) ?? []);

    // Get count of pending shared roadmaps + pending roadmap requests for badge
    const [{ count: sharedPending }, { count: requestsPending }] = await Promise.all([
      (supabase as any)
        .from("shared_roadmaps")
        .select("id", { count: "exact", head: true })
        .eq("receiver_id", user.id)
        .eq("status", "pending"),
      (supabase as any)
        .from("roadmap_requests")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", user.id)
        .eq("status", "pending"),
    ]);
    setSharedCount((sharedPending ?? 0) + (requestsPending ?? 0));

    setLoading(false);
  };

  useEffect(() => { fetchRoadmaps(); }, [user]);

  const handleArchive = async (id: string) => {
    await supabase.from("roadmaps").update({ status: "archived" }).eq("id", id);
    setArchiveConfirmId(null);
    fetchRoadmaps();
  };

  const handleUnarchive = async (id: string) => {
    await supabase.from("roadmaps").update({ status: "active" }).eq("id", id);
    setUnarchiveConfirmId(null);
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

  const displayRoadmaps = showArchived ? archivedRoadmaps : roadmaps;

  return (
    <>
      <AppBar />
      <WavyBackground />
      <div className="min-h-screen pt-20 pb-10 px-4 md:px-12 max-w-5xl mx-auto animate-fade-in">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/home")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h2 className="font-heading text-2xl md:text-3xl font-bold">
              {showArchived ? "Archived Roadmaps" : "My Roadmaps"}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => navigate("/shared-with-me")}
              className="border-border font-heading font-bold relative"
            >
              <Share2 className="mr-2 h-4 w-4" />
              Shared Roadmaps
              {sharedCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-warning text-warning-foreground text-xs font-bold flex items-center justify-center">
                  {sharedCount}
                </span>
              )}
            </Button>
            {archivedRoadmaps.length > 0 && (
              <Button
                variant={showArchived ? "default" : "outline"}
                onClick={() => setShowArchived(!showArchived)}
                className={showArchived ? "gradient-primary text-primary-foreground font-heading font-bold" : "border-border font-heading font-bold"}
              >
                <Archive className="mr-2 h-4 w-4" />
                {showArchived ? "Active" : "Archived"}
              </Button>
            )}
            {!showArchived && roadmaps.length < 10 && (
              <Button
                onClick={() => navigate("/new")}
                className="gradient-primary text-primary-foreground font-heading font-bold"
              >
                <Plus className="mr-2 h-4 w-4" /> New Roadmap
              </Button>
            )}
          </div>
        </div>

        {displayRoadmaps.length === 0 ? (
          <div className="glass-strong p-8 text-center">
            <p className="text-muted-foreground mb-4">
              {showArchived ? "You don't have any archived roadmaps." : "You don't have any active roadmaps yet."}
            </p>
            {!showArchived && (
              <Button onClick={() => navigate("/new")} className="gradient-primary text-primary-foreground font-heading font-bold">
                <Plus className="mr-2 h-4 w-4" /> Create Your First Roadmap
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {displayRoadmaps.map((rm) => {
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
                    <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden">
                      <div className="h-full gradient-primary rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{completed} of {total} modules completed</p>
                  </div>

                  <div className="flex gap-2">
                    {showArchived ? (
                      <>
                        <Button
                          onClick={() => navigate(`/dashboard/${rm.id}`)}
                          variant="outline"
                          className="flex-1 border-border font-heading font-bold"
                        >
                          View <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setUnarchiveConfirmId(rm.id)}
                          className="border-border hover:bg-primary/10 hover:text-primary"
                        >
                          Restore
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          onClick={() => navigate(`/dashboard/${rm.id}`)}
                          className="flex-1 gradient-primary text-primary-foreground font-heading font-bold"
                        >
                          Continue <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setArchiveConfirmId(rm.id)}
                          className="border-border hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Archive className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!showArchived && roadmaps.length >= 10 && (
          <p className="text-sm text-muted-foreground text-center mt-4">
            You've reached the maximum of 10 active roadmaps. Archive one to create a new one.
          </p>
        )}
      </div>

      <Dialog open={!!archiveConfirmId} onOpenChange={() => setArchiveConfirmId(null)}>
        <DialogContent className="glass-strong border-border">
          <DialogHeader>
            <DialogTitle className="font-heading">Archive this roadmap?</DialogTitle>
            <DialogDescription>
              You can still access it from the Archived section and restore it anytime.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setArchiveConfirmId(null)} className="border-border">
              Cancel
            </Button>
            <Button onClick={() => archiveConfirmId && handleArchive(archiveConfirmId)} className="gradient-primary text-primary-foreground font-heading font-bold">
              Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!unarchiveConfirmId} onOpenChange={() => setUnarchiveConfirmId(null)}>
        <DialogContent className="glass-strong border-border">
          <DialogHeader>
            <DialogTitle className="font-heading">Restore this roadmap?</DialogTitle>
            <DialogDescription>
              This will move the roadmap back to your active list.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setUnarchiveConfirmId(null)} className="border-border">
              Cancel
            </Button>
            <Button onClick={() => unarchiveConfirmId && handleUnarchive(unarchiveConfirmId)} className="gradient-primary text-primary-foreground font-heading font-bold">
              Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
