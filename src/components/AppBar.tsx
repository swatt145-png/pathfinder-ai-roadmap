import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Link, useNavigate } from "react-router-dom";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { LogOut, BookOpen, Sun, Moon } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/logo.png";

export function AppBar() {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
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
    <header className="fixed top-0 left-0 right-0 z-50 h-14 flex items-center justify-between px-4 md:px-6 glass-nav">
      <Link
        to="/home"
        className="flex items-center gap-2 font-heading font-bold text-xl md:text-2xl gradient-text focus:outline-none focus:ring-2 focus:ring-primary rounded-sm"
      >
        <img src={logo} alt="PathFinder logo" className="h-9 w-9 object-contain" />
        PathFinder
      </Link>
      <div className="flex items-center gap-3">
        <button
          onClick={toggleTheme}
          className="w-9 h-9 rounded-full flex items-center justify-center border border-border text-foreground hover:bg-muted transition-colors"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="w-9 h-9 rounded-full gradient-primary flex items-center justify-center text-sm font-heading font-bold text-primary-foreground focus:outline-none focus:ring-2 focus:ring-primary">
              {initial}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="glass-strong border-border">
            <DropdownMenuItem onClick={signOut} className="text-muted-foreground hover:text-foreground cursor-pointer">
              <LogOut className="mr-2 h-4 w-4" /> Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
