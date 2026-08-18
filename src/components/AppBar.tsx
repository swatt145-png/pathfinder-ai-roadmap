import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Link, useNavigate } from "react-router-dom";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { LogOut, User, Sun, Moon, Globe, BookOpen, Users } from "lucide-react";
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
    <header className="fixed top-0 left-0 right-0 z-50 h-14 flex items-center justify-between px-6 md:px-8 glass-nav">
      <Link
        to="/home"
        className="flex items-center gap-2 font-heading font-bold text-xl md:text-2xl gradient-text focus:outline-none focus:ring-2 focus:ring-primary rounded-sm"
      >
        <img src={logo} alt="WayVion logo" className="h-9 w-9 object-contain" />
        <span className="hidden sm:inline">WayVion</span>
      </Link>
      <div className="flex items-center gap-2 sm:gap-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to="/my-roadmaps"
              className="w-9 h-9 rounded-full flex items-center justify-center border border-border text-foreground hover:bg-muted transition-colors"
              aria-label="My Roadmaps"
            >
              <BookOpen className="h-5 w-5" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>My Roadmaps</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to="/groups"
              className="w-9 h-9 rounded-full flex items-center justify-center border border-border text-foreground hover:bg-muted transition-colors"
              aria-label="My Groups"
            >
              <Users className="h-5 w-5" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>My Groups</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to="/community"
              className="w-9 h-9 rounded-full flex items-center justify-center border border-border text-foreground hover:bg-muted transition-colors"
              aria-label="Community"
            >
              <Globe className="h-5 w-5" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Community</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleTheme}
              className="w-9 h-9 rounded-full flex items-center justify-center border border-border text-foreground hover:bg-muted transition-colors"
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{theme === "dark" ? "Light mode" : "Dark mode"}</p>
          </TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button className="w-9 h-9 rounded-full gradient-primary flex items-center justify-center text-sm font-heading font-bold text-primary-foreground focus:outline-none focus:ring-2 focus:ring-primary">
                  {initial}
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Profile</p>
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="glass-strong border-border">
            <DropdownMenuItem onClick={() => navigate("/profile")} className="text-muted-foreground hover:text-foreground cursor-pointer">
              <User className="mr-2 h-4 w-4" /> My Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={signOut} className="text-muted-foreground hover:text-foreground cursor-pointer">
              <LogOut className="mr-2 h-4 w-4" /> Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

    </header>
  );
}
