import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import topicAI from "@/assets/topics/ai.jpg";
import topicWebDev from "@/assets/topics/webdev.jpg";
import topicDataScience from "@/assets/topics/datascience.jpg";
import topicBusiness from "@/assets/topics/business.jpg";
import topicFinance from "@/assets/topics/finance.jpg";
import topicMarketing from "@/assets/topics/marketing.jpg";
import topicHealthcare from "@/assets/topics/healthcare.jpg";
import topicDesign from "@/assets/topics/design.jpg";
import topicCybersecurity from "@/assets/topics/cybersecurity.jpg";
import topicCloud from "@/assets/topics/cloud.jpg";
import topicProjectMgmt from "@/assets/topics/projectmgmt.jpg";
import topicMobile from "@/assets/topics/mobile.jpg";

const categories = [
{ label: "Artificial Intelligence", image: topicAI },
{ label: "Web Development", image: topicWebDev },
{ label: "Data Science", image: topicDataScience },
{ label: "Business Strategy", image: topicBusiness },
{ label: "Finance & Investing", image: topicFinance },
{ label: "Digital Marketing", image: topicMarketing },
{ label: "Healthcare & Medicine", image: topicHealthcare },
{ label: "Graphic Design", image: topicDesign },
{ label: "Cybersecurity", image: topicCybersecurity },
{ label: "Cloud Computing", image: topicCloud },
{ label: "Project Management", image: topicProjectMgmt },
{ label: "Mobile Development", image: topicMobile }];


export function ExploreCategories() {
  const navigate = useNavigate();
  const sectionRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {if (entry.isIntersecting) setVisible(true);},
      { threshold: 0.1 }
    );
    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="w-full py-20 md:py-28 border-t border-border/40"
      style={{ background: "hsl(var(--muted) / 0.3)" }}>

      <div className="max-w-6xl mx-auto px-4">
        <div
          className={`text-center mb-12 transition-all duration-700 ${
          visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`
          }>

          <h2 className="font-heading text-3xl md:text-5xl font-bold gradient-text mb-3">Your Personalized Path to Any Field!

          </h2>
          <p className="text-muted-foreground text-base md:text-lg max-w-2xl mx-auto">
            From technology to business — explore any field and master it with a personalized AI roadmap
          </p>
        </div>

        <div
          className={`grid grid-cols-4 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-4 md:gap-6 transition-all duration-700 ${
          visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`
          }
          style={{ transitionDelay: "300ms" }}>

          {categories.map((cat, i) =>
          <button
            key={cat.label}
            onClick={() => navigate(`/new?topic=${encodeURIComponent(cat.label)}`)}
            className="group flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card hover:border-primary/40 transition-all duration-300 hover:scale-[1.03] hover:shadow-xl hover:shadow-primary/10 cursor-pointer text-left"
            style={{
              transitionDelay: visible ? `${200 + i * 60}ms` : "0ms",
              opacity: visible ? 1 : 0,
              transform: visible ? "translateY(0)" : "translateY(12px)"
            }}>

              <div className="aspect-square sm:aspect-[4/3] overflow-hidden">
                <img
                src={cat.image}
                alt={cat.label}
                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                loading="lazy" />

              </div>
              <div className="px-2 py-1.5 sm:px-4 sm:py-3">
                <span className="text-[10px] leading-tight sm:text-sm md:text-base font-heading font-semibold text-foreground">
                  {cat.label}
                </span>
              </div>
            </button>
          )}
        </div>
      </div>
    </section>);

}