import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";

const skillCategories = [
  {
    title: "Development",
    skills: ["Python", "JavaScript", "React", "Node.js"],
  },
  {
    title: "Data & AI",
    skills: ["Machine Learning", "Data Analysis", "Deep Learning", "NLP"],
  },
  {
    title: "Business",
    skills: ["Product Management", "Leadership", "Entrepreneurship", "Negotiation"],
  },
  {
    title: "Design",
    skills: ["UI/UX Design", "Figma", "Motion Graphics", "Brand Identity"],
  },
];

export function PopularSkills() {
  const navigate = useNavigate();
  const sectionRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.1 }
    );
    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="w-full py-20 md:py-28 border-t border-border/40"
      style={{ background: "hsl(var(--muted) / 0.3)" }}
    >
      <div className="max-w-6xl mx-auto px-4">
        {/* Header */}
        <div
          className={`mb-12 transition-all duration-700 ${
            visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          }`}
        >
          <h2 className="font-heading text-3xl md:text-5xl font-bold gradient-text mb-3">
            Popular Skills
          </h2>

          {/* Trending callout */}
          <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-2 mt-4">
            <TrendingUp className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-primary">
              AI & Machine Learning is a top skill
            </span>
          </div>
        </div>

        {/* Skills grid */}
        <div
          className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-16 transition-all duration-700 ${
            visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
          style={{ transitionDelay: "200ms" }}
        >
          {skillCategories.map((cat) => (
            <div key={cat.title} className="space-y-3">
              <h3 className="font-heading text-lg font-bold text-foreground mb-4">
                {cat.title}
              </h3>
              {cat.skills.map((skill) => (
                <button
                  key={skill}
                  onClick={() => navigate(`/new?topic=${encodeURIComponent(skill)}`)}
                  className="flex items-center justify-between w-full text-left px-4 py-3 rounded-xl border border-border/40 bg-card hover:border-primary/40 hover:bg-primary/5 transition-all duration-200 group cursor-pointer"
                >
                  <span className="text-sm font-medium text-foreground/80 group-hover:text-primary transition-colors">
                    {skill}
                  </span>
                  <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Big CTA */}
        <div
          className={`text-center transition-all duration-700 ${
            visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          }`}
          style={{ transitionDelay: "500ms" }}
        >
          <h3 className="font-heading text-4xl md:text-6xl font-extrabold text-foreground mb-6">
            What will you learn{" "}
            <span className="gradient-text">today</span>?
          </h3>
          <Button
            onClick={() => navigate("/new")}
            className="px-12 h-14 text-lg font-heading font-bold gradient-primary text-primary-foreground transition-all hover:scale-105 glow-primary"
          >
            Start Learning
          </Button>
        </div>
      </div>
    </section>
  );
}
