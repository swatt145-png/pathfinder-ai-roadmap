import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onClose: () => void;
  onJoined: () => void;
}

async function cloneSharedRoadmapsForMember(userId: string, groupId: string) {
  // Only clone roadmaps that have been explicitly shared by the owner
  // (i.e., at least one other member already has an entry in member_group_roadmaps)
  const { data: groupRoadmaps } = await (supabase as any)
    .from("group_roadmaps")
    .select("id, roadmap_id")
    .eq("group_id", groupId);

  if (!groupRoadmaps || groupRoadmaps.length === 0) return;

  for (const gr of groupRoadmaps) {
    // Check if this roadmap was shared (has any member_group_roadmaps entries)
    const { count } = await (supabase as any)
      .from("member_group_roadmaps")
      .select("id", { count: "exact", head: true })
      .eq("group_roadmap_id", gr.id);

    if ((count ?? 0) === 0) continue; // Not shared yet, skip

    // Use SECURITY DEFINER RPC — the member themselves calls this on join,
    // but it needs the group owner to be the caller. For late joiners,
    // we do a direct insert since the user IS the target (user_id = auth.uid()).
    const { data: fullRoadmap } = await supabase
      .from("roadmaps")
      .select("*")
      .eq("id", gr.roadmap_id)
      .single();

    if (!fullRoadmap) continue;

    const { data: cloned } = await supabase.from("roadmaps").insert({
      user_id: userId,
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
      source_roadmap_id: fullRoadmap.id,
    } as any).select("id").single();

    if (cloned) {
      await (supabase as any).from("member_group_roadmaps").insert({
        group_roadmap_id: gr.id,
        member_id: userId,
        roadmap_id: cloned.id,
      });
    }
  }
}

export default function JoinGroupModal({ open, onClose, onJoined }: Props) {
  const { user } = useAuth();
  const [code, setCode] = useState("");
  const [joining, setJoining] = useState(false);

  if (!open) return null;

  const handleJoin = async () => {
    if (!user || !code.trim()) return;
    setJoining(true);

    const normalizedCode = code.trim().toUpperCase();

    const { data: group, error: lookupErr } = await (supabase as any)
      .from("groups")
      .select("id, name")
      .eq("invite_code", normalizedCode)
      .eq("is_active", true)
      .single();

    if (lookupErr || !group) {
      toast({ title: "Invalid invite code", description: "No active group found with this code.", variant: "destructive" });
      setJoining(false);
      return;
    }

    const { error: joinErr } = await (supabase as any)
      .from("group_members")
      .insert({ group_id: group.id, user_id: user.id, role: "member" });

    if (joinErr) {
      if (joinErr.code === "23505") {
        toast({ title: "Already a member", description: `You're already in "${group.name}".` });
      } else {
        toast({ title: "Error", description: joinErr.message, variant: "destructive" });
      }
      setJoining(false);
      return;
    }

    await cloneSharedRoadmapsForMember(user.id, group.id);

    toast({ title: `Joined "${group.name}"!`, description: "You're now a member of this group." });
    setJoining(false);
    setCode("");
    onJoined();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-strong p-6 md:p-8 rounded-2xl w-full max-w-sm mx-4 relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground">
          <X className="h-5 w-5" />
        </button>

        <h2 className="font-heading text-xl font-bold mb-4">Join a Group</h2>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-heading font-semibold mb-1.5 block">Invite Code</label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="XXXX-XXXX"
              className="bg-background/50 border-border font-mono text-center text-lg tracking-widest"
              maxLength={9}
            />
          </div>

          <Button
            onClick={handleJoin}
            disabled={joining || !code.trim()}
            className="w-full gradient-primary text-primary-foreground font-heading font-bold"
          >
            {joining ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            {joining ? "Joining..." : "Join Group"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export { cloneSharedRoadmapsForMember };
