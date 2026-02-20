import { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: "signin" | "signup";
}

const PASSWORD_RULES = [
  { test: (p: string) => p.length >= 8, label: "At least 8 characters" },
  { test: (p: string) => /[A-Z]/.test(p), label: "At least 1 uppercase letter" },
  { test: (p: string) => /[a-z]/.test(p), label: "At least 1 lowercase letter" },
  { test: (p: string) => /[0-9]/.test(p), label: "At least 1 number" },
  { test: (p: string) => /[^A-Za-z0-9]/.test(p), label: "At least 1 special character" },
];

export function AuthModal({ open, onOpenChange, defaultTab = "signup" }: AuthModalProps) {
  const [tab, setTab] = useState<"signin" | "signup">(defaultTab);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [signUpSuccess, setSignUpSuccess] = useState(false);
  const { signUp, signIn } = useAuth();

  // Load saved email on mount
  useEffect(() => {
    const savedEmail = localStorage.getItem("rememberedEmail");
    if (savedEmail) {
      setEmail(savedEmail);
      setRememberMe(true);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (tab === "signup") {
      const allPass = PASSWORD_RULES.every((r) => r.test(password));
      if (!allPass) {
        setError("Password does not meet all requirements");
        setLoading(false);
        return;
      }
      const { error } = await signUp(email, password, displayName);
      if (error) setError(error);
      else setSignUpSuccess(true);
    } else {
      const { error } = await signIn(email, password);
      if (error) {
        setError(error);
      } else {
        if (rememberMe) {
          localStorage.setItem("rememberedEmail", email);
        } else {
          localStorage.removeItem("rememberedEmail");
        }
        onOpenChange(false);
      }
    }
    setLoading(false);
  };

  const switchTab = (t: "signin" | "signup") => {
    setTab(t);
    setError(null);
    setSignUpSuccess(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong sm:max-w-md border-border p-0 gap-0">
        <div className="flex border-b border-border">
          <button
            onClick={() => switchTab("signup")}
            className={`flex-1 py-4 text-sm font-heading font-semibold transition-colors ${tab === "signup" ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            Sign Up
          </button>
          <button
            onClick={() => switchTab("signin")}
            className={`flex-1 py-4 text-sm font-heading font-semibold transition-colors ${tab === "signin" ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            Sign In
          </button>
        </div>

        <div className="p-6">
          {signUpSuccess ? (
            <div className="text-center py-4">
              <p className="text-success font-semibold mb-2">Account created!</p>
              <p className="text-muted-foreground text-sm">Check your email to verify your account, then sign in.</p>
              <Button className="mt-4 w-full gradient-primary text-primary-foreground font-heading" onClick={() => switchTab("signin")}>
                Go to Sign In
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {tab === "signup" && (
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-sm">Display Name</Label>
                  <Input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your name"
                    required
                    className="bg-muted/50 border-border focus:border-primary"
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label className="text-muted-foreground text-sm">Email</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="bg-muted/50 border-border focus:border-primary"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground text-sm">Password</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={tab === "signup" ? "Create a strong password" : "Your password"}
                  required
                  minLength={tab === "signup" ? 8 : 6}
                  className="bg-muted/50 border-border focus:border-primary"
                />
                {tab === "signup" && (
                  <ul className="mt-1 space-y-0.5">
                    {PASSWORD_RULES.map((rule) => (
                      <li key={rule.label} className={`text-xs flex items-center gap-1.5 ${password && rule.test(password) ? "text-success" : "text-muted-foreground"}`}>
                        <span>{rule.test(password) ? "✓" : "○"}</span> {rule.label}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {tab === "signin" && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="remember"
                    checked={rememberMe}
                    onCheckedChange={(checked) => setRememberMe(checked === true)}
                  />
                  <Label htmlFor="remember" className="text-muted-foreground text-sm cursor-pointer">
                    Remember me
                  </Label>
                </div>
              )}
              {error && <p className="text-destructive text-sm">{error}</p>}
              <Button type="submit" disabled={loading} className="w-full gradient-primary text-primary-foreground font-heading font-semibold h-12">
                {loading ? <Loader2 className="animate-spin" /> : tab === "signup" ? "Create Account" : "Sign In"}
              </Button>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
