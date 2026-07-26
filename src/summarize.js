// src/summarize.js
// Sends the raw headline candidates to Claude and asks it to pick the top 10
// most significant Canadian stories and write a tight 2-3 sentence summary
// for each, using only the supplied snippet (no fabrication).
//
// Claude is asked to reference each pick by its candidate index rather than
// retyping the title/link -- some aggregator links (e.g. Google News) are
// very long, and having the model reproduce them verbatim risks truncating
// the JSON response before it finishes. The code maps indices back to the
// original candidate data instead.

const Anthropic = require("@anthropic-ai/sdk");

const MODEL = "claude-sonnet-4-6";

function buildPrompt(candidates) {
  const list = candidates
    .map((c, i) => {
      return [
        `[${i + 1}]`,
        `Title: ${c.title}`,
        `Source: ${c.source}`,
        `Snippet: ${c.snippet || "(no snippet available)"}`,
      ].join("\n");
    })
    .join("\n\n");

  return `You are curating a daily Canadian news digest for a busy professional.

Below are recent headlines pulled from multiple Canadian news outlets (CBC News, CTV News, Global News, National Post, Google News Canada). Some may be duplicates covering the same story, low-importance filler, or non-news content (ads, section labels). Your job:

1. Select up to 10 of the most significant, genuinely newsworthy stories about Canada (national news, politics, economy, major international stories involving Canada, etc.). Prefer national significance over celebrity/entertainment gossip unless nothing else qualifies. If fewer than 10 genuinely newsworthy candidates are available, return as many as are available (even just 1) -- never pad with filler.
2. If two entries clearly cover the same underlying story, treat them as one and pick whichever index has the better title/snippet.
3. For each selected story, write a clear, neutral 2-3 sentence summary based ONLY on the title and snippet given below. Do not invent facts, numbers, or quotes that are not implied by the source text.
4. Keep each summary objective and concise -- no editorializing.
5. Do NOT repeat the link or URL anywhere -- just reference the candidate's bracketed number.

Candidates:

${list}

CRITICAL: Respond with ONLY a JSON array -- no markdown fences, no preamble, no explanation, no commentary before or after it, even if there is only one candidate or the candidates seem limited. Your entire response must be valid JSON and nothing else. "index" must be the bracketed candidate number [n] above:
[
  {"index": 1, "summary": "2-3 sentence summary"}
]`;
}

function extractJsonArray(text) {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    return text.trim();
  }
  return text.slice(start, end + 1);
}

async function summarizeTopStories(candidates) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY environment variable / secret.");
  }

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [{ role: "user", content: buildPrompt(candidates) }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock) {
    throw new Error("Claude response did not contain a text block.");
  }

  const withoutFences = textBlock.text.replace(/^```json\s*|^```\s*|```$/gm, "").trim();
  const cleaned = extractJsonArray(withoutFences);

  let picks;
  try {
    picks = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Failed to parse Claude's JSON response: ${err.message}\nRaw: ${textBlock.text}`);
  }

  if (!Array.isArray(picks) || picks.length === 0) {
    throw new Error("Claude did not return a non-empty array of picks.");
  }

  const stories = picks
    .map((pick) => {
      const candidate = candidates[pick.index - 1];
      if (!candidate) return null;
      return {
        title: candidate.title,
        summary: pick.summary,
        link: candidate.link,
        source: candidate.source,
      };
    })
    .filter(Boolean);

  if (stories.length === 0) {
    throw new Error("None of Claude's picks matched a valid candidate index.");
  }

  return stories;
}

module.exports = { summarizeTopStories };
