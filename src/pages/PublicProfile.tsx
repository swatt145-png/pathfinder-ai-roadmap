import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppBar } from "@/components/AppBar";
import WavyBackground from "@/components/WavyBackground";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  UserPlus,
  UserCheck,
  Clock,
  Check,
  MapPin,
  Globe,
  Star,
  BookOpen,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { RoadmapData } from "@/lib/types";

interface ProfileData {
  id: string;
  display_name: string | null;
  bio: string | null;
  location: string | null;
  website: string | null;
}

interface RoadmapRow {
  id: string;
  topic: string;
  skill_level: string;
  timeline_weeks: number;
  hours_per_day: number;
  roadmap_data: unknown;
}

interface ConnectionRow {
  id: string;
  requester_id: string;
  receiver_id: string;
  status: string;
}

export default function PublicProfile() {
  const { userId } = useParams<{ userId: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [roadmaps, setRoadmaps] = useState<RoadmapRow[]>([]);
  const [points, setPoints] = useState(0);
  const [connectionCount, setConnectionCount] = useState(0);
  const [connection, setConnection] = useState<ConnectionRow | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    if (!userId || !user) return;

    const [
      { data: profileData },
      { data: roadmapData },
      { data: pointsData },
      { data: connectionData },
    ] = await Promise.all([
      supabase.from("profiles").select("id, display_name, bio, location, website").eq("id", userId).single(),
      supabase
        .from("roadmaps")
        .select("id, topic, skill_level, timeline_weeks, hours_per_day, roadmap_data")
        .eq("user_id", userId)
        .eq("status", "active"),
      (supabase as any).rpc("calculate_user_points", { p_user_id: userId }),
      (supabase as any)
        .from("connections")
        .select("id, requester_id, receiver_id, status")
        .or(
          `and(requester_id.eq.${userId},receiver_id.eq.${user.id}),and(requester_id.eq.${user.id},receiver_id.eq.${userId})`
        ),
    ]);

    setProfile(profileData as ProfileData | null);
    setRoadmaps((roadmapData as RoadmapRow[]) ?? []);
    setPoints((pointsData as number) ?? 0);

    // Find connection between current user and profile user
    const conn = (connectionData as ConnectionRow[] | null)?.[0] ?? null;
    setConnection(conn);

    // Count accepted connections for this user
    const { count } = await (supabase as any)
      .from("connections")
      .select("id", { count: "exact", head: true })
      .eq("status", "accepted")
      .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`);
    setConnectionCount(count ?? 0);

    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [userId, user]);

  const getConnectionStatus = (): "none" | "pending_sent" | "pending_received" | "accepted" => {
    if (!connection || !user) return "none";
    if (connection.status === "accepted") return "accepted";
    if (connection.status === "pending" && connection.requester_id === user.id)
      return "pending_sent";
    if (connection.status === "pending" && connection.receiver_id === user.id)
      return "pending_received";
    return "none";
  };

  const handleConnect = async () => {
    if (!user || !userId) return;
    const { error } = await (supabase as any).from("connections").insert({
      requester_id: user.id,
      receiver_id: userId,
    });
    if (error) {
      toast({ title: "Error", description: "Could not send request.", variant: "destructive" });
      return;
    }
    toast({ title: "Connection request sent!" });
    fetchData();
  };

  const handleAccept = async () => {
    if (!connection) return;
    await (supabase as any).from("connections").update({ status: "accepted" }).eq("id", connection.id);
    toast({ title: "Connection accepted!" });
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

  if (!profile) {
    return (
      <>
        <AppBar />
        <WavyBackground />
        <div className="min-h-screen pt-20 pb-10 px-4 md:px-12 max-w-3xl mx-auto">
          <div className="glass-strong p-8 text-center">
            <p className="text-muted-foreground">User not found.</p>
          </div>
        </div>
      </>
    );
  }

  const initial = (profile.display_name?.[0] ?? "U").toUpperCase();
  const status = getConnectionStatus();

  return (
    <>
      <AppBar />
      <WavyBackground />
      <div className="min-h-screen pt-20 pb-10 px-4 md:px-12 max-w-3xl mx-auto animate-fade-in">
        {/* Profile header */}
        <div className="glass-strong p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-full gradient-primary flex items-center justify-center text-2xl font-heading font-bold text-primary-foreground shrink-0">
              {initial}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-heading text-2xl font-bold">
                {profile.display_name || "User"}
              </h2>
              {profile.bio && (
                <p className="text-muted-foreground mt-1">{profile.bio}</p>
              )}
              <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-muted-foreground">
                {profile.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" /> {profile.location}
                  </span>
                )}
                {profile.website && (
                  <a
                    href={profile.website.startsWith("http") ? profile.website : `https://${profile.website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-primary hover:underline"
                  >
                    <Globe className="h-3.5 w-3.5" /> Website
                  </a>
                )}
                <span className="flex items-center gap-1 font-heading font-bold text-warning">
                  <Star className="h-3.5 w-3.5" /> {points} pts
                </span>
                <span className="flex items-center gap-1">
                  <UserCheck className="h-3.5 w-3.5" /> {connectionCount} connections
                </span>
              </div>
            </div>
          </div>

          {/* Connection button */}
          {userId !== user?.id && (
            <div className="mt-4">
              {status === "none" && (
                <Button
                  onClick={handleConnect}
                  className="gradient-primary text-primary-foreground font-heading font-bold"
                >
                  <UserPlus className="mr-2 h-4 w-4" /> Connect
                </Button>
              )}
              {status === "pending_sent" && (
                <Button disabled className="font-heading font-bold opacity-60">
                  <Clock className="mr-2 h-4 w-4" /> Pending
                </Button>
              )}
              {status === "pending_received" && (
                <Button
                  onClick={handleAccept}
                  className="gradient-primary text-primary-foreground font-heading font-bold"
                >
                  <Check className="mr-2 h-4 w-4" /> Accept Connection
                </Button>
              )}
              {status === "accepted" && (
                <Button
                  disabled
                  className="font-heading font-bold bg-success/20 text-success"
                >
                  <UserCheck className="mr-2 h-4 w-4" /> Connected
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Roadmaps */}
        <div className="flex items-center gap-2 mb-4">
          <BookOpen className="h-5 w-5 text-primary" />
          <h3 className="font-heading text-lg font-bold">Learning Roadmaps</h3>
        </div>

        {roadmaps.length === 0 ? (
          <div className="glass-strong p-6 text-center">
            <p className="text-muted-foreground">No roadmaps yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {roadmaps.map((rm) => {
              const rd = rm.roadmap_data as unknown as RoadmapData;
              const moduleCount = rd?.modules?.length ?? 0;
              return (
                <div key={rm.id} className="glass-blue p-4">
                  <h4 className="font-heading font-bold text-base">{rm.topic}</h4>
                  <p className="text-sm text-muted-foreground">
                    {rm.skill_level} · {rm.timeline_weeks} weeks · {rm.hours_per_day}h/day · {moduleCount} modules
                  </p>
                  {rd?.summary && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                      {rd.summary}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
