import { useEffect, useState } from "react";
import WavyBackground from "@/components/WavyBackground";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppBar } from "@/components/AppBar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, ArrowRight, Archive, ArrowLeft, Share2, Check, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
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

interface SharedRoadmapRow {
  id: string;
  sender_id: string;
  roadmap_id: string;
  status: string;
  created_at: string;
  senderName: string;
  roadmap: RoadmapRow | null;
}

export default function MyRoadmaps() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [roadmaps, setRoadmaps] = useState<RoadmapRow[]>([]);
  const [archivedRoadmaps, setArchivedRoadmaps] = useState<RoadmapRow[]>([]);
  const [sharedRoadmaps, setSharedRoadmaps] = useState<SharedRoadmapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [unarchiveConfirmId, setUnarchiveConfirmId] = useState<string | null>(null);
  const [archiveConfirmId, setArchiveConfirmId] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

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

    // Fetch shared roadmaps pending for this user
    const { data: sharedData } = await supabase
      .from("shared_roadmaps")
      .select("id, sender_id, roadmap_id, status, created_at")
      .eq("receiver_id", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (sharedData && sharedData.length > 0) {
      // Fetch sender profiles and roadmap data
      const senderIds = [...new Set(sharedData.map((s) => s.sender_id))];
      const roadmapIds = [...new Set(sharedData.map((s) => s.roadmap_id))];

      const [{ data: senders }, { data: roadmapDetails }] = await Promise.all([
        supabase.from("profiles").select("id, display_name").in("id", senderIds),
        supabase
          .from("roadmaps")
          .select("id, topic, skill_level, timeline_weeks, hours_per_day, status, created_at, completed_modules, total_modules, current_streak, roadmap_data")
          .in("id", roadmapIds),
      ]);

      const senderMap: Record<string, string> = {};
      for (const s of senders ?? []) senderMap[s.id] = s.display_name ?? "User";

      const roadmapMap: Record<string, RoadmapRow> = {};
      for (const r of (roadmapDetails as RoadmapRow[]) ?? []) roadmapMap[r.id] = r;

      setSharedRoadmaps(
        sharedData.map((s) => ({
          ...s,
          senderName: senderMap[s.sender_id] ?? "User",
          roadmap: roadmapMap[s.roadmap_id] ?? null,
        }))
      );
    } else {
      setSharedRoadmaps([]);
    }

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

  const handleAcceptShared = async (shared: SharedRoadmapRow) => {
    if (!user || !shared.roadmap) return;
    setAcceptingId(shared.id);

    // Fetch the full roadmap data
    const { data: fullRoadmap } = await supabase
      .from("roadmaps")
      .select("*")
      .eq("id", shared.roadmap_id)
      .single();

    if (!fullRoadmap) {
      toast({ title: "Error", description: "Original roadmap not found.", variant: "destructive" });
      setAcceptingId(null);
      return;
    }

    // Clone into receiver's roadmaps with zero progress
    const { error: insertError } = await supabase.from("roadmaps").insert({
      user_id: user.id,
      topic: fullRoadmap.topic,
      skill_level: fullRoadmap.skill_level,
      timeline_weeks: fullRoadmap.timeline_weeks,
      hours_per_day: fullRoadmap.hours_per_day,
      hard_deadline: fullRoadmap.hard_deadline,
      deadline_date: fullRoadmap.deadline_date,
      roadmap_data: fullRoadmap.roadmap_data,
      original_roadmap_data: fullRoadmap.original_roadmap_data,
      learning_goal: fullRoadmap.learning_goal,
      status: "active",
      completed_modules: 0,
      total_modules: fullRoadmap.total_modules,
      current_streak: 0,
    });

    if (insertError) {
      toast({ title: "Error", description: "Could not accept roadmap.", variant: "destructive" });
      setAcceptingId(null);
      return;
    }

    // Update shared_roadmaps status
    await supabase.from("shared_roadmaps").update({ status: "accepted" }).eq("id", shared.id);

    toast({ title: "Roadmap accepted! It's now in your active roadmaps." });
    setAcceptingId(null);
    fetchRoadmaps();
  };

  const handleRejectShared = async (sharedId: string) => {
    await supabase.from("shared_roadmaps").update({ status: "rejected" }).eq("id", sharedId);
    toast({ title: "Shared roadmap rejected." });
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

        {/* Shared with me section */}
        {!showArchived && sharedRoadmaps.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <Share2 className="h-5 w-5 text-primary" />
              <h3 className="font-heading text-lg font-bold">Shared with You</h3>
            </div>
            <div className="space-y-3">
              {sharedRoadmaps.map((shared) => {
                const rm = shared.roadmap;
                if (!rm) return null;
                const rd = rm.roadmap_data as unknown as RoadmapData;
                const moduleCount = rd?.modules?.length ?? 0;

                return (
                  <div key={shared.id} className="glass-blue p-5 border-l-4 border-primary/60">
                    <p className="text-xs text-muted-foreground mb-2">
                      Shared by <span className="font-heading font-bold text-foreground">{shared.senderName}</span>
                    </p>
                    <h4 className="font-heading font-bold text-lg">{rm.topic}</h4>
                    <p className="text-sm text-muted-foreground">
                      {rm.skill_level} · {rm.timeline_weeks} weeks · {rm.hours_per_day}h/day · {moduleCount} modules
                    </p>
                    {rd?.summary && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{rd.summary}</p>
                    )}
                    {rd?.modules && rd.modules.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {rd.modules.slice(0, 5).map((mod) => (
                          <span key={mod.id} className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-heading">
                            {mod.title}
                          </span>
                        ))}
                        {rd.modules.length > 5 && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-muted/50 text-muted-foreground font-heading">
                            +{rd.modules.length - 5} more
                          </span>
                        )}
                      </div>
                    )}
                    <div className="flex gap-2 mt-3">
                      <Button
                        onClick={() => handleAcceptShared(shared)}
                        disabled={acceptingId === shared.id}
                        className="flex-1 gradient-primary text-primary-foreground font-heading font-bold"
                        size="sm"
                      >
                        {acceptingId === shared.id ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Accept
                      </Button>
                      <Button
                        onClick={() => handleRejectShared(shared.id)}
                        variant="outline"
                        className="border-border hover:bg-destructive/10 hover:text-destructive"
                        size="sm"
                      >
                        <X className="mr-1.5 h-3.5 w-3.5" /> Reject
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

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
