export interface Resource {
  title: string;
  url: string;
  type: "video" | "article" | "documentation" | "tutorial" | "practice";
  estimated_minutes: number;
  description: string;
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correct_answer: string;
  explanation: string;
}

export interface Module {
  id: string;
  title: string;
  description: string;
  estimated_hours: number;
  day_start: number;
  day_end: number;
  week: number;
  prerequisites: string[];
  learning_objectives: string[];
  resources: Resource[];
  quiz: QuizQuestion[];
}

export interface RoadmapData {
  topic: string;
  skill_level: string;
  timeline_weeks: number;
  hours_per_day: number;
  total_hours: number;
  summary: string;
  modules: Module[];
  tips: string;
}

export interface ModuleProgress {
  id: string;
  roadmap_id: string;
  user_id: string;
  module_id: string;
  module_title: string | null;
  status: "not_started" | "in_progress" | "completed" | "skipped";
  self_report: "easy" | "medium" | "hard" | null;
  quiz_score: number | null;
  quiz_answers: Record<string, string> | null;
  time_spent_minutes: number | null;
  completed_at: string | null;
  created_at: string;
  completed_resources: string[];
  notes: string;
}

export interface AdaptationResult {
  needs_adaptation: boolean;
  adaptation_type: "none" | "minor" | "major";
  reason: string;
  changes_summary: string;
  message_to_student: string;
  updated_roadmap: RoadmapData | null;
}

export interface AdaptOption {
  id: string;
  label: string;
  description: string;
  timeline_weeks: number;
  hours_per_day: number;
  total_remaining_hours: number;
  modules_kept: number;
  modules_removed: string[];
  modules_added: string[];
  tradeoff: string;
  updated_roadmap: RoadmapData;
}

export interface AdaptResult {
  analysis: string;
  options: AdaptOption[];
  recommendation: string;
  recommendation_reason: string;
}
