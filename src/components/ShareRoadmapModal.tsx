import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Share2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Connection {
  userId: string;
  displayName: string;
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    setSelected(new Set());
    setLoading(true);

    (async () => {
      // Fetch accepted connections
      const { data: connData } = await supabase
        .from("connections")
        .select("requester_id, receiver_id")
        .eq("status", "accepted")
        .or(`requester_id.eq.${user.id},receiver_id.eq.${user.id}`);

      if (!connData || connData.length === 0) {
        setConnections([]);
        setLoading(false);
        return;
      }

      // Get the other user's ID from each connection
      const otherIds = connData.map((c) =>
        c.requester_id === user.id ? c.receiver_id : c.requester_id
      );

      // Fetch their profiles
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
      setLoading(false);
    })();
  }, [open, user]);

  const toggleSelection = (userId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const handleShare = async () => {
    if (!user || selected.size === 0) return;
    setSending(true);

    const rows = Array.from(selected).map((receiverId) => ({
      sender_id: user.id,
      receiver_id: receiverId,
      roadmap_id: roadmapId,
    }));

    const { error } = await supabase.from("shared_roadmaps").insert(rows);

    if (error) {
      toast({
        title: "Error",
        description: "Could not share roadmap.",
        variant: "destructive",
      });
    } else {
      toast({ title: `Roadmap shared with ${selected.size} connection${selected.size > 1 ? "s" : ""}!` });
      onClose();
    }
    setSending(false);
  };

  if (!open) return null;

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
        ) : connections.length === 0 ? (
          <p className="text-muted-foreground text-center py-6">
            No connections yet. Connect with other learners first!
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mb-3">
              Select connections to share this roadmap with:
            </p>
            <div className="space-y-2 max-h-60 overflow-y-auto mb-4">
              {connections.map((c) => (
                <label
                  key={c.userId}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/10 cursor-pointer transition-colors"
                >
                  <Checkbox
                    checked={selected.has(c.userId)}
                    onCheckedChange={() => toggleSelection(c.userId)}
                  />
                  <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center text-xs font-heading font-bold text-primary-foreground shrink-0">
                    {(c.displayName[0] ?? "U").toUpperCase()}
                  </div>
                  <span className="font-heading text-sm">{c.displayName}</span>
                </label>
              ))}
            </div>
            <Button
              onClick={handleShare}
              disabled={selected.size === 0 || sending}
              className="w-full gradient-primary text-primary-foreground font-heading font-bold"
            >
              {sending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Share2 className="mr-2 h-4 w-4" />
              )}
              Share with {selected.size || ""} {selected.size === 1 ? "person" : selected.size > 1 ? "people" : "selected"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
