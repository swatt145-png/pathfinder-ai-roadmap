/**
 * Sanitize user-provided strings before embedding them in LLM prompts.
 * Prevents basic prompt injection by stripping control characters,
 * limiting length, and collapsing excessive whitespace.
 */
export function sanitizePromptInput(
  input: unknown,
  maxLength = 500,
): string {
  if (typeof input !== "string") return "";

  return input
    // Remove control characters (except normal whitespace)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    // Collapse multiple newlines into one
    .replace(/\n{3,}/g, "\n\n")
    // Trim and limit length
    .trim()
    .slice(0, maxLength);
}
