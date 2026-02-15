import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LogOut } from "lucide-react";

export function AppBar() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const initial = (profile?.display_name?.[0] ?? "U").toUpperCase();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-14 flex items-center justify-between px-4 md:px-6 border-b border-white/5 bg-background/80 backdrop-blur-lg">
      <button
        type="button"
        onClick={() => navigate("/")}
        className="font-heading font-bold text-lg gradient-text focus:outline-none"
      >
        🧭 Pathfinder
      </button>
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
    </header>
  );
}
