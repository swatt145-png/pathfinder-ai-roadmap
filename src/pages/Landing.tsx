import { useState } from "react";
import { AuthModal } from "@/components/AuthModal";
import { Button } from "@/components/ui/button";
import { Compass, BarChart3, Zap } from "lucide-react";
import logo from "@/assets/logo.png";

export default function Landing() {
  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState<"signin" | "signup">("signup");

  const features = [
    { icon: Compass, text: "Personalized roadmaps for any tech skill" },
    { icon: BarChart3, text: "Adapts based on your actual progress" },
    { icon: Zap, text: "Real resources, real quizzes, real results" },
  ];

  return (
    <>
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center max-w-lg animate-fade-in">
          <img src={logo} alt="PathFinder logo" className="h-24 w-24 mx-auto mb-4 object-contain rounded-full ring-2 ring-white/80" />
          <h1 className="font-heading text-5xl md:text-6xl font-extrabold gradient-text mb-4">
            PathFinder
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground mb-10 font-body">
            Your AI-powered learning companion that adapts to you
          </p>

          <div className="space-y-4 mb-10">
            {features.map((f) => (
              <div key={f.text} className="flex items-center gap-3 glass px-4 py-3 text-left">
                <f.icon className="w-5 h-5 text-primary shrink-0" />
                <span className="text-sm text-foreground/90">{f.text}</span>
              </div>
            ))}
          </div>

          <Button
            onClick={() => { setAuthTab("signup"); setAuthOpen(true); }}
            className="w-full sm:w-auto px-10 h-14 text-lg font-heading font-bold gradient-primary text-primary-foreground glow-primary transition-all hover:scale-105"
          >
            Get Started
          </Button>

          <p className="mt-4 text-sm text-muted-foreground">
            Already have an account?{" "}
            <button
              onClick={() => { setAuthTab("signin"); setAuthOpen(true); }}
              className="text-primary hover:underline font-medium"
            >
              Sign In
            </button>
          </p>
        </div>
      </div>

      <AuthModal open={authOpen} onOpenChange={setAuthOpen} defaultTab={authTab} />
    </>
  );
}
