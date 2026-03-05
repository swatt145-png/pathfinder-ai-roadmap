import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Share2, X, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Connection {
  userId: string;
  displayName: string;
}

interface OwnedGroup {
  id: string;
  name: string;
  type: string;
  alreadyHas: boolean;
}

interface ShareRoadmapModalProps {
  roadmapId: string;
  open: boolean;
  onClose: () => void;
}

export function ShareRoadmapModal({ roadmapId, open, onClose }: ShareRoadmapModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [ownedGroups, setOwnedGroups] = useState<OwnedGroup[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    setSelectedUsers(new Set());
    setSelectedGroups(new Set());
    setLoading(true);

    (async () => {
      // Fetch accepted connections
      const { data: connData } = await (supabase as any)
        .from("connections")
        .select("requester_id, receiver_id")
        .eq("status", "accepted")
        .or(`requester_id.eq.${user.id},receiver_id.eq.${user.id}`);

      if (connData && connData.length > 0) {
        const otherIds = connData.map((c: any) =>
          c.requester_id === user.id ? c.receiver_id : c.requester_id
        );
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", otherIds);
        setConnections(
          (profiles ?? []).map((p) => ({
            userId: p.id,
            displayName: p.display_name ?? "User",
          }))
        );
      } else {
        setConnections([]);
      }

      // Fetch groups the user owns
      const { data: groups } = await (supabase as any)
        .from("groups")
        .select("id, name, type")
        .eq("owner_id", user.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (groups && groups.length > 0) {
        // Check which groups already have this roadmap
        const groupsWithStatus: OwnedGroup[] = [];
        for (const g of groups) {
          const { data: existing } = await (supabase as any)
            .from("group_roadmaps")
            .select("id")
            .eq("group_id", g.id)
            .eq("roadmap_id", roadmapId)
            .maybeSingle();

          // Check count limit (max 5)
          const { count } = await (supabase as any)
            .from("group_roadmaps")
            .select("id", { count: "exact", head: true })
            .eq("group_id", g.id);

          groupsWithStatus.push({
            ...g,
            alreadyHas: !!existing || (count ?? 0) >= 5,
          });
        }
        setOwnedGroups(groupsWithStatus);
      } else {
        setOwnedGroups([]);
      }

      setLoading(false);
    })();
  }, [open, user, roadmapId]);

  const toggleUser = (userId: string) => {
    setSelectedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const toggleGroup = (groupId: string) => {
    setSelectedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const handleShare = async () => {
    if (!user || (selectedUsers.size === 0 && selectedGroups.size === 0)) return;
    setSending(true);

    // Share with connections
    if (selectedUsers.size > 0) {
      const rows = Array.from(selectedUsers).map((receiverId) => ({
        sender_id: user.id,
        receiver_id: receiverId,
        roadmap_id: roadmapId,
      }));
      await (supabase as any).from("shared_roadmaps").insert(rows);
    }

    // Add to groups (just link — owner shares explicitly from group page)
    for (const groupId of selectedGroups) {
      await (supabase as any)
        .from("group_roadmaps")
        .insert({ group_id: groupId, roadmap_id: roadmapId, assigned_by: user.id });
    }

    const totalShared = selectedUsers.size + selectedGroups.size;
    toast({ title: `Roadmap shared with ${totalShared} ${totalShared === 1 ? "recipient" : "recipients"}!` });
    onClose();
    setSending(false);
  };

  if (!open) return null;

  const totalSelected = selectedUsers.size + selectedGroups.size;
  const hasContent = connections.length > 0 || ownedGroups.length > 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="glass-strong border border-border rounded-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-heading font-bold text-lg flex items-center gap-2">
            <Share2 className="h-5 w-5 text-primary" /> Share Roadmap
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
          </div>
        ) : !hasContent ? (
          <p className="text-muted-foreground text-center py-6">
            No connections or groups yet. Connect with other learners or create a group first!
          </p>
        ) : (
          <>
            <div className="max-h-72 overflow-y-auto mb-4">
              {/* Groups section */}
              {ownedGroups.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-heading font-semibold text-muted-foreground uppercase tracking-wider mb-2">My Groups</p>
                  <div className="space-y-1">
                    {ownedGroups.map((g) => (
                      <label
                        key={g.id}
                        className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${
                          g.alreadyHas ? "opacity-50 cursor-not-allowed" : "hover:bg-accent/10 cursor-pointer"
                        }`}
                      >
                        <Checkbox
                          checked={selectedGroups.has(g.id)}
                          onCheckedChange={() => !g.alreadyHas && toggleGroup(g.id)}
                          disabled={g.alreadyHas}
                        />
                        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                          <Users className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <span className="font-heading text-sm">{g.name}</span>
                          {g.alreadyHas && <p className="text-xs text-muted-foreground">Already added or at limit</p>}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Connections section */}
              {connections.length > 0 && (
                <div>
                  <p className="text-xs font-heading font-semibold text-muted-foreground uppercase tracking-wider mb-2">Connections</p>
                  <div className="space-y-1">
                    {connections.map((c) => (
                      <label
                        key={c.userId}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/10 cursor-pointer transition-colors"
                      >
                        <Checkbox
                          checked={selectedUsers.has(c.userId)}
                          onCheckedChange={() => toggleUser(c.userId)}
                        />
                        <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center text-xs font-heading font-bold text-primary-foreground shrink-0">
                          {(c.displayName[0] ?? "U").toUpperCase()}
                        </div>
                        <span className="font-heading text-sm">{c.displayName}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <Button
              onClick={handleShare}
              disabled={totalSelected === 0 || sending}
              className="w-full gradient-primary text-primary-foreground font-heading font-bold"
            >
              {sending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Share2 className="mr-2 h-4 w-4" />
              )}
              Share with {totalSelected || ""} {totalSelected === 1 ? "recipient" : totalSelected > 1 ? "recipients" : "selected"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
