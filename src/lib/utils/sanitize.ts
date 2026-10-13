import DOMPurify from 'dompurify';

/**
 * Sanitize HTML content to prevent XSS attacks
 */
export const sanitizeHTML = (html: string): string => {
  return DOMPurify.sanitize(html);
};

/**
 * Sanitize text content (strip all HTML tags)
 */
export const sanitizeText = (text: string): string => {
  return DOMPurify.sanitize(text, { ALLOWED_TAGS: [] });
};

/**
 * Sanitize user input before display
 */
export const sanitizeUserInput = (input: string): string => {
  if (!input) return '';
  return sanitizeText(input);
};
