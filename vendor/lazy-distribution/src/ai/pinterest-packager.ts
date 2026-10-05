import type { ContentEnvelope, DistributionDraft } from "../core/types.js";

type PackagedCopy = { title: string; description: string };

export async function packageForPinterest(
  source: ContentEnvelope,
  targetId: string
): Promise<DistributionDraft> {
  const copy = process.env.OPENAI_API_KEY
    ? await generateWithAI(source)
    : fallbackCopy(source);

  return {
    platform: "pinterest",
    targetId,
    title: copy.title.slice(0, 100),
    description: copy.description.slice(0, 800),
    link: source.url,
    mediaUrl: source.thumbnailUrl
  };
}

async function generateWithAI(source: ContentEnvelope): Promise<PackagedCopy> {
  const prompt = [
    "Create Pinterest copy for an English-speaking audience, prioritizing US, Canada, UK and Australia.",
    "Return JSON only with keys title and description.",
    "Do not invent facts. Do not mention SEO. Avoid spammy clickbait.",
    "Title max 100 characters. Description max 800 characters.",
    `YouTube title: ${source.title}`,
    `YouTube description: ${source.description}`,
    `Tags: ${source.tags.join(", ")}`,
    `Hashtags: ${source.hashtags.join(" ")}`
  ].join("\n");

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
      input: prompt
    })
  });

  if (!res.ok) throw new Error(`OpenAI API failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as any;

  const text =
    data.output_text ??
    data.output?.flatMap((item: any) => item.content ?? [])
      ?.filter((c: any) => c.type === "output_text")
      ?.map((c: any) => c.text)
      ?.join("\n") ??
    "";

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI returned invalid JSON");

  const parsed = JSON.parse(text.slice(start, end + 1));
  return {
    title: String(parsed.title ?? source.title),
    description: String(parsed.description ?? source.description)
  };
}

function fallbackCopy(source: ContentEnvelope): PackagedCopy {
  return {
    title: source.title,
    description: source.description || `Watch this challenge on YouTube: ${source.url}`
  };
}
