import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { X, Loader2, Copy, Check } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { generateInviteCode } from "@/lib/inviteCode";
import type { GroupType } from "@/lib/groupLabels";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateGroupModal({ open, onClose, onCreated }: Props) {
  const { user, profile } = useAuth();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<GroupType>("study_group");
  const [creating, setCreating] = useState(false);
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const role = profile?.role ?? "learner";

  if (!open) return null;

  const handleCreate = async () => {
    if (!user || !name.trim()) return;
    setCreating(true);
    const inviteCode = generateInviteCode();

    const { error } = await (supabase as any).from("groups").insert({
      owner_id: user.id,
      name: name.trim(),
      description: description.trim() || null,
      type,
      invite_code: inviteCode,
    });

    setCreating(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    setCreatedCode(inviteCode);
    onCreated();
  };

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = () => {
    setName("");
    setDescription("");
    setType("study_group");
    setCreatedCode(null);
    setCopied(false);
    onClose();
  };

  const inviteLink = createdCode ? `${window.location.origin}/join/${createdCode}` : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={handleClose}>
      <div className="glass-strong p-6 md:p-8 rounded-2xl w-full max-w-md mx-4 relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={handleClose} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground">
          <X className="h-5 w-5" />
        </button>

        {createdCode ? (
          <div className="space-y-4 text-center">
            <h2 className="font-heading text-xl font-bold">Group Created!</h2>
            <p className="text-muted-foreground text-sm">Share this invite code with your members:</p>
            <div className="glass p-4 rounded-lg">
              <p className="font-mono text-2xl font-bold tracking-wider">{createdCode}</p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => handleCopy(createdCode)}
                variant="outline"
                className="flex-1 border-border font-heading font-bold"
              >
                {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                {copied ? "Copied!" : "Copy Code"}
              </Button>
              <Button
                onClick={() => handleCopy(inviteLink)}
                className="flex-1 gradient-primary text-primary-foreground font-heading font-bold"
              >
                <Copy className="mr-2 h-4 w-4" /> Copy Link
              </Button>
            </div>
            <Button onClick={handleClose} variant="ghost" className="w-full">Done</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <h2 className="font-heading text-xl font-bold">Create a Group</h2>

            <div>
              <label className="text-sm font-heading font-semibold mb-1.5 block">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CS101 Spring 2026" className="bg-background/50 border-border" />
            </div>

            <div>
              <label className="text-sm font-heading font-semibold mb-1.5 block">
                Description <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this group about?" rows={2} className="bg-background/50 border-border resize-none" />
            </div>

            <div>
              <label className="text-sm font-heading font-semibold mb-1.5 block">Type</label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { value: "classroom" as GroupType, label: "Classroom", disabled: role !== "educator" && role !== "manager" },
                  { value: "team" as GroupType, label: "Team", disabled: role !== "manager" && role !== "educator" },
                  { value: "study_group" as GroupType, label: "Study Group", disabled: false },
                ]).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => !opt.disabled && setType(opt.value)}
                    disabled={opt.disabled}
                    className={`p-2 rounded-lg border text-sm font-heading font-semibold transition-all ${
                      type === opt.value ? "border-primary bg-primary/10 text-foreground" : opt.disabled ? "border-border text-muted-foreground/50 cursor-not-allowed" : "border-border hover:border-muted-foreground/30 text-muted-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {role === "learner" && (
                <p className="text-xs text-muted-foreground mt-1">Switch to Educator or Manager role in profile settings to create Classrooms or Teams.</p>
              )}
            </div>

            <Button
              onClick={handleCreate}
              disabled={creating || !name.trim()}
              className="w-full gradient-primary text-primary-foreground font-heading font-bold"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {creating ? "Creating..." : "Create Group"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
