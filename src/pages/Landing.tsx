import { useState, useRef } from "react";
import { AuthModal } from "@/components/AuthModal";
import { Button } from "@/components/ui/button";
import { Compass, BarChart3, Zap, Brain, Loader2, Search, RefreshCw, Sun, Moon } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { HowItWorks } from "@/components/HowItWorks";
import { ExploreCategories } from "@/components/ExploreCategories";
import logo from "@/assets/logo.png";

export default function Landing() {
  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState<"signin" | "signup">("signup");
  const [guestLoading, setGuestLoading] = useState(false);
  const { signInAsGuest } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const features = [
    { icon: Compass, text: "Personalized roadmaps for any tech skill" },
    { icon: BarChart3, text: "Adapts based on your actual progress" },
    { icon: Zap, text: "Real resources, real quizzes, real results" },
    { icon: Brain, text: "AI-powered insights & smart recommendations" },
  ];

  const handleGuestLogin = async () => {
    setGuestLoading(true);
    await signInAsGuest();
    setGuestLoading(false);
  };

  return (
    <>
      <div className="fixed top-4 right-4 z-50">
        <button
          onClick={toggleTheme}
          className="w-10 h-10 rounded-full flex items-center justify-center border border-border bg-card text-foreground hover:bg-muted transition-colors shadow-sm"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>
      </div>
      <div className="flex min-h-[80vh] items-center justify-center px-4 pb-0">
        <div className="text-center max-w-xl animate-fade-in">
          <img src={logo} alt="PathFinder logo" className="h-36 w-36 mx-auto mb-5 object-contain" />
          <h1 className="font-heading text-6xl md:text-7xl font-extrabold gradient-text mb-4">
            PathFinder
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground mb-10 font-body">
            Your AI-powered learning companion that adapts to you
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-10">
            {features.map((f) => (
              <div key={f.text} className="flex items-center gap-3 glass-blue px-5 py-4 text-left rounded-xl">
                <f.icon className="w-6 h-6 text-primary shrink-0" />
                <span className="text-base text-foreground/90">{f.text}</span>
              </div>
            ))}
          </div>

          <Button
            onClick={() => { setAuthTab("signup"); setAuthOpen(true); }}
            className="w-full sm:w-auto px-10 h-14 text-lg font-heading font-bold gradient-primary text-primary-foreground transition-all hover:scale-105 hover:shadow-md"
          >
            Get Started
          </Button>

          <div className="mt-5 flex items-center justify-center gap-5 text-base">
            <button
              onClick={() => { setAuthTab("signin"); setAuthOpen(true); }}
              className="text-primary hover:underline font-semibold text-base"
            >
              Sign In
            </button>
            <span className="text-border">|</span>
            <button
              onClick={() => { setAuthTab("signup"); setAuthOpen(true); }}
              className="text-primary hover:underline font-semibold text-base"
            >
              Sign Up
            </button>
          </div>

          <button
            onClick={handleGuestLogin}
            disabled={guestLoading}
            className="mt-5 glass-blue px-8 py-3 rounded-xl text-base font-semibold text-foreground/80 border-2 border-border hover:text-foreground hover:border-primary/50 hover:bg-primary/10 hover:shadow-lg hover:scale-[1.03] transition-all"
          >
            {guestLoading ? (
              <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Entering as guest…</span>
            ) : (
              "Continue as Guest"
            )}
          </button>
        </div>
      </div>

      <HowItWorks />
      <ExploreCategories />

      <AuthModal open={authOpen} onOpenChange={setAuthOpen} defaultTab={authTab} />
    </>
  );
}
