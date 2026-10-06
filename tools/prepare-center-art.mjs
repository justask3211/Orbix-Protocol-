import { createRequire } from 'node:module';
const sharp = createRequire(new URL('./game-lab/package.json', import.meta.url))('sharp');
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const entries = [
  {
    "id": "number-hunt",
    "source": "C:\\Users\\santh\\.codex\\generated_images\\01a10cb7-ff42-7d90-bb4f-8073bca8c262\\exec-a4034720-0da7-4e42-9f4f-785c4fa16105.png",
    "prompt": "An orange fox explorer with teal backpack standing on a whimsical coral and mint floating puzzle island, oversized tactile cube tiles bearing clear numerals 3, 7, 9, a large luminous question-mark mystery cube, small golden coins and lush chunky stylized plants. Sunlit coral peach atmosphere, turquoise shadows and creamy highlights, clear composition with strongest subjects toward right and no text labels."
  },
  {
    "id": "boss-raid",
    "source": "C:\\Users\\santh\\.codex\\generated_images\\01a10cb7-ff42-7d90-bb4f-8073bca8c262\\exec-addbb93f-09b8-4530-b56a-f13a6bc14fee.png",
    "prompt": "A majestic cute giant violet crystalline stone golem boss, glowing amber heart, on a lavender floating arena, six little colorful adventurers approaching in two visual groups of three, coral and teal costumes, magical impact arcs and bright stylized stones. Joyful cooperative action, friendly expressive characters, indigo lilac sky and orange warm rim light, no text."
  },
  {
    "id": "token-catch",
    "source": "C:\\Users\\santh\\.codex\\generated_images\\01a10cb7-ff42-7d90-bb4f-8073bca8c262\\exec-3bbbc040-b378-4c11-95e8-9636d3a7d9c8.png",
    "prompt": "A nimble coral-orange fox mascot with a little teal catcher basket leaping between floating turquoise platforms to catch oversized shiny golden coin tokens, a handful of magenta geometric hazard shapes clearly separate, dynamic diagonal arc of coins, fresh aqua blue environment and candy colored flora, cheerful sunlight, no text."
  },
  {
    "id": "reaction-duel",
    "source": "C:\\Users\\santh\\.codex\\generated_images\\01a10cb7-ff42-7d90-bb4f-8073bca8c262\\exec-a5bd13fb-22c5-42b6-bd84-e04a74026d08.png",
    "prompt": "Two charming stylized adventurers facing each other across a split coral and periwinkle floating reaction arena, expressive competitive poses, a chunky golden lightning symbol floating between them, dramatic playful energetic composition, peach-coral left world and blue-lilac right world, tactile rounded game props, no text."
  }
];
const destination = resolve('web/public/center-art');
await mkdir(destination, { recursive: true });
const manifest = [];
for (const entry of entries) {
  const output = resolve(destination, entry.id + '.webp');
  await sharp(entry.source).resize({ width: 960, withoutEnlargement: true }).webp({ quality: 80, effort: 6 }).toFile(output);
  const bytes = await readFile(output);
  manifest.push({ game: entry.id, file: 'center-art/' + entry.id + '.webp', bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), generatedWith: 'Built-in image_gen',
    prompt: entry.prompt, use: 'Illustrated world preview; not a gameplay screenshot.' });
  console.log(entry.id + ': ' + bytes.length + ' bytes');
}
await writeFile(resolve(destination, 'provenance.json'), JSON.stringify(manifest, null, 2) + '\n');
