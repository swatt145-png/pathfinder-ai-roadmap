

# Serper API Integration for Real Learning Resources

## Problem
The AI currently generates resource URLs from memory, which often leads to broken links or expired pages. We need to fetch real, verified links from Google and YouTube.

## Approach
We'll use a **two-step generation process** inside the existing `generate-roadmap` edge function:

1. **Step 1 -- AI generates the curriculum structure** (modules, objectives, quizzes) but WITHOUT resource URLs
2. **Step 2 -- Serper API searches** for each module's topic to find real Google web results and YouTube videos
3. **Step 3 -- Assemble** the final roadmap by injecting the verified resources into each module

## What You Need To Do
1. Get your Serper API key from [serper.dev](https://serper.dev) (free tier gives 2,500 searches)
2. When prompted, paste the key so it can be stored securely as a backend secret

## Technical Details

### Secret Setup
- Store `SERPER_API_KEY` as a backend secret accessible by the edge function

### Edge Function Changes (`supabase/functions/generate-roadmap/index.ts`)

**Modified AI prompt:** Tell the AI to generate modules with empty `resources: []` arrays -- no URLs, no guessing.

**New Serper search step:** After the AI returns the curriculum, loop through each module and:
- Call Serper's `/search` endpoint with a query like `"learn {module.title} {skill_level} tutorial"` to get 2-3 web articles/docs
- Call Serper's `/search` endpoint with `type: "videos"` for 1-2 YouTube results
- Map results into the existing `Resource` format (`title`, `url`, `type`, `estimated_minutes`, `description`)

**Assembly:** Merge the Serper results into each module's `resources` array before returning the final roadmap.

### Serper API Calls (per module)

```text
POST https://google.serper.dev/search
Headers: X-API-KEY: {SERPER_API_KEY}
Body: { "q": "learn [module title] [skill level] tutorial", "num": 3 }

POST https://google.serper.dev/videos  
Headers: X-API-KEY: {SERPER_API_KEY}
Body: { "q": "[module title] tutorial [skill level]", "num": 2 }
```

### Resource Mapping
Each Serper result will be converted to:
- **Web results** -> `type: "article"` or `"documentation"` (based on domain detection)
- **Video results** -> `type: "video"`, with `estimated_minutes` extracted from duration if available

### No Frontend Changes
The `Resource` type and all UI components remain unchanged -- the data shape is identical, just with real URLs.

### Performance
- For a 6-module roadmap: ~12 Serper API calls (2 per module)
- Serper responses are fast (~200ms each)
- Total added latency: ~1-2 seconds (calls can be parallelized per module)

