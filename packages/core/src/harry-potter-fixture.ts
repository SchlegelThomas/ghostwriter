/**
 * Hermetic / local seed: Harry Potter as a multi-book series.
 *
 * Scene summaries and prose are original placeholder text for product testing —
 * not quotations from the published novels.
 */
import {
  bookId,
  chapterId,
  defineProjectRecords,
  partId,
  projectId,
  sceneId,
  storyKnowledgeId,
  type BookStatus,
  type SceneStatus
} from "./domain.js";
import { harryPotterSeedVisualsForKnowledge } from "./harry-potter-visual-seeds.js";
import { projectNavigatorFromRecords } from "./project-navigator.js";

function seedVisuals(knowledgeId: { toString(): string }) {
  const visuals = harryPotterSeedVisualsForKnowledge(String(knowledgeId));
  return visuals.length === 0 ? {} : { visuals: [...visuals] };
}

export const HARRY_POTTER_FIXTURE_PROJECT_ID = projectId(
  "project-harry-potter-series"
);

const CREATED_AT = "2026-07-25T12:00:00.000Z";

const harryId = storyKnowledgeId("knowledge-hp-harry");
const hermioneId = storyKnowledgeId("knowledge-hp-hermione");
const ronId = storyKnowledgeId("knowledge-hp-ron");
const dumbledoreId = storyKnowledgeId("knowledge-hp-dumbledore");
const voldemortId = storyKnowledgeId("knowledge-hp-voldemort");
const snapeId = storyKnowledgeId("knowledge-hp-snape");
const hagridId = storyKnowledgeId("knowledge-hp-hagrid");
const hogwartsId = storyKnowledgeId("knowledge-hp-hogwarts");
const privetDriveId = storyKnowledgeId("knowledge-hp-privet-drive");
const diagonAlleyId = storyKnowledgeId("knowledge-hp-diagon-alley");
const horcruxThreadId = storyKnowledgeId("knowledge-hp-horcrux-thread");
const prophecyThreadId = storyKnowledgeId("knowledge-hp-prophecy-thread");

type SeedScene = Readonly<{
  slug: string;
  title: string;
  status: SceneStatus;
  summary: string;
  prose: string;
  pov?: "harry" | "hermione" | "ron" | "hagrid" | "dumbledore";
}>;

type SeedChapter = Readonly<{
  slug: string;
  title: string;
  scenes: readonly SeedScene[];
}>;

type SeedBook = Readonly<{
  slug: string;
  title: string;
  status: BookStatus;
  partTitle: string;
  chapters: readonly SeedChapter[];
}>;

const BOOKS: readonly SeedBook[] = [
  {
    slug: "philosophers-stone",
    title: "Harry Potter and the Philosopher's Stone",
    status: "complete",
    partTitle: "Year One",
    chapters: [
      {
        slug: "boy-who-lived",
        title: "The Boy Who Lived",
        scenes: [
          {
            slug: "privet-drive-morning",
            title: "Morning on Privet Drive",
            status: "complete",
            summary: "A quiet suburban street pretends nothing magical happened overnight.",
            prose:
              "Number four, Privet Drive, woke to ordinary light. The hedges were trimmed. The milk bottles waited. Only the cat on the corner seemed to know the night had bent.",
            pov: "harry"
          },
          {
            slug: "letter-arrives",
            title: "The first letter",
            status: "complete",
            summary: "An unexpected envelope finds its way past every ordinary barrier.",
            prose:
              "The letter was not like the bills. The ink looked older than the paper. Harry held it as if it might vanish before he finished reading his own name.",
            pov: "harry"
          }
        ]
      },
      {
        slug: "diagon-alley",
        title: "Diagon Alley",
        scenes: [
          {
            slug: "leaky-cauldron",
            title: "Through the Leaky Cauldron",
            status: "complete",
            summary: "A brick wall opens onto a street that should not fit in London.",
            prose:
              "Hagrid counted bricks with a careful knuckle. The wall shivered, then opened, and the alley poured sound into Harry's ears — cauldrons, owls, and a hundred quiet bargains.",
            pov: "hagrid"
          },
          {
            slug: "ollivanders",
            title: "Ollivanders",
            status: "drafting",
            summary: "A wand chooses before anyone finishes explaining the rules.",
            prose:
              "Dust and wand boxes filled the shop like a library of unsaid spells. When the right wand finally settled into Harry's hand, the air answered with a soft, bright breath.",
            pov: "harry"
          }
        ]
      }
    ]
  },
  {
    slug: "chamber-of-secrets",
    title: "Harry Potter and the Chamber of Secrets",
    status: "complete",
    partTitle: "Year Two",
    chapters: [
      {
        slug: "dobby",
        title: "Dobby's warning",
        scenes: [
          {
            slug: "socked-visitor",
            title: "A visitor with socks",
            status: "complete",
            summary: "A house-elf arrives with a warning Harry does not want to hear.",
            prose:
              "The elf wrung his ears and spoke in fragments. Danger waited at school, he insisted — and friendship, somehow, was part of the trap.",
            pov: "harry"
          }
        ]
      },
      {
        slug: "heir",
        title: "The Heir of Slytherin",
        scenes: [
          {
            slug: "writing-on-the-wall",
            title: "Writing on the wall",
            status: "drafting",
            summary: "Fear spreads through the castle when the corridor speaks in paint.",
            prose:
              "The message was tall enough for everyone to read at a run. Hermione stopped mid-step. Ron whispered the obvious question no one wanted answered.",
            pov: "hermione"
          },
          {
            slug: "chamber-door",
            title: "The chamber door",
            status: "planned",
            summary: "A sink becomes a threshold to something older than the school.",
            prose:
              "The pipes sang a language Harry almost understood. When the entrance opened, the cold below felt less like water and more like memory.",
            pov: "harry"
          }
        ]
      }
    ]
  },
  {
    slug: "prisoner-of-azkaban",
    title: "Harry Potter and the Prisoner of Azkaban",
    status: "complete",
    partTitle: "Year Three",
    chapters: [
      {
        slug: "dementors",
        title: "Dementors on the train",
        scenes: [
          {
            slug: "cold-compartment",
            title: "Cold in the compartment",
            status: "complete",
            summary: "Happiness drains from the carriage as something hooded passes.",
            prose:
              "The chocolate wrapper crackled too loudly. Harry's breath fogged, then stopped meaning anything. Somewhere nearby, a scream tried to become a memory.",
            pov: "harry"
          }
        ]
      },
      {
        slug: "shrieking-shack",
        title: "The Shrieking Shack",
        scenes: [
          {
            slug: "truth-in-the-shack",
            title: "Truth in the shack",
            status: "drafting",
            summary: "Old friendships and old crimes finally stand in the same room.",
            prose:
              "Dust hung in the slanted light. Names that had been stories became people again — wounded, furious, and somehow still trying to protect the same boy.",
            pov: "ron"
          }
        ]
      }
    ]
  },
  {
    slug: "goblet-of-fire",
    title: "Harry Potter and the Goblet of Fire",
    status: "revising",
    partTitle: "Year Four",
    chapters: [
      {
        slug: "triwizard",
        title: "The Triwizard Tournament",
        scenes: [
          {
            slug: "name-from-the-goblet",
            title: "A fourth name",
            status: "complete",
            summary: "The goblet chooses three champions — then refuses to stop at three.",
            prose:
              "The hall held its breath for the third parchment. When a fourth rose, the silence cracked into a hundred overlapping questions, all aimed at Harry.",
            pov: "harry"
          },
          {
            slug: "first-task",
            title: "The first task",
            status: "drafting",
            summary: "Dragons wait beyond the tents; strategy arrives late.",
            prose:
              "Harry smelled heat before he saw scales. The wand in his hand felt too light for the size of the problem, until the sky itself became the answer.",
            pov: "harry"
          }
        ]
      },
      {
        slug: "graveyard",
        title: "The graveyard",
        scenes: [
          {
            slug: "return",
            title: "A return",
            status: "planned",
            summary: "A portkey delivers Harry to a place the tournament never mentioned.",
            prose:
              "The cup's metal was still warm. The air afterward was cold and wrong. Tombstones stood like an audience that had been waiting years for this scene.",
            pov: "harry"
          }
        ]
      }
    ]
  },
  {
    slug: "order-of-the-phoenix",
    title: "Harry Potter and the Order of the Phoenix",
    status: "drafting",
    partTitle: "Year Five",
    chapters: [
      {
        slug: "grimmauld",
        title: "Number Twelve, Grimmauld Place",
        scenes: [
          {
            slug: "hidden-house",
            title: "The hidden house",
            status: "complete",
            summary: "A London terrace reveals itself only to those who already know it.",
            prose:
              "The street rearranged itself around a door that had not been there a blink ago. Inside, the Order spoke in low voices that still managed to fill every room.",
            pov: "harry"
          }
        ]
      },
      {
        slug: "umbridge",
        title: "Dolores Umbridge",
        scenes: [
          {
            slug: "pink-office",
            title: "The pink office",
            status: "drafting",
            summary: "A smile and a quill become instruments of control.",
            prose:
              "The office smelled of perfume and chalk. Hermione's notes grew sharper in the margins. Harry learned that some punishments were designed to look like lessons.",
            pov: "hermione"
          },
          {
            slug: "da-meeting",
            title: "Dumbledore's Army",
            status: "planned",
            summary: "Students invent a room that exists only when they need it.",
            prose:
              "The door appeared after the seventh pass. Inside: cushions, practice dummies, and a quiet agreement that fear would not be the curriculum.",
            pov: "hermione"
          }
        ]
      }
    ]
  },
  {
    slug: "half-blood-prince",
    title: "Harry Potter and the Half-Blood Prince",
    status: "drafting",
    partTitle: "Year Six",
    chapters: [
      {
        slug: "potions-book",
        title: "The Half-Blood Prince",
        scenes: [
          {
            slug: "annotated-margins",
            title: "Annotated margins",
            status: "complete",
            summary: "A battered potions book teaches more than the assigned text.",
            prose:
              "The handwriting in the margins was impatient and brilliant. Harry followed it like a trail of footprints left by someone who had already solved every trap.",
            pov: "harry"
          }
        ]
      },
      {
        slug: "memories",
        title: "Memories in the pensieve",
        scenes: [
          {
            slug: "slug-club-memory",
            title: "A borrowed memory",
            status: "drafting",
            summary: "Dumbledore shows Harry a past that still has unfinished edges.",
            prose:
              "The pensieve silvered and deepened. In the memory, a younger face spoke with confidence that history would later refuse to keep.",
            pov: "dumbledore"
          },
          {
            slug: "cave",
            title: "The cave",
            status: "planned",
            summary: "An island of stone waits inside dark water.",
            prose:
              "The boat barely held two. Every stroke toward the island cost something Harry could not name until the potion began to ask for payment.",
            pov: "harry"
          }
        ]
      }
    ]
  },
  {
    slug: "deathly-hallows",
    title: "Harry Potter and the Deathly Hallows",
    status: "planned",
    partTitle: "Year Seven",
    chapters: [
      {
        slug: "hunt",
        title: "The hunt begins",
        scenes: [
          {
            slug: "leaving",
            title: "Leaving everything named",
            status: "drafting",
            summary: "The trio steps away from school and into a war without timetables.",
            prose:
              "The tent smelled of rain and old canvas. Maps covered the table. Hermione checked the list twice, then once more for the things lists cannot hold.",
            pov: "hermione"
          },
          {
            slug: "horcrux-weight",
            title: "The weight of a horcrux",
            status: "planned",
            summary: "Carrying a fragment of a soul changes the temperature of every argument.",
            prose:
              "The locket sat against Harry's chest like a second, colder heartbeat. Ron's jokes shortened. Even silence began to take sides.",
            pov: "harry"
          }
        ]
      },
      {
        slug: "battle",
        title: "The Battle of Hogwarts",
        scenes: [
          {
            slug: "final-stand",
            title: "The final stand",
            status: "planned",
            summary: "The castle becomes a battlefield the founders never drew on any map.",
            prose:
              "Spells crossed the Great Hall like weather. Portraits shouted advice. Harry walked a path that felt both chosen and inevitable.",
            pov: "harry"
          }
        ]
      }
    ]
  }
] as const;

const POV_IDS = {
  harry: harryId,
  hermione: hermioneId,
  ron: ronId,
  hagrid: hagridId,
  dumbledore: dumbledoreId
} as const;

function sceneKey(bookSlug: string, sceneSlug: string): string {
  return `scene-hp-${bookSlug}-${sceneSlug}`;
}

function chapterKey(bookSlug: string, chapterSlug: string): string {
  return `chapter-hp-${bookSlug}-${chapterSlug}`;
}

function partKey(bookSlug: string): string {
  return `part-hp-${bookSlug}`;
}

function bookKey(bookSlug: string): string {
  return `book-hp-${bookSlug}`;
}

const sceneProseById = new Map<string, string>();

const books = BOOKS.map((book) => {
  const id = bookId(bookKey(book.slug));
  return {
    id,
    projectId: HARRY_POTTER_FIXTURE_PROJECT_ID,
    title: book.title,
    status: book.status,
    manuscript: {
      parts: [
        {
          id: partId(partKey(book.slug)),
          title: book.partTitle,
          chapters: book.chapters.map((chapter) => ({
            id: chapterId(chapterKey(book.slug, chapter.slug)),
            title: chapter.title,
            sceneIds: chapter.scenes.map((scene) =>
              sceneId(sceneKey(book.slug, scene.slug))
            )
          }))
        }
      ],
      unassignedSceneIds: [] as const
    },
    createdAt: CREATED_AT
  };
});

const scenes = BOOKS.flatMap((book) => {
  const currentBookId = bookId(bookKey(book.slug));
  return book.chapters.flatMap((chapter) =>
    chapter.scenes.map((scene) => {
      const id = sceneId(sceneKey(book.slug, scene.slug));
      sceneProseById.set(id, scene.prose);
      return {
        id,
        projectId: HARRY_POTTER_FIXTURE_PROJECT_ID,
        bookId: currentBookId,
        title: scene.title,
        status: scene.status,
        summary: scene.summary,
        ...(scene.pov === undefined
          ? {}
          : { povStoryKnowledgeId: POV_IDS[scene.pov] })
      };
    })
  );
});

const allSceneIds = scenes.map((scene) => scene.id);

export const HARRY_POTTER_FIXTURE = defineProjectRecords({
  project: {
    id: HARRY_POTTER_FIXTURE_PROJECT_ID,
    title: "Harry Potter",
    bookIds: books.map((book) => book.id),
    createdAt: CREATED_AT
  },
  books,
  scenes,
  storyKnowledge: [
    {
      id: harryId,
      projectId: HARRY_POTTER_FIXTURE_PROJECT_ID,
      label: "Harry Potter",
      kind: "character",
      authority: "confirmed",
      linkedSceneIds: allSceneIds.filter((id) =>
        scenes.some(
          (scene) =>
            scene.id === id && scene.povStoryKnowledgeId === harryId
        )
      ),
      linkedKnowledge: [],
      characterSheet: {
        desire: "Protect the people he loves and end Voldemort's return.",
        pressure: "Prophecy, fame, and a war that keeps choosing him.",
        voiceNotes: "Direct, stubborn, braver aloud than he feels."
      },
      ...seedVisuals(harryId)
    },
    {
      id: hermioneId,
      projectId: HARRY_POTTER_FIXTURE_PROJECT_ID,
      label: "Hermione Granger",
      kind: "character",
      authority: "confirmed",
      linkedSceneIds: allSceneIds.filter((id) =>
        scenes.some(
          (scene) =>
            scene.id === id && scene.povStoryKnowledgeId === hermioneId
        )
      ),
      linkedKnowledge: [],
      characterSheet: {
        desire: "Know enough to keep her friends alive.",
        pressure: "Rules that fail exactly when courage is required.",
        voiceNotes: "Precise, urgent, allergic to half-answers."
      },
      ...seedVisuals(hermioneId)
    },
    {
      id: ronId,
      projectId: HARRY_POTTER_FIXTURE_PROJECT_ID,
      label: "Ron Weasley",
      kind: "character",
      authority: "confirmed",
      linkedSceneIds: allSceneIds.filter((id) =>
        scenes.some(
          (scene) => scene.id === id && scene.povStoryKnowledgeId === ronId
        )
      ),
      linkedKnowledge: [],
      characterSheet: {
        desire: "Matter as much as his famous friend — and stay loyal anyway.",
        pressure: "Comparison, scarcity, and jokes that hide fear.",
        voiceNotes: "Warm, blunt, funny until the stakes get quiet."
      },
      ...seedVisuals(ronId)
    },
    {
      id: dumbledoreId,
      projectId: HARRY_POTTER_FIXTURE_PROJECT_ID,
      label: "Albus Dumbledore",
      kind: "character",
      authority: "confirmed",
      linkedSceneIds: allSceneIds.filter((id) =>
        scenes.some(
          (scene) =>
            scene.id === id && scene.povStoryKnowledgeId === dumbledoreId
        )
      ),
      linkedKnowledge: [],
      characterSheet: {
        desire: "Guide Harry without claiming his choices.",
        pressure: "Secrets kept too long for reasons that once seemed kind.",
        voiceNotes: "Gentle, lateral, heavy with unfinished plans."
      },
      ...seedVisuals(dumbledoreId)
    },
    {
      id: voldemortId,
      projectId: HARRY_POTTER_FIXTURE_PROJECT_ID,
      label: "Lord Voldemort",
      kind: "character",
      authority: "confirmed",
      linkedSceneIds: [],
      linkedKnowledge: [],
      characterSheet: {
        desire: "Conquer death and command what he cannot understand.",
        pressure: "A prophecy and a boy who keeps surviving him.",
        voiceNotes: "Cold, theatrical, allergic to equality."
      },
      ...seedVisuals(voldemortId)
    },
    {
      id: snapeId,
      projectId: HARRY_POTTER_FIXTURE_PROJECT_ID,
      label: "Severus Snape",
      kind: "character",
      authority: "disputed",
      linkedSceneIds: [],
      linkedKnowledge: [],
      characterSheet: {
        desire: "Keep a promise no one is allowed to see.",
        pressure: "Every side suspects him for different reasons.",
        voiceNotes: "Cutting, controlled, meaning buried under disdain."
      },
      ...seedVisuals(snapeId)
    },
    {
      id: hagridId,
      projectId: HARRY_POTTER_FIXTURE_PROJECT_ID,
      label: "Rubeus Hagrid",
      kind: "character",
      authority: "confirmed",
      linkedSceneIds: allSceneIds.filter((id) =>
        scenes.some(
          (scene) =>
            scene.id === id && scene.povStoryKnowledgeId === hagridId
        )
      ),
      linkedKnowledge: [],
      characterSheet: {
        desire: "Protect magical creatures and the boy he delivered.",
        pressure: "A soft heart in a war that punishes softness.",
        voiceNotes: "Booming, earnest, secretly careful."
      },
      ...seedVisuals(hagridId)
    },
    {
      id: hogwartsId,
      projectId: HARRY_POTTER_FIXTURE_PROJECT_ID,
      label: "Hogwarts",
      kind: "location",
      authority: "confirmed",
      linkedSceneIds: allSceneIds,
      linkedKnowledge: []
    },
    {
      id: privetDriveId,
      projectId: HARRY_POTTER_FIXTURE_PROJECT_ID,
      label: "4 Privet Drive",
      kind: "location",
      authority: "confirmed",
      linkedSceneIds: [
        sceneId(sceneKey("philosophers-stone", "privet-drive-morning")),
        sceneId(sceneKey("philosophers-stone", "letter-arrives"))
      ],
      linkedKnowledge: []
    },
    {
      id: diagonAlleyId,
      projectId: HARRY_POTTER_FIXTURE_PROJECT_ID,
      label: "Diagon Alley",
      kind: "location",
      authority: "confirmed",
      linkedSceneIds: [
        sceneId(sceneKey("philosophers-stone", "leaky-cauldron")),
        sceneId(sceneKey("philosophers-stone", "ollivanders"))
      ],
      linkedKnowledge: []
    },
    {
      id: horcruxThreadId,
      projectId: HARRY_POTTER_FIXTURE_PROJECT_ID,
      label: "The Horcruxes",
      kind: "thread",
      authority: "planned",
      linkedSceneIds: [
        sceneId(sceneKey("half-blood-prince", "slug-club-memory")),
        sceneId(sceneKey("half-blood-prince", "cave")),
        sceneId(sceneKey("deathly-hallows", "horcrux-weight")),
        sceneId(sceneKey("deathly-hallows", "final-stand"))
      ],
      linkedKnowledge: []
    },
    {
      id: prophecyThreadId,
      projectId: HARRY_POTTER_FIXTURE_PROJECT_ID,
      label: "The Prophecy",
      kind: "thread",
      authority: "disputed",
      linkedSceneIds: [
        sceneId(sceneKey("order-of-the-phoenix", "hidden-house")),
        sceneId(sceneKey("goblet-of-fire", "return")),
        sceneId(sceneKey("deathly-hallows", "final-stand"))
      ],
      linkedKnowledge: []
    }
  ],
  editions: []
});

export const HARRY_POTTER_FIXTURE_NAVIGATOR = projectNavigatorFromRecords(
  HARRY_POTTER_FIXTURE
);

/** Original seed prose keyed by scene id — for hermetic document initialization. */
export function harryPotterSceneProse(sceneIdValue: string): string | undefined {
  return sceneProseById.get(sceneIdValue);
}

export const HARRY_POTTER_SEED_CAPTURES = [
  {
    slug: "quirrell-mirror",
    modality: "text" as const,
    prose:
      "What if Quirrell never looks away from the Mirror — and Harry has to decide whether truth or desire wins first?"
  },
  {
    slug: "marauders-map-edge",
    modality: "dictation" as const,
    prose:
      "Voice note: a blank corridor on the Marauder's Map that only appears when someone is grieving. Might belong in book three or five."
  },
  {
    slug: "horcrux-lullaby",
    modality: "text" as const,
    prose:
      "Scene seed: a lullaby Lily once sang becomes the only sound that makes a Horcrux hesitate. Not sure which book yet."
  }
] as const;
