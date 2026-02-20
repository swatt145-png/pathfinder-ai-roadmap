import { useState } from "react";
import { AuthModal } from "@/components/AuthModal";
import { Button } from "@/components/ui/button";
import { Compass, BarChart3, Zap, Brain, Loader2, Sun, Moon } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { HowItWorks } from "@/components/HowItWorks";
import { ExploreCategories } from "@/components/ExploreCategories";
import { WhyPathfinder } from "@/components/WhyPathfinder";
import { PopularSkills } from "@/components/PopularSkills";
import logo from "@/assets/logo.png";

export default function Landing() {
  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState<"signin" | "signup">("signup");
  const [guestLoading, setGuestLoading] = useState(false);
  const { signInAsGuest } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const features = [
    { icon: Compass, text: "Personalized roadmaps for any skill" },
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

      {/* Hero Section — with decorative shapes */}
      <section className="relative flex min-h-[85vh] items-center justify-center px-4 pb-0 overflow-hidden">
        {/* Decorative shapes */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {/* Top-left violet glow */}
          <div
            className="absolute -top-20 -left-20 w-80 h-80 rounded-full opacity-20 blur-3xl"
            style={{ background: "hsl(var(--violet) / 0.4)" }}
          />
          {/* Bottom-right primary glow */}
          <div
            className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full opacity-15 blur-3xl"
            style={{ background: "hsl(var(--primary) / 0.5)" }}
          />
          {/* Geometric accents */}
          <div
            className="absolute top-[15%] right-[10%] w-24 h-24 rounded-full border border-primary/10 opacity-30"
          />
          <div
            className="absolute bottom-[20%] left-[8%] w-16 h-16 rounded-lg border border-violet/10 opacity-25 rotate-45"
          />
          <div
            className="absolute top-[40%] left-[5%] w-3 h-3 rounded-full bg-primary/20"
          />
          <div
            className="absolute top-[25%] right-[25%] w-2 h-2 rounded-full bg-violet/30"
          />
          <div
            className="absolute bottom-[35%] right-[15%] w-4 h-4 rounded-full bg-primary/15"
          />
          {/* Diagonal line accent */}
          <div
            className="absolute top-0 right-[30%] w-px h-40 opacity-10 rotate-[30deg]"
            style={{ background: "linear-gradient(to bottom, hsl(var(--violet) / 0.5), transparent)" }}
          />
        </div>

        <div className="relative z-10 text-center max-w-xl animate-fade-in">
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
            className="w-full sm:w-auto px-10 h-14 text-lg font-heading font-bold gradient-primary text-primary-foreground transition-all hover:scale-105 glow-primary"
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
            className="mt-5 glass-blue px-8 py-3 rounded-xl text-base font-semibold text-foreground/80"
          >
            {guestLoading ? (
              <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Entering as guest…</span>
            ) : (
              "Continue as Guest"
            )}
          </button>
        </div>
      </section>

      <HowItWorks />
      <ExploreCategories />
      <WhyPathfinder />
      <PopularSkills />

      <AuthModal open={authOpen} onOpenChange={setAuthOpen} defaultTab={authTab} />
    </>
  );
}
