

## UI Polish: Consistent Hover Effects, Selected States, and Background Enhancements

### 1. Consistent Hover Effects Across All Buttons

**Problem:** The "Get Started" button uses the `Button` component with scale+shadow hover, but "Continue as Guest" is a plain `<button>` with only `hover:scale-105`. Other interactive elements (quick start chips, learning goal cards, skill level cards) also have inconsistent hover behavior.

**Fix:** Standardize all interactive elements to use the same hover pattern -- a visible background color shift, border highlight, slight scale, and shadow lift:
- **Landing page "Continue as Guest"**: Convert to use the same hover pattern as the "Conceptual" card reference (bg fill + border highlight + scale + shadow)
- **NewRoadmap selection cards** (Learning Goal, Skill Level): Add a more prominent `hover:bg-primary/8 hover:border-primary/40 hover:shadow-md hover:scale-[1.02]` effect
- **Quick start chips**: Add matching hover with border highlight and scale
- **Timeline unit buttons** (Hours/Days/Weeks): Add consistent hover

### 2. Clear Selected/Active State for Buttons

**Problem:** Selected options (e.g., "Conceptual", "Beginner") only get `border-primary bg-primary/10` which blends into the background. No strong visual distinction.

**Fix:** Make selected state much more prominent:
- Selected: `bg-primary/20 border-primary border-2 shadow-lg shadow-primary/15` with a ring effect
- The selected card's text and icon become `text-primary` (already partially done)
- Timeline unit buttons: selected gets `bg-primary text-primary-foreground` (solid fill) instead of just `bg-primary/20`

### 3. Subtle Background Enhancements

**Problem:** Plain solid background looks flat and dull in both modes.

**Fix:** Add subtle, non-distracting background patterns/gradients:
- **Dark mode**: A very subtle radial gradient from the center (slightly lighter) fading to the base background, plus a faint grid dot pattern using CSS
- **Light mode**: A soft radial gradient with a hint of blue warmth, plus the same faint dot pattern
- Both applied via CSS on the `body` element, keeping it performant (no extra DOM elements)

### Technical Details

**Files to modify:**

1. **`src/index.css`** -- Add subtle background patterns:
   - Dark mode: `radial-gradient(ellipse at 50% 0%, hsl(210 25% 14%) 0%, hsl(220 20% 10%) 70%)` plus a repeating dot pattern via `radial-gradient(circle, hsl(var(--primary) / 0.03) 1px, transparent 1px)` at `24px 24px` size
   - Light mode: `radial-gradient(ellipse at 50% 0%, hsl(210 30% 98%) 0%, hsl(210 20% 96%) 70%)` with same dot pattern at lower opacity

2. **`src/pages/Landing.tsx`** -- Update "Continue as Guest" button:
   - Add `border-2 border-border hover:border-primary/50 hover:bg-primary/10 hover:shadow-lg hover:scale-[1.03]` for consistent hover
   
3. **`src/pages/NewRoadmap.tsx`** -- Update selection cards and buttons:
   - Learning Goal & Skill Level cards: selected state gets `border-2 border-primary bg-primary/15 shadow-lg shadow-primary/15 scale-[1.02]`; hover gets `hover:border-primary/40 hover:bg-primary/8 hover:shadow-md hover:scale-[1.02]`
   - Timeline unit buttons: selected gets solid `bg-primary text-primary-foreground`; hover gets `hover:bg-primary/15`
   - Quick start chips: add `hover:border-primary/30 hover:shadow-sm hover:scale-[1.02]`

