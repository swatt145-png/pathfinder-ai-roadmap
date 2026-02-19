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
      if (password.length < 6) {
        setError("Password must be at least 6 characters");
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
      <DialogContent className="glass-strong sm:max-w-md border-white/10 p-0 gap-0">
        <div className="flex border-b border-white/10">
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
                    className="bg-white/5 border-white/10 focus:border-primary"
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
                  className="bg-white/5 border-white/10 focus:border-primary"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground text-sm">Password</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 6 characters"
                  required
                  minLength={6}
                  className="bg-white/5 border-white/10 focus:border-primary"
                />
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
