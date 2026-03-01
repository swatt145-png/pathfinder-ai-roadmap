import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppBar } from "@/components/AppBar";
import WavyBackground from "@/components/WavyBackground";
import { UserCard } from "@/components/community/UserCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Search, Users, UserCheck, Bell, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";

interface ProfileRow {
  id: string;
  display_name: string | null;
  bio: string | null;
}

interface ConnectionRow {
  id: string;
  requester_id: string;
  receiver_id: string;
  status: string;
}

export default function Community() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [userTopics, setUserTopics] = useState<Record<string, string[]>>({});
  const [userPoints, setUserPoints] = useState<Record<string, number>>({});
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    if (!user) return;

    const [{ data: profileData }, { data: roadmapData }, { data: connectionData }] =
      await Promise.all([
        supabase.from("profiles").select("id, display_name, bio"),
        supabase.from("roadmaps").select("user_id, topic"),
        (supabase as any).from("connections").select("id, requester_id, receiver_id, status"),
      ]);

    // Filter out self and guest accounts (no display name set or default "User" with no activity)
    const roadmapOwners = new Set((roadmapData ?? []).map((r: any) => r.user_id));
    const otherProfiles = (profileData ?? []).filter((p) => {
      if (p.id === user.id) return false;
      // Keep users who have a real name (not default "User") OR have at least one roadmap
      const hasRealName = p.display_name && p.display_name !== "User";
      const hasRoadmaps = roadmapOwners.has(p.id);
      return hasRealName || hasRoadmaps;
    });
    setProfiles(otherProfiles);

    // Group topics by user
    const topics: Record<string, string[]> = {};
    for (const rm of roadmapData ?? []) {
      if (!topics[rm.user_id]) topics[rm.user_id] = [];
      if (!topics[rm.user_id].includes(rm.topic)) {
        topics[rm.user_id].push(rm.topic);
      }
    }
    setUserTopics(topics);

    setConnections((connectionData ?? []) as ConnectionRow[]);

    // Fetch points for each user
    const points: Record<string, number> = {};
    await Promise.all(
      otherProfiles.map(async (p) => {
        const { data } = await (supabase as any).rpc("calculate_user_points", {
          p_user_id: p.id,
        });
        points[p.id] = (data as number) ?? 0;
      })
    );
    setUserPoints(points);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [user]);

  const getConnectionStatus = (
    userId: string
  ): "none" | "pending_sent" | "pending_received" | "accepted" => {
    if (!user) return "none";
    const conn = connections.find(
      (c) =>
        (c.requester_id === user.id && c.receiver_id === userId) ||
        (c.requester_id === userId && c.receiver_id === user.id)
    );
    if (!conn) return "none";
    if (conn.status === "accepted") return "accepted";
    if (conn.status === "pending" && conn.requester_id === user.id)
      return "pending_sent";
    if (conn.status === "pending" && conn.receiver_id === user.id)
      return "pending_received";
    return "none";
  };

  const handleConnect = async (receiverId: string) => {
    if (!user) return;
    const { error } = await (supabase as any).from("connections").insert({
      requester_id: user.id,
      receiver_id: receiverId,
    });
    if (error) {
      toast({
        title: "Error",
        description: "Could not send connection request.",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Connection request sent!" });
    fetchData();
  };

  const handleAccept = async (requesterId: string) => {
    if (!user) return;
    const conn = connections.find(
      (c) => c.requester_id === requesterId && c.receiver_id === user.id
    );
    if (!conn) return;
    await (supabase as any)
      .from("connections")
      .update({ status: "accepted" })
      .eq("id", conn.id);
    toast({ title: "Connection accepted!" });
    fetchData();
  };

  // Split profiles into sections
  const { pendingRequests, friends, otherLearners } = useMemo(() => {
    const pending: ProfileRow[] = [];
    const connected: ProfileRow[] = [];
    const others: ProfileRow[] = [];

    const searchProfiles = search.trim()
      ? profiles.filter((p) => {
          const q = search.toLowerCase();
          const topics = userTopics[p.id] ?? [];
          return (
            p.display_name?.toLowerCase().includes(q) ||
            topics.some((t) => t.toLowerCase().includes(q))
          );
        })
      : profiles;

    for (const p of searchProfiles) {
      const status = getConnectionStatus(p.id);
      if (status === "pending_received") pending.push(p);
      else if (status === "accepted") connected.push(p);
      else others.push(p);
    }

    return { pendingRequests: pending, friends: connected, otherLearners: others };
  }, [profiles, search, userTopics, connections, user]);

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

  const renderUserCard = (p: ProfileRow) => (
    <UserCard
      key={p.id}
      userId={p.id}
      displayName={p.display_name ?? "User"}
      bio={p.bio}
      topics={userTopics[p.id] ?? []}
      points={userPoints[p.id] ?? 0}
      connectionStatus={getConnectionStatus(p.id)}
      onConnect={handleConnect}
      onAccept={handleAccept}
    />
  );

  const hasNoResults = pendingRequests.length === 0 && friends.length === 0 && otherLearners.length === 0;

  return (
    <>
      <AppBar />
      <WavyBackground />
      <div className="min-h-screen pt-20 pb-10 px-4 md:px-12 max-w-5xl mx-auto animate-fade-in">
        <div className="flex items-center gap-3 mb-6">
          <Users className="h-7 w-7 text-primary" />
          <h2 className="font-heading text-2xl md:text-3xl font-bold">
            Community
          </h2>
        </div>

        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or topic..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 glass-strong border-border font-heading"
          />
        </div>

        {/* Pending Connection Requests */}
        {pendingRequests.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <Bell className="h-5 w-5 text-warning" />
              <h3 className="font-heading text-lg font-bold">
                Connection Requests
              </h3>
              <span className="text-xs font-heading font-bold px-2 py-0.5 rounded-full bg-warning/20 text-warning">
                {pendingRequests.length}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {pendingRequests.map(renderUserCard)}
            </div>
          </div>
        )}

        {/* My Connections / Friends */}
        {friends.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <UserCheck className="h-5 w-5 text-success" />
              <h3 className="font-heading text-lg font-bold">
                My Connections
              </h3>
              <span className="text-xs font-heading font-bold px-2 py-0.5 rounded-full bg-success/20 text-success">
                {friends.length}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {friends.map(renderUserCard)}
            </div>
          </div>
        )}

        {/* Find Other Learners */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-5 w-5 text-primary" />
            <h3 className="font-heading text-lg font-bold">
              Find Other Learners
            </h3>
          </div>
          {otherLearners.length === 0 ? (
            <div className="glass-strong p-8 text-center">
              <p className="text-muted-foreground">
                {search
                  ? "No users found matching your search."
                  : hasNoResults
                    ? "No other users yet. Be the first to invite friends!"
                    : "You've connected with everyone! Search for more users by topic."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {otherLearners.map(renderUserCard)}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
