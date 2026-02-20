import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function PopularSkillsCTA() {
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
        <div
          className={`text-center transition-all duration-700 ${
            visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          }`}
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
