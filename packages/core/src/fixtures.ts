import {
  bookId,
  chapterId,
  defineProjectRecords,
  editionId,
  partId,
  projectId,
  revisionId,
  sceneId,
  storyKnowledgeId
} from "./domain.js";
import { projectNavigatorFromRecords } from "./project-navigator.js";

export const BELLWETHER_FIXTURE_PROJECT_ID = projectId("project-bellwether-cycle");

const signalBookId = bookId("book-signal-at-bellwether");
const darkTidesBookId = bookId("book-dark-between-tides");

const maraId = storyKnowledgeId("knowledge-mara-venn");
const bellwetherId = storyKnowledgeId("knowledge-bellwether-island");
const channelNineId = storyKnowledgeId("knowledge-channel-nine");
const callerThreadId = storyKnowledgeId("knowledge-caller-thread");

const arrivalSceneId = sceneId("scene-arrival-at-bellwether");
const deadFrequencySceneId = sceneId("scene-dead-frequency");
const futureCallSceneId = sceneId("scene-future-call");
const falseRescueSceneId = sceneId("scene-false-rescue");
const darkHarborSceneId = sceneId("scene-dark-harbor");
const secondSignalSceneId = sceneId("scene-second-signal");

export const BELLWETHER_FIXTURE = defineProjectRecords({
  project: {
    id: BELLWETHER_FIXTURE_PROJECT_ID,
    title: "The Bellwether Cycle",
    bookIds: [signalBookId, darkTidesBookId],
    createdAt: "2026-07-11T18:00:00.000Z"
  },
  books: [
    {
      id: signalBookId,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      title: "The Signal at Bellwether",
      status: "drafting",
      manuscript: {
        parts: [
          {
            id: partId("part-the-warning"),
            title: "The warning",
            chapters: [
              {
                id: chapterId("chapter-low-tide"),
                title: "Low tide",
                sceneIds: [arrivalSceneId, deadFrequencySceneId]
              },
              {
                id: chapterId("chapter-static"),
                title: "Static",
                sceneIds: [futureCallSceneId]
              }
            ]
          }
        ],
        unassignedSceneIds: [falseRescueSceneId]
      },
      createdAt: "2026-07-11T18:00:00.000Z"
    },
    {
      id: darkTidesBookId,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      title: "The Dark Between Tides",
      status: "planned",
      manuscript: {
        parts: [
          {
            id: partId("part-after-the-light"),
            title: "After the light",
            chapters: [
              {
                id: chapterId("chapter-low-harbor"),
                title: "Low Harbor",
                sceneIds: [darkHarborSceneId, secondSignalSceneId]
              }
            ]
          }
        ],
        unassignedSceneIds: []
      },
      createdAt: "2026-07-11T18:05:00.000Z"
    }
  ],
  scenes: [
    {
      id: arrivalSceneId,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      bookId: signalBookId,
      title: "Arrival at Bellwether",
      status: "complete",
      summary: "Mara finds the keeper's log incomplete.",
      povStoryKnowledgeId: maraId
    },
    {
      id: deadFrequencySceneId,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      bookId: signalBookId,
      title: "The dead frequency",
      status: "complete",
      summary: "A voice hides beneath the weather channel.",
      povStoryKnowledgeId: maraId
    },
    {
      id: futureCallSceneId,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      bookId: signalBookId,
      title: "The call that hasn't happened",
      status: "drafting",
      summary: "Mara hears her own voice warning her from tomorrow.",
      povStoryKnowledgeId: maraId
    },
    {
      id: falseRescueSceneId,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      bookId: signalBookId,
      title: "The false rescue",
      status: "planned",
      summary: "A convincing forecast leads Mara to the wrong boat.",
      povStoryKnowledgeId: maraId
    },
    {
      id: darkHarborSceneId,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      bookId: darkTidesBookId,
      title: "Low Harbor goes dark",
      status: "planned",
      summary: "The town blames Bellwether when every light fails.",
      povStoryKnowledgeId: maraId
    },
    {
      id: secondSignalSceneId,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      bookId: darkTidesBookId,
      title: "The second signal",
      status: "planned",
      summary: "A new transmission arrives from beyond the island.",
      povStoryKnowledgeId: maraId
    }
  ],
  storyKnowledge: [
    {
      id: maraId,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      label: "Mara Venn",
      kind: "character",
      authority: "confirmed",
      linkedSceneIds: [
        arrivalSceneId,
        deadFrequencySceneId,
        futureCallSceneId,
        falseRescueSceneId,
        darkHarborSceneId,
        secondSignalSceneId
      ],
      linkedKnowledge: []
    },
    {
      id: bellwetherId,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      label: "Bellwether Island",
      kind: "location",
      authority: "confirmed",
      linkedSceneIds: [arrivalSceneId, deadFrequencySceneId, darkHarborSceneId],
      linkedKnowledge: []
    },
    {
      id: channelNineId,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      label: "Channel 9 warning rule",
      kind: "world-rule",
      authority: "planned",
      linkedSceneIds: [deadFrequencySceneId, futureCallSceneId, secondSignalSceneId],
      linkedKnowledge: []
    },
    {
      id: callerThreadId,
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      label: "Who sends the calls?",
      kind: "thread",
      authority: "disputed",
      linkedSceneIds: [deadFrequencySceneId, futureCallSceneId, secondSignalSceneId],
      linkedKnowledge: []
    }
  ],
  editions: [
    {
      id: editionId("edition-first-reader-draft"),
      projectId: BELLWETHER_FIXTURE_PROJECT_ID,
      bookId: signalBookId,
      name: "First reader draft",
      projectRevisionId: revisionId("revision-project-first-reader"),
      sceneRevisions: [
        {
          sceneId: arrivalSceneId,
          revisionId: revisionId("revision-arrival-first-reader")
        },
        {
          sceneId: deadFrequencySceneId,
          revisionId: revisionId("revision-frequency-first-reader")
        },
        {
          sceneId: futureCallSceneId,
          revisionId: revisionId("revision-call-first-reader")
        }
      ],
      createdAt: "2026-07-11T18:10:00.000Z"
    }
  ]
});

export const BELLWETHER_FIXTURE_NAVIGATOR =
  projectNavigatorFromRecords(BELLWETHER_FIXTURE);
