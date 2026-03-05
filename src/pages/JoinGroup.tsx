import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppBar } from "@/components/AppBar";
import WavyBackground from "@/components/WavyBackground";
import { Button } from "@/components/ui/button";
import { Loader2, Users, CheckCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { getGroupLabels, type GroupType } from "@/lib/groupLabels";
import { cloneSharedRoadmapsForMember } from "@/components/JoinGroupModal";

interface GroupInfo {
  id: string;
  name: string;
  description: string | null;
  type: string;
  is_active: boolean;
  owner_id: string;
}

export default function JoinGroup() {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [group, setGroup] = useState<GroupInfo | null>(null);
  const [ownerName, setOwnerName] = useState("");
  const [memberCount, setMemberCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [alreadyMember, setAlreadyMember] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!user || !inviteCode) return;

    (async () => {
      const { data: g } = await (supabase as any)
        .from("groups")
        .select("id, name, description, type, is_active, owner_id")
        .eq("invite_code", inviteCode.toUpperCase())
        .eq("is_active", true)
        .single();

      if (!g) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      setGroup(g);
      setIsOwner(g.owner_id === user.id);

      const [{ data: ownerProfile }, { count }, { data: membership }] = await Promise.all([
        supabase.from("profiles").select("display_name").eq("id", g.owner_id).single(),
        (supabase as any).from("group_members").select("id", { count: "exact", head: true }).eq("group_id", g.id),
        (supabase as any).from("group_members").select("id").eq("group_id", g.id).eq("user_id", user.id).maybeSingle(),
      ]);

      setOwnerName(ownerProfile?.display_name ?? "Unknown");
      setMemberCount(count ?? 0);
      setAlreadyMember(!!membership);
      setLoading(false);
    })();
  }, [user, inviteCode]);

  const handleJoin = async () => {
    if (!user || !group) return;
    setJoining(true);

    const { error } = await (supabase as any)
      .from("group_members")
      .insert({ group_id: group.id, user_id: user.id, role: "member" });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setJoining(false);
      return;
    }

    await cloneSharedRoadmapsForMember(user.id, group.id);

    toast({ title: `Joined "${group.name}"!` });
    navigate(`/group/${group.id}`);
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

  if (notFound) {
    return (
      <>
        <AppBar />
        <WavyBackground />
        <div className="min-h-screen pt-20 pb-10 px-4 flex items-center justify-center">
          <div className="glass-strong p-8 text-center max-w-md">
            <h2 className="font-heading text-xl font-bold mb-2">Invalid Invite Link</h2>
            <p className="text-muted-foreground mb-4">This invite code doesn't match any active group.</p>
            <Button onClick={() => navigate("/groups")} className="gradient-primary text-primary-foreground font-heading font-bold">
              Go to My Groups
            </Button>
          </div>
        </div>
      </>
    );
  }

  const labels = getGroupLabels((group?.type ?? "study_group") as GroupType);

  return (
    <>
      <AppBar />
      <WavyBackground />
      <div className="min-h-screen pt-20 pb-10 px-4 flex items-center justify-center">
        <div className="glass-strong p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-full gradient-primary flex items-center justify-center mx-auto mb-4">
            <Users className="h-8 w-8 text-primary-foreground" />
          </div>

          <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary font-heading mb-2 inline-block">
            {labels.group}
          </span>

          <h2 className="font-heading text-2xl font-bold mb-1">{group?.name}</h2>
          <p className="text-muted-foreground text-sm mb-1">by {ownerName}</p>
          {group?.description && <p className="text-muted-foreground text-sm mb-3">{group.description}</p>}
          <p className="text-sm text-muted-foreground mb-6">
            <Users className="inline h-3.5 w-3.5 mr-1" />{memberCount} {labels.members.toLowerCase()}
          </p>

          {isOwner ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 justify-center text-success">
                <CheckCircle className="h-5 w-5" />
                <span className="font-heading font-semibold">You own this group</span>
              </div>
              <Button onClick={() => navigate(`/group/${group?.id}`)} className="w-full gradient-primary text-primary-foreground font-heading font-bold">
                Manage Group
              </Button>
            </div>
          ) : alreadyMember ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 justify-center text-success">
                <CheckCircle className="h-5 w-5" />
                <span className="font-heading font-semibold">Already enrolled</span>
              </div>
              <Button onClick={() => navigate(`/group/${group?.id}`)} variant="outline" className="w-full border-border font-heading font-bold">
                View Group
              </Button>
            </div>
          ) : (
            <Button
              onClick={handleJoin}
              disabled={joining}
              className="w-full gradient-primary text-primary-foreground font-heading font-bold h-12 text-base"
            >
              {joining ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {joining ? "Joining..." : `Join ${labels.group}`}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
