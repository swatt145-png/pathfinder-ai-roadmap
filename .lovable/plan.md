

## Premium UI Overhaul: Hover Effects, Selected States, and Visual Elegance

### Problems Identified

1. **Hover effects not working on glass-blue elements**: The `glass-blue` class uses `rounded-2xl` which creates a new stacking context, but the hover classes applied inline (like `hover:bg-primary/8`) use Tailwind opacity syntax that may not override the `background` CSS shorthand set by `.glass-blue`. The CSS `background` property in `.glass-blue` takes precedence over Tailwind's `hover:bg-*` utility classes.

2. **Selected state is invisible**: Selected cards use `bg-primary/20` which blends into the glass background. There's no strong visual differentiation.

3. **All sidebar buttons look identical**: Every action button in the Dashboard uses the same `gradient-primary` style with no visual hierarchy.

4. **Overall flat appearance**: The site lacks depth, layering, and visual richness compared to the reference site (Civictry) which uses gradient hero sections, colored icon circles, card shadows, and visual variety.

---

### Plan

#### 1. Fix Glass-Blue Hover and Selected States (Root Cause Fix)

**File: `src/index.css`**
- Add hover and selected variant classes directly in CSS so they properly override the `background` shorthand:
  - `.glass-blue:hover` -- slightly brighter background, border color change to primary
  - `.glass-blue-selected` -- a new class with `bg-primary/20` border-primary, ring, and shadow baked in
- Add a subtle inner glow/shadow on hover for depth

#### 2. Enhance Landing Page (`src/pages/Landing.tsx`)

- **Hero section**: Add a gradient overlay background (dark: subtle blue-to-transparent radial, light: warm blue tint) behind the hero content for visual depth
- **Feature cards**: Add hover lift effect with shadow and border color transition
- **"Get Started" button**: Add a subtle glow/shadow on hover
- **"Continue as Guest"**: Make hover more visible by using the CSS-level glass-blue hover
- **"Sign In" / "Sign Up" links**: Add underline animation on hover

#### 3. Fix NewRoadmap Page (`src/pages/NewRoadmap.tsx`)

- **Learning Goal & Skill Level cards**: Replace inline conditional classes with the new `.glass-blue-selected` CSS class for selected state. This ensures the background actually changes visually.
- **Selected state**: Add a visible left-border accent bar (4px primary color) plus stronger background tint and a ring
- **Timeline unit buttons**: Already have solid fill for selected -- verify these work. Add a transition effect.
- **Quick start chips**: Add hover border + scale via CSS class

#### 4. Dashboard Visual Hierarchy (`src/pages/Dashboard.tsx`)

- **Summary card**: Add a subtle gradient top border (primary to secondary) as a decorative accent
- **Module list items**: Differentiate hover state with background tint and left-border accent. "Up Next" module gets a pulsing left border or gradient accent.
- **Sidebar action buttons**: Create visual hierarchy -- primary action (Adapt My Plan) gets gradient, others get `variant="outline"` or `variant="secondary"` to differentiate
- **Stats cards** (hours, day, streak): Add subtle icon background circles for visual interest

#### 5. Background Enhancements (`src/index.css`)

- **Dark mode**: Add a very subtle mesh gradient using multiple radial gradients at different positions (top-left blue, bottom-right purple tint) for depth, plus the existing dot pattern
- **Light mode**: Add a soft gradient from white-blue at top to slightly warmer tone at bottom, plus dot pattern
- **AppBar**: Add a glass/frosted effect to the app bar (`backdrop-filter: blur`) for polish

#### 6. Global Polish

- **AppBar** (`src/components/AppBar.tsx`): Add `glass-strong` or backdrop-blur to the header for frosted glass nav bar effect
- **HowItWorks** (`src/components/HowItWorks.tsx`): Add hover lift to step icon circles
- **ExploreCategories** (`src/components/ExploreCategories.tsx`): Ensure hover works with glass-blue fix; add colored icon backgrounds (subtle primary tint circles behind icons)
- **Card component** (`src/components/ui/card.tsx`): Already has hover styles -- keep as-is

---

### Technical Details

**New CSS classes in `src/index.css`:**

```css
.glass-blue:hover {
  background: hsl(var(--glass-bg) / 0.85);
  border-color: hsl(var(--primary) / 0.4);
  box-shadow: 0 4px 16px hsl(var(--primary) / 0.1);
}

.glass-blue-selected {
  background: hsl(var(--primary) / 0.15) !important;
  border: 2px solid hsl(var(--primary)) !important;
  box-shadow: 0 4px 20px hsl(var(--primary) / 0.2), inset 0 1px 0 hsl(var(--primary) / 0.1);
}
```

**Background mesh gradient (dark mode):**
```css
body {
  background-image:
    radial-gradient(ellipse at 20% 0%, hsl(210 40% 18% / 0.5) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 100%, hsl(250 30% 15% / 0.3) 0%, transparent 50%),
    radial-gradient(circle, hsl(var(--primary) / 0.07) 1px, transparent 1px);
  background-size: 100% 100%, 100% 100%, 20px 20px;
  background-color: hsl(var(--background));
}
```

**Files to modify:**
1. `src/index.css` -- Glass hover/selected fixes, background mesh gradients, AppBar glass
2. `src/pages/Landing.tsx` -- Hero gradient overlay, consistent hover effects
3. `src/pages/NewRoadmap.tsx` -- Use glass-blue-selected class, fix hover states
4. `src/pages/Dashboard.tsx` -- Button hierarchy, module hover states, visual accents
5. `src/components/AppBar.tsx` -- Frosted glass nav bar
6. `src/components/HowItWorks.tsx` -- Hover effects on step circles
7. `src/components/ExploreCategories.tsx` -- Enhanced card hover with icon tint circles

