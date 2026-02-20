import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Code2, Database, Globe, Brain, Cloud, Shield,
  MonitorSmartphone, Infinity, BarChart3, Boxes,
  Smartphone, Link2
} from "lucide-react";

const categories = [
  { icon: Code2, label: "Programming" },
  { icon: Database, label: "Databases" },
  { icon: Globe, label: "Networking" },
  { icon: Brain, label: "Machine Learning" },
  { icon: Cloud, label: "Cloud Computing" },
  { icon: Shield, label: "Cybersecurity" },
  { icon: MonitorSmartphone, label: "Web Development" },
  { icon: Infinity, label: "DevOps" },
  { icon: BarChart3, label: "Data Science" },
  { icon: Boxes, label: "System Design" },
  { icon: Smartphone, label: "Mobile Development" },
  { icon: Link2, label: "Blockchain" },
];

function WalkingDog() {
  return (
    <div className="relative w-full h-16 overflow-hidden my-6">
      <div className="absolute animate-walk-dog flex items-end gap-3">
        {/* Dog SVG */}
        <svg viewBox="0 0 80 50" className="w-14 h-14" xmlns="http://www.w3.org/2000/svg">
          {/* Body */}
          <ellipse cx="40" cy="28" rx="18" ry="12" fill="hsl(var(--primary) / 0.15)" stroke="hsl(var(--primary))" strokeWidth="1.5" />
          {/* Head */}
          <circle cx="58" cy="18" r="10" fill="hsl(var(--primary) / 0.15)" stroke="hsl(var(--primary))" strokeWidth="1.5" />
          {/* Ear */}
          <path d="M52 12 Q48 4 50 14" fill="none" stroke="hsl(var(--primary))" strokeWidth="1.5" strokeLinecap="round">
            <animate attributeName="d" values="M52 12 Q48 4 50 14;M52 10 Q46 2 50 12;M52 12 Q48 4 50 14" dur="0.4s" repeatCount="indefinite" />
          </path>
          {/* Eye */}
          <circle cx="61" cy="16" r="2" fill="hsl(var(--accent))" />
          <circle cx="62" cy="15" r="0.7" fill="hsl(var(--background))" />
          {/* Nose */}
          <circle cx="66" cy="19" r="1.5" fill="hsl(var(--secondary))" />
          {/* Tail */}
          <path d="M22 22 Q14 10 18 18" fill="none" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round">
            <animate attributeName="d" values="M22 22 Q14 10 18 18;M22 22 Q10 14 16 20;M22 22 Q14 10 18 18" dur="0.3s" repeatCount="indefinite" />
          </path>
          {/* Legs walking */}
          <line x1="30" y1="38" x2="28" y2="48" stroke="hsl(var(--primary))" strokeWidth="1.5" strokeLinecap="round">
            <animate attributeName="x2" values="28;32;28" dur="0.4s" repeatCount="indefinite" />
          </line>
          <line x1="36" y1="38" x2="38" y2="48" stroke="hsl(var(--primary))" strokeWidth="1.5" strokeLinecap="round">
            <animate attributeName="x2" values="38;34;38" dur="0.4s" repeatCount="indefinite" />
          </line>
          <line x1="44" y1="38" x2="42" y2="48" stroke="hsl(var(--primary))" strokeWidth="1.5" strokeLinecap="round">
            <animate attributeName="x2" values="42;46;42" dur="0.4s" repeatCount="indefinite" begin="0.2s" />
          </line>
          <line x1="50" y1="38" x2="52" y2="48" stroke="hsl(var(--primary))" strokeWidth="1.5" strokeLinecap="round">
            <animate attributeName="x2" values="52;48;52" dur="0.4s" repeatCount="indefinite" begin="0.2s" />
          </line>
        </svg>
        {/* Topic bubbles that appear as dog walks */}
        {["Python", "React", "AI/ML", "DevOps", "SQL", "Cloud"].map((topic, i) => (
          <span
            key={topic}
            className="glass-blue px-3 py-1.5 rounded-full text-xs font-heading font-semibold text-primary whitespace-nowrap"
            style={{ animationDelay: `${i * 1.2}s` }}
          >
            {topic}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ExploreCategories() {
  const navigate = useNavigate();
  const sectionRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.15 }
    );
    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="w-full max-w-5xl mx-auto px-4 pt-16 pb-20 border-t border-border/40">
      <div
        className={`text-center mb-6 transition-all duration-700 ${
          visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
        }`}
      >
        <h2 className="font-heading text-3xl md:text-4xl font-bold gradient-text mb-3">
          What Will You Learn?
        </h2>
        <p className="text-muted-foreground text-base md:text-lg max-w-2xl mx-auto">
          Explore popular categories
        </p>
      </div>

      {/* Walking dog animation */}
      <div className={`transition-all duration-700 ${visible ? "opacity-100" : "opacity-0"}`} style={{ transitionDelay: "300ms" }}>
        <WalkingDog />
      </div>

      <div
        className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 transition-all duration-700 ${
          visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
        }`}
        style={{ transitionDelay: "500ms" }}
      >
        {categories.map((cat, i) => {
          const Icon = cat.icon;
          return (
            <button
              key={cat.label}
              onClick={() => navigate(`/new?topic=${encodeURIComponent(cat.label)}`)}
              className="flex items-center gap-3 glass-blue px-4 py-3.5 rounded-xl text-left border border-transparent hover:border-primary/30 transition-all duration-200 hover:scale-[1.03] hover:shadow-lg hover:shadow-primary/10 cursor-pointer"
              style={{
                transitionDelay: visible ? `${400 + i * 50}ms` : "0ms",
                opacity: visible ? 1 : 0,
                transform: visible ? "translateY(0)" : "translateY(8px)",
              }}
            >
              <div className="icon-circle shrink-0">
                <Icon className="w-5 h-5 text-primary" />
              </div>
              <span className="text-sm font-semibold text-foreground/90">{cat.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
