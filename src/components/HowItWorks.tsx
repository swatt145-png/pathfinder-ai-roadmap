import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

import stepDirection from "@/assets/steps/step-direction.jpg";
import stepArchitect from "@/assets/steps/step-architect.jpg";
import stepResearch from "@/assets/steps/step-research.jpg";
import stepAdapt from "@/assets/steps/step-adapt.jpg";

const steps = [
  {
    image: stepDirection,
    title: "You Set the Direction",
    description: "Pick your topic, level, goal, and timeline.",
  },
  {
    image: stepArchitect,
    title: "AI Designs Your Curriculum",
    description: "AI breaks your topic into structured, sequenced modules.",
  },
  {
    image: stepResearch,
    title: "Agents Find Best Resources",
    description: "Agents score and curate top resources from the web.",
  },
  {
    image: stepAdapt,
    title: "Adaptive Agent Evolves",
    description: "Your roadmap adapts based on your progress.",
  },
];

export function HowItWorks() {
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
    <section ref={sectionRef} className="w-full py-10 md:py-16 border-t border-border/40">
      <div className="max-w-6xl mx-auto px-4">
        {/* Header */}
        <div
          className={`text-center mb-16 transition-all duration-700 ${
            visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          }`}
        >
          <h2 className="font-heading text-3xl md:text-5xl font-bold gradient-text mb-3">
            How WayVion Builds Your Learning Path
          </h2>
          <p className="text-muted-foreground text-base md:text-lg max-w-2xl mx-auto">
            AI agents work together to create a personalized, optimized curriculum
          </p>
          <div className="mt-4 mx-auto w-24 h-1 rounded-full gradient-primary animate-pulse" />
        </div>

        {/* Steps workflow */}
        <div className="relative grid grid-cols-1 md:grid-cols-4 gap-8 md:gap-6">
          {/* Connecting line — desktop */}
          <div className="hidden md:block absolute top-[88px] left-[12.5%] right-[12.5%] h-0.5">
            <div className="w-full h-full bg-gradient-to-r from-primary/30 via-secondary/50 to-primary/30 rounded-full" />
            {/* Animated dot */}
            <div
              className="absolute top-[-3px] w-2 h-2 rounded-full bg-primary shadow-lg shadow-primary/50"
              style={{
                animation: "flowDot 4s linear infinite",
              }}
            />
          </div>

          {/* Connecting line — mobile */}
          <div className="md:hidden absolute top-0 bottom-0 left-8 w-0.5 bg-gradient-to-b from-primary/30 via-secondary/50 to-primary/30 rounded-full" />

          {steps.map((step, i) => (
            <div
              key={step.title}
              className={`relative flex md:flex-col items-start md:items-center text-left md:text-center gap-5 md:gap-0 transition-all duration-700 ${
                visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
              }`}
              style={{ transitionDelay: `${200 + i * 150}ms` }}
            >
              {/* Step label */}
              <div className="hidden md:block mb-3">
                <span className="text-xs font-heading font-bold text-primary tracking-widest uppercase">
                  Step {i + 1}
                </span>
              </div>

              {/* Image card */}
              <div className="relative z-10 shrink-0 w-16 h-16 md:w-40 md:h-40 rounded-xl md:rounded-2xl overflow-hidden glass-blue border border-primary/20 md:mb-5 hover:scale-105 hover:border-primary/40 transition-all duration-300 shadow-lg">
                <img
                  src={step.image}
                  alt={step.title}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>

              <div className="md:px-2">
                <span className="md:hidden text-xs font-heading font-bold text-primary tracking-widest uppercase block mb-1">
                  Step {i + 1}
                </span>
                <h3 className="font-heading text-base md:text-lg font-semibold text-foreground mb-1.5">
                  {step.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div
          className={`mt-14 flex justify-center transition-all duration-700 ${
            visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          }`}
          style={{ transitionDelay: "900ms" }}
        >
          <Button
            onClick={() => {
              const hero = document.getElementById("hero-auth");
              if (hero) hero.scrollIntoView({ behavior: "smooth", block: "center" });
              else navigate("/new");
            }}
            className="px-10 h-13 text-base font-heading font-bold gradient-primary text-primary-foreground transition-all hover:scale-105 glow-primary"
          >
            Build Your Roadmap
          </Button>
        </div>
      </div>
    </section>
  );
}
