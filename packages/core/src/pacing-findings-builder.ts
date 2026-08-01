import type { CatalogAgentPlaybook } from "./catalog-agent-playbooks.js";
import type { CatalogMemoLens } from "./catalog-memo-v1.js";
import {
  validatePacingFindingsV1,
  type PacingFindingsV1
} from "./pacing-findings-v1.js";
import {
  assignTurnsToNearestScenes,
  PACING_TURN_BANDS,
  type EqualWeightScenePercent
} from "./pacing-position.js";

export function buildDeterministicPacingFindings(input: Readonly<{
  projectTitle: string;
  lens?: CatalogMemoLens;
  orderedPercents: readonly EqualWeightScenePercent[];
  playbook: CatalogAgentPlaybook;
}>): PacingFindingsV1 {
  const turns = assignTurnsToNearestScenes(
    PACING_TURN_BANDS,
    input.orderedPercents
  ).map((turn) => {
    const measuredPct = turn.scene?.midPct;
    const driftNote =
      measuredPct === undefined ||
      (measuredPct >= turn.bandLow && measuredPct <= turn.bandHigh)
        ? undefined
        : `The nearest scene midpoint is ${measuredPct.toFixed(1)}%, outside the ${turn.bandLow}–${turn.bandHigh}% reference band. Treat this as a navigation anchor, not proof that the story turn occurs there.`;
    return {
      id: turn.id,
      ...(turn.scene === undefined
        ? {}
        : {
            sceneId: turn.scene.sceneId,
            sceneTitle: turn.scene.title,
            measuredPct: turn.scene.midPct
          }),
      bandLow: turn.bandLow,
      bandHigh: turn.bandHigh,
      ...(driftNote === undefined ? {} : { driftNote })
    };
  });
  const doctrineSentences = [
    input.playbook.doctrine,
    ...input.playbook.sections.map((section) => section.note)
  ]
    .join(" ")
    .split(/(?<=[.!?])\s+/u);
  const prescription = (keyword: string, fallback: string): string =>
    doctrineSentences.find((sentence) =>
      sentence.toLocaleLowerCase().includes(keyword)
    ) ?? fallback;
  const prescriptions = [
    {
      action: "cut" as const,
      body: prescription("cut", "Cut scenes that do not change story state.")
    },
    {
      action: "merge" as const,
      body: prescription("merge", "Merge scenes that repeat the same story function.")
    },
    {
      action: "add-pressure" as const,
      body: prescription(
        "add pressure",
        "Add pressure through a deadline, cost, or rival plan before adding incident."
      )
    }
  ];
  const sceneCount = input.orderedPercents.length;
  return validatePacingFindingsV1({
    schemaId: "pacing-findings-v1",
    agentId: "pacing-doctor",
    title: `Pacing Doctor · ${input.projectTitle}`.slice(0, 120),
    summary:
      sceneCount === 0
        ? "No active manuscript scenes are available yet. These findings preserve the Pacing Doctor playbook as a checklist; add scenes before treating any turn position as measured."
        : `Mapped ${sceneCount} active manuscript scene${sceneCount === 1 ? "" : "s"} in navigator order. Percentages give every scene equal weight; they are navigation anchors, not claims about word count or where a story turn actually occurs.`,
    ...(input.lens === undefined ? {} : { lens: input.lens }),
    positionBasis: "equal-scene",
    turns,
    flatRuns: [],
    prescriptions,
    sections: input.playbook.sections.map((section) => ({
      heading: section.heading,
      body: section.note
    })),
    evidence: input.orderedPercents.slice(0, 20).map((scene) => ({
      label: `${scene.index + 1}. ${scene.title} · ${scene.startPct.toFixed(1)}–${scene.endPct.toFixed(1)}%`,
      sceneId: scene.sceneId
    }))
  });
}
