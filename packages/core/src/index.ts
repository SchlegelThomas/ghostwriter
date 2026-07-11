export type Chapter = Readonly<{
  id: string;
  title: string;
  order: number;
}>;

export type Manuscript = Readonly<{
  id: string;
  title: string;
  chapters: readonly Chapter[];
}>;

export function createManuscript(id: string, title: string): Manuscript {
  return { id, title, chapters: [] };
}

export function addChapter(manuscript: Manuscript, id: string, title: string): Manuscript {
  return {
    ...manuscript,
    chapters: [...manuscript.chapters, { id, title, order: manuscript.chapters.length + 1 }]
  };
}
