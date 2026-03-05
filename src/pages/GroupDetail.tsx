import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppBar } from "@/components/AppBar";
import WavyBackground from "@/components/WavyBackground";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ArrowLeft, Copy, Check, Users, Trash2, BarChart3, RefreshCw, LogOut, Save, Send, ChevronDown, CheckCircle, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { getGroupLabels, type GroupType } from "@/lib/groupLabels";
import { generateInviteCode } from "@/lib/inviteCode";

const MAX_GROUP_ROADMAPS = 5;

interface GroupData {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  type: string;
  invite_code: string;
  is_active: boolean;
  created_at: string;
}

interface MemberRow {
  id: string;
  user_id: string;
  role: string;
  joined_at: string;
  display_name: string;
}

interface AssignedRoadmap {
  id: string;
  roadmap_id: string;
  assigned_at: string;
  topic: string;
  sharedCount: number;
}

interface RoadmapOption {
  id: string;
  topic: string;
  skill_level: string;
}

// Maps group_roadmap_id → member's cloned roadmap_id (for member view)
interface MemberRoadmapMap {
  [groupRoadmapId: string]: string;
}

export default function GroupDetail() {
  const { groupId } = useParams<{ groupId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [group, setGroup] = useState<GroupData | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [ownerName, setOwnerName] = useState("");
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [assignedRoadmaps, setAssignedRoadmaps] = useState<AssignedRoadmap[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"members" | "roadmaps">("members");
  const [copiedCode, setCopiedCode] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState<string | null>(null);
  const [leaveConfirm, setLeaveConfirm] = useState(false);

  // Roadmap dropdown state
  const [availableRoadmaps, setAvailableRoadmaps] = useState<RoadmapOption[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [addingRoadmap, setAddingRoadmap] = useState<string | null>(null);
  const [sharingRoadmap, setSharingRoadmap] = useState<string | null>(null);
  const [removeRoadmapConfirm, setRemoveRoadmapConfirm] = useState<string | null>(null);
  // Member's cloned roadmap IDs (group_roadmap_id → cloned roadmap_id)
  const [memberRoadmapMap, setMemberRoadmapMap] = useState<MemberRoadmapMap>({});

  const fetchGroup = async () => {
    if (!user || !groupId) return;

    const { data: g } = await (supabase as any)
      .from("groups")
      .select("*")
      .eq("id", groupId)
      .single();

    if (!g) {
      navigate("/groups");
      return;
    }

    setGroup(g);
    setIsOwner(g.owner_id === user.id);
    setEditName(g.name);
    setEditDesc(g.description ?? "");

    const { data: ownerProfile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", g.owner_id)
      .single();
    setOwnerName(ownerProfile?.display_name ?? "Unknown");

    const { data: memberRows } = await (supabase as any)
      .from("group_members")
      .select("id, user_id, role, joined_at")
      .eq("group_id", groupId)
      .order("joined_at", { ascending: true });

    const membersWithNames: MemberRow[] = [];
    for (const m of memberRows ?? []) {
      const { data: p } = await supabase.from("profiles").select("display_name").eq("id", m.user_id).single();
      membersWithNames.push({ ...m, display_name: p?.display_name ?? "Unknown" });
    }
    setMembers(membersWithNames);

    // Fetch assigned roadmaps
    const { data: grRows } = await (supabase as any)
      .from("group_roadmaps")
      .select("id, roadmap_id, assigned_at")
      .eq("group_id", groupId)
      .order("assigned_at", { ascending: false });

    const roadmapsWithDetails: AssignedRoadmap[] = [];
    for (const gr of grRows ?? []) {
      const { data: rm } = await supabase.from("roadmaps").select("topic").eq("id", gr.roadmap_id).single();
      const { count } = await (supabase as any)
        .from("member_group_roadmaps")
        .select("id", { count: "exact", head: true })
        .eq("group_roadmap_id", gr.id);
      roadmapsWithDetails.push({
        ...gr,
        topic: rm?.topic ?? "Deleted Roadmap",
        sharedCount: count ?? 0,
      });
    }
    setAssignedRoadmaps(roadmapsWithDetails);

    // Fetch available roadmaps for dropdown (owner only)
    if (g.owner_id === user.id) {
      const { data: myRoadmaps } = await supabase
        .from("roadmaps")
        .select("id, topic, skill_level")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("created_at", { ascending: false });

      const assignedIds = new Set((grRows ?? []).map((r: any) => r.roadmap_id));
      setAvailableRoadmaps((myRoadmaps ?? []).filter((r) => !assignedIds.has(r.id)));
    } else {
      // For members: fetch their cloned roadmap IDs
      const map: MemberRoadmapMap = {};
      for (const gr of grRows ?? []) {
        const { data: mgr } = await (supabase as any)
          .from("member_group_roadmaps")
          .select("roadmap_id")
          .eq("group_roadmap_id", gr.id)
          .eq("member_id", user.id)
          .maybeSingle();
        if (mgr) {
          map[gr.id] = mgr.roadmap_id;
        }
      }
      setMemberRoadmapMap(map);
    }

    setLoading(false);
  };

  useEffect(() => { fetchGroup(); }, [user, groupId]);

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedCode(true);
    toast({ title: "Copied!" });
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleSaveDetails = async () => {
    if (!group) return;
    setSaving(true);
    await (supabase as any).from("groups").update({
      name: editName.trim(),
      description: editDesc.trim() || null,
    }).eq("id", group.id);
    setSaving(false);
    toast({ title: "Group updated" });
    fetchGroup();
  };

  const handleToggleActive = async () => {
    if (!group) return;
    await (supabase as any).from("groups").update({ is_active: !group.is_active }).eq("id", group.id);
    toast({ title: group.is_active ? "Group deactivated" : "Group reactivated" });
    fetchGroup();
  };

  const handleRegenerateCode = async () => {
    if (!group) return;
    const newCode = generateInviteCode();
    await (supabase as any).from("groups").update({ invite_code: newCode }).eq("id", group.id);
    toast({ title: "Invite code regenerated" });
    fetchGroup();
  };

  const handleRemoveMember = async (memberId: string) => {
    await (supabase as any).from("group_members").delete().eq("id", memberId);
    toast({ title: "Member removed" });
    setRemoveConfirm(null);
    fetchGroup();
  };

  const handleLeaveGroup = async () => {
    if (!user || !groupId) return;
    await (supabase as any).from("group_members").delete().eq("group_id", groupId).eq("user_id", user.id);
    toast({ title: "You left the group" });
    navigate("/groups");
  };

  // Add roadmap to group (just links it, doesn't distribute)
  const handleAddRoadmap = async (roadmapId: string) => {
    if (!user || !groupId) return;
    setAddingRoadmap(roadmapId);

    const { error } = await (supabase as any)
      .from("group_roadmaps")
      .insert({ group_id: groupId, roadmap_id: roadmapId, assigned_by: user.id });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Roadmap added to group" });
    }
    setAddingRoadmap(null);
    setShowDropdown(false);
    fetchGroup();
  };

  // Share/distribute a roadmap to all members (clone to each)
  const handleShareToMembers = async (groupRoadmapId: string, roadmapId: string) => {
    if (!user || !groupId) return;
    setSharingRoadmap(groupRoadmapId);

    // Re-fetch members directly to avoid stale state
    const { data: currentMembers } = await (supabase as any)
      .from("group_members")
      .select("user_id")
      .eq("group_id", groupId);

    const allMemberIds = (currentMembers ?? []).map((m: any) => m.user_id);

    if (allMemberIds.length === 0) {
      toast({ title: "No members in this group yet" });
      setSharingRoadmap(null);
      return;
    }

    // Use SECURITY DEFINER RPC to clone roadmaps (bypasses roadmaps RLS)
    let shared = 0;
    for (const memberId of allMemberIds) {
      const { data: clonedId, error } = await (supabase as any).rpc("clone_roadmap_for_member", {
        p_source_roadmap_id: roadmapId,
        p_target_user_id: memberId,
        p_group_roadmap_id: groupRoadmapId,
      });

      if (!error && clonedId) {
        shared++;
      }
    }

    toast({ title: `Roadmap shared with ${shared} ${shared === 1 ? "member" : "members"}!` });
    setSharingRoadmap(null);
    fetchGroup();
  };

  // Remove roadmap from group
  const handleRemoveRoadmap = async (groupRoadmapId: string) => {
    await (supabase as any).from("group_roadmaps").delete().eq("id", groupRoadmapId);
    toast({ title: "Roadmap removed from group" });
    setRemoveRoadmapConfirm(null);
    fetchGroup();
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

  if (!group) return null;

  const labels = getGroupLabels(group.type as GroupType);
  const inviteLink = `${window.location.origin}/join/${group.invite_code}`;
  const atLimit = assignedRoadmaps.length >= MAX_GROUP_ROADMAPS;

  return (
    <>
      <AppBar />
      <WavyBackground />
      <div className="min-h-screen pt-20 pb-10 px-4 md:px-12 max-w-4xl mx-auto animate-fade-in">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate("/groups")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-heading text-2xl md:text-3xl font-bold">{group.name}</h2>
              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary font-heading">{labels.group}</span>
              {!group.is_active && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/20 text-destructive font-heading">Inactive</span>
              )}
            </div>
            {!isOwner && <p className="text-sm text-muted-foreground">by {ownerName}</p>}
          </div>
        </div>

        {/* Owner: Edit section */}
        {isOwner && (
          <div className="glass-strong p-5 mb-6 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-sm font-heading font-semibold mb-1 block">Name</label>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="bg-background/50 border-border" />
              </div>
              <div>
                <label className="text-sm font-heading font-semibold mb-1 block">Description</label>
                <Input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="Optional" className="bg-background/50 border-border" />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={handleSaveDetails} disabled={saving} size="sm" className="gradient-primary text-primary-foreground font-heading font-bold">
                {saving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />} Save
              </Button>
              <Button onClick={handleToggleActive} variant="outline" size="sm" className="border-border">
                {group.is_active ? "Deactivate" : "Reactivate"}
              </Button>
            </div>

            {/* Invite code section */}
            <div className="flex items-center gap-2 flex-wrap glass p-3 rounded-lg">
              <span className="text-sm text-muted-foreground">Invite:</span>
              <span className="font-mono font-bold tracking-wider">{group.invite_code}</span>
              <Button onClick={() => handleCopy(group.invite_code)} variant="ghost" size="sm">
                {copiedCode ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              </Button>
              <Button onClick={() => handleCopy(inviteLink)} variant="outline" size="sm" className="border-border text-xs">
                Copy Link
              </Button>
              <Button onClick={handleRegenerateCode} variant="ghost" size="sm" className="text-xs text-muted-foreground">
                <RefreshCw className="h-3 w-3 mr-1" /> Regenerate
              </Button>
            </div>
          </div>
        )}

        {/* Member: group description */}
        {!isOwner && group.description && (
          <div className="glass-strong p-5 mb-6">
            <p className="text-muted-foreground">{group.description}</p>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          <Button
            onClick={() => setTab("members")}
            variant={tab === "members" ? "default" : "outline"}
            className={tab === "members" ? "gradient-primary text-primary-foreground font-heading font-bold" : "border-border font-heading font-bold"}
          >
            <Users className="mr-2 h-4 w-4" /> {labels.members} ({members.length})
          </Button>
          <Button
            onClick={() => setTab("roadmaps")}
            variant={tab === "roadmaps" ? "default" : "outline"}
            className={tab === "roadmaps" ? "gradient-primary text-primary-foreground font-heading font-bold" : "border-border font-heading font-bold"}
          >
            Roadmaps ({isOwner ? `${assignedRoadmaps.length}/${MAX_GROUP_ROADMAPS}` : assignedRoadmaps.length})
          </Button>
        </div>

        {/* Members tab */}
        {tab === "members" && (
          <div className="space-y-2">
            {members.length === 0 ? (
              <div className="glass p-6 text-center text-muted-foreground">
                No {labels.members.toLowerCase()} have joined yet. Share the invite code to get started.
              </div>
            ) : (
              members.map((m) => (
                <div key={m.id} className="glass-blue p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full gradient-primary flex items-center justify-center text-sm font-heading font-bold text-primary-foreground">
                      {(m.display_name?.[0] ?? "U").toUpperCase()}
                    </div>
                    <div>
                      <p className="font-heading font-semibold text-sm">{m.display_name}</p>
                      <p className="text-xs text-muted-foreground">Joined {new Date(m.joined_at).toLocaleDateString()}</p>
                    </div>
                  </div>
                  {isOwner && (
                    <Button
                      onClick={() => setRemoveConfirm(m.id)}
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Roadmaps tab */}
        {tab === "roadmaps" && (
          <div className="space-y-2">
            {/* Add roadmap dropdown (owner only) */}
            {isOwner && (
              <div className="relative mb-3">
                {atLimit ? (
                  <p className="text-sm text-muted-foreground">Maximum of {MAX_GROUP_ROADMAPS} roadmaps reached. Remove one to add another.</p>
                ) : (
                  <>
                    <Button
                      onClick={() => setShowDropdown(!showDropdown)}
                      variant="outline"
                      className="w-full justify-between border-border font-heading font-bold"
                    >
                      <span>Add a roadmap to this group...</span>
                      <ChevronDown className={`h-4 w-4 transition-transform ${showDropdown ? "rotate-180" : ""}`} />
                    </Button>
                    {showDropdown && (
                      <div className="absolute top-full left-0 right-0 mt-1 glass-strong border border-border rounded-lg z-10 max-h-60 overflow-y-auto">
                        {availableRoadmaps.length === 0 ? (
                          <p className="p-3 text-sm text-muted-foreground text-center">No more roadmaps available to add.</p>
                        ) : (
                          availableRoadmaps.map((rm) => (
                            <button
                              key={rm.id}
                              onClick={() => handleAddRoadmap(rm.id)}
                              disabled={addingRoadmap === rm.id}
                              className="w-full p-3 text-left hover:bg-muted/20 transition-colors flex items-center justify-between border-b border-border/50 last:border-0"
                            >
                              <div>
                                <p className="font-heading font-semibold text-sm">{rm.topic}</p>
                                <p className="text-xs text-muted-foreground">{rm.skill_level}</p>
                              </div>
                              {addingRoadmap === rm.id && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {assignedRoadmaps.length === 0 ? (
              <div className="glass p-6 text-center text-muted-foreground">
                {isOwner
                  ? "No roadmaps added yet. Use the dropdown above to add roadmaps from your library."
                  : "No roadmaps have been shared with you yet."}
              </div>
            ) : (
              assignedRoadmaps.map((ar) => {
                const isShared = ar.sharedCount > 0;
                const memberClonedId = memberRoadmapMap[ar.id];

                return (
                  <div key={ar.id} className="glass-blue p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        {!isOwner && memberClonedId ? (
                          <button
                            onClick={() => navigate(`/dashboard/${memberClonedId}`)}
                            className="font-heading font-semibold text-left hover:text-primary transition-colors flex items-center gap-1.5"
                          >
                            {ar.topic}
                            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                          </button>
                        ) : (
                          <p className="font-heading font-semibold">{ar.topic}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {isOwner ? (
                            <>
                              Added {new Date(ar.assigned_at).toLocaleDateString()}
                              {isShared && ` · Shared with ${ar.sharedCount} ${ar.sharedCount === 1 ? labels.member.toLowerCase() : labels.members.toLowerCase()}`}
                            </>
                          ) : memberClonedId ? (
                            "Click to view modules and track progress"
                          ) : (
                            "Not yet shared by the group owner"
                          )}
                        </p>
                      </div>
                      {isOwner && (
                        <div className="flex items-center gap-1 shrink-0">
                          {isShared ? (
                            <span className="flex items-center gap-1 text-xs font-heading font-bold text-success px-2 py-1">
                              <CheckCircle className="h-3.5 w-3.5" /> Shared
                            </span>
                          ) : (
                            <Button
                              onClick={() => handleShareToMembers(ar.id, ar.roadmap_id)}
                              disabled={sharingRoadmap === ar.id || members.length === 0}
                              size="sm"
                              className="gradient-primary text-primary-foreground font-heading font-bold text-xs"
                            >
                              {sharingRoadmap === ar.id ? (
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                              ) : (
                                <Send className="mr-1 h-3 w-3" />
                              )}
                              Share
                            </Button>
                          )}
                          <Button
                            onClick={() => navigate(`/group/${groupId}/progress/${ar.roadmap_id}`)}
                            variant="outline"
                            size="sm"
                            className="border-border font-heading font-bold text-xs"
                          >
                            <BarChart3 className="mr-1 h-3 w-3" /> Progress
                          </Button>
                          <Button
                            onClick={() => setRemoveRoadmapConfirm(ar.id)}
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Leave group (member only) */}
        {!isOwner && (
          <div className="mt-8 text-center">
            <Button onClick={() => setLeaveConfirm(true)} variant="ghost" className="text-destructive hover:text-destructive">
              <LogOut className="mr-2 h-4 w-4" /> Leave Group
            </Button>
          </div>
        )}
      </div>

      {/* Remove member confirm */}
      <Dialog open={!!removeConfirm} onOpenChange={() => setRemoveConfirm(null)}>
        <DialogContent className="glass-strong border-border">
          <DialogHeader>
            <DialogTitle className="font-heading">Remove {labels.member.toLowerCase()}?</DialogTitle>
            <DialogDescription>They will no longer be part of this group. Their cloned roadmaps will remain.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRemoveConfirm(null)} className="border-border">Cancel</Button>
            <Button onClick={() => removeConfirm && handleRemoveMember(removeConfirm)} className="bg-destructive text-destructive-foreground font-heading font-bold">Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove roadmap confirm */}
      <Dialog open={!!removeRoadmapConfirm} onOpenChange={() => setRemoveRoadmapConfirm(null)}>
        <DialogContent className="glass-strong border-border">
          <DialogHeader>
            <DialogTitle className="font-heading">Remove roadmap from group?</DialogTitle>
            <DialogDescription>Members who already received this roadmap will keep their copies.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRemoveRoadmapConfirm(null)} className="border-border">Cancel</Button>
            <Button onClick={() => removeRoadmapConfirm && handleRemoveRoadmap(removeRoadmapConfirm)} className="bg-destructive text-destructive-foreground font-heading font-bold">Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Leave confirm */}
      <Dialog open={leaveConfirm} onOpenChange={setLeaveConfirm}>
        <DialogContent className="glass-strong border-border">
          <DialogHeader>
            <DialogTitle className="font-heading">Leave this group?</DialogTitle>
            <DialogDescription>Your cloned roadmaps will remain in your account.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setLeaveConfirm(false)} className="border-border">Cancel</Button>
            <Button onClick={handleLeaveGroup} className="bg-destructive text-destructive-foreground font-heading font-bold">Leave</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
