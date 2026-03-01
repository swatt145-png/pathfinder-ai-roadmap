import { useEffect, useState } from "react";
import WavyBackground from "@/components/WavyBackground";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppBar } from "@/components/AppBar";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, Share2, Check, X, Send, Bell } from "lucide-react";
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

interface RoadmapRequestRow {
  id: string;
  requester_id: string;
  roadmap_id: string;
  status: string;
  created_at: string;
  requesterName: string;
  roadmap: RoadmapRow | null;
}

export default function SharedWithMe() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [pendingShares, setPendingShares] = useState<SharedRoadmapRow[]>([]);
  const [acceptedShares, setAcceptedShares] = useState<SharedRoadmapRow[]>([]);
  const [pendingRequests, setPendingRequests] = useState<RoadmapRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  const fetchData = async () => {
    if (!user) return;

    // Fetch shared roadmaps (where I'm the receiver)
    const { data: sharedData } = await (supabase as any)
      .from("shared_roadmaps")
      .select("id, sender_id, roadmap_id, status, created_at")
      .eq("receiver_id", user.id)
      .in("status", ["pending", "accepted"])
      .order("created_at", { ascending: false });

    // Fetch roadmap requests (where I'm the owner and someone requested my roadmap)
    const { data: requestData } = await (supabase as any)
      .from("roadmap_requests")
      .select("id, requester_id, roadmap_id, status, created_at")
      .eq("owner_id", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    // Collect all user IDs and roadmap IDs we need to look up
    const userIds = new Set<string>();
    const roadmapIds = new Set<string>();

    for (const s of sharedData ?? []) {
      userIds.add(s.sender_id);
      roadmapIds.add(s.roadmap_id);
    }
    for (const r of requestData ?? []) {
      userIds.add(r.requester_id);
      roadmapIds.add(r.roadmap_id);
    }

    let profileMap: Record<string, string> = {};
    let roadmapMap: Record<string, RoadmapRow> = {};

    if (userIds.size > 0 || roadmapIds.size > 0) {
      const [{ data: profiles }, { data: roadmaps }] = await Promise.all([
        userIds.size > 0
          ? supabase.from("profiles").select("id, display_name").in("id", Array.from(userIds))
          : { data: [] },
        roadmapIds.size > 0
          ? supabase
              .from("roadmaps")
              .select("id, topic, skill_level, timeline_weeks, hours_per_day, status, created_at, completed_modules, total_modules, current_streak, roadmap_data")
              .in("id", Array.from(roadmapIds))
          : { data: [] },
      ]);

      for (const p of profiles ?? []) profileMap[p.id] = p.display_name ?? "User";
      for (const r of (roadmaps as RoadmapRow[]) ?? []) roadmapMap[r.id] = r;
    }

    // Build shared roadmap rows
    if (sharedData && sharedData.length > 0) {
      const enriched: SharedRoadmapRow[] = sharedData.map((s: any) => ({
        ...s,
        senderName: profileMap[s.sender_id] ?? "User",
        roadmap: roadmapMap[s.roadmap_id] ?? null,
      }));
      setPendingShares(enriched.filter((s) => s.status === "pending"));
      setAcceptedShares(enriched.filter((s) => s.status === "accepted"));
    } else {
      setPendingShares([]);
      setAcceptedShares([]);
    }

    // Build roadmap request rows
    if (requestData && requestData.length > 0) {
      const enrichedRequests: RoadmapRequestRow[] = requestData.map((r: any) => ({
        ...r,
        requesterName: profileMap[r.requester_id] ?? "User",
        roadmap: roadmapMap[r.roadmap_id] ?? null,
      }));
      setPendingRequests(enrichedRequests);
    } else {
      setPendingRequests([]);
    }

    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [user]);

  const handleAcceptShare = async (shared: SharedRoadmapRow) => {
    if (!user || !shared.roadmap) return;
    setAcceptingId(shared.id);

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

    await (supabase as any).from("shared_roadmaps").update({ status: "accepted" }).eq("id", shared.id);
    toast({ title: "Roadmap accepted! It's now in your active roadmaps." });
    setAcceptingId(null);
    fetchData();
  };

  const handleRejectShare = async (sharedId: string) => {
    await (supabase as any).from("shared_roadmaps").update({ status: "rejected" }).eq("id", sharedId);
    toast({ title: "Shared roadmap rejected." });
    fetchData();
  };

  const handleShareToRequester = async (request: RoadmapRequestRow) => {
    if (!user) return;
    setAcceptingId(request.id);

    // Share the roadmap with the requester
    const { error } = await (supabase as any).from("shared_roadmaps").insert({
      sender_id: user.id,
      receiver_id: request.requester_id,
      roadmap_id: request.roadmap_id,
      status: "pending",
    });

    if (!error) {
      await (supabase as any).from("roadmap_requests").update({ status: "accepted" }).eq("id", request.id);
      toast({ title: `Roadmap shared with ${request.requesterName}!` });
    } else {
      toast({ title: "Error", description: "Could not share roadmap.", variant: "destructive" });
    }
    setAcceptingId(null);
    fetchData();
  };

  const handleDeclineRequest = async (requestId: string) => {
    await (supabase as any).from("roadmap_requests").update({ status: "rejected" }).eq("id", requestId);
    toast({ title: "Request declined." });
    fetchData();
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

  const renderSharedCard = (shared: SharedRoadmapRow, showActions: boolean) => {
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
        {showActions && (
          <div className="flex gap-2 mt-3">
            <Button
              onClick={() => handleAcceptShare(shared)}
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
              onClick={() => handleRejectShare(shared.id)}
              variant="outline"
              className="border-border hover:bg-destructive/10 hover:text-destructive"
              size="sm"
            >
              <X className="mr-1.5 h-3.5 w-3.5" /> Reject
            </Button>
          </div>
        )}
        {!showActions && (
          <p className="text-xs text-success font-heading font-bold mt-2">Accepted — added to your roadmaps</p>
        )}
      </div>
    );
  };

  const hasNothing = pendingShares.length === 0 && acceptedShares.length === 0 && pendingRequests.length === 0;

  return (
    <>
      <AppBar />
      <WavyBackground />
      <div className="min-h-screen pt-20 pb-10 px-4 md:px-12 max-w-5xl mx-auto animate-fade-in">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate("/my-roadmaps")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <Share2 className="h-6 w-6 text-primary" />
          <h2 className="font-heading text-2xl md:text-3xl font-bold">Shared Roadmaps</h2>
        </div>

        {/* Roadmap Requests (someone requested your roadmap) */}
        {pendingRequests.length > 0 && (
          <div className="mb-8">
            <h3 className="font-heading text-lg font-bold mb-3 flex items-center gap-2">
              <Bell className="h-5 w-5 text-warning" />
              Roadmap Requests
              <span className="text-xs font-heading font-bold px-2 py-0.5 rounded-full bg-warning/20 text-warning">
                {pendingRequests.length}
              </span>
            </h3>
            <div className="space-y-3">
              {pendingRequests.map((req) => {
                const rm = req.roadmap;
                if (!rm) return null;
                const rd = rm.roadmap_data as unknown as RoadmapData;
                const moduleCount = rd?.modules?.length ?? 0;

                return (
                  <div key={req.id} className="glass-blue p-5 border-l-4 border-warning/60">
                    <p className="text-xs text-muted-foreground mb-2">
                      <span className="font-heading font-bold text-foreground">{req.requesterName}</span> requested your roadmap
                    </p>
                    <h4 className="font-heading font-bold text-lg">{rm.topic}</h4>
                    <p className="text-sm text-muted-foreground">
                      {rm.skill_level} · {rm.timeline_weeks} weeks · {rm.hours_per_day}h/day · {moduleCount} modules
                    </p>
                    <div className="flex gap-2 mt-3">
                      <Button
                        onClick={() => handleShareToRequester(req)}
                        disabled={acceptingId === req.id}
                        className="flex-1 gradient-primary text-primary-foreground font-heading font-bold"
                        size="sm"
                      >
                        {acceptingId === req.id ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Share
                      </Button>
                      <Button
                        onClick={() => handleDeclineRequest(req.id)}
                        variant="outline"
                        className="border-border hover:bg-destructive/10 hover:text-destructive"
                        size="sm"
                      >
                        <X className="mr-1.5 h-3.5 w-3.5" /> Decline
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Pending shared roadmaps (someone shared with you) */}
        {pendingShares.length > 0 && (
          <div className="mb-8">
            <h3 className="font-heading text-lg font-bold mb-3 flex items-center gap-2">
              Shared with You
              <span className="text-xs font-heading font-bold px-2 py-0.5 rounded-full bg-warning/20 text-warning">
                {pendingShares.length}
              </span>
            </h3>
            <div className="space-y-3">
              {pendingShares.map((s) => renderSharedCard(s, true))}
            </div>
          </div>
        )}

        {/* Accepted history */}
        {acceptedShares.length > 0 && (
          <div className="mb-8">
            <h3 className="font-heading text-lg font-bold mb-3">Previously Accepted</h3>
            <div className="space-y-3">
              {acceptedShares.map((s) => renderSharedCard(s, false))}
            </div>
          </div>
        )}

        {hasNothing && (
          <div className="glass-strong p-8 text-center">
            <p className="text-muted-foreground">
              No shared roadmaps or requests yet. Connect with other learners to share and request roadmaps!
            </p>
          </div>
        )}
      </div>
    </>
  );
}
