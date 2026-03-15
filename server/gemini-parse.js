/**
 * gemini-parse.js — bulletproof Gemini JSON response parser
 *
 * Handles every format Gemini might return:
 *   - Raw JSON
 *   - ```json ... ```
 *   - ``` ... ```
 *   - JSON buried inside prose ("Here are the changes: { ... }")
 *   - Escaped newlines, trailing commas, other quirks
 */

function parseGeminiJson(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Empty response from Gemini');
  }

  let text = rawText.trim();

  // ── Strategy 1: strip ```json ... ``` or ``` ... ``` fences ──
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // ── Strategy 2: extract the outermost { ... } block ──
  // This handles cases where Gemini adds prose before/after the JSON
  const firstBrace = text.indexOf('{');
  const lastBrace  = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }

  // ── Strategy 3: fix common JSON issues Gemini produces ──

  // Remove trailing commas before } or ] — invalid JSON
  text = text.replace(/,\s*([}\]])/g, '$1');

  // Fix unescaped control characters in string values
  // (Gemini sometimes puts literal newlines inside JSON strings)
  // We process string by string to only fix inside quoted values
  text = fixUnescapedNewlinesInStrings(text);

  // ── Try to parse ──
  try {
    return JSON.parse(text);
  } catch (firstErr) {
    // ── Strategy 4: last resort — extract files array manually ──
    // If JSON.parse still fails, try to rescue the files array
    try {
      return rescueFilesArray(text, rawText);
    } catch (_) {
      // Log the raw text for debugging
      console.error('[GeminiParse] Failed to parse. Raw (first 500 chars):', rawText.slice(0, 500));
      throw new Error('Could not parse Gemini response as JSON: ' + firstErr.message);
    }
  }
}

/**
 * Fix literal newlines/tabs inside JSON string values.
 * JSON.parse rejects strings that contain unescaped \n or \t.
 */
function fixUnescapedNewlinesInStrings(jsonStr) {
  let result = '';
  let inString = false;
  let escape = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const ch = jsonStr[i];

    if (escape) {
      result += ch;
      escape = false;
      continue;
    }

    if (ch === '\\') {
      result += ch;
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }

    if (inString) {
      // Replace unescaped control characters with proper escape sequences
      if (ch === '\n') { result += '\\n'; continue; }
      if (ch === '\r') { result += '\\r'; continue; }
      if (ch === '\t') { result += '\\t'; continue; }
    }

    result += ch;
  }

  return result;
}

/**
 * Last-resort: try to manually extract action + files from broken JSON.
 * Useful when Gemini returns mostly-valid JSON with one broken file content.
 */
function rescueFilesArray(text, rawText) {
  // Try to find "action" and "files" fields
  const actionMatch = text.match(/"action"\s*:\s*"([^"]+)"/);
  const summaryMatch = text.match(/"summary"\s*:\s*"([^"]+)"/);

  if (!actionMatch) throw new Error('No action field found');

  // Try to parse files array by finding individual file objects
  const files = [];
  // Match each { "path": "...", "content": "..." } object
  // Use a greedy approach to capture the content field
  const filePattern = /"path"\s*:\s*"([^"]+)"/g;
  let match;
  while ((match = filePattern.exec(text)) !== null) {
    const filePath = match[1];
    // Find content after this path
    const afterPath = text.slice(match.index);
    const contentMatch = afterPath.match(/"content"\s*:\s*"([\s\S]*?)(?:"\s*[,}])/);
    if (contentMatch) {
      // Unescape the content
      let content = contentMatch[1];
      content = content.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      files.push({ path: filePath, content });
    }
  }

  if (files.length === 0) throw new Error('No files found in rescue attempt');

  return {
    action: actionMatch[1],
    files,
    summary: summaryMatch ? summaryMatch[1] : `Edited ${files.map(f => f.path).join(', ')}`
  };
}

module.exports = { parseGeminiJson };
