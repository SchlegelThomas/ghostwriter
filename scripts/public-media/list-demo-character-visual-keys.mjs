/**
 * Prints tab-separated objectKey and fixture filename for Harry Potter demo portraits.
 * Keep in sync with packages/core/src/harry-potter-visual-seeds.ts.
 */
const PROJECT_ID = "project-harry-potter-series";
const PORTRAIT_COUNT = 6;

const characters = [
  ["knowledge-hp-harry", "hp-harry.png"],
  ["knowledge-hp-hermione", "hp-hermione.png"],
  ["knowledge-hp-ron", "hp-ron.png"],
  ["knowledge-hp-dumbledore", "hp-dumbledore.png"],
  ["knowledge-hp-voldemort", "hp-voldemort.png"],
  ["knowledge-hp-snape", "hp-snape.png"],
  ["knowledge-hp-hagrid", "hp-hagrid.png"]
];

const lines = [];
for (const [knowledgeId, filename] of characters) {
  for (let index = 1; index <= PORTRAIT_COUNT; index += 1) {
    const visualId = `visual-seed-portrait-${index}`;
    const objectKey = `projects/${PROJECT_ID}/story-knowledge/${knowledgeId}/visuals/${visualId}.png`;
    lines.push(`${objectKey}\t${filename}`);
  }
}
console.log(lines.join("\n"));
