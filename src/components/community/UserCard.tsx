import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { UserPlus, Clock, UserCheck, Check, BookOpen } from "lucide-react";

interface UserCardProps {
  userId: string;
  displayName: string;
  bio: string | null;
  topics: string[];
  points: number;
  connectionStatus: "none" | "pending_sent" | "pending_received" | "accepted";
  onConnect: (userId: string) => void;
  onAccept: (userId: string) => void;
}

export function UserCard({
  userId,
  displayName,
  bio,
  topics,
  points,
  connectionStatus,
  onConnect,
  onAccept,
}: UserCardProps) {
  const navigate = useNavigate();
  const initial = (displayName?.[0] ?? "U").toUpperCase();

  return (
    <div
      className="glass-blue p-5 flex flex-col gap-3 cursor-pointer hover:bg-accent/10 transition-all"
      onClick={() => navigate(`/user/${userId}`)}
    >
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-full gradient-primary flex items-center justify-center text-sm font-heading font-bold text-primary-foreground shrink-0">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-heading font-bold text-base truncate">{displayName || "User"}</p>
          {bio ? (
            <p className="text-sm text-muted-foreground line-clamp-1">{bio}</p>
          ) : topics.length > 0 ? (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <BookOpen className="h-3 w-3" /> Learning {topics.length} topic{topics.length !== 1 ? "s" : ""}
            </p>
          ) : null}
        </div>
        <span className="text-xs font-heading font-bold px-2 py-1 rounded-full bg-warning/20 text-warning shrink-0">
          {points} pts
        </span>
      </div>

      {topics.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {topics.slice(0, 4).map((topic) => (
            <span
              key={topic}
              className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-heading"
            >
              {topic}
            </span>
          ))}
          {topics.length > 4 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-muted/50 text-muted-foreground font-heading">
              +{topics.length - 4}
            </span>
          )}
        </div>
      )}

      <div
        onClick={(e) => e.stopPropagation()}
        className="mt-auto"
      >
        {connectionStatus === "none" && (
          <Button
            onClick={() => onConnect(userId)}
            size="sm"
            className="w-full gradient-primary text-primary-foreground font-heading font-bold text-xs h-8"
          >
            <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Connect
          </Button>
        )}
        {connectionStatus === "pending_sent" && (
          <Button
            size="sm"
            disabled
            className="w-full font-heading font-bold text-xs h-8 opacity-60"
          >
            <Clock className="mr-1.5 h-3.5 w-3.5" /> Pending
          </Button>
        )}
        {connectionStatus === "pending_received" && (
          <Button
            onClick={() => onAccept(userId)}
            size="sm"
            className="w-full gradient-primary text-primary-foreground font-heading font-bold text-xs h-8"
          >
            <Check className="mr-1.5 h-3.5 w-3.5" /> Accept
          </Button>
        )}
        {connectionStatus === "accepted" && (
          <Button
            size="sm"
            disabled
            className="w-full font-heading font-bold text-xs h-8 bg-success/20 text-success"
          >
            <UserCheck className="mr-1.5 h-3.5 w-3.5" /> Connected
          </Button>
        )}
      </div>
    </div>
  );
}
