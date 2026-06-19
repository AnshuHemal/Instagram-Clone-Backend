/**
 * Input sanitization utilities.
 * Strips HTML tags and normalizes text inputs before DB storage.
 */

/**
 * Strip HTML tags and decode common HTML entities from user-provided text.
 * Used for captions, bios, comments, and display names.
 */
export function sanitizeText(input: string | undefined | null): string {
  if (!input) return '';
  return input
    .replace(/<[^>]*>/g, '')           // strip HTML tags
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .trim();
}

/**
 * Sanitize and truncate to max length.
 */
export function sanitizeAndTruncate(input: string | undefined | null, maxLength: number): string {
  return sanitizeText(input).slice(0, maxLength);
}
