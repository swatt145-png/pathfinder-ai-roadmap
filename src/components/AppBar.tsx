import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Link, useNavigate } from "react-router-dom";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { LogOut, BookOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/logo.png";

export function AppBar() {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const initial = (profile?.display_name?.[0] ?? "U").toUpperCase();
  const [activeCount, setActiveCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("roadmaps")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .then(({ data }) => setActiveCount(data?.length ?? 0));
  }, [user]);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-14 flex items-center justify-between px-4 md:px-6 border-b border-white/5 bg-background/80 backdrop-blur-lg">
      <Link
        to="/home"
        className="flex items-center gap-2 font-heading font-bold text-lg gradient-text focus:outline-none focus:ring-2 focus:ring-primary rounded-sm"
      >
        <img src={logo} alt="PathFinder logo" className="h-8 w-8 object-contain rounded-full ring-2 ring-white/80" />
        PathFinder
      </Link>
      <div className="flex items-center gap-3">
        {activeCount > 0 && (
          <Button
            onClick={() => navigate("/my-roadmaps")}
            className="h-9 px-4 text-sm font-heading font-bold gradient-primary text-primary-foreground glow-primary transition-all hover:scale-105"
          >
            <BookOpen className="mr-2 h-4 w-4" />
            My Roadmaps ({activeCount})
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="w-9 h-9 rounded-full gradient-primary flex items-center justify-center text-sm font-heading font-bold text-primary-foreground focus:outline-none focus:ring-2 focus:ring-primary">
              {initial}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="glass-strong border-white/10">
            <DropdownMenuItem onClick={signOut} className="text-muted-foreground hover:text-foreground cursor-pointer">
              <LogOut className="mr-2 h-4 w-4" /> Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
