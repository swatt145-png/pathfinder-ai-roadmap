import { useEffect, useRef, useState } from "react";
import { Compass, Brain, Search, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

const steps = [
{
  icon: Compass,
  title: "You Set the Direction",
  description: "Pick your topic, level, goal, and timeline."
},
{
  icon: Brain,
  title: "AI Architect Designs Your Curriculum",
  description: "AI breaks your topic into structured, sequenced modules."
},
{
  icon: Search,
  title: "Research Agents Find the Best Resources",
  description: "Agents score and curate top resources from the web."
},
{
  icon: RefreshCw,
  title: "Adaptive Agent Evolves With You",
  description: "Your roadmap adapts based on your inputs."
}];


export function HowItWorks() {
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
    <section ref={sectionRef} className="w-full max-w-5xl mx-auto px-4 pt-16 pb-16">
      {/* Header */}
      <div
        className={`text-center mb-14 transition-all duration-700 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`
        }>

        <h2 className="font-heading text-3xl md:text-4xl font-bold gradient-text mb-3">
          How Pathfinder Builds Your Learning Path
        </h2>
        <p className="text-muted-foreground text-base md:text-lg max-w-2xl mx-auto">AI agents work together to create a personalized, optimized curriculum 

        </p>
      </div>

      {/* Steps */}
      <div className="relative grid grid-cols-1 md:grid-cols-4 gap-6 md:gap-4">
        {/* Connecting line — desktop */}
        <div className="hidden md:block absolute top-10 left-[12.5%] right-[12.5%] h-px bg-gradient-to-r from-primary/40 via-secondary/40 to-primary/40" />

        {/* Connecting line — mobile */}
        <div className="md:hidden absolute top-0 bottom-0 left-6 w-px bg-gradient-to-b from-primary/40 via-secondary/40 to-primary/40" />

        {steps.map((step, i) => {
          const Icon = step.icon;
          return (
            <div
              key={step.title}
              className={`relative flex md:flex-col items-start md:items-center text-left md:text-center gap-5 md:gap-0 transition-all duration-700 ${
              visible ?
              "opacity-100 translate-y-0" :
              "opacity-0 translate-y-8"}`
              }
              style={{ transitionDelay: `${200 + i * 150}ms` }}>

              {/* Icon circle */}
              <div className="relative z-10 shrink-0 flex items-center justify-center w-12 h-12 md:w-16 md:h-16 rounded-full glass-blue border border-primary/30 md:mb-5">
                <Icon className="w-5 h-5 md:w-7 md:h-7 text-primary" />
              </div>

              {/* Step number badge */}
              <span className="hidden md:block absolute -top-1 -right-1 md:static md:mb-3 text-xs font-heading font-bold text-muted-foreground tracking-widest uppercase">
                Step {i + 1}
              </span>

              <div className="md:px-1">
                <span className="md:hidden text-xs font-heading font-bold text-muted-foreground tracking-widest uppercase block mb-1">
                  Step {i + 1}
                </span>
                <h3 className="font-heading text-base md:text-lg font-semibold text-foreground mb-1.5">
                  {step.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {step.description}
                </p>
              </div>
            </div>);

        })}
      </div>

      {/* CTA */}
      <div
        className={`mt-14 flex justify-center transition-all duration-700 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`
        }
        style={{ transitionDelay: "900ms" }}>

        <Button
          onClick={() => navigate("/new")}
          variant="outline"
          className="px-8 h-12 text-base font-heading font-semibold border-primary/40 text-primary hover:bg-primary/10">

          Build Your Roadmap
        </Button>
      </div>
    </section>);

}