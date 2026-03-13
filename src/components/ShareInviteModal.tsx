import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Send, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Connection {
  userId: string;
  displayName: string;
  disabledReason?: string;
}

interface ShareInviteModalProps {
  open: boolean;
  onClose: () => void;
  groupId: string;
  groupName: string;
  inviteCode: string;
}

export function ShareInviteModal({ open, onClose, groupId, groupName, inviteCode }: ShareInviteModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    setSelected(new Set());
    setLoading(true);

    (async () => {
      // Fetch accepted connections
      const { data: connData } = await (supabase as any)
        .from("connections")
        .select("requester_id, receiver_id")
        .eq("status", "accepted")
        .or(`requester_id.eq.${user.id},receiver_id.eq.${user.id}`);

      if (!connData || connData.length === 0) {
        setConnections([]);
        setLoading(false);
        return;
      }

      const otherIds = connData.map((c: any) =>
        c.requester_id === user.id ? c.receiver_id : c.requester_id
      );

      // Fetch profiles, existing members, and existing invites in parallel
      const [{ data: profiles }, { data: memberRows }, { data: inviteRows }] = await Promise.all([
        supabase.from("profiles").select("id, display_name").in("id", otherIds),
        (supabase as any).from("group_members").select("user_id").eq("group_id", groupId),
        (supabase as any).from("group_invites").select("receiver_id").eq("group_id", groupId).eq("status", "pending"),
      ]);

      const memberIds = new Set((memberRows ?? []).map((m: any) => m.user_id));
      const invitedIds = new Set((inviteRows ?? []).map((i: any) => i.receiver_id));

      setConnections(
        (profiles ?? []).map((p) => ({
          userId: p.id,
          displayName: p.display_name ?? "User",
          disabledReason: memberIds.has(p.id)
            ? "Already member"
            : invitedIds.has(p.id)
            ? "Invite sent"
            : undefined,
        }))
      );
      setLoading(false);
    })();
  }, [open, user, groupId]);

  const toggle = (userId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const handleSend = async () => {
    if (!user || selected.size === 0) return;
    setSending(true);

    const rows = Array.from(selected).map((receiverId) => ({
      group_id: groupId,
      sender_id: user.id,
      receiver_id: receiverId,
    }));

    const { error } = await (supabase as any).from("group_invites").insert(rows);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `Invite sent to ${selected.size} connection${selected.size === 1 ? "" : "s"}` });
      onClose();
    }
    setSending(false);
  };

  if (!open) return null;

  const selectableCount = connections.filter((c) => !c.disabledReason).length;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="glass-strong border border-border rounded-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-heading font-bold text-lg flex items-center gap-2">
            <Send className="h-5 w-5 text-primary" /> Share Invite
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          Invite connections to join <span className="font-heading font-semibold text-foreground">{groupName}</span>
        </p>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
          </div>
        ) : connections.length === 0 ? (
          <p className="text-muted-foreground text-center py-6">
            No connections yet. Connect with other learners first!
          </p>
        ) : selectableCount === 0 ? (
          <p className="text-muted-foreground text-center py-6">
            All your connections are already members or have pending invites.
          </p>
        ) : (
          <>
            <div className="max-h-72 overflow-y-auto mb-4">
              <div className="space-y-1">
                {connections.map((c) => (
                  <label
                    key={c.userId}
                    className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${
                      c.disabledReason ? "opacity-50 cursor-not-allowed" : "hover:bg-accent/10 cursor-pointer"
                    }`}
                  >
                    <Checkbox
                      checked={selected.has(c.userId)}
                      onCheckedChange={() => !c.disabledReason && toggle(c.userId)}
                      disabled={!!c.disabledReason}
                    />
                    <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center text-xs font-heading font-bold text-primary-foreground shrink-0">
                      {(c.displayName[0] ?? "U").toUpperCase()}
                    </div>
                    <div>
                      <span className="font-heading text-sm">{c.displayName}</span>
                      {c.disabledReason && (
                        <p className="text-xs text-muted-foreground">{c.disabledReason}</p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <Button
              onClick={handleSend}
              disabled={selected.size === 0 || sending}
              className="w-full gradient-primary text-primary-foreground font-heading font-bold"
            >
              {sending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Send {selected.size > 0 ? `${selected.size} ` : ""}Invite{selected.size !== 1 ? "s" : ""}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
