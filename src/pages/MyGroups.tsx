import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppBar } from "@/components/AppBar";
import WavyBackground from "@/components/WavyBackground";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, Users, Copy, Check, LogIn, BookOpen, TrendingUp, Send, Mail, X as XIcon } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { toast } from "@/hooks/use-toast";
import { getGroupLabels, type GroupType } from "@/lib/groupLabels";
import CreateGroupModal from "@/components/CreateGroupModal";
import JoinGroupModal from "@/components/JoinGroupModal";
import { ShareInviteModal } from "@/components/ShareInviteModal";
import { cloneSharedRoadmapsForMember } from "@/components/JoinGroupModal";

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
  completionPct: number;
  completedModules: number;
  totalModules: number;
}

interface PendingInvite {
  id: string;
  group_id: string;
  sender_id: string;
  senderName: string;
  groupName: string;
  groupType: string;
  groupDescription: string | null;
  topics: string[];
}

function ProgressRing({ pct, size = 48, stroke = 4 }: { pct: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-muted/30" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#ringGrad)" strokeWidth={stroke} strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" className="transition-all duration-700" />
      <defs>
        <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="hsl(var(--primary))" />
          <stop offset="100%" stopColor="hsl(172 66% 50%)" />
        </linearGradient>
      </defs>
    </svg>
  );
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
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [joiningInvite, setJoiningInvite] = useState<string | null>(null);
  const [dismissingInvite, setDismissingInvite] = useState<string | null>(null);
  const [shareInviteGroup, setShareInviteGroup] = useState<{ id: string; name: string; invite_code: string } | null>(null);

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
      let totalModules = 0;
      let completedModules = 0;
      for (const gr of grRows ?? []) {
        const { data: mgr } = await (supabase as any)
          .from("member_group_roadmaps")
          .select("roadmap_id")
          .eq("group_roadmap_id", gr.id)
          .eq("member_id", user.id)
          .maybeSingle();
        if (mgr) {
          assignedCount++;
          const { data: rm } = await supabase.from("roadmaps").select("topic, roadmap_data").eq("id", mgr.roadmap_id).single();
          if (rm?.topic) topics.push(rm.topic);
          const rmData = rm?.roadmap_data as any;
          totalModules += rmData?.modules?.length ?? 0;
          const { data: prog } = await supabase.from("progress").select("status").eq("roadmap_id", mgr.roadmap_id).eq("user_id", user.id);
          if (prog) completedModules += prog.filter((p: any) => p.status === "completed").length;
        }
      }

      memberWithDetails.push({
        ...m,
        group: g,
        ownerName: ownerProfile?.display_name ?? "Unknown",
        roadmapCount: assignedCount,
        memberCount: mc ?? 0,
        topics,
        completionPct: totalModules > 0 ? Math.round((completedModules / totalModules) * 100) : 0,
        completedModules,
        totalModules,
      });
    }
    setMemberGroups(memberWithDetails);

    // Fetch pending invites for this user
    const { data: inviteRows } = await (supabase as any)
      .from("group_invites")
      .select("id, group_id, sender_id")
      .eq("receiver_id", user.id)
      .eq("status", "pending");

    const invitesWithDetails: PendingInvite[] = [];
    for (const inv of inviteRows ?? []) {
      const [{ data: g }, { data: senderProfile }, { data: grRows }] = await Promise.all([
        (supabase as any).from("groups").select("name, type, description").eq("id", inv.group_id).single(),
        supabase.from("profiles").select("display_name").eq("id", inv.sender_id).single(),
        (supabase as any).from("group_roadmaps").select("roadmap_id").eq("group_id", inv.group_id),
      ]);
      const topics: string[] = [];
      for (const gr of grRows ?? []) {
        const { data: rm } = await supabase.from("roadmaps").select("topic").eq("id", gr.roadmap_id).single();
        if (rm?.topic) topics.push(rm.topic);
      }
      if (g) {
        invitesWithDetails.push({
          ...inv,
          senderName: senderProfile?.display_name ?? "Unknown",
          groupName: g.name,
          groupType: g.type,
          groupDescription: g.description,
          topics,
        });
      }
    }
    setPendingInvites(invitesWithDetails);

    setLoading(false);
  };

  useEffect(() => { fetchGroups(); }, [user]);

  const handleCopyCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedCode(code);
    toast({ title: "Invite code copied!" });
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleAcceptInvite = async (invite: PendingInvite) => {
    if (!user) return;
    setJoiningInvite(invite.id);

    // Insert as group member
    const { error } = await (supabase as any)
      .from("group_members")
      .insert({ group_id: invite.group_id, user_id: user.id, role: "member" });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setJoiningInvite(null);
      return;
    }

    // Clone shared roadmaps
    await cloneSharedRoadmapsForMember(user.id, invite.group_id);

    // Update invite status
    await (supabase as any)
      .from("group_invites")
      .update({ status: "accepted" })
      .eq("id", invite.id);

    toast({ title: `Joined "${invite.groupName}"!` });
    setJoiningInvite(null);
    fetchGroups();
  };

  const handleDismissInvite = async (inviteId: string) => {
    setDismissingInvite(inviteId);
    await (supabase as any)
      .from("group_invites")
      .update({ status: "dismissed" })
      .eq("id", inviteId);
    setPendingInvites((prev) => prev.filter((i) => i.id !== inviteId));
    setDismissingInvite(null);
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
        <Breadcrumbs items={[{ label: "My Groups" }]} />
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-heading text-2xl md:text-3xl font-bold">My Groups</h2>
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

        {/* Pending Invites */}
        {pendingInvites.length > 0 && (
          <div className="mb-8">
            <h3 className="font-heading text-lg font-semibold mb-3 text-muted-foreground flex items-center gap-2">
              <Mail className="h-4 w-4" /> Pending Invites
              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary font-heading">{pendingInvites.length}</span>
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {pendingInvites.map((inv) => {
                const labels = getGroupLabels(inv.groupType as GroupType);
                return (
                  <div key={inv.id} className="glass-strong p-5 border border-primary/20">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-heading font-bold text-lg leading-tight">{inv.groupName}</h4>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary font-heading">{labels.group}</span>
                          <span className="text-xs text-muted-foreground">from {inv.senderName}</span>
                        </div>
                      </div>
                    </div>
                    {inv.groupDescription && (
                      <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{inv.groupDescription}</p>
                    )}
                    {inv.topics.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        <BookOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                        {inv.topics.map((t, i) => (
                          <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary/80 font-heading">{t}</span>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button
                        onClick={() => handleAcceptInvite(inv)}
                        disabled={joiningInvite === inv.id}
                        className="flex-1 gradient-primary text-primary-foreground font-heading font-bold"
                        size="sm"
                      >
                        {joiningInvite === inv.id ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <LogIn className="w-3 h-3 mr-1" />}
                        Join
                      </Button>
                      <Button
                        onClick={() => handleDismissInvite(inv.id)}
                        disabled={dismissingInvite === inv.id}
                        variant="outline"
                        className="border-border font-heading font-bold"
                        size="sm"
                      >
                        {dismissingInvite === inv.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <XIcon className="w-3 h-3" />}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Owned Groups */}
        {ownedGroups.length > 0 && (
          <div className="mb-8">
            <h3 className="font-heading text-lg font-semibold mb-3 text-muted-foreground">Groups I Own</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {ownedGroups.map((g) => {
                const labels = getGroupLabels(g.type as GroupType);
                return (
                  <div key={g.id} className="glass-blue p-5 cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all group" onClick={() => navigate(`/group/${g.id}`)}>
                    {/* Top row */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-heading font-bold text-lg leading-tight group-hover:text-primary transition-colors">{g.name}</h4>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary font-heading">{labels.group}</span>
                          {!g.is_active && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/20 text-destructive font-heading">Inactive</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleCopyCode(g.invite_code); }}
                          className="flex items-center gap-1 text-xs font-mono glass px-2 py-1 rounded-lg hover:text-primary transition-colors"
                        >
                          {copiedCode === g.invite_code ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                          {g.invite_code}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setShareInviteGroup({ id: g.id, name: g.name, invite_code: g.invite_code }); }}
                          className="flex items-center justify-center w-7 h-7 rounded-lg glass hover:text-primary transition-colors"
                          title="Share with connections"
                        >
                          <Send className="h-3 w-3" />
                        </button>
                      </div>
                    </div>

                    {g.description && <p className="text-sm text-muted-foreground mb-2 line-clamp-2">{g.description}</p>}

                    {/* Topic tags */}
                    {g.topics.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {g.topics.map((t, i) => (
                          <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary/80 font-heading">{t}</span>
                        ))}
                      </div>
                    )}

                    {/* Stats row */}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t border-border/30">
                      <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {g.memberCount} {labels.members.toLowerCase()}</span>
                      <span className="flex items-center gap-1"><BookOpen className="h-3.5 w-3.5" /> {g.roadmapCount} roadmap{g.roadmapCount !== 1 ? "s" : ""}</span>
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
                  <div key={m.id} className="glass-blue p-5 cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all group" onClick={() => navigate(`/group/${m.group.id}`)}>
                    {/* Top row: name + progress ring */}
                    <div className="flex items-start gap-3 mb-3">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-heading font-bold text-lg leading-tight group-hover:text-primary transition-colors">{m.group.name}</h4>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary font-heading">{labels.group}</span>
                          <span className="text-xs text-muted-foreground">by {m.ownerName}</span>
                        </div>
                      </div>
                      {m.roadmapCount > 0 && (
                        <div className="relative">
                          <ProgressRing pct={m.completionPct} />
                          <span className="absolute inset-0 flex items-center justify-center text-xs font-heading font-bold">{m.completionPct}%</span>
                        </div>
                      )}
                    </div>

                    {/* Topic tags */}
                    {m.topics.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {m.topics.map((t, i) => (
                          <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary/80 font-heading">{t}</span>
                        ))}
                      </div>
                    )}

                    {/* Stats row */}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t border-border/30">
                      <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {m.memberCount} {labels.members.toLowerCase()}</span>
                      <span className="flex items-center gap-1"><BookOpen className="h-3.5 w-3.5" /> {m.roadmapCount} assigned</span>
                      {m.totalModules > 0 && (
                        <span className="flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5" /> {m.completedModules}/{m.totalModules} modules</span>
                      )}
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
      {shareInviteGroup && (
        <ShareInviteModal
          open={!!shareInviteGroup}
          onClose={() => setShareInviteGroup(null)}
          groupId={shareInviteGroup.id}
          groupName={shareInviteGroup.name}
          inviteCode={shareInviteGroup.invite_code}
        />
      )}
    </>
  );
}
