import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AuthModal } from "@/components/AuthModal";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppBar } from "@/components/AppBar";
import { Loader2, BookOpen, Plus } from "lucide-react";

export default function Landing() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState<"signin" | "signup">("signup");
  const [activeCount, setActiveCount] = useState(0);
  const [checkingRoadmaps, setCheckingRoadmaps] = useState(false);

  useEffect(() => {
    if (!user) return;
    setCheckingRoadmaps(true);
    supabase
      .from("roadmaps")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .then(({ data }) => {
        setActiveCount(data?.length ?? 0);
        setCheckingRoadmaps(false);
      });
  }, [user]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <>
      {user && <AppBar />}
      <div className={`flex min-h-screen items-center justify-center px-4 ${user ? "pt-14" : ""}`}>
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

        {user && !checkingRoadmaps && (
          <div className="space-y-3">
            {activeCount > 0 && (
              <Button
                onClick={() => navigate("/my-roadmaps")}
                className="w-full sm:w-auto px-10 h-14 text-lg font-heading font-bold gradient-primary text-primary-foreground glow-primary transition-all hover:scale-105"
              >
                <BookOpen className="mr-2 h-5 w-5" />
                View My Roadmaps ({activeCount})
              </Button>
            )}
            {activeCount < 5 && (
              <Button
                onClick={() => navigate("/new")}
                variant={activeCount > 0 ? "outline" : "default"}
                className={`w-full sm:w-auto px-10 h-14 text-lg font-heading font-bold transition-all hover:scale-105 ${
                  activeCount === 0
                    ? "gradient-primary text-primary-foreground glow-primary"
                    : "border-white/10 hover:bg-white/5"
                }`}
              >
                <Plus className="mr-2 h-5 w-5" />
                Generate New Roadmap
              </Button>
            )}
            {activeCount >= 5 && (
              <p className="text-sm text-muted-foreground">You've reached the maximum of 5 active roadmaps. Archive one to create a new one.</p>
            )}
          </div>
        )}

        {!user && (
          <>
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
          </>
        )}
      </div>
      </div>

      <AuthModal open={authOpen} onOpenChange={setAuthOpen} defaultTab={authTab} />
    </>
  );
}
