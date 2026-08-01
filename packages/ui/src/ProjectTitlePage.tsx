import { useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import type {
  BookCover,
  BookId,
  BookStatus,
  ProjectCommand,
  ProjectNavigator,
  ProjectNavigatorBook
} from "@ghostwriter/core";
import type { ManuscriptSelection } from "./manuscript-selection.js";
import {
  bookCoverInitials,
  bookCoverPlaceholderColors,
  bookCoverTrailLabel,
  bookTitleStudioFingerprint,
  buildBookCoverImagePrompt
} from "./project-title-page-model.js";
import {
  ImageGenerationUnavailable,
  ImageModelPicker
} from "./ImageModelPicker.js";
import {
  accountHasAvailableImageModels,
  resolveWorkspaceImageModelId,
  workspaceImageModelPickerOptions,
  type WorkspaceAvailableModel
} from "./workspace-agent-prefs.js";
import { ghostwriterTheme } from "./theme.js";
import type { OpenSettingsHandler } from "./settings-focus.js";

const { colors, fonts } = ghostwriterTheme;

const BOOK_STATUSES: readonly BookStatus[] = [
  "planned",
  "drafting",
  "revising",
  "complete"
];

const DEFAULT_COVER_OPTION_COUNT = 3;

export type CoverOptionsJobSnapshot = Readonly<{
  bookId: BookId;
  jobId: string;
  status: "queued" | "running" | "ready" | "failed";
  options?: readonly Readonly<{
    id: string;
    previewUrl: string;
    prompt: string;
    variationIndex: number;
  }>[];
  error?: Readonly<{
    code: string;
    message: string;
  }>;
  basePrompt?: string;
}>;

export type ProjectTitlePageProps = Readonly<{
  project: ProjectNavigator;
  busy?: boolean;
  onCommand(command: ProjectCommand): Promise<boolean>;
  onOpenBook(selection: Extract<ManuscriptSelection, { kind: "book" }>): void;
  onProposeCoverConcept?(bookId: BookId): void;
  onStartCoverOptionsJob?(input: Readonly<{
    bookId: BookId;
    prompt: string;
    count?: number;
    refinement?: string;
    imageModel?: string;
  }>): Promise<void>;
  coverOptionsJob?: CoverOptionsJobSnapshot;
  coverReviewBookId?: BookId;
  onCoverReviewConsumed?(): void;
  imageAvailableModels?: readonly WorkspaceAvailableModel[];
  preferredImageModelId?: string;
  onOpenSettings?: OpenSettingsHandler;
  /** @deprecated Prefer onStartCoverOptionsJob — sync preview is unused by the studio UI. */
  onGenerateCoverPreview?(input: Readonly<{
    bookId: BookId;
    prompt: string;
  }>): Promise<Readonly<{ previewUrl: string }>>;
  onApplyCoverImage?(input: Readonly<{
    bookId: BookId;
    previewDataUri: string;
  }>): Promise<void>;
  onResolveCoverDisplayUrl?(input: Readonly<{
    bookId: BookId;
    imageUrl: string;
  }>): Promise<string | undefined>;
}>;

type SaveStatus = "idle" | "saved" | "unchanged" | "error";

type TitlePageView = "shelf" | "book";

function statusWhisper(status: BookStatus): string {
  switch (status) {
    case "planned":
      return "Planned";
    case "drafting":
      return "Drafting";
    case "revising":
      return "Revising";
    case "complete":
      return "Complete";
  }
}

function coverImageUrlForSave(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("data:")) {
    return "";
  }
  return trimmed;
}

function coverFromDraft(draft: Readonly<{
  concept: string;
  notes: string;
  imageUrl: string;
}>): BookCover | null {
  const concept = draft.concept.trim();
  const notes = draft.notes.trim();
  const imageUrl = coverImageUrlForSave(draft.imageUrl);
  if (concept === "" && notes === "" && imageUrl === "") {
    return null;
  }
  return {
    ...(concept === "" ? {} : { concept }),
    ...(notes === "" ? {} : { notes }),
    ...(imageUrl === "" ? {} : { imageUrl })
  };
}

function PanelButton({
  label,
  onPress,
  disabled = false,
  primary = false
}: Readonly<{
  label: string;
  onPress(): void;
  disabled?: boolean;
  primary?: boolean;
}>) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary && styles.buttonPrimary,
        pressed && styles.pressed,
        disabled && styles.disabled
      ]}
    >
      <Text
        style={[styles.buttonText, primary && styles.buttonTextPrimary]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function externalHttpsCoverUrl(imageUrl: string | undefined): string | undefined {
  if (imageUrl === undefined) return undefined;
  if (imageUrl.startsWith("https://") || imageUrl.startsWith("http://")) {
    return imageUrl;
  }
  return undefined;
}

function useCoverDisplayUrl(
  bookId: BookId | undefined,
  imageUrl: string | undefined,
  onResolve?: ProjectTitlePageProps["onResolveCoverDisplayUrl"]
): string | undefined {
  const [resolved, setResolved] = useState<string | undefined>();
  // Keep unstable parent callbacks out of effect deps (same pattern as Cast visuals).
  const onResolveRef = useRef(onResolve);
  onResolveRef.current = onResolve;

  useEffect(() => {
    if (bookId === undefined || imageUrl === undefined) {
      setResolved(undefined);
      return;
    }
    const resolve = onResolveRef.current;
    if (resolve === undefined) {
      setResolved(externalHttpsCoverUrl(imageUrl));
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const next = await resolve({ bookId, imageUrl });
        if (cancelled) return;
        setResolved(next ?? externalHttpsCoverUrl(imageUrl));
      } catch {
        if (!cancelled) {
          setResolved(externalHttpsCoverUrl(imageUrl));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId, imageUrl]);

  return resolved ?? externalHttpsCoverUrl(imageUrl);
}

function TitleBreadcrumbs({
  crumbs
}: Readonly<{
  crumbs: readonly Readonly<{
    label: string;
    onPress?: () => void;
  }>[];
}>) {
  return (
    <View accessibilityLabel="Title page trail" style={styles.crumbs}>
      {crumbs.map((crumb, index) => {
        const current = index === crumbs.length - 1;
        return (
          <View key={`${crumb.label}:${index}`} style={styles.crumbItem}>
            {index === 0 ? null : (
              <Text style={styles.crumbDivider}>·</Text>
            )}
            {crumb.onPress === undefined || current ? (
              <Text
                numberOfLines={1}
                style={[styles.crumbText, current && styles.crumbTextCurrent]}
              >
                {crumb.label}
              </Text>
            ) : (
              <Pressable
                accessibilityRole="link"
                onPress={crumb.onPress}
                style={({ pressed }) => [pressed && styles.pressed]}
              >
                <Text numberOfLines={1} style={styles.crumbLink}>
                  {crumb.label}
                </Text>
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}

function StatusDropdown({
  value,
  disabled,
  onChange
}: Readonly<{
  value: BookStatus;
  disabled?: boolean;
  onChange(status: BookStatus): void;
}>) {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.statusDropdown}>
      <Pressable
        accessibilityLabel="Book status"
        accessibilityRole="button"
        accessibilityState={{ expanded: open, disabled: Boolean(disabled) }}
        disabled={disabled}
        onPress={() => setOpen((current) => !current)}
        style={({ pressed }) => [
          styles.statusDropdownTrigger,
          pressed && styles.pressed,
          disabled && styles.disabled
        ]}
      >
        <Text style={styles.statusDropdownTriggerText}>
          {statusWhisper(value)}
        </Text>
        <Text style={styles.statusDropdownCaret}>{open ? "▴" : "▾"}</Text>
      </Pressable>
      {open ? (
        <View accessibilityRole="menu" style={styles.statusDropdownMenu}>
          {BOOK_STATUSES.map((status) => {
            const selected = status === value;
            return (
              <Pressable
                accessibilityRole="menuitem"
                accessibilityState={{ selected }}
                key={status}
                onPress={() => {
                  onChange(status);
                  setOpen(false);
                }}
                style={({ pressed }) => [
                  styles.statusDropdownItem,
                  selected && styles.statusDropdownItemSelected,
                  pressed && styles.pressed
                ]}
              >
                <Text
                  style={[
                    styles.statusDropdownItemText,
                    selected && styles.statusDropdownItemTextSelected
                  ]}
                >
                  {statusWhisper(status)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/** Perspective hardcover: spine + page block + cover face with art. */
function RenderedBook({
  title,
  status,
  coverUri,
  large = false,
  showStatus = true
}: Readonly<{
  title: string;
  status: BookStatus;
  coverUri?: string;
  large?: boolean;
  showStatus?: boolean;
}>) {
  const placeholder = bookCoverPlaceholderColors(title);
  const initials = bookCoverInitials(title);
  const faceWidth = large ? 200 : 112;
  const faceHeight = large ? 300 : 168;
  const spineWidth = large ? 22 : 12;
  const pageWidth = large ? 10 : 6;

  return (
    <View
      accessibilityLabel={`Rendered book ${title}`}
      style={[
        styles.bookStage,
        large && styles.bookStageLarge,
        {
          width: spineWidth + faceWidth + pageWidth + (large ? 18 : 10),
          height: faceHeight + (large ? 16 : 8)
        }
      ]}
    >
      <View
        style={[
          styles.bookShadow,
          {
            width: faceWidth + spineWidth,
            height: faceHeight * 0.2,
            left: spineWidth * 0.4
          }
        ]}
      />
      <View
        style={[
          styles.bookAssembly,
          large && styles.bookAssemblyLarge,
          { height: faceHeight }
        ]}
      >
        <View
          style={[
            styles.bookSpine,
            {
              width: spineWidth,
              height: faceHeight,
              backgroundColor: placeholder.bottom
            }
          ]}
        >
          {large ? (
            <Text numberOfLines={1} style={styles.bookSpineText}>
              {bookCoverTrailLabel(title)}
            </Text>
          ) : null}
        </View>
        <View
          style={[
            styles.bookFace,
            { width: faceWidth, height: faceHeight }
          ]}
        >
          {coverUri === undefined ? (
            <>
              <View
                style={[
                  styles.coverPlaceholderTop,
                  { backgroundColor: placeholder.top }
                ]}
              />
              <View
                style={[
                  styles.coverPlaceholderBottom,
                  { backgroundColor: placeholder.bottom }
                ]}
              />
              <Text
                style={[
                  styles.coverInitials,
                  large && styles.coverInitialsLarge
                ]}
              >
                {initials}
              </Text>
            </>
          ) : (
            <Image
              accessibilityLabel={`Cover art for ${title}`}
              resizeMode="cover"
              source={{ uri: coverUri }}
              style={styles.coverImage}
            />
          )}
          <View style={styles.coverTitleOverlay}>
            <Text
              numberOfLines={large ? 4 : 3}
              style={[styles.coverTitle, large && styles.coverTitleLarge]}
            >
              {title}
            </Text>
            {showStatus ? (
              <Text style={styles.coverStatus}>{statusWhisper(status)}</Text>
            ) : null}
          </View>
          <View style={styles.bookFaceSheen} />
        </View>
        <View
          style={[
            styles.bookPages,
            { width: pageWidth, height: faceHeight - 8 }
          ]}
        />
      </View>
    </View>
  );
}

function ShelfTile({
  book,
  disabled,
  onPress,
  onResolveCoverDisplayUrl
}: Readonly<{
  book: ProjectNavigatorBook;
  disabled: boolean;
  onPress(): void;
  onResolveCoverDisplayUrl?: ProjectTitlePageProps["onResolveCoverDisplayUrl"];
}>) {
  const displayUrl = useCoverDisplayUrl(
    book.id,
    book.cover?.imageUrl,
    onResolveCoverDisplayUrl
  );

  return (
    <Pressable
      accessibilityLabel={`Open title studio for ${book.title}`}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.shelfTile, pressed && styles.pressed]}
    >
      <RenderedBook
        coverUri={displayUrl}
        status={book.status}
        title={book.title}
      />
      <Text numberOfLines={2} style={styles.shelfTileCaption}>
        {book.title}
      </Text>
    </Pressable>
  );
}

export function ProjectTitlePage({
  project,
  busy = false,
  onCommand,
  onOpenBook,
  onProposeCoverConcept,
  onStartCoverOptionsJob,
  coverOptionsJob,
  coverReviewBookId,
  onCoverReviewConsumed,
  imageAvailableModels = [],
  preferredImageModelId,
  onOpenSettings,
  onApplyCoverImage,
  onResolveCoverDisplayUrl
}: ProjectTitlePageProps) {
  const activeBooks = useMemo(
    () => project.books.filter((book) => book.archivedAt === undefined),
    [project.books]
  );

  const [view, setView] = useState<TitlePageView>("shelf");
  const [focusedBookId, setFocusedBookId] = useState<BookId | undefined>();
  const [projectTitleDraft, setProjectTitleDraft] = useState(project.title);
  const [bookTitleDraft, setBookTitleDraft] = useState("");
  const [statusDraft, setStatusDraft] = useState<BookStatus>("planned");
  const [conceptDraft, setConceptDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [imageUrlDraft, setImageUrlDraft] = useState("");
  const [showAdvancedUrl, setShowAdvancedUrl] = useState(false);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | undefined>();
  const [coverPreviewDataUri, setCoverPreviewDataUri] = useState<
    string | undefined
  >();
  const [selectedOptionId, setSelectedOptionId] = useState<string | undefined>();
  const [refinementDraft, setRefinementDraft] = useState("");
  const [coverJobStarting, setCoverJobStarting] = useState(false);
  const [coverApplying, setCoverApplying] = useState(false);
  const [coverActionError, setCoverActionError] = useState<string | undefined>();
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveStatusMessage, setSaveStatusMessage] = useState<string | undefined>();
  const imageModelOptions = useMemo(
    () => workspaceImageModelPickerOptions(imageAvailableModels),
    [imageAvailableModels]
  );
  const imageGenerationAvailable = accountHasAvailableImageModels(
    imageAvailableModels
  );
  const [imageModelId, setImageModelId] = useState(() =>
    resolveWorkspaceImageModelId(imageAvailableModels, preferredImageModelId)
  );

  useEffect(() => {
    setImageModelId((current) => {
      if (imageModelOptions.some((entry) => entry.value === current)) {
        return current;
      }
      return resolveWorkspaceImageModelId(
        imageAvailableModels,
        preferredImageModelId
      );
    });
  }, [imageAvailableModels, imageModelOptions, preferredImageModelId]);

  const focusedBook = activeBooks.find((book) => book.id === focusedBookId);
  const focusedFingerprint =
    focusedBook === undefined
      ? undefined
      : bookTitleStudioFingerprint(focusedBook);

  const jobForFocusedBook =
    coverOptionsJob !== undefined &&
    focusedBook !== undefined &&
    coverOptionsJob.bookId === focusedBook.id
      ? coverOptionsJob
      : undefined;

  const jobInFlight =
    jobForFocusedBook !== undefined &&
    (jobForFocusedBook.status === "queued" ||
      jobForFocusedBook.status === "running");

  const coverImageBusy = coverJobStarting || coverApplying || jobInFlight;
  const coverActionsDisabled =
    busy || coverImageBusy || !imageGenerationAvailable;

  const savedCoverDisplayUrl = useCoverDisplayUrl(
    focusedBook?.id,
    focusedBook?.cover?.imageUrl,
    onResolveCoverDisplayUrl
  );

  const bookFaceUri = coverPreviewUrl ?? savedCoverDisplayUrl;

  useEffect(() => {
    setProjectTitleDraft(project.title);
  }, [project.title]);

  useEffect(() => {
    if (view !== "book") return;
    if (
      focusedBookId !== undefined &&
      activeBooks.some((book) => book.id === focusedBookId)
    ) {
      return;
    }
    setView("shelf");
    setFocusedBookId(undefined);
  }, [activeBooks, focusedBookId, view]);

  useEffect(() => {
    if (coverReviewBookId === undefined) return;
    setFocusedBookId(coverReviewBookId);
    setView("book");
    onCoverReviewConsumed?.();
    // Consume once per review hint — avoid callback identity churn re-opening.
  }, [coverReviewBookId]);

  // Ephemeral option previews live outside server fingerprint — only reset when
  // the focused book identity changes (or studio closes).
  useEffect(() => {
    setCoverPreviewUrl(undefined);
    setCoverPreviewDataUri(undefined);
    setSelectedOptionId(undefined);
    setCoverActionError(undefined);
    setShowAdvancedUrl(false);
    setRefinementDraft("");
    setSaveStatus("idle");
    setSaveStatusMessage(undefined);
  }, [focusedBookId]);

  useEffect(() => {
    if (focusedFingerprint === undefined || focusedBook === undefined) {
      setBookTitleDraft("");
      setStatusDraft("planned");
      setConceptDraft("");
      setNotesDraft("");
      setImageUrlDraft("");
      return;
    }
    setBookTitleDraft(focusedBook.title);
    setStatusDraft(focusedBook.status);
    setConceptDraft(focusedBook.cover?.concept ?? "");
    setNotesDraft(focusedBook.cover?.notes ?? "");
    setImageUrlDraft(focusedBook.cover?.imageUrl ?? "");
    setSaveStatus("idle");
    setSaveStatusMessage(undefined);
    // Sync drafts only when server-owned fields change — not navigator identity,
    // and do not wipe in-progress cover option selection.
  }, [focusedFingerprint]);

  useEffect(() => {
    if (
      jobForFocusedBook === undefined ||
      jobForFocusedBook.status !== "ready" ||
      jobForFocusedBook.options === undefined ||
      jobForFocusedBook.options.length === 0
    ) {
      return;
    }
    const first = jobForFocusedBook.options[0]!;
    setSelectedOptionId(first.id);
    setCoverPreviewUrl(first.previewUrl);
    setCoverPreviewDataUri(first.previewUrl);
    setCoverActionError(undefined);
  }, [jobForFocusedBook?.jobId, jobForFocusedBook?.status]);

  useEffect(() => {
    if (jobForFocusedBook?.status !== "failed") return;
    setCoverActionError(
      jobForFocusedBook.error?.message ?? "Could not paint cover options."
    );
  }, [jobForFocusedBook?.jobId, jobForFocusedBook?.status, jobForFocusedBook?.error?.message]);

  useEffect(() => {
    if (!jobInFlight) return;
    setSelectedOptionId(undefined);
    setCoverPreviewUrl(undefined);
    setCoverPreviewDataUri(undefined);
    setCoverActionError(undefined);
  }, [jobForFocusedBook?.jobId, jobInFlight]);

  function clearSaveStatus(): void {
    setSaveStatus("idle");
    setSaveStatusMessage(undefined);
  }

  function openBookStudio(bookId: BookId): void {
    setFocusedBookId(bookId);
    setView("book");
  }

  function backToShelf(): void {
    setView("shelf");
    setFocusedBookId(undefined);
    setCoverPreviewUrl(undefined);
    setCoverPreviewDataUri(undefined);
    setSelectedOptionId(undefined);
    setCoverActionError(undefined);
    setRefinementDraft("");
    clearSaveStatus();
  }

  function selectCoverOption(option: Readonly<{
    id: string;
    previewUrl: string;
  }>): void {
    setSelectedOptionId(option.id);
    setCoverPreviewUrl(option.previewUrl);
    setCoverPreviewDataUri(option.previewUrl);
    setCoverActionError(undefined);
  }

  async function startCoverOptionsJob(
    refinement?: string
  ): Promise<void> {
    if (
      focusedBook === undefined ||
      onStartCoverOptionsJob === undefined ||
      coverActionsDisabled
    ) {
      return;
    }
    setCoverJobStarting(true);
    setCoverActionError(undefined);
    try {
      const prompt = buildBookCoverImagePrompt({
        title: bookTitleDraft,
        concept: conceptDraft
      });
      const trimmedRefinement = refinement?.trim() ?? "";
      await onStartCoverOptionsJob({
        bookId: focusedBook.id,
        prompt,
        count: DEFAULT_COVER_OPTION_COUNT,
        imageModel: imageModelId,
        ...(trimmedRefinement === ""
          ? {}
          : { refinement: trimmedRefinement })
      });
    } catch (error) {
      setCoverActionError(
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "Could not start cover options."
      );
    } finally {
      setCoverJobStarting(false);
    }
  }

  async function applyCoverPreview(): Promise<void> {
    if (
      focusedBook === undefined ||
      onApplyCoverImage === undefined ||
      coverPreviewDataUri === undefined ||
      busy ||
      coverApplying
    ) {
      return;
    }
    setCoverApplying(true);
    setCoverActionError(undefined);
    try {
      await onApplyCoverImage({
        bookId: focusedBook.id,
        previewDataUri: coverPreviewDataUri
      });
      setCoverPreviewUrl(undefined);
      setCoverPreviewDataUri(undefined);
      setSelectedOptionId(undefined);
    } catch (error) {
      setCoverActionError(
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "Could not apply the cover image."
      );
    } finally {
      setCoverApplying(false);
    }
  }

  async function commitProjectTitle(): Promise<void> {
    const next = projectTitleDraft.trim();
    if (next === "" || next === project.title) return;
    await onCommand({ type: "project.rename", title: next });
  }

  async function saveFocusedBook(): Promise<void> {
    if (focusedBook === undefined) return;
    const title = bookTitleDraft.trim();
    if (title === "") {
      setSaveStatus("error");
      setSaveStatusMessage("Add a book title before saving.");
      return;
    }

    const safeImageUrl = coverImageUrlForSave(imageUrlDraft);
    const cover = coverFromDraft({
      concept: conceptDraft,
      notes: notesDraft,
      imageUrl: safeImageUrl
    });

    const existingCover = focusedBook.cover;
    const coverChanged =
      (existingCover?.concept ?? "") !== conceptDraft.trim() ||
      (existingCover?.notes ?? "") !== notesDraft.trim() ||
      (existingCover?.imageUrl ?? "") !== safeImageUrl;

    if (
      title === focusedBook.title &&
      statusDraft === focusedBook.status &&
      !coverChanged
    ) {
      setSaveStatus("unchanged");
      setSaveStatusMessage("Up to date — nothing to save");
      return;
    }

    try {
      const saved = await onCommand({
        type: "book.update",
        bookId: focusedBook.id,
        ...(title === focusedBook.title ? {} : { title }),
        ...(statusDraft === focusedBook.status ? {} : { status: statusDraft }),
        ...(coverChanged ? { cover } : {})
      });
      if (saved) {
        setSaveStatus("saved");
        setSaveStatusMessage("Saved");
      } else {
        setSaveStatus("error");
        setSaveStatusMessage("Could not save details.");
      }
    } catch (error) {
      setSaveStatus("error");
      setSaveStatusMessage(
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "Could not save details."
      );
    }
  }

  async function clearCover(): Promise<void> {
    if (focusedBook === undefined || focusedBook.cover === undefined) return;
    setConceptDraft("");
    setNotesDraft("");
    setImageUrlDraft("");
    clearSaveStatus();
    await onCommand({
      type: "book.update",
      bookId: focusedBook.id,
      cover: null
    });
  }

  const coverOptionsStatusLine =
    coverJobStarting
      ? "Painting options in the background…"
      : jobInFlight
        ? `Painting ${DEFAULT_COVER_OPTION_COUNT} cover options…`
        : undefined;

  if (view === "book" && focusedBook !== undefined) {
    return (
      <ScrollView
        accessibilityLabel="Book title studio"
        contentContainerStyle={styles.studioScrollContent}
        keyboardShouldPersistTaps="handled"
        style={styles.root}
      >
        <View style={styles.studioTopBar}>
          <View style={styles.studioCrumbs}>
            <TitleBreadcrumbs
              crumbs={[
                { label: "Series", onPress: backToShelf },
                { label: "Title page", onPress: backToShelf },
                { label: bookCoverTrailLabel(focusedBook.title) }
              ]}
            />
          </View>
          <StatusDropdown
            disabled={busy}
            onChange={(status) => {
              clearSaveStatus();
              setStatusDraft(status);
            }}
            value={statusDraft}
          />
        </View>

        <View style={styles.studioCenter}>
          <RenderedBook
            coverUri={bookFaceUri}
            large
            showStatus={false}
            status={statusDraft}
            title={bookTitleDraft.trim() || focusedBook.title}
          />
          {coverPreviewUrl === undefined ? null : (
            <Text style={styles.previewHint}>
              Preview · apply to keep it on the book
            </Text>
          )}
          {coverOptionsStatusLine === undefined ? null : (
            <Text accessibilityLiveRegion="polite" style={styles.coverJobStatus}>
              {coverOptionsStatusLine}
            </Text>
          )}
          {jobForFocusedBook?.status === "ready" &&
          jobForFocusedBook.options !== undefined &&
          jobForFocusedBook.options.length > 0 ? (
            <ScrollView
              accessibilityLabel="Cover options"
              contentContainerStyle={styles.optionsStripContent}
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.optionsStrip}
            >
              {jobForFocusedBook.options.map((option) => {
                const selected = selectedOptionId === option.id;
                return (
                  <Pressable
                    accessibilityLabel={`Cover option ${option.variationIndex + 1}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    key={option.id}
                    onPress={() => selectCoverOption(option)}
                    style={({ pressed }) => [
                      styles.optionThumb,
                      selected && styles.optionThumbSelected,
                      pressed && styles.pressed
                    ]}
                  >
                    <Image
                      accessibilityLabel={`Cover option ${option.variationIndex + 1} preview`}
                      resizeMode="cover"
                      source={{ uri: option.previewUrl }}
                      style={styles.optionThumbImage}
                    />
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}
          {onStartCoverOptionsJob === undefined ||
          jobForFocusedBook === undefined ||
          jobForFocusedBook.status !== "ready" ? null : (
            <View style={styles.iterateRow}>
              <TextInput
                accessibilityLabel="Refine cover direction"
                editable={!busy && !coverImageBusy}
                onChangeText={setRefinementDraft}
                placeholder="Refine this direction…"
                style={[styles.fieldInput, styles.iterateInput]}
                value={refinementDraft}
              />
              <PanelButton
                disabled={busy || coverImageBusy}
                label="Iterate"
                onPress={() => void startCoverOptionsJob(refinementDraft)}
              />
            </View>
          )}
        </View>

        <View style={styles.studioForm}>
          <TextInput
            accessibilityLabel="Book title"
            editable={!busy}
            onBlur={() => void saveFocusedBook()}
            onChangeText={(value) => {
              clearSaveStatus();
              setBookTitleDraft(value);
            }}
            placeholder="Book title"
            style={styles.bookTitleInput}
            value={bookTitleDraft}
          />

          <View style={styles.formField}>
            <Text style={styles.fieldLabel}>Art direction</Text>
            <TextInput
              accessibilityLabel="Cover concept"
              editable={!busy}
              multiline
              onChangeText={(value) => {
                clearSaveStatus();
                setConceptDraft(value);
              }}
              placeholder="Mood, palette, central image, lettering…"
              style={[styles.fieldInput, styles.fieldInputMultiline]}
              value={conceptDraft}
            />
          </View>

          <View style={styles.formField}>
            <Text style={styles.fieldLabel}>Notes</Text>
            <TextInput
              accessibilityLabel="Cover notes"
              editable={!busy}
              multiline
              onChangeText={(value) => {
                clearSaveStatus();
                setNotesDraft(value);
              }}
              placeholder="Series continuity, references, printer notes…"
              style={[styles.fieldInput, styles.fieldInputMultilineShort]}
              value={notesDraft}
            />
          </View>

          {coverActionError === undefined ? null : (
            <Text style={styles.coverActionError}>{coverActionError}</Text>
          )}

          {onStartCoverOptionsJob === undefined ? null : imageGenerationAvailable ? (
            <ImageModelPicker
              disabled={coverActionsDisabled}
              onChange={setImageModelId}
              options={imageModelOptions}
              value={imageModelId}
            />
          ) : (
            <ImageGenerationUnavailable onOpenSettings={onOpenSettings} />
          )}

          <View style={styles.deskActionsPrimary}>
            {onStartCoverOptionsJob === undefined ? null : (
              <PanelButton
                disabled={coverActionsDisabled}
                label={
                  coverJobStarting || jobInFlight
                    ? "Painting options…"
                    : "Generate options"
                }
                onPress={() => void startCoverOptionsJob()}
                primary
              />
            )}
            {onApplyCoverImage === undefined ? null : (
              <PanelButton
                disabled={
                  busy || coverApplying || coverPreviewDataUri === undefined
                }
                label={coverApplying ? "Binding…" : "Apply cover"}
                onPress={() => void applyCoverPreview()}
                primary
              />
            )}
            <PanelButton
              disabled={busy}
              label="Save"
              onPress={() => void saveFocusedBook()}
            />
          </View>

          <View style={styles.deskActionsSecondary}>
            <PanelButton
              disabled={busy}
              label="Open manuscript"
              onPress={() =>
                onOpenBook({ kind: "book", bookId: focusedBook.id })
              }
            />
            {onProposeCoverConcept === undefined ? null : (
              <PanelButton
                disabled={busy}
                label="Propose with Agent"
                onPress={() => onProposeCoverConcept(focusedBook.id)}
              />
            )}
            {focusedBook.cover === undefined ? null : (
              <PanelButton
                disabled={busy}
                label="Clear cover"
                onPress={() => void clearCover()}
              />
            )}
          </View>

          {saveStatus === "idle" || saveStatusMessage === undefined ? null : (
            <Text
              accessibilityLiveRegion="polite"
              style={[
                styles.saveStatus,
                saveStatus === "error" && styles.saveStatusError
              ]}
            >
              {saveStatusMessage}
            </Text>
          )}

          <Pressable
            accessibilityRole="button"
            onPress={() => setShowAdvancedUrl((current) => !current)}
            style={({ pressed }) => [
              styles.advancedToggle,
              pressed && styles.pressed
            ]}
          >
            <Text style={styles.advancedToggleText}>
              {showAdvancedUrl
                ? "Hide external cover URL"
                : "Paste an external cover URL"}
            </Text>
          </Pressable>
          {showAdvancedUrl ? (
            <TextInput
              accessibilityLabel="Cover image URL"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              onChangeText={(value) => {
                clearSaveStatus();
                setImageUrlDraft(value);
              }}
              placeholder="https://…"
              style={styles.fieldInput}
              value={imageUrlDraft}
            />
          ) : null}
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      accessibilityLabel="Series title page"
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      style={styles.root}
    >
      <TitleBreadcrumbs crumbs={[{ label: "Series" }, { label: "Title page" }]} />
      <TextInput
        accessibilityLabel="Project title"
        editable={!busy}
        onBlur={() => void commitProjectTitle()}
        onChangeText={setProjectTitleDraft}
        onSubmitEditing={() => void commitProjectTitle()}
        returnKeyType="done"
        style={styles.projectTitleInput}
        value={projectTitleDraft}
      />
      <Text style={styles.lede}>
        {activeBooks.length}{" "}
        {activeBooks.length === 1 ? "book" : "books"} on the shelf · open one
        to work the cover
      </Text>

      <View accessibilityLabel="Book cover shelf" style={styles.shelf}>
        {activeBooks.map((book) => (
          <ShelfTile
            book={book}
            disabled={busy}
            key={book.id}
            onPress={() => openBookStudio(book.id)}
            onResolveCoverDisplayUrl={onResolveCoverDisplayUrl}
          />
        ))}
      </View>

      {activeBooks.length === 0 ? (
        <Text style={styles.help}>
          Add a book to begin shaping covers on this title page.
        </Text>
      ) : null}

      <View style={styles.headerActions}>
        <PanelButton
          disabled={busy}
          label="New book"
          onPress={() =>
            void onCommand({ type: "book.create", title: "New book" })
          }
          primary
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    minHeight: 0,
    width: "100%"
  },
  scrollContent: {
    gap: 14,
    padding: 16
  },
  crumbs: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4
  },
  crumbItem: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    maxWidth: "100%"
  },
  crumbDivider: {
    color: colors.brandRule,
    fontFamily: fonts.ui,
    fontSize: 11
  },
  crumbText: {
    color: colors.muted,
    fontFamily: fonts.uiSemibold,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: "uppercase"
  },
  crumbTextCurrent: {
    color: colors.kicker
  },
  crumbLink: {
    color: colors.muted,
    fontFamily: fonts.uiSemibold,
    fontSize: 11,
    letterSpacing: 0.5,
    textDecorationLine: "underline",
    textTransform: "uppercase"
  },
  projectTitleInput: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 30,
    lineHeight: 36,
    paddingVertical: 2
  },
  lede: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 13,
    lineHeight: 18
  },
  shelf: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 18,
    paddingVertical: 8
  },
  shelfTile: {
    alignItems: "center",
    gap: 8,
    maxWidth: 160
  },
  shelfTileCaption: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 11,
    lineHeight: 14,
    textAlign: "center"
  },
  bookStage: {
    alignItems: "flex-start",
    justifyContent: "flex-end",
    position: "relative"
  },
  bookStageLarge: {
    alignSelf: "center"
  },
  bookShadow: {
    backgroundColor: "rgba(40, 35, 31, 0.18)",
    borderRadius: 999,
    bottom: 0,
    position: "absolute"
  },
  bookAssembly: {
    alignItems: "stretch",
    flexDirection: "row",
    ...( {
      transform: [
        { perspective: 900 },
        { rotateY: "-8deg" },
        { rotateZ: "-1deg" }
      ]
    } as object)
  },
  bookAssemblyLarge: {
    ...( {
      transform: [
        { perspective: 1100 },
        { rotateY: "-11deg" },
        { rotateZ: "-1.5deg" }
      ]
    } as object)
  },
  bookSpine: {
    borderBottomLeftRadius: 2,
    borderTopLeftRadius: 2,
    justifyContent: "center",
    overflow: "hidden"
  },
  bookSpineText: {
    color: colors.paper,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    letterSpacing: 0.8,
    opacity: 0.85,
    ...( { transform: [{ rotate: "-90deg" }] } as object)
  },
  bookFace: {
    backgroundColor: colors.wash,
    borderColor: "rgba(40, 35, 31, 0.2)",
    borderRightWidth: 1,
    borderWidth: 1,
    overflow: "hidden",
    position: "relative"
  },
  bookFaceSheen: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "transparent",
    borderLeftColor: "rgba(255,255,255,0.18)",
    borderLeftWidth: 10,
    opacity: 0.55
  },
  bookPages: {
    alignSelf: "center",
    backgroundColor: colors.paper,
    borderBottomRightRadius: 2,
    borderColor: colors.line,
    borderLeftWidth: 0,
    borderTopRightRadius: 2,
    borderWidth: 1
  },
  coverPlaceholderTop: {
    ...StyleSheet.absoluteFill,
    bottom: "42%"
  },
  coverPlaceholderBottom: {
    ...StyleSheet.absoluteFill,
    opacity: 0.55,
    top: "58%"
  },
  coverInitials: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 28,
    left: 0,
    opacity: 0.32,
    position: "absolute",
    right: 0,
    textAlign: "center",
    top: "30%"
  },
  coverInitialsLarge: {
    fontSize: 48
  },
  coverImage: {
    height: "100%",
    width: "100%"
  },
  coverTitleOverlay: {
    backgroundColor: "rgba(40, 35, 31, 0.72)",
    bottom: 0,
    gap: 2,
    left: 0,
    paddingHorizontal: 10,
    paddingVertical: 10,
    position: "absolute",
    right: 0
  },
  coverTitle: {
    color: colors.paper,
    fontFamily: fonts.story,
    fontSize: 12,
    lineHeight: 15
  },
  coverTitleLarge: {
    fontSize: 16,
    lineHeight: 20
  },
  coverStatus: {
    color: colors.brandRuleSoft,
    fontFamily: fonts.ui,
    fontSize: 10,
    letterSpacing: 0.3,
    textTransform: "uppercase"
  },
  headerActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  studioScrollContent: {
    gap: 20,
    paddingBottom: 40,
    paddingHorizontal: 20,
    paddingTop: 12
  },
  studioTopBar: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 16,
    justifyContent: "space-between",
    zIndex: 4
  },
  studioCrumbs: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    paddingTop: 4
  },
  statusDropdown: {
    position: "relative",
    zIndex: 5
  },
  statusDropdownTrigger: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  statusDropdownTriggerText: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 12
  },
  statusDropdownCaret: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 10
  },
  statusDropdownMenu: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    marginTop: 4,
    minWidth: "100%",
    overflow: "hidden",
    position: "absolute",
    right: 0,
    top: "100%"
  },
  statusDropdownItem: {
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  statusDropdownItemSelected: {
    backgroundColor: colors.accentSoft
  },
  statusDropdownItemText: {
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 12
  },
  statusDropdownItemTextSelected: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold
  },
  studioCenter: {
    alignItems: "center",
    alignSelf: "center",
    gap: 12,
    maxWidth: 520,
    width: "100%"
  },
  studioForm: {
    alignSelf: "center",
    gap: 12,
    maxWidth: 460,
    paddingTop: 4,
    width: "100%"
  },
  formField: {
    gap: 6
  },
  previewHint: {
    color: colors.amber,
    fontFamily: fonts.ui,
    fontSize: 12,
    textAlign: "center"
  },
  coverJobStatus: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 16,
    textAlign: "center"
  },
  optionsStrip: {
    maxWidth: "100%"
  },
  optionsStripContent: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    paddingVertical: 2
  },
  optionThumb: {
    borderColor: colors.line,
    borderRadius: 4,
    borderWidth: 1,
    height: 78,
    overflow: "hidden",
    width: 52
  },
  optionThumbSelected: {
    borderColor: colors.accent,
    borderWidth: 2
  },
  optionThumbImage: {
    height: "100%",
    width: "100%"
  },
  iterateRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
    maxWidth: 400,
    width: "100%"
  },
  iterateInput: {
    flexGrow: 1,
    minWidth: 180
  },
  bookTitleInput: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 28,
    lineHeight: 34,
    paddingVertical: 4,
    textAlign: "center"
  },
  fieldLabel: {
    color: colors.muted,
    fontFamily: fonts.uiSemibold,
    fontSize: 11,
    letterSpacing: 0.3
  },
  fieldInput: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 13,
    minHeight: 36,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  fieldInputMultiline: {
    minHeight: 88,
    textAlignVertical: "top"
  },
  fieldInputMultilineShort: {
    minHeight: 64,
    textAlignVertical: "top"
  },
  deskActionsPrimary: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
    marginTop: 4
  },
  deskActionsSecondary: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center"
  },
  advancedToggle: {
    alignSelf: "center",
    marginTop: 2,
    paddingVertical: 4
  },
  advancedToggleText: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12,
    textDecorationLine: "underline"
  },
  coverActionError: {
    color: colors.red,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 16,
    textAlign: "center"
  },
  saveStatus: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 16,
    textAlign: "center"
  },
  saveStatusError: {
    color: colors.red
  },
  help: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 13,
    lineHeight: 18
  },
  button: {
    backgroundColor: colors.wash,
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  buttonPrimary: {
    backgroundColor: colors.accent,
    borderColor: colors.accent
  },
  buttonText: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 12
  },
  buttonTextPrimary: {
    color: colors.paper
  },
  pressed: {
    opacity: 0.86
  },
  disabled: {
    opacity: 0.45
  }
});
