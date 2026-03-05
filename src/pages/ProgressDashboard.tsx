import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppBar } from "@/components/AppBar";
import WavyBackground from "@/components/WavyBackground";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, Users, BarChart3, Clock, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { getGroupLabels, type GroupType } from "@/lib/groupLabels";

interface MemberProgress {
  memberId: string;
  displayName: string;
  memberRoadmapId: string;
  completedModules: number;
  totalModules: number;
  completionPct: number;
  avgQuizScore: number | null;
  totalTimeMinutes: number;
  hardModules: number;
  lastActive: string | null;
  modules: ModuleProgress[];
}

interface ModuleProgress {
  moduleId: string;
  moduleTitle: string;
  status: string;
  quizScore: number | null;
  timeSpentMinutes: number | null;
  selfReport: string | null;
  completedAt: string | null;
}

export default function ProgressDashboard() {
  const { groupId, roadmapId } = useParams<{ groupId: string; roadmapId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [groupName, setGroupName] = useState("");
  const [groupType, setGroupType] = useState<GroupType>("study_group");
  const [roadmapTopic, setRoadmapTopic] = useState("");
  const [memberProgress, setMemberProgress] = useState<MemberProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"name" | "completion" | "quiz">("completion");

  useEffect(() => {
    if (!user || !groupId || !roadmapId) return;

    (async () => {
      // Get group info
      const { data: g } = await (supabase as any)
        .from("groups")
        .select("name, type")
        .eq("id", groupId)
        .single();

      if (g) {
        setGroupName(g.name);
        setGroupType(g.type as GroupType);
      }

      // Get roadmap topic
      const { data: rm } = await supabase.from("roadmaps").select("topic").eq("id", roadmapId).single();
      setRoadmapTopic(rm?.topic ?? "Unknown");

      // Get group_roadmap record
      const { data: gr } = await (supabase as any)
        .from("group_roadmaps")
        .select("id")
        .eq("group_id", groupId)
        .eq("roadmap_id", roadmapId)
        .single();

      if (!gr) {
        setLoading(false);
        return;
      }

      // Get all member_group_roadmaps for this assignment
      const { data: mgrs } = await (supabase as any)
        .from("member_group_roadmaps")
        .select("member_id, roadmap_id")
        .eq("group_roadmap_id", gr.id);

      const progressData: MemberProgress[] = [];

      for (const mgr of mgrs ?? []) {
        // Get member name
        const { data: profile } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("id", mgr.member_id)
          .single();

        // Get member's roadmap for total modules
        const { data: memberRm } = await supabase
          .from("roadmaps")
          .select("completed_modules, total_modules, last_activity_date")
          .eq("id", mgr.roadmap_id)
          .single();

        // Get progress records
        const { data: progressRows } = await supabase
          .from("progress")
          .select("module_id, module_title, status, quiz_score, time_spent_minutes, self_report, completed_at")
          .eq("roadmap_id", mgr.roadmap_id)
          .eq("user_id", mgr.member_id);

        const modules: ModuleProgress[] = (progressRows ?? []).map((p) => ({
          moduleId: p.module_id,
          moduleTitle: p.module_title ?? "Unknown",
          status: p.status,
          quizScore: p.quiz_score,
          timeSpentMinutes: p.time_spent_minutes,
          selfReport: p.self_report,
          completedAt: p.completed_at,
        }));

        const completed = modules.filter((m) => m.status === "completed").length;
        const total = memberRm?.total_modules ?? 0;
        const quizScores = modules.filter((m) => m.quizScore != null).map((m) => m.quizScore!);
        const avgQuiz = quizScores.length > 0 ? quizScores.reduce((a, b) => a + b, 0) / quizScores.length : null;
        const totalTime = modules.reduce((sum, m) => sum + (m.timeSpentMinutes ?? 0), 0);
        const hardCount = modules.filter((m) => m.selfReport === "hard" || m.selfReport === "very_hard").length;

        progressData.push({
          memberId: mgr.member_id,
          displayName: profile?.display_name ?? "Unknown",
          memberRoadmapId: mgr.roadmap_id,
          completedModules: completed,
          totalModules: total,
          completionPct: total > 0 ? Math.round((completed / total) * 100) : 0,
          avgQuizScore: avgQuiz != null ? Math.round(avgQuiz) : null,
          totalTimeMinutes: totalTime,
          hardModules: hardCount,
          lastActive: memberRm?.last_activity_date ?? null,
          modules,
        });
      }

      setMemberProgress(progressData);
      setLoading(false);
    })();
  }, [user, groupId, roadmapId]);

  if (loading) {
    return (
      <>
        <AppBar />
        <div className="flex min-h-screen items-center justify-center pt-14">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      </>
    );
  }

  const labels = getGroupLabels(groupType);

  // Summary stats
  const totalMembers = memberProgress.length;
  const avgCompletion = totalMembers > 0 ? Math.round(memberProgress.reduce((s, m) => s + m.completionPct, 0) / totalMembers) : 0;
  const quizScores = memberProgress.filter((m) => m.avgQuizScore != null).map((m) => m.avgQuizScore!);
  const avgQuiz = quizScores.length > 0 ? Math.round(quizScores.reduce((a, b) => a + b, 0) / quizScores.length) : null;
  const hardReports = memberProgress.reduce((s, m) => s + m.hardModules, 0);

  // Module difficulty analysis — aggregate across all members
  const moduleDifficulty: Record<string, { title: string; hard: number; easy: number; total: number }> = {};
  for (const mp of memberProgress) {
    for (const mod of mp.modules) {
      if (!moduleDifficulty[mod.moduleId]) {
        moduleDifficulty[mod.moduleId] = { title: mod.moduleTitle, hard: 0, easy: 0, total: 0 };
      }
      moduleDifficulty[mod.moduleId].total++;
      if (mod.selfReport === "hard" || mod.selfReport === "very_hard") moduleDifficulty[mod.moduleId].hard++;
      if (mod.selfReport === "easy" || mod.selfReport === "very_easy") moduleDifficulty[mod.moduleId].easy++;
    }
  }
  const difficultyList = Object.values(moduleDifficulty).filter((d) => d.hard > 0 || d.easy > 0);

  // Sort
  const sorted = [...memberProgress].sort((a, b) => {
    if (sortBy === "name") return a.displayName.localeCompare(b.displayName);
    if (sortBy === "quiz") return (b.avgQuizScore ?? 0) - (a.avgQuizScore ?? 0);
    return b.completionPct - a.completionPct;
  });

  return (
    <>
      <AppBar />
      <WavyBackground />
      <div className="min-h-screen pt-20 pb-10 px-4 md:px-12 max-w-5xl mx-auto animate-fade-in">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/group/${groupId}`)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <p className="text-xs text-muted-foreground">
              <button onClick={() => navigate("/groups")} className="hover:text-foreground">Groups</button>
              {" > "}
              <button onClick={() => navigate(`/group/${groupId}`)} className="hover:text-foreground">{groupName}</button>
              {" > "} Progress
            </p>
            <h2 className="font-heading text-xl md:text-2xl font-bold">{roadmapTopic} Progress</h2>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="glass-strong p-4 text-center">
            <Users className="h-5 w-5 text-primary mx-auto mb-1" />
            <p className="text-2xl font-heading font-bold">{totalMembers}</p>
            <p className="text-xs text-muted-foreground">{labels.members}</p>
          </div>
          <div className="glass-strong p-4 text-center">
            <BarChart3 className="h-5 w-5 text-primary mx-auto mb-1" />
            <p className="text-2xl font-heading font-bold">{avgCompletion}%</p>
            <p className="text-xs text-muted-foreground">Avg Completion</p>
          </div>
          <div className="glass-strong p-4 text-center">
            <BarChart3 className="h-5 w-5 text-primary mx-auto mb-1" />
            <p className="text-2xl font-heading font-bold">{avgQuiz != null ? `${avgQuiz}%` : "—"}</p>
            <p className="text-xs text-muted-foreground">Avg Quiz Score</p>
          </div>
          <div className="glass-strong p-4 text-center">
            <AlertTriangle className="h-5 w-5 text-warning mx-auto mb-1" />
            <p className="text-2xl font-heading font-bold">{hardReports}</p>
            <p className="text-xs text-muted-foreground">Hard Reports</p>
          </div>
        </div>

        {/* Completion bar chart */}
        {sorted.length > 0 && (
          <div className="glass-strong p-5 mb-6">
            <h3 className="font-heading font-bold text-sm mb-4">Member Completion</h3>
            <div className="space-y-3">
              {sorted.map((mp) => (
                <div key={mp.memberId} className="flex items-center gap-3">
                  <span className="text-xs font-heading w-20 truncate shrink-0">{mp.displayName}</span>
                  <div className="flex-1 h-6 bg-muted/30 rounded-full overflow-hidden relative">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${mp.completionPct}%`,
                        background: mp.completionPct === 100
                          ? "linear-gradient(90deg, #10b981, #059669)"
                          : mp.completionPct >= 50
                            ? "linear-gradient(90deg, #06b6d4, #0891b2)"
                            : "linear-gradient(90deg, #8b5cf6, #7c3aed)",
                      }}
                    />
                    <span className="absolute inset-0 flex items-center justify-center text-xs font-heading font-bold text-white drop-shadow-sm">
                      {mp.completionPct > 0 ? `${mp.completionPct}%` : ""}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground w-16 text-right shrink-0">
                    {mp.completedModules}/{mp.totalModules}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Module difficulty insights */}
        {difficultyList.length > 0 && (
          <div className="glass-strong p-5 mb-6">
            <h3 className="font-heading font-bold text-sm mb-3">Module Difficulty Insights</h3>
            <div className="space-y-2">
              {difficultyList
                .sort((a, b) => b.hard - a.hard)
                .map((d) => (
                  <div key={d.title} className="flex items-center gap-3">
                    <span className="text-xs font-heading flex-1 truncate">{d.title}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      {d.hard > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-warning/20 text-warning font-heading">
                          {d.hard} found hard
                        </span>
                      )}
                      {d.easy > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-success/20 text-success font-heading">
                          {d.easy} found easy
                        </span>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Sort controls */}
        <div className="flex gap-2 mb-3">
          <span className="text-sm text-muted-foreground self-center">Sort by:</span>
          {(["completion", "quiz", "name"] as const).map((s) => (
            <Button
              key={s}
              onClick={() => setSortBy(s)}
              variant={sortBy === s ? "default" : "outline"}
              size="sm"
              className={sortBy === s ? "gradient-primary text-primary-foreground font-heading font-bold" : "border-border"}
            >
              {s === "completion" ? "Completion" : s === "quiz" ? "Quiz Score" : "Name"}
            </Button>
          ))}
        </div>

        {/* Member table */}
        {sorted.length === 0 ? (
          <div className="glass p-6 text-center text-muted-foreground">
            No {labels.members.toLowerCase()} have this roadmap yet.
          </div>
        ) : (
          <div className="space-y-2">
            {sorted.map((mp) => (
              <div key={mp.memberId} className="glass-strong rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedMember(expandedMember === mp.memberId ? null : mp.memberId)}
                  className="w-full p-4 flex items-center gap-3 text-left hover:bg-muted/20 transition-colors"
                >
                  <div className="w-9 h-9 rounded-full gradient-primary flex items-center justify-center text-sm font-heading font-bold text-primary-foreground shrink-0">
                    {(mp.displayName?.[0] ?? "U").toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-heading font-semibold text-sm truncate">{mp.displayName}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{mp.completionPct}% complete</span>
                      {mp.avgQuizScore != null && <span>Quiz: {mp.avgQuizScore}%</span>}
                      {mp.totalTimeMinutes > 0 && <span><Clock className="inline h-3 w-3 mr-0.5" />{mp.totalTimeMinutes}m</span>}
                      {mp.hardModules > 0 && <span className="text-warning">{mp.hardModules} hard</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="w-20 h-2 bg-muted/50 rounded-full overflow-hidden">
                      <div className="h-full gradient-primary rounded-full" style={{ width: `${mp.completionPct}%` }} />
                    </div>
                    {expandedMember === mp.memberId ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </button>

                {expandedMember === mp.memberId && mp.modules.length > 0 && (
                  <div className="border-t border-border px-4 pb-4">
                    <table className="w-full text-sm mt-3">
                      <thead>
                        <tr className="text-xs text-muted-foreground border-b border-border">
                          <th className="text-left pb-2 font-heading">Module</th>
                          <th className="text-center pb-2 font-heading">Status</th>
                          <th className="text-center pb-2 font-heading">Quiz</th>
                          <th className="text-center pb-2 font-heading">Time</th>
                          <th className="text-center pb-2 font-heading">Difficulty</th>
                          <th className="text-right pb-2 font-heading">Completed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mp.modules.map((mod) => (
                          <tr key={mod.moduleId} className="border-b border-border/50 last:border-0">
                            <td className="py-2 font-semibold text-xs">{mod.moduleTitle}</td>
                            <td className="py-2 text-center">
                              <span className={`text-xs px-1.5 py-0.5 rounded ${mod.status === "completed" ? "bg-success/20 text-success" : "bg-muted text-muted-foreground"}`}>
                                {mod.status}
                              </span>
                            </td>
                            <td className="py-2 text-center text-xs">{mod.quizScore != null ? `${mod.quizScore}%` : "—"}</td>
                            <td className="py-2 text-center text-xs">{mod.timeSpentMinutes != null ? `${mod.timeSpentMinutes}m` : "—"}</td>
                            <td className="py-2 text-center text-xs">
                              {mod.selfReport ? (
                                <span className={mod.selfReport === "hard" || mod.selfReport === "very_hard" ? "text-warning" : ""}>
                                  {mod.selfReport}
                                </span>
                              ) : "—"}
                            </td>
                            <td className="py-2 text-right text-xs text-muted-foreground">
                              {mod.completedAt ? new Date(mod.completedAt).toLocaleDateString() : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
