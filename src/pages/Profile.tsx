import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { AppBar } from "@/components/AppBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { User, Mail, MapPin, Globe, Phone, FileText, Save, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export default function Profile() {
  const { user, profile } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [location, setLocation] = useState("");
  const [website, setWebsite] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name, bio, location, website, phone")
        .eq("id", user.id)
        .single();
      if (data) {
        setDisplayName(data.display_name ?? "");
        setBio(data.bio ?? "");
        setLocation(data.location ?? "");
        setWebsite(data.website ?? "");
        setPhone(data.phone ?? "");
      }
      setLoading(false);
    })();
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: displayName, bio, location, website, phone })
      .eq("id", user.id);
    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Profile updated", description: "Your changes have been saved." });
    }
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

  const email = user?.email ?? "Guest user";
  const initial = (displayName?.[0] ?? email?.[0] ?? "U").toUpperCase();

  return (
    <>
      <AppBar />
      <div className="min-h-screen pt-20 pb-24 px-4 md:px-12">
        <div className="max-w-2xl mx-auto animate-fade-in">
          {/* Avatar & header */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-20 h-20 rounded-full gradient-primary flex items-center justify-center text-3xl font-heading font-bold text-primary-foreground mb-4">
              {initial}
            </div>
            <h1 className="font-heading text-2xl md:text-3xl font-bold gradient-text">My Profile</h1>
            <p className="text-muted-foreground text-sm mt-1">{email}</p>
          </div>

          {/* Form */}
          <div className="glass-strong p-6 md:p-8 space-y-5">
            {/* Display Name */}
            <div>
              <label className="text-sm font-heading font-semibold text-foreground flex items-center gap-2 mb-1.5">
                <User className="w-4 h-4 text-primary" /> Display Name
              </label>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                className="bg-background/50 border-border"
              />
            </div>

            {/* Email (read-only) */}
            <div>
              <label className="text-sm font-heading font-semibold text-foreground flex items-center gap-2 mb-1.5">
                <Mail className="w-4 h-4 text-primary" /> Email
              </label>
              <Input value={email} disabled className="bg-muted/50 border-border text-muted-foreground" />
            </div>

            {/* Bio */}
            <div>
              <label className="text-sm font-heading font-semibold text-foreground flex items-center gap-2 mb-1.5">
                <FileText className="w-4 h-4 text-primary" /> Bio <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <Textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell us a little about yourself..."
                rows={3}
                className="bg-background/50 border-border resize-none"
              />
            </div>

            {/* Location */}
            <div>
              <label className="text-sm font-heading font-semibold text-foreground flex items-center gap-2 mb-1.5">
                <MapPin className="w-4 h-4 text-primary" /> Location <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <Input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. San Francisco, CA"
                className="bg-background/50 border-border"
              />
            </div>

            {/* Website */}
            <div>
              <label className="text-sm font-heading font-semibold text-foreground flex items-center gap-2 mb-1.5">
                <Globe className="w-4 h-4 text-primary" /> Website <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <Input
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://yoursite.com"
                className="bg-background/50 border-border"
              />
            </div>

            {/* Phone */}
            <div>
              <label className="text-sm font-heading font-semibold text-foreground flex items-center gap-2 mb-1.5">
                <Phone className="w-4 h-4 text-primary" /> Phone <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 (555) 123-4567"
                className="bg-background/50 border-border"
              />
            </div>

            <Button
              onClick={handleSave}
              disabled={saving}
              className="w-full gradient-primary text-primary-foreground font-heading font-bold h-12 text-base transition-all glow-primary"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
              {saving ? "Saving..." : "Save Profile"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
