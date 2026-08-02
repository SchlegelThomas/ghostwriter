import { DomainValidationError } from "./domain.js";
import { decodePngDataUri } from "./book-cover-images.js";

export const CHARACTER_VISUAL_LOCATOR_ORIGIN = "https://ghostwriter.character";

export function buildCharacterVisualObjectKey(
  projectId: string,
  knowledgeId: string,
  visualId: string
): string {
  return `projects/${projectId}/story-knowledge/${knowledgeId}/visuals/${visualId}.png`;
}

export function buildCharacterVisualLocatorUrl(
  projectId: string,
  knowledgeId: string,
  visualId: string
): string {
  return `${CHARACTER_VISUAL_LOCATOR_ORIGIN}/projects/${encodeURIComponent(projectId)}/story-knowledge/${encodeURIComponent(knowledgeId)}/visuals/${encodeURIComponent(visualId)}`;
}

export function buildCharacterVisualPublicUrl(
  origin: string,
  projectId: string,
  knowledgeId: string,
  visualId: string
): string {
  const base = origin.endsWith("/") ? origin.slice(0, -1) : origin;
  const objectKey = buildCharacterVisualObjectKey(projectId, knowledgeId, visualId);
  const encodedPath = objectKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${base}/${encodedPath}`;
}

export function isCharacterVisualLocatorUrl(url: string): boolean {
  return parseCharacterVisualLocatorUrl(url) !== undefined;
}

/** True when the UI must resolve a private locator through the download API. */
export function characterVisualDisplayNeedsResolve(url: string): boolean {
  return isCharacterVisualLocatorUrl(url);
}

export function parseCharacterVisualLocatorUrl(
  url: string
):
  | Readonly<{
      projectId: string;
      knowledgeId: string;
      visualId: string;
    }>
  | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.origin !== CHARACTER_VISUAL_LOCATOR_ORIGIN) {
    return undefined;
  }
  const segments = parsed.pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length !== 6) {
    return undefined;
  }
  const [
    projectsLabel,
    projectId,
    knowledgeLabel,
    knowledgeId,
    visualsLabel,
    visualId
  ] = segments;
  if (
    projectsLabel !== "projects" ||
    knowledgeLabel !== "story-knowledge" ||
    visualsLabel !== "visuals" ||
    projectId === undefined ||
    knowledgeId === undefined ||
    visualId === undefined ||
    projectId.length === 0 ||
    knowledgeId.length === 0 ||
    visualId.length === 0
  ) {
    return undefined;
  }
  return Object.freeze({
    projectId: decodeURIComponent(projectId),
    knowledgeId: decodeURIComponent(knowledgeId),
    visualId: decodeURIComponent(visualId)
  });
}

export { decodePngDataUri };

export function assertCharacterVisualPngDataUri(dataUri: string): Uint8Array {
  try {
    return decodePngDataUri(dataUri);
  } catch (error) {
    if (error instanceof DomainValidationError) {
      throw new DomainValidationError(
        error.code,
        error.message.replace(/^Book cover/u, "Character visual")
      );
    }
    throw error;
  }
}
