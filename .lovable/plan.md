

# Serper API Integration for Real Learning Resources

## Current Architecture (v2 — Enhanced Pipeline)

### 10-Stage Curation Pipeline

1. **Stage 1: AI Curriculum Generation** (Agent 1 — gemini-2.5-flash)
   - Generates modules with `anchor_terms[]` per module for Stage 4 precision filtering
   - No resources/URLs — just structure

2. **Stage 2A/2B: High-Recall Retrieval** (Serper API)
   - Topic-wide anchors + module-specific searches in parallel

3. **Stage 3: YouTube API Enrichment** (batch metadata fetch)

4. **Stage 4: Enhanced Hard Filtering** (3-layer)
   - 4.1: Embedding similarity threshold (≥0.05)
   - 4.2: **Anchor Precision Gate** — module-specific anchor terms, hard reject if 0 match
   - 4.3: **Scope Mismatch Penalty** — penalizes broad "roadmap/full course" content for non-intro modules (10-15 points)

5. **Stage 5: Light Authority Scoring** (bounded priors, NOT selection driver)
   - Tier-based normalized priors (0-1) with max impact caps:
     - OFFICIAL_DOCS: 1.00, max +5
     - VENDOR_DOCS: 0.90, max +4
     - UNIVERSITY_DIRECT: 0.85, max +4
     - EDUCATION_DOMAIN: 0.75, max +3
     - BLOG: 0.60, max +3
     - YOUTUBE_TRUSTED: 0.80, max +3
     - YOUTUBE_UNKNOWN: 0.50, max +2
     - COMMUNITY: 0.42, max +2
   - Garbage filter (spam domains, thin pages only)
   - **Diversity caps** before Agent 2: max 40% videos, max 40% docs

6. **Stage 6: AI Context Fit Scoring** (Agent 2 — gemini-3-pro-preview)
   - Receives authority metadata but scores independently on content fit
   - Runs **in parallel** with Negotiation Pass for speed

7. **Negotiation Pass** (span detection for oversized resources)
   - Runs in parallel with Agent 2
   - Uses heuristic context_fit for quality gate (≥30)

8. **Stage 7: Clustering & Diversity**

9. **Stage 8: Batch LLM Reranker** (Agent 3 — gemini-2.5-flash-lite)

10. **Stage 9: Final Assembly**
    - Budget enforcement even for first/single resources (bug fixed)
    - Orphan continuation validation (bug fixed — skips if primary not selected)

### Bug Fixes Applied
- First resource in module no longer bypasses budget check (was allowing 693-min videos)
- "Continue watching" only shows if the primary resource was actually selected in a prior module

### Performance
- Agent 2 + Negotiation Pass run in parallel (~20-30s saved)
