

## Landing Page Grand Overhaul

This plan covers 5 major changes to transform the landing page into a premium, visually rich experience.

---

### 1. Remove Dog Animation, Redesign "What Will You Learn?" with AI-Generated Topic Cards

**What changes:**
- Delete the entire `WalkingDog` component and the `walk-dog` CSS keyframe
- Replace the 12 tech-only categories with ~12 broad categories spanning technology, business, finance, healthcare, design, etc.
- Each topic becomes a **card with an AI-generated image** on top and the topic name below (inspired by the Udemy-style card layout)
- Cards displayed in a horizontal scrollable carousel (using embla-carousel, already installed) with 4 visible on desktop, 2 on mobile
- Clicking a card navigates to `/new?topic=TopicName`

**AI Image Generation approach:**
- Create a new edge function `generate-topic-images` that calls the Lovable AI gateway (`google/gemini-2.5-flash-image`) to generate creative, abstract illustrations for each topic
- Store generated images in a Supabase storage bucket (`topic-images`)
- Cache results: only generate once per topic, serve from storage thereafter
- The landing page fetches image URLs from storage on load
- Fallback: gradient placeholder with icon while images load or if generation fails

**New broad categories:**
Artificial Intelligence, Web Development, Data Science, Business Strategy, Finance & Investing, Digital Marketing, Healthcare & Medicine, Graphic Design, Cybersecurity, Cloud Computing, Project Management, Mobile Development

---

### 2. Enhanced Hero Background with Shapes and Violet/Purple Contrast

**What changes in `src/index.css`:**
- Add pastel violet/purple radial gradients alongside the existing blue ones for color contrast
- Add decorative abstract SVG shapes (floating circles, lines, geometric patterns) as a background layer behind the hero section
- Dark mode: mesh gradient with blue at top-left, violet/purple at bottom-right, subtle teal accent
- Light mode: soft blue-to-lavender gradient with warm white base

**New CSS variables:**
- `--violet: 260 60% 65%` (dark) / `--violet: 260 55% 55%` (light) for the purple accent

**Hero section (`src/pages/Landing.tsx`):**
- Add decorative SVG shapes (blurred circles, diagonal lines) positioned absolutely behind the hero content
- These create the geometric background pattern seen in the Udemy reference

---

### 3. "How Pathfinder Builds Your Learning Path" Workflow Redesign

**What changes in `src/components/HowItWorks.tsx`:**
- Replace the small Lucide icons with AI-generated illustration images (same edge function, different prompts)
- Each step gets a larger card (rounded-xl) with the illustration inside, connected by a horizontal line/arrow on desktop
- Step cards get a subtle glass background with hover lift
- Add "STEP 1", "STEP 2" labels above each card in bold
- The connecting line becomes a gradient line with animated dots flowing left-to-right (CSS animation)
- Mobile: vertical timeline with line on the left, cards stacked

**Step illustrations (generated via AI):**
1. "You Set the Direction" -- compass/map illustration
2. "AI Architect Designs Curriculum" -- brain/blueprint illustration
3. "Research Agents Find Resources" -- magnifying glass/books illustration
4. "Adaptive Agent Evolves" -- refresh/growth illustration

---

### 4. New "Why PathFinder?" Characteristics Section

**New component: `src/components/WhyPathfinder.tsx`**

Layout inspired by the Udemy characteristics screenshot:
- 3 alternating rows, each with text on one side and an AI-generated illustration on the other
- Row 1: Image left, text right -- "Personalized to Your Learning Goal"
- Row 2: Text left, image right -- "Customized to Your Proficiency Level"  
- Row 3: Image left, text right -- "Fits Your Timeline"
- Each row has a small label (e.g., "Personalized"), bold heading, and descriptive paragraph
- Images are AI-generated abstract illustrations representing each concept
- Placed in `Landing.tsx` after the ExploreCategories section

---

### 5. New "Popular Skills" Section with CTA

**New component: `src/components/PopularSkills.tsx`**

Inspired by the Udemy Popular Skills screenshot:
- Section heading: "Popular Skills"
- Grid layout with 3-4 columns showing skill categories
- Each category (Development, Design, Business) lists 3-4 popular skills as clickable links with arrow icons
- Left column highlights a trending skill with "X is a top skill" callout
- Below the grid: large CTA text "What will you learn today?" with a prominent "Start Learning" button
- Clicking any skill navigates to `/new?topic=SkillName`
- Placed after the WhyPathfinder section

---

### 6. Distinct Section Boundaries

**Changes across all landing sections:**
- Each section gets its own subtle background variation (alternating between transparent and a very light glass tint)
- Clear `border-t` or gradient dividers between sections
- Consistent vertical padding (py-20 md:py-28) for breathing room
- Section order: Hero -> HowItWorks -> ExploreCategories -> WhyPathfinder -> PopularSkills

---

### Technical Details

**Files to create:**
- `supabase/functions/generate-topic-images/index.ts` -- Edge function to generate and store AI images
- `src/components/WhyPathfinder.tsx` -- Characteristics section
- `src/components/PopularSkills.tsx` -- Popular skills grid + CTA

**Files to modify:**
- `src/index.css` -- Remove walk-dog animation, add violet CSS variables, enhanced mesh gradients with purple
- `src/components/ExploreCategories.tsx` -- Complete rewrite: remove dog, new card carousel with images, broadened categories
- `src/components/HowItWorks.tsx` -- Replace icons with AI-generated illustrations, animated workflow line
- `src/pages/Landing.tsx` -- Add decorative SVG shapes to hero, import new sections, add section boundaries

**Database migration:**
- Create `topic-images` storage bucket for caching generated images
- Create `topic_images` table to track which images have been generated (topic_name, image_url, created_at)

**Edge function (`generate-topic-images`):**
- Accepts a list of topic names
- For each topic, checks if image already exists in storage
- If not, calls Lovable AI gateway with `google/gemini-2.5-flash-image` to generate a creative abstract illustration
- Uploads the base64 result to Supabase storage
- Returns public URLs for all topics
- Uses `LOVABLE_API_KEY` (already configured)

