import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase-safe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

const PASSWORD_RULES = [
  { test: (p: string) => p.length >= 8, label: "At least 8 characters" },
  { test: (p: string) => /[0-9]/.test(p), label: "Contains a number" },
  { test: (p: string) => /[^A-Za-z0-9]/.test(p), label: "Contains a special character" },
];

export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isRecovery, setIsRecovery] = useState(false);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("type=recovery")) {
      setIsRecovery(true);
    }
    // Listen for recovery event
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsRecovery(true);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    const allPass = PASSWORD_RULES.every((r) => r.test(password));
    if (!allPass) {
      setError("Password does not meet all requirements");
      return;
    }
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
    } else {
      setSuccess(true);
    }
    setLoading(false);
  };

  if (!isRecovery && !success) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="glass-blue p-8 max-w-md w-full text-center">
          <p className="text-muted-foreground">Invalid or expired reset link.</p>
          <Button onClick={() => navigate("/")} className="mt-4 gradient-primary text-primary-foreground font-heading">Go Home</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="glass-blue p-8 max-w-md w-full">
        {success ? (
          <div className="text-center">
            <p className="text-success font-semibold mb-2">Password updated!</p>
            <p className="text-muted-foreground text-sm mb-4">You can now sign in with your new password.</p>
            <Button onClick={() => navigate("/")} className="gradient-primary text-primary-foreground font-heading">Go to Sign In</Button>
          </div>
        ) : (
          <form onSubmit={handleReset} className="space-y-4">
            <h2 className="font-heading text-xl font-bold">Set New Password</h2>
            <div className="space-y-2">
              <Label className="text-muted-foreground text-sm">New Password</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter new password"
                required
                className="bg-muted/50 border-border focus:border-primary"
              />
              <ul className="mt-1 space-y-0.5">
                {PASSWORD_RULES.map((rule) => (
                  <li key={rule.label} className={`text-xs flex items-center gap-1.5 ${password && rule.test(password) ? "text-success" : "text-muted-foreground"}`}>
                    <span>{rule.test(password) ? "✓" : "○"}</span> {rule.label}
                  </li>
                ))}
              </ul>
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full gradient-primary text-primary-foreground font-heading font-semibold h-12">
              {loading ? <Loader2 className="animate-spin" /> : "Update Password"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
