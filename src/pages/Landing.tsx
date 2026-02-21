import { useState } from "react";
import { AuthModal } from "@/components/AuthModal";
import { Button } from "@/components/ui/button";
import { Compass, BarChart3, Zap, Brain, Loader2, Sun, Moon } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { HowItWorks } from "@/components/HowItWorks";
import { ExploreCategories } from "@/components/ExploreCategories";
import { WhyWayVion } from "@/components/WhyPathfinder";

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
  { icon: Brain, text: "AI-powered insights & smart recommendations" }];


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
          aria-label="Toggle theme">

          {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>
      </div>

      {/* Hero Section — with decorative shapes */}
      <section className="relative flex min-h-[85vh] items-center justify-center px-4 pb-8 overflow-hidden">
        {/* Fluid wave background */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {/* Top-left violet glow */}
          <div
            className="absolute -top-20 -left-20 w-80 h-80 rounded-full opacity-20 blur-3xl"
            style={{ background: "hsl(var(--violet) / 0.4)" }} />

          {/* Bottom-right primary glow */}
          <div
            className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full opacity-15 blur-3xl"
            style={{ background: "hsl(var(--primary) / 0.5)" }} />

          {/* Fluid wave shapes — inspired by abstract fluid backgrounds */}
          <svg className="absolute inset-0 w-full h-full hero-waves" viewBox="0 0 1440 900" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0,300 C360,450 720,150 1080,350 C1260,450 1440,280 1440,280 L1440,0 L0,0 Z" className="hero-wave-1" />
            <path d="M0,500 C200,350 500,550 800,400 C1100,250 1300,500 1440,450 L1440,900 L0,900 Z" className="hero-wave-2" />
            <path d="M0,650 C300,550 600,750 900,600 C1200,450 1440,700 1440,700 L1440,900 L0,900 Z" className="hero-wave-3" />
          </svg>
          {/* Geometric accents */}
          <div className="absolute top-[15%] right-[10%] w-24 h-24 rounded-full border border-primary/10 opacity-30" />
          <div className="absolute bottom-[20%] left-[8%] w-16 h-16 rounded-lg border border-violet/10 opacity-25 rotate-45" />
          <div className="absolute top-[40%] left-[5%] w-3 h-3 rounded-full bg-primary/20" />
          <div className="absolute top-[25%] right-[25%] w-2 h-2 rounded-full bg-violet/30" />
          <div className="absolute bottom-[35%] right-[15%] w-4 h-4 rounded-full bg-primary/15" />
        </div>

        <div className="relative z-10 text-center max-w-xl animate-fade-in">
          <img src={logo} alt="WayVion logo" className="h-36 w-36 mx-auto mb-5 mt-8 object-contain" />
          <h1 className="font-heading text-6xl md:text-7xl font-extrabold gradient-text mb-4">WayVion

          </h1>
          <p className="text-lg md:text-xl text-muted-foreground mb-10 font-body">
            Your AI-powered learning companion that adapts to you
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-10">
            {features.map((f) =>
            <div key={f.text} className="flex items-center gap-3 glass-blue px-5 py-4 text-left rounded-xl">
                <f.icon className="w-6 h-6 text-primary shrink-0" />
                <span className="text-base text-foreground/90">{f.text}</span>
              </div>
            )}
          </div>

          <div id="hero-auth">
            <Button
              onClick={() => {setAuthTab("signup");setAuthOpen(true);}}
              className="w-full sm:w-auto px-10 h-14 text-lg font-heading font-bold gradient-primary text-primary-foreground transition-all hover:scale-105 glow-primary">

              Get Started
            </Button>

            <div className="mt-5 flex items-center justify-center gap-5 text-base">
              <button
                onClick={() => {setAuthTab("signin");setAuthOpen(true);}}
                className="text-primary hover:underline font-semibold text-base">

                Sign In
              </button>
              <span className="text-border">|</span>
              <button
                onClick={() => {setAuthTab("signup");setAuthOpen(true);}}
                className="text-primary hover:underline font-semibold text-base">

                Sign Up
              </button>
            </div>

            <button
              onClick={handleGuestLogin}
              disabled={guestLoading}
              className="mt-5 glass-blue px-8 py-3 rounded-xl text-base font-semibold text-foreground/80">

              {guestLoading ?
              <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Entering as guest…</span> :

              "Continue as Guest"
              }
            </button>
          </div>
        </div>
      </section>

      <HowItWorks />
      <WhyWayVion />
      <ExploreCategories />

      {/* Footer */}
      <footer className="relative bg-gradient-to-r from-[hsl(var(--primary)/0.9)] to-[hsl(var(--primary-dark,var(--primary))/0.95)] text-primary-foreground py-10 px-4">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="text-center md:text-left space-y-2">
            <p className="font-heading font-bold text-lg">WayVion</p>
            <p className="text-sm opacity-80">© {new Date().getFullYear()} WayVion. All rights reserved.</p>
            <p className="text-sm opacity-70">Built with ❤️ for lifelong learners.</p>
            <div className="flex gap-4 justify-center md:justify-start text-sm opacity-80">
              <a href="#" className="hover:underline">Terms & Conditions</a>
              <a href="#" className="hover:underline">Privacy Policy</a>
            </div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <p className="text-xs opacity-70">Scan to access on mobile</p>
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent("https://wayvion.lovable.app")}&bgcolor=transparent&color=ffffff`}
              alt="QR Code"
              className="w-32 h-32 rounded-lg bg-white/10 p-1" />

          </div>
        </div>
      </footer>

      <AuthModal open={authOpen} onOpenChange={setAuthOpen} defaultTab={authTab} />
    </>);

}