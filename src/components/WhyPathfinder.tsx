import { useEffect, useRef, useState } from "react";

import imgPersonalized from "@/assets/why/personalized.jpg";
import imgProficiency from "@/assets/why/proficiency.jpg";
import imgTimeline from "@/assets/why/timeline.jpg";

const features = [
  {
    label: "Personalized",
    title: "Tailored to Your Learning Goal",
    description:
      "Every roadmap is uniquely crafted based on what you want to achieve. Whether you're switching careers, upskilling, or exploring a passion — your curriculum is built just for you.",
    image: imgPersonalized,
  },
  {
    label: "Adaptive",
    title: "Customized to Your Proficiency Level",
    description:
      "Beginner or expert, Pathfinder meets you where you are. The AI adjusts difficulty, depth, and pacing so you're always challenged but never overwhelmed.",
    image: imgProficiency,
  },
  {
    label: "Flexible",
    title: "Fits Your Timeline",
    description:
      "Got 30 minutes a day or 4 hours? Set your schedule and the AI distributes modules accordingly — complete with deadlines and milestones that respect your life.",
    image: imgTimeline,
  },
];

export function WhyPathfinder() {
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
        <div
          className={`text-center mb-16 transition-all duration-700 ${
            visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          }`}
        >
          <h2 className="font-heading text-3xl md:text-5xl font-bold gradient-text mb-3">
            Why Pathfinder?
          </h2>
          <p className="text-muted-foreground text-base md:text-lg max-w-2xl mx-auto">
            Learning that adapts to you — not the other way around
          </p>
        </div>

        <div className="space-y-8 md:space-y-24">
          {features.map((feature, i) => {
            const imageFirst = i % 2 === 0;
            return (
              <div
                key={feature.label}
                className={`flex flex-row ${
                  imageFirst ? "md:flex-row" : "md:flex-row-reverse"
                } items-center gap-4 md:gap-16 transition-all duration-700 ${
                  visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
                }`}
                style={{ transitionDelay: `${300 + i * 200}ms` }}
              >
                {/* Image */}
                <div className="w-1/3 md:w-1/2 shrink-0">
                  <div className="rounded-xl md:rounded-2xl overflow-hidden shadow-2xl shadow-primary/10 border border-border/40">
                    <img
                      src={feature.image}
                      alt={feature.title}
                      className="w-full h-24 sm:h-32 md:h-80 object-cover"
                      loading="lazy"
                    />
                  </div>
                </div>

                {/* Text */}
                <div className="w-2/3 md:w-1/2 space-y-1 md:space-y-4">
                  <span className="inline-block text-[10px] md:text-xs font-heading font-bold text-primary tracking-widest uppercase bg-primary/10 px-2 py-0.5 md:px-3 md:py-1 rounded-full">
                    {feature.label}
                  </span>
                  <h3 className="font-heading text-sm sm:text-lg md:text-3xl font-bold text-foreground leading-tight">
                    {feature.title}
                  </h3>
                  <p className="text-muted-foreground text-xs sm:text-sm md:text-lg leading-relaxed line-clamp-3 md:line-clamp-none">
                    {feature.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
