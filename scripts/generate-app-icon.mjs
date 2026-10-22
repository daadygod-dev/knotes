import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const prompt = `A premium square desktop app icon for "Notes Search", a local-first notes application. Visual language: warm editorial minimalism, parchment cream, charcoal ink, muted amber gold. One confident centered symbol: two overlapping folded note sheets in deep charcoal, with a thin warm-amber magnifying glass overlapping the lower-right corner. The lens is the focal point. Soft rounded-square cream tile with subtle paper grain, generous padding, strong silhouette, high contrast, readable at 16 pixels. Flat vector-like illustration with a small amount of dimensional shading. Straight-on view, no perspective, no background scene, no text, no letters, no numbers, no interface, no watermark, no mockup, no multiple variants, no grid. Transparent outside the rounded-square tile.`;

if (process.argv.includes("--prompt-only")) {
  console.log(prompt);
  process.exit(0);
}

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("OPENAI_API_KEY is not set.");
  console.error("Set it, or run `node scripts/generate-app-icon.mjs --prompt-only` to copy the prompt into another image generator.");
  process.exit(1);
}

const outputPath = resolve(process.argv.find((arg) => arg.startsWith("--output="))?.slice(9) ?? "public/app-icon.png");
const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";

const response = await fetch("https://api.openai.com/v1/images/generations", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model,
    prompt,
    n: 1,
    size: "1024x1024",
    quality: "high",
    background: "transparent",
    output_format: "png",
  }),
});

const payload = await response.json().catch(() => null);

if (!response.ok) {
  const message = payload?.error?.message || `Image request failed with HTTP ${response.status}.`;
  console.error(message);
  process.exit(1);
}

const image = payload?.data?.[0];
let bytes;
if (image?.b64_json) {
  bytes = Buffer.from(image.b64_json, "base64");
} else if (image?.url) {
  const download = await fetch(image.url);
  if (!download.ok) {
    console.error(`Could not download the generated image: HTTP ${download.status}.`);
    process.exit(1);
  }
  bytes = Buffer.from(await download.arrayBuffer());
} else {
  console.error("The image response did not contain b64_json or a URL.");
  process.exit(1);
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, bytes);
console.log(`Wrote ${outputPath} (${bytes.length} bytes) using ${model}.`);
console.log("Use this 1024px PNG as the source for the Windows .ico or macOS .icns build.");
