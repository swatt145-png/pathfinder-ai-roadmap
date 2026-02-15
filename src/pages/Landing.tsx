import { useState } from "react";
import { AuthModal } from "@/components/AuthModal";
import { Button } from "@/components/ui/button";

export default function Landing() {
  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState<"signin" | "signup">("signup");

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center max-w-lg animate-fade-in">
        <h1 className="font-heading text-5xl md:text-6xl font-extrabold gradient-text mb-4">
          🧭 Pathfinder
        </h1>
        <p className="text-lg md:text-xl text-muted-foreground mb-10 font-body">
          Your AI-powered learning companion that adapts to you
        </p>

        <div className="space-y-4 mb-10">
          {[
            { icon: "🎯", text: "Personalized roadmaps for any tech skill" },
            { icon: "📊", text: "Adapts based on your actual progress" },
            { icon: "⚡", text: "Real resources, real quizzes, real results" },
          ].map((f) => (
            <div key={f.text} className="flex items-center gap-3 glass px-4 py-3 text-left">
              <span className="text-xl">{f.icon}</span>
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

      <AuthModal open={authOpen} onOpenChange={setAuthOpen} defaultTab={authTab} />
    </div>
  );
}
