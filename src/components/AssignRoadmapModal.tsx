import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { X, Loader2, Check } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface RoadmapOption {
  id: string;
  topic: string;
  skill_level: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  groupId: string;
  onAssigned: () => void;
}

export default function AssignRoadmapModal({ open, onClose, groupId, onAssigned }: Props) {
  const { user } = useAuth();
  const [roadmaps, setRoadmaps] = useState<RoadmapOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    (async () => {
      setLoading(true);
      // Get owner's roadmaps
      const { data } = await supabase
        .from("roadmaps")
        .select("id, topic, skill_level")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("created_at", { ascending: false });

      // Get already assigned roadmap IDs for this group
      const { data: assigned } = await (supabase as any)
        .from("group_roadmaps")
        .select("roadmap_id")
        .eq("group_id", groupId);

      const assignedIds = new Set((assigned ?? []).map((a: any) => a.roadmap_id));
      setRoadmaps((data ?? []).filter((r) => !assignedIds.has(r.id)));
      setSelected(new Set());
      setLoading(false);
    })();
  }, [open, user, groupId]);

  if (!open) return null;

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const handleAssign = async () => {
    if (!user || selected.size === 0) return;
    setAssigning(true);

    // Get group members
    const { data: members } = await (supabase as any)
      .from("group_members")
      .select("user_id")
      .eq("group_id", groupId);

    const memberIds: string[] = (members ?? []).map((m: any) => m.user_id);

    for (const roadmapId of selected) {
      // Insert group_roadmap record
      const { data: gr, error: grErr } = await (supabase as any)
        .from("group_roadmaps")
        .insert({ group_id: groupId, roadmap_id: roadmapId, assigned_by: user.id })
        .select("id")
        .single();

      if (grErr || !gr) continue;

      // Fetch full roadmap for cloning
      const { data: fullRoadmap } = await supabase
        .from("roadmaps")
        .select("*")
        .eq("id", roadmapId)
        .single();

      if (!fullRoadmap) continue;

      // Clone for each member
      for (const memberId of memberIds) {
        const { data: cloned } = await supabase.from("roadmaps").insert({
          user_id: memberId,
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
            member_id: memberId,
            roadmap_id: cloned.id,
          });
        }
      }
    }

    toast({ title: `${selected.size} roadmap${selected.size > 1 ? "s" : ""} assigned!` });
    setAssigning(false);
    onAssigned();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-strong p-6 md:p-8 rounded-2xl w-full max-w-md mx-4 relative max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground">
          <X className="h-5 w-5" />
        </button>

        <h2 className="font-heading text-xl font-bold mb-4">Assign Roadmaps</h2>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
          </div>
        ) : roadmaps.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-8">
            No available roadmaps to assign. Create a roadmap first or all your roadmaps are already assigned.
          </p>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto space-y-2 mb-4">
              {roadmaps.map((rm) => (
                <button
                  key={rm.id}
                  onClick={() => toggleSelect(rm.id)}
                  className={`w-full p-3 rounded-lg border text-left transition-all flex items-center gap-3 ${
                    selected.has(rm.id) ? "border-primary bg-primary/10" : "border-border hover:border-muted-foreground/30"
                  }`}
                >
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${
                    selected.has(rm.id) ? "border-primary bg-primary" : "border-muted-foreground/30"
                  }`}>
                    {selected.has(rm.id) && <Check className="h-3 w-3 text-primary-foreground" />}
                  </div>
                  <div>
                    <p className="font-heading font-semibold text-sm">{rm.topic}</p>
                    <p className="text-xs text-muted-foreground">{rm.skill_level}</p>
                  </div>
                </button>
              ))}
            </div>

            <Button
              onClick={handleAssign}
              disabled={assigning || selected.size === 0}
              className="w-full gradient-primary text-primary-foreground font-heading font-bold"
            >
              {assigning ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {assigning ? "Assigning..." : `Assign ${selected.size} roadmap${selected.size !== 1 ? "s" : ""}`}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
