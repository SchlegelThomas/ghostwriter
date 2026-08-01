export const WORKSPACE_CHAT_MAX_ATTACHMENTS = 3;
export const WORKSPACE_CHAT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export type WorkspaceChatPendingAttachment = Readonly<{
  id: string;
  kind: "image" | "video";
  name: string;
  mimeType: string;
  /** Base64 payload without data-URL prefix; images only when under size cap. */
  dataBase64?: string;
  byteLength: number;
}>;

export type WorkspaceChatComposerKeyEvent = Readonly<{
  key?: string;
  shiftKey?: boolean;
  nativeEvent?: Readonly<{ isComposing?: boolean; keyCode?: number; key?: string }>;
}>;

/** Enter sends; Shift+Enter inserts a newline. */
export function shouldSubmitChatOnEnterKey(
  event: WorkspaceChatComposerKeyEvent
): boolean {
  if (event.key !== "Enter" || event.shiftKey === true) return false;
  const nativeEvent = event.nativeEvent;
  if (nativeEvent?.isComposing === true) return false;
  if (nativeEvent?.keyCode === 229) return false;
  return true;
}

const IMAGE_MIME_PREFIX = "image/";
const VIDEO_MIME_PREFIX = "video/";

export function composerAttachmentKindFromMime(
  mimeType: string
): "image" | "video" | undefined {
  const normalized = mimeType.trim().toLowerCase();
  if (normalized.startsWith(IMAGE_MIME_PREFIX)) return "image";
  if (normalized.startsWith(VIDEO_MIME_PREFIX)) return "video";
  return undefined;
}

export function composerAttachmentAcceptAttribute(): string {
  return "image/jpeg,image/png,image/webp,video/mp4,video/webm,video/*";
}

export function resolveComposerSendMessage(
  draft: string,
  attachments: readonly WorkspaceChatPendingAttachment[]
): string {
  const trimmed = draft.trim();
  if (trimmed.length > 0) return trimmed;
  if (attachments.length === 0) return "";
  return `Attached: ${attachments.map((attachment) => attachment.name).join(", ")}`;
}

export async function readComposerAttachmentFile(
  file: File
): Promise<WorkspaceChatPendingAttachment | Readonly<{ error: string }>> {
  const kind = composerAttachmentKindFromMime(file.type);
  if (kind === undefined) {
    return { error: "Only images and videos are supported." };
  }
  if (kind === "image" && file.size > WORKSPACE_CHAT_MAX_IMAGE_BYTES) {
    return { error: "Each image must be 8 MB or smaller." };
  }

  if (kind === "video") {
    return Object.freeze({
      id: `attach-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      name: file.name,
      mimeType: file.type || "video/mp4",
      byteLength: file.size
    });
  }

  const dataBase64 = await readFileAsBase64(file);
  return Object.freeze({
    id: `attach-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    name: file.name,
    mimeType: file.type || "image/jpeg",
    dataBase64,
    byteLength: file.size
  });
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Could not read attachment."));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read attachment."));
    reader.readAsDataURL(file);
  });
}
