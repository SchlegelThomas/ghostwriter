import Underline from "@tiptap/extension-underline";
import { UniqueID } from "@tiptap/extension-unique-id";
import {
  EditorContent,
  useEditor,
  useEditorState,
  type JSONContent,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";

import { serializeCanonicalSceneDocument } from "./canonical.js";
import {
  generateBlockId,
  validateSceneDocumentV1,
} from "./document.js";
import { clampEditorSelection } from "./selection.js";
import {
  SCENE_DOCUMENT_SCHEMA_VERSION,
  type SceneDocumentV1,
} from "./types.js";

export { clampEditorSelection } from "./selection.js";

/** Request token — bump `id` to insert `text` at the live caret. */
export type SceneEditorInsertRequest = Readonly<{
  id: number;
  text: string;
}>;

export const SCENE_EDITOR_CLASS_NAMES = {
  root: "ghostwriter-scene-editor",
  toolbar: "ghostwriter-scene-editor__toolbar",
  toolbarButton: "ghostwriter-scene-editor__toolbar-button",
  content: "ghostwriter-scene-editor__content",
} as const;

export interface SceneEditorProps {
  /** Schema-v1 platform-neutral JSON rendered by the editor. */
  readonly value: SceneDocumentV1;
  /** Receives strict schema-v1 JSON after each editor content change. */
  readonly onChange: (value: SceneDocumentV1) => void;
  /** Required accessible name for the prose editing surface. */
  readonly ariaLabel: string;
  /** Allows read-only rendering without presenting the control as disabled. */
  readonly editable?: boolean;
  /** Disables both prose editing and formatting controls. */
  readonly disabled?: boolean;
  /** CSS hook added to `ghostwriter-scene-editor`. */
  readonly className?: string;
  /** CSS hook added to `ghostwriter-scene-editor__toolbar`. */
  readonly toolbarClassName?: string;
  /** CSS hook added directly to the ProseMirror editing element. */
  readonly editorClassName?: string;
  /** Optional root style override, useful for Expo web hosts. */
  readonly style?: CSSProperties;
  /** Session-only caret/selection recovery across Reader and shell remounts. */
  readonly selectionStorageKey?: string;
  /** Dictation / assist insert at the current selection (id must change each request). */
  readonly insertTextRequest?: SceneEditorInsertRequest;
  /** When false (default), formatting controls stay collapsed behind Aa. */
  readonly defaultFormattingToolbarOpen?: boolean;
}

interface ToolbarButtonProps {
  readonly label: string;
  readonly children: ReactNode;
  readonly disabled: boolean;
  readonly pressed?: boolean;
  readonly onActivate: () => void;
}

const ROOT_STYLE: CSSProperties = {
  border: "1px solid #d8cdbd",
  borderRadius: 8,
  backgroundColor: "#fffdf9",
  color: "#2f2924",
  overflow: "hidden",
};

const TOOLBAR_STYLE: CSSProperties = {
  alignItems: "center",
  backgroundColor: "#f6f0e7",
  borderBottom: "1px solid #d8cdbd",
  display: "flex",
  flexWrap: "wrap",
  gap: 2,
  minHeight: 32,
  padding: "2px 4px",
  position: "sticky",
  top: 0,
  zIndex: 2,
};

const TOOLBAR_BUTTON_STYLE: CSSProperties = {
  alignItems: "center",
  backgroundColor: "transparent",
  border: "1px solid transparent",
  borderRadius: 4,
  color: "inherit",
  cursor: "pointer",
  display: "inline-flex",
  font: "inherit",
  fontSize: 12,
  justifyContent: "center",
  lineHeight: 1,
  minHeight: 26,
  minWidth: 26,
  padding: "3px 5px",
};

const ACTIVE_TOOLBAR_BUTTON_STYLE: CSSProperties = {
  backgroundColor: "#e9dece",
  borderColor: "#baa98f",
};

const EMPTY_TOOLBAR_STATE = {
  blockquote: false,
  bold: false,
  canRedo: false,
  canUndo: false,
  heading1: false,
  heading2: false,
  italic: false,
  paragraph: false,
  strike: false,
  underline: false,
};

const PROSEMIRROR_STYLE = [
  "box-sizing: border-box",
  "font-family: Georgia, 'Times New Roman', serif",
  "font-size: 1rem",
  "line-height: 1.75",
  "min-height: 14rem",
  "outline: none",
  "padding: 1rem 1.25rem",
  "white-space: pre-wrap",
].join("; ");

function joinClassNames(
  ...classNames: readonly (string | undefined)[]
): string {
  return classNames.filter((className) => className !== undefined).join(" ");
}

function toEditorContent(value: SceneDocumentV1): JSONContent {
  return JSON.parse(JSON.stringify(value.document)) as JSONContent;
}

function createEditorAttributes(
  ariaLabel: string,
  editorClassName: string | undefined,
  editable: boolean,
  disabled: boolean,
): Record<string, string> {
  return {
    "aria-disabled": String(disabled),
    "aria-label": ariaLabel,
    "aria-multiline": "true",
    "aria-readonly": String(!editable),
    class: joinClassNames(
      SCENE_EDITOR_CLASS_NAMES.content,
      editorClassName,
    ),
    role: "textbox",
    style: PROSEMIRROR_STYLE,
    tabindex: disabled ? "-1" : "0",
  };
}

function createSceneEditorExtensions() {
  return [
    StarterKit.configure({
      bulletList: false,
      code: false,
      codeBlock: false,
      heading: {
        levels: [1, 2, 3],
      },
      link: false,
      listItem: false,
      listKeymap: false,
      orderedList: false,
      trailingNode: false,
      underline: false,
    }),
    Underline,
    UniqueID.configure({
      attributeName: "id",
      generateID: () => generateBlockId(),
      types: ["paragraph", "heading", "blockquote", "horizontalRule"],
    }),
  ];
}

function readStoredSelection(
  key: string | undefined,
  maximumPosition: number,
): Readonly<{ from: number; to: number }> | undefined {
  if (key === undefined || typeof sessionStorage === "undefined") return undefined;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(key) ?? "null") as {
      from?: unknown;
      to?: unknown;
    } | null;
    if (
      parsed === null ||
      !Number.isSafeInteger(parsed.from) ||
      !Number.isSafeInteger(parsed.to)
    ) {
      return undefined;
    }
    return clampEditorSelection(
      { from: Number(parsed.from), to: Number(parsed.to) },
      maximumPosition,
    );
  } catch {
    return undefined;
  }
}

function writeStoredSelection(
  key: string | undefined,
  selection: Readonly<{ from: number; to: number }>,
): void {
  if (key === undefined || typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      key,
      JSON.stringify({ from: selection.from, to: selection.to }),
    );
  } catch {
    // Session-only presentation state may fail without affecting canonical prose.
  }
}

function ToolbarButton({
  label,
  children,
  disabled,
  pressed,
  onActivate,
}: ToolbarButtonProps) {
  function keepEditorSelection(event: MouseEvent<HTMLButtonElement>): void {
    event.preventDefault();
  }

  return (
    <button
      aria-label={label}
      aria-pressed={pressed}
      className={SCENE_EDITOR_CLASS_NAMES.toolbarButton}
      disabled={disabled}
      onClick={onActivate}
      onMouseDown={keepEditorSelection}
      style={{
        ...TOOLBAR_BUTTON_STYLE,
        ...(pressed === true ? ACTIVE_TOOLBAR_BUTTON_STYLE : {}),
        ...(disabled ? { cursor: "default", opacity: 0.5 } : {}),
      }}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

/**
 * Web Tiptap scene editor. The component deliberately exposes only
 * schema-versioned JSON and React presentation hooks—never Tiptap editor,
 * ProseMirror view, or DOM values.
 */
export function SceneEditor({
  value,
  onChange,
  ariaLabel,
  editable = true,
  disabled = false,
  className,
  toolbarClassName,
  editorClassName,
  style,
  selectionStorageKey,
  insertTextRequest,
  defaultFormattingToolbarOpen = false,
}: SceneEditorProps) {
  const [formattingOpen, setFormattingOpen] = useState(
    defaultFormattingToolbarOpen,
  );
  const normalizedValue = useMemo(
    () => validateSceneDocumentV1(value),
    [value],
  );
  const canonicalValue = useMemo(
    () => serializeCanonicalSceneDocument(normalizedValue),
    [normalizedValue],
  );
  const onChangeRef = useRef(onChange);
  const selectionStorageKeyRef = useRef(selectionStorageKey);
  const suppressSelectionWriteRef = useRef(false);
  const hasRestoredSelectionRef = useRef(false);
  const focusOnNextRestoreRef = useRef(true);
  const isEditable = editable && !disabled;
  const extensions = useMemo(createSceneEditorExtensions, []);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    selectionStorageKeyRef.current = selectionStorageKey;
    hasRestoredSelectionRef.current = false;
    focusOnNextRestoreRef.current = true;
  }, [selectionStorageKey]);

  function restoreStoredSelection(
    targetEditor: {
      isDestroyed: boolean;
      isEditable: boolean;
      state: { doc: { content: { size: number } }; selection: { from: number; to: number } };
      commands: {
        setTextSelection(selection: { from: number; to: number }): boolean;
      };
      chain(): {
        focus(): { setTextSelection(selection: { from: number; to: number }): { run(): boolean } };
        setTextSelection(selection: { from: number; to: number }): { run(): boolean };
      };
    },
  ): void {
    if (hasRestoredSelectionRef.current || targetEditor.isDestroyed) {
      return;
    }
    // Draft mounts read-only until the scene lease is held. Restoring (and
    // especially focusing) while contenteditable=false cannot stick.
    if (!targetEditor.isEditable) {
      return;
    }
    const stored = readStoredSelection(
      selectionStorageKeyRef.current,
      targetEditor.state.doc.content.size,
    );
    hasRestoredSelectionRef.current = true;
    if (stored === undefined) {
      focusOnNextRestoreRef.current = false;
      return;
    }
    suppressSelectionWriteRef.current = true;
    const shouldFocus = focusOnNextRestoreRef.current;
    focusOnNextRestoreRef.current = false;
    if (shouldFocus) {
      // First restore after mount/scene change: return keyboard focus with the
      // caret so Reader/shell remounts do not land at offset 0.
      targetEditor.chain().focus().setTextSelection(stored).run();
    } else {
      targetEditor.commands.setTextSelection(stored);
    }
    const finish = () => {
      suppressSelectionWriteRef.current = false;
      if (!targetEditor.isDestroyed) {
        writeStoredSelection(
          selectionStorageKeyRef.current,
          targetEditor.state.selection,
        );
      }
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(finish);
    } else {
      queueMicrotask(finish);
    }
  }

  const editor = useEditor({
    content: toEditorContent(normalizedValue),
    editable: isEditable,
    editorProps: {
      attributes: createEditorAttributes(
        ariaLabel,
        editorClassName,
        isEditable,
        disabled,
      ),
    },
    extensions,
    immediatelyRender: false,
    onCreate: ({ editor: createdEditor }) => {
      // Content sync may still run after create; restore again there.
      const restore = () => restoreStoredSelection(createdEditor);
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(restore);
      } else {
        queueMicrotask(restore);
      }
    },
    onSelectionUpdate: ({ editor: updatedEditor }) => {
      // Persist only focused writer carets so remount/blur churn cannot
      // overwrite the session caret before restore runs.
      if (
        suppressSelectionWriteRef.current ||
        !updatedEditor.isFocused
      ) {
        return;
      }
      writeStoredSelection(
        selectionStorageKeyRef.current,
        updatedEditor.state.selection,
      );
    },
    onBlur: ({ editor: blurredEditor }) => {
      if (suppressSelectionWriteRef.current) {
        return;
      }
      writeStoredSelection(
        selectionStorageKeyRef.current,
        blurredEditor.state.selection,
      );
    },
    onUpdate: ({ editor: updatedEditor }) => {
      const nextValue = validateSceneDocumentV1({
        schemaVersion: SCENE_DOCUMENT_SCHEMA_VERSION,
        document: updatedEditor.getJSON(),
      });
      onChangeRef.current(nextValue);
    },
  });

  const toolbarState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      blockquote: currentEditor?.isActive("blockquote") ?? false,
      bold: currentEditor?.isActive("bold") ?? false,
      canRedo: currentEditor?.can().redo() ?? false,
      canUndo: currentEditor?.can().undo() ?? false,
      heading1:
        currentEditor?.isActive("heading", { level: 1 }) ?? false,
      heading2:
        currentEditor?.isActive("heading", { level: 2 }) ?? false,
      italic: currentEditor?.isActive("italic") ?? false,
      paragraph: currentEditor?.isActive("paragraph") ?? false,
      strike: currentEditor?.isActive("strike") ?? false,
      underline: currentEditor?.isActive("underline") ?? false,
    }),
  });
  const currentToolbarState = toolbarState ?? EMPTY_TOOLBAR_STATE;

  useEffect(() => {
    if (editor === null || editor.isDestroyed) {
      return;
    }

    editor.setEditable(isEditable, false);
    editor.setOptions({
      editorProps: {
        ...editor.options.editorProps,
        attributes: createEditorAttributes(
          ariaLabel,
          editorClassName,
          isEditable,
          disabled,
        ),
      },
    });
    if (isEditable) {
      restoreStoredSelection(editor);
    }
  }, [ariaLabel, disabled, editor, editorClassName, isEditable]);

  useEffect(() => {
    if (editor === null || editor.isDestroyed) {
      return;
    }

    const editorValue = validateSceneDocumentV1({
      schemaVersion: SCENE_DOCUMENT_SCHEMA_VERSION,
      document: editor.getJSON(),
    });

    if (serializeCanonicalSceneDocument(editorValue) !== canonicalValue) {
      // setContent resets the caret; keep the session restore pending so we
      // can re-apply after the canonical document lands.
      hasRestoredSelectionRef.current = false;
      editor.commands.setContent(toEditorContent(normalizedValue), {
        emitUpdate: false,
        errorOnInvalidContent: true,
      });
      restoreStoredSelection(editor);
    } else if (!hasRestoredSelectionRef.current) {
      restoreStoredSelection(editor);
    }
  }, [canonicalValue, editor, isEditable, normalizedValue]);

  const lastInsertIdRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (
      editor === null ||
      editor.isDestroyed ||
      !isEditable ||
      insertTextRequest === undefined ||
      insertTextRequest.text.length === 0 ||
      insertTextRequest.id === lastInsertIdRef.current
    ) {
      return;
    }
    lastInsertIdRef.current = insertTextRequest.id;
    editor.chain().focus().insertContent(insertTextRequest.text).run();
  }, [editor, insertTextRequest, isEditable]);

  if (ariaLabel.trim().length === 0) {
    throw new Error("SceneEditor requires a non-empty ariaLabel.");
  }

  if (editor === null) {
    return (
      <div
        aria-label={ariaLabel}
        className={joinClassNames(
          SCENE_EDITOR_CLASS_NAMES.root,
          className,
        )}
        data-ghostwriter-editor="loading"
        style={{ ...ROOT_STYLE, ...style }}
      />
    );
  }

  const controlsDisabled = !isEditable;

  return (
    <div
      className={joinClassNames(SCENE_EDITOR_CLASS_NAMES.root, className)}
      data-ghostwriter-editor="ready"
      style={{ ...ROOT_STYLE, ...style }}
    >
      <div
        aria-label={`${ariaLabel} formatting`}
        className={joinClassNames(
          SCENE_EDITOR_CLASS_NAMES.toolbar,
          toolbarClassName,
        )}
        role="toolbar"
        style={TOOLBAR_STYLE}
      >
        <ToolbarButton
          disabled={false}
          label={formattingOpen ? "Hide formatting" : "Show formatting"}
          onActivate={() => setFormattingOpen((open) => !open)}
          pressed={formattingOpen}
        >
          Aa
        </ToolbarButton>
        {formattingOpen ? (
          <>
            <ToolbarButton
              disabled={controlsDisabled}
              label="Paragraph"
              onActivate={() => editor.chain().focus().setParagraph().run()}
              pressed={currentToolbarState.paragraph}
            >
              ¶
            </ToolbarButton>
            <ToolbarButton
              disabled={controlsDisabled}
              label="Heading 1"
              onActivate={() =>
                editor.chain().focus().toggleHeading({ level: 1 }).run()
              }
              pressed={currentToolbarState.heading1}
            >
              H1
            </ToolbarButton>
            <ToolbarButton
              disabled={controlsDisabled}
              label="Heading 2"
              onActivate={() =>
                editor.chain().focus().toggleHeading({ level: 2 }).run()
              }
              pressed={currentToolbarState.heading2}
            >
              H2
            </ToolbarButton>
            <ToolbarButton
              disabled={controlsDisabled}
              label="Block quote"
              onActivate={() =>
                editor.chain().focus().toggleBlockquote().run()
              }
              pressed={currentToolbarState.blockquote}
            >
              “”
            </ToolbarButton>
            <ToolbarButton
              disabled={controlsDisabled}
              label="Scene break"
              onActivate={() =>
                editor.chain().focus().setHorizontalRule().run()
              }
            >
              ⁂
            </ToolbarButton>
            <ToolbarButton
              disabled={controlsDisabled}
              label="Bold"
              onActivate={() => editor.chain().focus().toggleBold().run()}
              pressed={currentToolbarState.bold}
            >
              <strong>B</strong>
            </ToolbarButton>
            <ToolbarButton
              disabled={controlsDisabled}
              label="Italic"
              onActivate={() => editor.chain().focus().toggleItalic().run()}
              pressed={currentToolbarState.italic}
            >
              <em>I</em>
            </ToolbarButton>
            <ToolbarButton
              disabled={controlsDisabled}
              label="Underline"
              onActivate={() => editor.chain().focus().toggleUnderline().run()}
              pressed={currentToolbarState.underline}
            >
              <u>U</u>
            </ToolbarButton>
            <ToolbarButton
              disabled={controlsDisabled}
              label="Strikethrough"
              onActivate={() => editor.chain().focus().toggleStrike().run()}
              pressed={currentToolbarState.strike}
            >
              <s>S</s>
            </ToolbarButton>
            <ToolbarButton
              disabled={controlsDisabled || !currentToolbarState.canUndo}
              label="Undo"
              onActivate={() => editor.chain().focus().undo().run()}
            >
              ↶
            </ToolbarButton>
            <ToolbarButton
              disabled={controlsDisabled || !currentToolbarState.canRedo}
              label="Redo"
              onActivate={() => editor.chain().focus().redo().run()}
            >
              ↷
            </ToolbarButton>
          </>
        ) : null}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
