import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Code2,
  Database,
  Globe,
  Brain,
  Cloud,
  Shield,
  MonitorSmartphone,
  Infinity,
  BarChart3,
  Boxes,
  Smartphone,
  Link2,
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

export function ExploreCategories() {
  const navigate = useNavigate();
  const sectionRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setVisible(true);
      },
      { threshold: 0.15 }
    );
    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="w-full max-w-5xl mx-auto px-4 pt-6 pb-20">
      <div
        className={`text-center mb-10 transition-all duration-700 ${
          visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
        }`}
      >
        <h2 className="font-heading text-3xl md:text-4xl font-bold gradient-text mb-3">
          What Will You Learn?
        </h2>
        <p className="text-muted-foreground text-base md:text-lg max-w-2xl mx-auto">
          Explore popular categories or type your own topic.
        </p>
      </div>

      <div
        className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 transition-all duration-700 ${
          visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
        }`}
        style={{ transitionDelay: "200ms" }}
      >
        {categories.map((cat, i) => {
          const Icon = cat.icon;
          return (
            <button
              key={cat.label}
              onClick={() => navigate(`/new?topic=${encodeURIComponent(cat.label)}`)}
              className="flex items-center gap-3 glass-blue px-4 py-3.5 rounded-xl text-left border border-transparent hover:border-primary/30 transition-all duration-200 hover:scale-[1.03] hover:shadow-lg hover:shadow-primary/10 cursor-pointer"
              style={{
                transitionDelay: visible ? `${100 + i * 50}ms` : "0ms",
                opacity: visible ? 1 : 0,
                transform: visible ? "translateY(0)" : "translateY(8px)",
              }}
            >
              <Icon className="w-5 h-5 text-primary shrink-0" />
              <span className="text-sm font-semibold text-foreground/90">{cat.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
