import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppBar } from "@/components/AppBar";
import WavyBackground from "@/components/WavyBackground";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, ArrowLeft, Users, Copy, Check, LogIn } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { getGroupLabels, type GroupType } from "@/lib/groupLabels";
import CreateGroupModal from "@/components/CreateGroupModal";
import JoinGroupModal from "@/components/JoinGroupModal";

interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  type: string;
  invite_code: string;
  is_active: boolean;
  created_at: string;
}

interface MemberGroupRow {
  id: string;
  group_id: string;
  joined_at: string;
  group: GroupRow & { owner_id: string };
}

interface EnrichedMemberGroup extends MemberGroupRow {
  ownerName: string;
  roadmapCount: number;
  memberCount: number;
  topics: string[];
}

export default function MyGroups() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [ownedGroups, setOwnedGroups] = useState<(GroupRow & { memberCount: number; roadmapCount: number; topics: string[] })[]>([]);
  const [memberGroups, setMemberGroups] = useState<EnrichedMemberGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const fetchGroups = async () => {
    if (!user) return;

    // Fetch owned groups
    const { data: owned } = await (supabase as any)
      .from("groups")
      .select("*")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false });

    const ownedWithCounts: typeof ownedGroups = [];
    for (const g of owned ?? []) {
      const [{ count: mc }, { count: rc }, { data: grRows }] = await Promise.all([
        (supabase as any).from("group_members").select("id", { count: "exact", head: true }).eq("group_id", g.id),
        (supabase as any).from("group_roadmaps").select("id", { count: "exact", head: true }).eq("group_id", g.id),
        (supabase as any).from("group_roadmaps").select("roadmap_id").eq("group_id", g.id),
      ]);
      const topics: string[] = [];
      for (const gr of grRows ?? []) {
        const { data: rm } = await supabase.from("roadmaps").select("topic").eq("id", gr.roadmap_id).single();
        if (rm?.topic) topics.push(rm.topic);
      }
      ownedWithCounts.push({ ...g, memberCount: mc ?? 0, roadmapCount: rc ?? 0, topics });
    }
    setOwnedGroups(ownedWithCounts);

    // Fetch groups user is a member of (not owner)
    const { data: memberships } = await (supabase as any)
      .from("group_members")
      .select("id, group_id, joined_at")
      .eq("user_id", user.id);

    const memberWithDetails: EnrichedMemberGroup[] = [];
    for (const m of memberships ?? []) {
      const { data: g } = await (supabase as any)
        .from("groups")
        .select("*")
        .eq("id", m.group_id)
        .single();

      if (!g || g.owner_id === user.id) continue;

      const [{ data: ownerProfile }, { count: mc }] = await Promise.all([
        supabase.from("profiles").select("display_name").eq("id", g.owner_id).single(),
        (supabase as any).from("group_members").select("id", { count: "exact", head: true }).eq("group_id", g.id),
      ]);

      // Get only roadmaps assigned to this member (not total group roadmaps)
      const { data: grRows } = await (supabase as any)
        .from("group_roadmaps")
        .select("id, roadmap_id")
        .eq("group_id", g.id);

      let assignedCount = 0;
      const topics: string[] = [];
      for (const gr of grRows ?? []) {
        const { data: mgr } = await (supabase as any)
          .from("member_group_roadmaps")
          .select("roadmap_id")
          .eq("group_roadmap_id", gr.id)
          .eq("member_id", user.id)
          .maybeSingle();
        if (mgr) {
          assignedCount++;
          const { data: rm } = await supabase.from("roadmaps").select("topic").eq("id", mgr.roadmap_id).single();
          if (rm?.topic) topics.push(rm.topic);
        }
      }

      memberWithDetails.push({
        ...m,
        group: g,
        ownerName: ownerProfile?.display_name ?? "Unknown",
        roadmapCount: assignedCount,
        memberCount: mc ?? 0,
        topics,
      });
    }
    setMemberGroups(memberWithDetails);
    setLoading(false);
  };

  useEffect(() => { fetchGroups(); }, [user]);

  const handleCopyCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedCode(code);
    toast({ title: "Invite code copied!" });
    setTimeout(() => setCopiedCode(null), 2000);
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
      <WavyBackground />
      <div className="min-h-screen pt-20 pb-10 px-4 md:px-12 max-w-5xl mx-auto animate-fade-in">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/home")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h2 className="font-heading text-2xl md:text-3xl font-bold">My Groups</h2>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setShowJoin(true)}
              className="border-border font-heading font-bold"
            >
              <LogIn className="mr-2 h-4 w-4" /> Join Group
            </Button>
            <Button
              onClick={() => setShowCreate(true)}
              className="gradient-primary text-primary-foreground font-heading font-bold"
            >
              <Plus className="mr-2 h-4 w-4" /> Create Group
            </Button>
          </div>
        </div>

        {/* Owned Groups */}
        {ownedGroups.length > 0 && (
          <div className="mb-8">
            <h3 className="font-heading text-lg font-semibold mb-3 text-muted-foreground">Groups I Own</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {ownedGroups.map((g) => {
                const labels = getGroupLabels(g.type as GroupType);
                return (
                  <div key={g.id} className="glass-blue p-5 cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all" onClick={() => navigate(`/group/${g.id}`)}>
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h4 className="font-heading font-bold text-lg">{g.name}</h4>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary font-heading">
                          {labels.group}
                        </span>
                      </div>
                      {!g.is_active && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/20 text-destructive font-heading">Inactive</span>
                      )}
                    </div>
                    {g.description && <p className="text-sm text-muted-foreground mb-2 line-clamp-2">{g.description}</p>}
                    {g.topics.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-3">
                        {g.topics.slice(0, 3).map((t, i) => (
                          <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/40 text-muted-foreground font-heading">{t.length > 25 ? t.slice(0, 25) + "…" : t}</span>
                        ))}
                        {g.topics.length > 3 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/40 text-muted-foreground">+{g.topics.length - 3}</span>}
                      </div>
                    )}
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {g.memberCount} {labels.members.toLowerCase()}</span>
                        <span>{g.roadmapCount} roadmap{g.roadmapCount !== 1 ? "s" : ""}</span>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleCopyCode(g.invite_code); }}
                        className="flex items-center gap-1 text-xs font-mono hover:text-primary transition-colors"
                      >
                        {copiedCode === g.invite_code ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        {g.invite_code}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Member Groups */}
        {memberGroups.length > 0 && (
          <div className="mb-8">
            <h3 className="font-heading text-lg font-semibold mb-3 text-muted-foreground">Groups I Belong To</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {memberGroups.map((m) => {
                const labels = getGroupLabels(m.group.type as GroupType);
                return (
                  <div key={m.id} className="glass-blue p-5 cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all" onClick={() => navigate(`/group/${m.group.id}`)}>
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h4 className="font-heading font-bold text-lg">{m.group.name}</h4>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary font-heading">
                          {labels.group}
                        </span>
                      </div>
                    </div>
                    {m.group.description && <p className="text-sm text-muted-foreground mb-2 line-clamp-2">{m.group.description}</p>}
                    {m.topics.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-3">
                        {m.topics.slice(0, 3).map((t, i) => (
                          <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/40 text-muted-foreground font-heading">{t.length > 25 ? t.slice(0, 25) + "…" : t}</span>
                        ))}
                        {m.topics.length > 3 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/40 text-muted-foreground">+{m.topics.length - 3}</span>}
                      </div>
                    )}
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <div className="flex items-center gap-3">
                        <span>by {m.ownerName}</span>
                        <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {m.memberCount}</span>
                      </div>
                      <span>{m.roadmapCount} roadmap{m.roadmapCount !== 1 ? "s" : ""} assigned</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty state */}
        {ownedGroups.length === 0 && memberGroups.length === 0 && (
          <div className="glass-strong p-8 text-center">
            <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-heading text-lg font-bold mb-2">No groups yet</h3>
            <p className="text-muted-foreground mb-4">Create a group to collaborate or join one with an invite code.</p>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" onClick={() => setShowJoin(true)} className="border-border font-heading font-bold">
                <LogIn className="mr-2 h-4 w-4" /> Join Group
              </Button>
              <Button onClick={() => setShowCreate(true)} className="gradient-primary text-primary-foreground font-heading font-bold">
                <Plus className="mr-2 h-4 w-4" /> Create Group
              </Button>
            </div>
          </div>
        )}
      </div>

      <CreateGroupModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={fetchGroups} />
      <JoinGroupModal open={showJoin} onClose={() => setShowJoin(false)} onJoined={fetchGroups} />
    </>
  );
}
