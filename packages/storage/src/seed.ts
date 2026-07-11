import type { ProjectRecords, ProjectRepository } from "@ghostwriter/core";

export async function seedProject(
  repository: ProjectRepository,
  records: ProjectRecords
): Promise<void> {
  await repository.transaction((writer) => {
    writer.insertProject(records.project);
    for (const book of records.books) writer.insertBook(book);
    for (const scene of records.scenes) writer.insertScene(scene);
    for (const knowledge of records.storyKnowledge) writer.insertStoryKnowledge(knowledge);
    for (const edition of records.editions) writer.insertEdition(edition);
  });
}
