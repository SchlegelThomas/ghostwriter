import { useEffect, useRef, useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions
} from "react-native";
import { Circle, Line, Svg, Text as SvgText } from "react-native-svg";
import type {
  CharacterVisual,
  ProjectCommand,
  ProjectNavigator,
  ProjectNavigatorKnowledge,
  SceneId,
  StoryKnowledgeId,
  StoryKnowledgeLinkKind
} from "@ghostwriter/core";
import {
  buildKnowledgeConstellation,
  characterVisualEmptyStateCopy,
  composeCharacterRoleSummary,
  groupConstellationPeersByKind,
  parseAliasList,
  projectCastRoster,
  scenePresenceRows,
  visualsAfterDelete,
  type KnowledgeConstellationPeer
} from "./cast-studio-model.js";
import { ghostwriterTheme } from "./theme.js";

const { colors, fonts } = ghostwriterTheme;

const LINK_KINDS: readonly StoryKnowledgeLinkKind[] = [
  "cast",
  "theme",
  "development-cycle",
  "breadcrumb",
  "related"
];

export type CharacterVisualOptionsJobSnapshot = Readonly<{
  knowledgeId: StoryKnowledgeId;
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

export type CastRelationshipsStudioProps = Readonly<{
  project: ProjectNavigator;
  selectedKnowledgeId?: StoryKnowledgeId;
  busy?: boolean;
  /** Force narrow list constellation; otherwise inferred from width. */
  layout?: "wide" | "narrow";
  onCommand(command: ProjectCommand): Promise<boolean>;
  onSelectKnowledge(storyKnowledgeId: StoryKnowledgeId | undefined): void;
  onOpenRecord?(storyKnowledgeId: StoryKnowledgeId): void;
  onOpenScene?(sceneId: SceneId): void;
  characterVisualJob?: CharacterVisualOptionsJobSnapshot;
  onStartCharacterVisualJob?(input: Readonly<{
    knowledgeId: StoryKnowledgeId;
    count?: number;
    refinement?: string;
  }>): Promise<void>;
  onApplyCharacterVisual?(input: Readonly<{
    knowledgeId: StoryKnowledgeId;
    previewDataUri: string;
    alt: string;
    source: "generated" | "upload";
  }>): Promise<void>;
  onResolveCharacterVisualDisplayUrl?(input: Readonly<{
    knowledgeId: StoryKnowledgeId;
    visualId: string;
    imageUrl: string;
  }>): Promise<string | undefined>;
}>;

export function CastRelationshipsStudio({
  project,
  selectedKnowledgeId,
  busy = false,
  layout: layoutProp,
  onCommand,
  onSelectKnowledge,
  onOpenRecord,
  onOpenScene,
  characterVisualJob,
  onStartCharacterVisualJob,
  onApplyCharacterVisual,
  onResolveCharacterVisualDisplayUrl
}: CastRelationshipsStudioProps) {
  const { width } = useWindowDimensions();
  const narrow = layoutProp === "narrow" || (layoutProp === undefined && width < 760);
  const roster = projectCastRoster(project, { includeArchived: true });
  const activeRoster = roster.filter((row) => !row.archived);
  const archivedRoster = roster.filter((row) => row.archived);
  const selected =
    selectedKnowledgeId === undefined
      ? undefined
      : project.storyKnowledge.find(
          (record) =>
            record.id === selectedKnowledgeId && record.kind === "character"
        );

  return (
    <View accessibilityLabel="Cast studio" style={styles.root}>
      <View style={[styles.body, narrow && styles.bodyNarrow]}>
        <View
          accessibilityLabel="Character roster"
          style={[styles.rosterPane, narrow && styles.rosterPaneNarrow]}
        >
          <View style={styles.rosterHeader}>
            <View style={styles.rosterHeaderCopy}>
              <Text style={styles.eyebrow}>Cast</Text>
              <Text style={styles.rosterTitle}>Characters</Text>
              <Text style={styles.help}>
                Story knowledge cast — not Canvas Thread Trace.
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Create character"
              accessibilityRole="button"
              disabled={busy}
              onPress={() =>
                void onCommand({
                  type: "storyKnowledge.create",
                  label: "New character",
                  kind: "character",
                  authority: "planned"
                })
              }
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.pressed,
                busy && styles.disabled
              ]}
            >
              <Text style={styles.primaryButtonText}>New</Text>
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={styles.rosterScroll}
          >
            {activeRoster.length === 0 ? (
              <Text style={styles.help}>
                No characters yet. Create one to open a dossier.
              </Text>
            ) : (
              activeRoster.map((row) => {
                const selectedRow = row.id === selectedKnowledgeId;
                return (
                  <Pressable
                    accessibilityLabel={`Open ${row.label}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: selectedRow }}
                    disabled={busy}
                    key={row.id}
                    onPress={() => onSelectKnowledge(row.id)}
                    style={({ pressed }) => [
                      styles.rosterRow,
                      selectedRow && styles.rosterRowSelected,
                      pressed && styles.pressed
                    ]}
                  >
                    <Text numberOfLines={1} style={styles.rosterLabel}>
                      {row.label}
                    </Text>
                    <Text style={styles.rosterMeta}>
                      {row.sceneCount} scenes · {row.linkCount} links
                    </Text>
                    <Text style={styles.authorityChip}>{row.authority}</Text>
                  </Pressable>
                );
              })
            )}
            {archivedRoster.length === 0 ? null : (
              <View style={styles.archivedBlock}>
                <Text style={styles.sectionTitle}>Archived</Text>
                {archivedRoster.map((row) => (
                  <Pressable
                    accessibilityLabel={`Open archived ${row.label}`}
                    accessibilityRole="button"
                    disabled={busy}
                    key={row.id}
                    onPress={() => onSelectKnowledge(row.id)}
                    style={({ pressed }) => [
                      styles.rosterRow,
                      styles.rosterRowArchived,
                      row.id === selectedKnowledgeId && styles.rosterRowSelected,
                      pressed && styles.pressed
                    ]}
                  >
                    <Text numberOfLines={1} style={styles.rosterLabel}>
                      {row.label}
                    </Text>
                    <Text style={styles.rosterMeta}>Archived · restore from dossier</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </ScrollView>
        </View>

        <View
          accessibilityLabel="Character dossier"
          style={[styles.dossierPane, narrow && styles.dossierPaneNarrow]}
        >
          {selected === undefined ? (
            <View style={styles.emptyDetail}>
              <Text style={styles.eyebrow}>Dossier</Text>
              <Text style={styles.emptyTitle}>Pick a character</Text>
              <Text style={styles.help}>
                Select someone from the roster to edit notes, sheet, knowledge
                links, and scene presence.
              </Text>
            </View>
          ) : (
            <CharacterDossier
              busy={busy}
              characterVisualJob={characterVisualJob}
              knowledge={selected}
              narrow={narrow}
              onApplyCharacterVisual={onApplyCharacterVisual}
              onCommand={onCommand}
              onResolveCharacterVisualDisplayUrl={
                onResolveCharacterVisualDisplayUrl
              }
              onStartCharacterVisualJob={onStartCharacterVisualJob}
              onOpenRecord={(id) => {
                onOpenRecord?.(id);
                onSelectKnowledge(id);
              }}
              onOpenScene={onOpenScene}
              project={project}
            />
          )}
        </View>
      </View>
    </View>
  );
}

function readFileAsPngDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string" || !result.startsWith("data:image/png")) {
        reject(new Error("Choose a PNG image."));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.readAsDataURL(file);
  });
}

function CharacterVisualThumb({
  visual,
  busy,
  resolveDisplayUrl,
  onOpen,
  onDelete
}: Readonly<{
  visual: CharacterVisual;
  busy: boolean;
  resolveDisplayUrl?(input: Readonly<{
    visualId: string;
    imageUrl: string;
  }>): Promise<string | undefined>;
  onOpen(uri: string): void;
  onDelete(): void;
}>) {
  const [uri, setUri] = useState(visual.url);
  // Parent often passes an inline resolver; keep it out of effect deps so we
  // resolve once per visual id/url instead of re-downloading every render.
  const resolveDisplayUrlRef = useRef(resolveDisplayUrl);
  resolveDisplayUrlRef.current = resolveDisplayUrl;

  useEffect(() => {
    let cancelled = false;
    const resolve = resolveDisplayUrlRef.current;
    if (resolve === undefined) {
      setUri(visual.url);
      return;
    }
    void resolve({
      visualId: visual.id,
      imageUrl: visual.url
    })
      .then((resolved) => {
        if (cancelled || resolved === undefined) return;
        setUri((current) => (current === resolved ? current : resolved));
      })
      .catch(() => {
        // Keep the locator URL; do not retry on parent re-render.
      });
    return () => {
      cancelled = true;
    };
  }, [visual.id, visual.url]);

  return (
    <View style={styles.visualThumbWrap}>
      <Pressable
        accessibilityLabel={`Enlarge ${visual.alt}`}
        accessibilityRole="button"
        disabled={busy}
        onPress={() => onOpen(uri)}
        style={({ pressed }) => [
          styles.visualThumb,
          pressed && styles.pressed
        ]}
      >
        <Image
          accessibilityLabel={visual.alt}
          resizeMode="cover"
          source={{ uri }}
          style={styles.visualThumbImage}
        />
      </Pressable>
      <Pressable
        accessibilityLabel={`Delete ${visual.alt}`}
        accessibilityRole="button"
        disabled={busy}
        onPress={onDelete}
        style={({ pressed }) => [
          styles.visualDelete,
          pressed && styles.pressed,
          busy && styles.disabled
        ]}
      >
        <Text style={styles.visualDeleteText}>Delete</Text>
      </Pressable>
    </View>
  );
}

function CharacterVisualGallery({
  knowledge,
  busy,
  characterVisualJob,
  onCommand,
  onStartCharacterVisualJob,
  onApplyCharacterVisual,
  onResolveCharacterVisualDisplayUrl
}: Readonly<{
  knowledge: ProjectNavigatorKnowledge;
  busy: boolean;
  characterVisualJob?: CharacterVisualOptionsJobSnapshot;
  onCommand(command: ProjectCommand): Promise<boolean>;
  onStartCharacterVisualJob?(input: Readonly<{
    knowledgeId: StoryKnowledgeId;
    count?: number;
    refinement?: string;
  }>): Promise<void>;
  onApplyCharacterVisual?(input: Readonly<{
    knowledgeId: StoryKnowledgeId;
    previewDataUri: string;
    alt: string;
    source: "generated" | "upload";
  }>): Promise<void>;
  onResolveCharacterVisualDisplayUrl?(input: Readonly<{
    knowledgeId: StoryKnowledgeId;
    visualId: string;
    imageUrl: string;
  }>): Promise<string | undefined>;
}>) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [actionError, setActionError] = useState<string | undefined>();
  const [applying, setApplying] = useState(false);
  const [starting, setStarting] = useState(false);
  const [selectedOptionId, setSelectedOptionId] = useState<string | undefined>();
  const [previewDataUri, setPreviewDataUri] = useState<string | undefined>();
  const [enlargedUri, setEnlargedUri] = useState<string | undefined>();

  const jobForCharacter =
    characterVisualJob !== undefined &&
    characterVisualJob.knowledgeId === knowledge.id
      ? characterVisualJob
      : undefined;
  const jobInFlight =
    jobForCharacter !== undefined &&
    (jobForCharacter.status === "queued" || jobForCharacter.status === "running");
  const galleryBusy = busy || applying || starting || jobInFlight;
  const emptyCopy = characterVisualEmptyStateCopy(knowledge.visuals);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png";
    input.multiple = false;
    input.setAttribute("aria-hidden", "true");
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.width = "1px";
    input.style.height = "1px";
    document.body.appendChild(input);
    fileInputRef.current = input;
    return () => {
      fileInputRef.current = null;
      input.remove();
    };
  }, []);

  useEffect(() => {
    if (
      jobForCharacter === undefined ||
      jobForCharacter.status !== "ready" ||
      jobForCharacter.options === undefined ||
      jobForCharacter.options.length === 0
    ) {
      return;
    }
    const first = jobForCharacter.options[0]!;
    setSelectedOptionId(first.id);
    setPreviewDataUri(first.previewUrl);
    setActionError(undefined);
  }, [jobForCharacter?.jobId, jobForCharacter?.status]);

  async function startGenerate(): Promise<void> {
    if (onStartCharacterVisualJob === undefined || galleryBusy) return;
    setStarting(true);
    setActionError(undefined);
    try {
      await onStartCharacterVisualJob({
        knowledgeId: knowledge.id,
        count: 3
      });
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Could not start generation."
      );
    } finally {
      setStarting(false);
    }
  }

  async function applyPreview(source: "generated" | "upload"): Promise<void> {
    if (
      onApplyCharacterVisual === undefined ||
      previewDataUri === undefined ||
      galleryBusy
    ) {
      return;
    }
    setApplying(true);
    setActionError(undefined);
    try {
      await onApplyCharacterVisual({
        knowledgeId: knowledge.id,
        previewDataUri,
        alt: `${knowledge.label} portrait`,
        source
      });
      setPreviewDataUri(undefined);
      setSelectedOptionId(undefined);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Could not save portrait."
      );
    } finally {
      setApplying(false);
    }
  }

  function pickUpload(): void {
    const input = fileInputRef.current;
    if (input === null || galleryBusy || onApplyCharacterVisual === undefined) {
      return;
    }
    input.value = "";
    input.onchange = () => {
      const file = input.files?.[0];
      input.value = "";
      if (file === undefined) return;
      void (async () => {
        setApplying(true);
        setActionError(undefined);
        try {
          const dataUri = await readFileAsPngDataUri(file);
          await onApplyCharacterVisual({
            knowledgeId: knowledge.id,
            previewDataUri: dataUri,
            alt: `${knowledge.label} portrait`,
            source: "upload"
          });
        } catch (error) {
          setActionError(
            error instanceof Error ? error.message : "Upload failed."
          );
        } finally {
          setApplying(false);
        }
      })();
    };
    input.click();
  }

  function deleteVisual(visualId: string): void {
    const next = visualsAfterDelete(knowledge.visuals, visualId);
    void onCommand({
      type: "storyKnowledge.update",
      storyKnowledgeId: knowledge.id,
      visuals: next
    });
  }

  return (
    <View accessibilityLabel="Character visuals" style={styles.visualGallery}>
      <View style={styles.visualGalleryHeader}>
        <Text style={styles.sectionTitle}>Visuals</Text>
        <View style={styles.visualActions}>
          {onStartCharacterVisualJob === undefined ? null : (
            <Pressable
              accessibilityLabel="Generate character visuals"
              accessibilityRole="button"
              disabled={galleryBusy}
              onPress={() => void startGenerate()}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.pressed,
                galleryBusy && styles.disabled
              ]}
            >
              <Text style={styles.primaryButtonText}>
                {jobInFlight ? "Generating…" : "Generate"}
              </Text>
            </Pressable>
          )}
          {onApplyCharacterVisual === undefined ? null : (
            <Pressable
              accessibilityLabel="Upload character visual PNG"
              accessibilityRole="button"
              disabled={galleryBusy}
              onPress={pickUpload}
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.pressed,
                galleryBusy && styles.disabled
              ]}
            >
              <Text style={styles.secondaryButtonText}>Upload</Text>
            </Pressable>
          )}
        </View>
      </View>

      {emptyCopy === undefined ? null : (
        <Text style={styles.help}>{emptyCopy}</Text>
      )}

      {(knowledge.visuals?.length ?? 0) === 0 ? null : (
        <ScrollView
          horizontal
          style={styles.visualStrip}
          contentContainerStyle={styles.visualStripContent}
        >
          {knowledge.visuals!.map((visual) => (
            <CharacterVisualThumb
              busy={galleryBusy}
              key={visual.id}
              onDelete={() => deleteVisual(visual.id)}
              onOpen={setEnlargedUri}
              resolveDisplayUrl={
                onResolveCharacterVisualDisplayUrl === undefined
                  ? undefined
                  : (input) =>
                      onResolveCharacterVisualDisplayUrl({
                        knowledgeId: knowledge.id,
                        visualId: input.visualId,
                        imageUrl: input.imageUrl
                      })
              }
              visual={visual}
            />
          ))}
        </ScrollView>
      )}

      {jobForCharacter?.status === "failed" ? (
        <Text style={styles.visualError}>
          {jobForCharacter.error?.message ?? "Generation failed."}
        </Text>
      ) : null}

      {jobForCharacter?.status === "ready" &&
      jobForCharacter.options !== undefined &&
      jobForCharacter.options.length > 0 ? (
        <View style={styles.visualOptionsBlock}>
          <Text style={styles.help}>Pick an option, then apply.</Text>
          <ScrollView
            horizontal
            contentContainerStyle={styles.visualStripContent}
            style={styles.visualStrip}
          >
            {jobForCharacter.options.map((option) => {
              const selected = option.id === selectedOptionId;
              return (
                <Pressable
                  accessibilityLabel={`Visual option ${option.variationIndex + 1}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={option.id}
                  onPress={() => {
                    setSelectedOptionId(option.id);
                    setPreviewDataUri(option.previewUrl);
                  }}
                  style={({ pressed }) => [
                    styles.visualThumb,
                    selected && styles.visualThumbSelected,
                    pressed && styles.pressed
                  ]}
                >
                  <Image
                    accessibilityLabel={`Option ${option.variationIndex + 1}`}
                    resizeMode="cover"
                    source={{ uri: option.previewUrl }}
                    style={styles.visualThumbImage}
                  />
                </Pressable>
              );
            })}
          </ScrollView>
          {onApplyCharacterVisual === undefined ? null : (
            <Pressable
              accessibilityLabel="Apply selected character visual"
              accessibilityRole="button"
              disabled={galleryBusy || previewDataUri === undefined}
              onPress={() => void applyPreview("generated")}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.pressed,
                (galleryBusy || previewDataUri === undefined) && styles.disabled
              ]}
            >
              <Text style={styles.primaryButtonText}>
                {applying ? "Applying…" : "Apply"}
              </Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {actionError === undefined ? null : (
        <Text style={styles.visualError}>{actionError}</Text>
      )}

      <Modal
        animationType="fade"
        transparent
        visible={enlargedUri !== undefined}
        onRequestClose={() => setEnlargedUri(undefined)}
      >
        <Pressable
          accessibilityLabel="Close enlarged visual"
          onPress={() => setEnlargedUri(undefined)}
          style={styles.visualModalBackdrop}
        >
          {enlargedUri === undefined ? null : (
            <Image
              accessibilityLabel="Enlarged character visual"
              resizeMode="contain"
              source={{ uri: enlargedUri }}
              style={styles.visualModalImage}
            />
          )}
        </Pressable>
      </Modal>
    </View>
  );
}

function CharacterDossier({
  project,
  knowledge,
  busy,
  narrow,
  onCommand,
  onOpenRecord,
  onOpenScene,
  characterVisualJob,
  onStartCharacterVisualJob,
  onApplyCharacterVisual,
  onResolveCharacterVisualDisplayUrl
}: Readonly<{
  project: ProjectNavigator;
  knowledge: ProjectNavigatorKnowledge;
  busy: boolean;
  narrow: boolean;
  onCommand(command: ProjectCommand): Promise<boolean>;
  onOpenRecord(storyKnowledgeId: StoryKnowledgeId): void;
  onOpenScene?(sceneId: SceneId): void;
  characterVisualJob?: CharacterVisualOptionsJobSnapshot;
  onStartCharacterVisualJob?(input: Readonly<{
    knowledgeId: StoryKnowledgeId;
    count?: number;
    refinement?: string;
  }>): Promise<void>;
  onApplyCharacterVisual?(input: Readonly<{
    knowledgeId: StoryKnowledgeId;
    previewDataUri: string;
    alt: string;
    source: "generated" | "upload";
  }>): Promise<void>;
  onResolveCharacterVisualDisplayUrl?(input: Readonly<{
    knowledgeId: StoryKnowledgeId;
    visualId: string;
    imageUrl: string;
  }>): Promise<string | undefined>;
}>) {
  const [linkKind, setLinkKind] = useState<StoryKnowledgeLinkKind>("related");
  const [notesDraft, setNotesDraft] = useState(knowledge.notes ?? "");
  const [aliasesDraft, setAliasesDraft] = useState(
    (knowledge.aliases ?? []).join(", ")
  );
  const [desireDraft, setDesireDraft] = useState(
    knowledge.characterSheet?.desire ?? ""
  );
  const [pressureDraft, setPressureDraft] = useState(
    knowledge.characterSheet?.pressure ?? ""
  );
  const [voiceDraft, setVoiceDraft] = useState(
    knowledge.characterSheet?.voiceNotes ?? ""
  );

  useEffect(() => {
    setNotesDraft(knowledge.notes ?? "");
    setAliasesDraft((knowledge.aliases ?? []).join(", "));
    setDesireDraft(knowledge.characterSheet?.desire ?? "");
    setPressureDraft(knowledge.characterSheet?.pressure ?? "");
    setVoiceDraft(knowledge.characterSheet?.voiceNotes ?? "");
  }, [knowledge]);

  const roleSummary = composeCharacterRoleSummary({
    notes: knowledge.notes,
    characterSheet: knowledge.characterSheet
  });
  const constellation = buildKnowledgeConstellation(
    knowledge,
    project.storyKnowledge
  );
  const scenes = scenePresenceRows(knowledge, project);
  const peers = project.storyKnowledge.filter(
    (candidate) =>
      candidate.id !== knowledge.id && candidate.archivedAt === undefined
  );
  const archived = knowledge.archivedAt !== undefined;

  function commitSheet(
    key: "desire" | "pressure" | "voiceNotes",
    value: string
  ): void {
    const next = value.trim();
    const current = knowledge.characterSheet?.[key] ?? "";
    if (next === current) return;
    const desire = key === "desire" ? next : desireDraft.trim();
    const pressure = key === "pressure" ? next : pressureDraft.trim();
    const voiceNotes = key === "voiceNotes" ? next : voiceDraft.trim();
    const empty = desire === "" && pressure === "" && voiceNotes === "";
    void onCommand({
      type: "storyKnowledge.update",
      storyKnowledgeId: knowledge.id,
      characterSheet: empty
        ? null
        : {
            ...(desire === "" ? {} : { desire }),
            ...(pressure === "" ? {} : { pressure }),
            ...(voiceNotes === "" ? {} : { voiceNotes })
          }
    });
  }

  return (
    <ScrollView
      accessibilityLabel={`Dossier for ${knowledge.label}`}
      contentContainerStyle={styles.dossierContent}
      keyboardShouldPersistTaps="handled"
      style={styles.dossierScroll}
    >
      <View style={styles.dossierHeader}>
        <View style={styles.dossierHeaderCopy}>
          <Text style={styles.eyebrow}>
            Character · {knowledge.authority}
            {archived ? " · archived" : ""}
          </Text>
          <Text style={styles.dossierTitle}>{knowledge.label}</Text>
        </View>
        <Pressable
          accessibilityLabel={archived ? "Restore character" : "Archive character"}
          accessibilityRole="button"
          disabled={busy}
          onPress={() =>
            void onCommand({
              type: "storyKnowledge.setArchived",
              storyKnowledgeId: knowledge.id,
              archived: !archived
            })
          }
          style={({ pressed }) => [
            styles.secondaryButton,
            pressed && styles.pressed,
            busy && styles.disabled
          ]}
        >
          <Text style={styles.secondaryButtonText}>
            {archived ? "Restore" : "Archive"}
          </Text>
        </Pressable>
      </View>

      <CharacterVisualGallery
        busy={busy || archived}
        characterVisualJob={characterVisualJob}
        knowledge={knowledge}
        onApplyCharacterVisual={onApplyCharacterVisual}
        onCommand={onCommand}
        onResolveCharacterVisualDisplayUrl={onResolveCharacterVisualDisplayUrl}
        onStartCharacterVisualJob={onStartCharacterVisualJob}
      />

      <Text style={styles.sectionTitle}>Role in the story</Text>
      {roleSummary.length === 0 ? (
        <Text style={styles.help}>
          Add notes and sheet fields below — Role is composed from what you
          write (no AI generation).
        </Text>
      ) : (
        <Text style={styles.roleSummary}>{roleSummary}</Text>
      )}

      <Text style={styles.fieldLabel}>Aliases</Text>
      <TextInput
        accessibilityLabel="Character aliases"
        editable={!busy}
        onBlur={() => {
          const next = parseAliasList(aliasesDraft);
          const current = knowledge.aliases ?? [];
          if (
            next.length === current.length &&
            next.every((alias, index) => alias === current[index])
          ) {
            return;
          }
          void onCommand({
            type: "storyKnowledge.update",
            storyKnowledgeId: knowledge.id,
            aliases: next.length === 0 ? null : next
          });
        }}
        onChangeText={setAliasesDraft}
        placeholder="Comma-separated"
        style={styles.input}
        value={aliasesDraft}
      />

      <Text style={styles.fieldLabel}>Notes</Text>
      <TextInput
        accessibilityLabel="Character notes"
        editable={!busy}
        multiline
        onBlur={() => {
          const next = notesDraft.trim();
          const current = knowledge.notes ?? "";
          if (next === current) return;
          void onCommand({
            type: "storyKnowledge.update",
            storyKnowledgeId: knowledge.id,
            notes: next === "" ? null : next
          });
        }}
        onChangeText={setNotesDraft}
        placeholder="Who they are in the story"
        style={styles.inputTall}
        value={notesDraft}
      />

      <Text style={styles.sectionTitle}>Character sheet</Text>
      {(
        [
          ["Desire", desireDraft, setDesireDraft, "desire"],
          ["Pressure", pressureDraft, setPressureDraft, "pressure"],
          ["Voice", voiceDraft, setVoiceDraft, "voiceNotes"]
        ] as const
      ).map(([label, value, setValue, key]) => (
        <View key={key} style={styles.field}>
          <Text style={styles.fieldLabel}>{label}</Text>
          <TextInput
            accessibilityLabel={label}
            editable={!busy}
            multiline
            onBlur={() => commitSheet(key, value)}
            onChangeText={setValue}
            style={styles.input}
            value={value}
          />
        </View>
      ))}

      <Text style={styles.sectionTitle}>Constellation</Text>
      <Text style={styles.help}>
        Knowledge links between story records. This is not Canvas Thread Trace.
      </Text>
      {constellation.peers.length === 0 ? (
        <Text style={styles.help}>
          No knowledge links yet. Link another record below.
        </Text>
      ) : narrow ? (
        <ConstellationList
          onOpenPeer={onOpenRecord}
          peers={constellation.peers}
        />
      ) : (
        <ConstellationMap
          egoLabel={constellation.ego.label}
          onOpenPeer={onOpenRecord}
          peers={constellation.peers}
        />
      )}

      <View style={styles.kindRow}>
        {LINK_KINDS.map((kind) => (
          <Pressable
            accessibilityLabel={`Link kind ${kind}`}
            accessibilityRole="button"
            accessibilityState={{ selected: linkKind === kind }}
            disabled={busy}
            key={kind}
            onPress={() => setLinkKind(kind)}
            style={({ pressed }) => [
              styles.kindChip,
              linkKind === kind && styles.kindChipSelected,
              pressed && styles.pressed
            ]}
          >
            <Text
              style={[
                styles.kindChipText,
                linkKind === kind && styles.kindChipTextSelected
              ]}
            >
              {kind}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.linkList}>
        {peers.map((candidate) => {
          const linked = knowledge.linkedKnowledge.some(
            (link) => link.toId === candidate.id && link.kind === linkKind
          );
          return (
            <View key={candidate.id} style={styles.linkRow}>
              <Pressable
                accessibilityLabel={`Open ${candidate.label}`}
                disabled={busy}
                onPress={() => onOpenRecord(candidate.id)}
                style={styles.linkLabelPress}
              >
                <Text style={styles.linkLabel}>
                  {candidate.label}
                  <Text style={styles.linkMeta}> · {candidate.kind}</Text>
                </Text>
              </Pressable>
              <Pressable
                accessibilityLabel={
                  linked
                    ? `Unlink ${candidate.label}`
                    : `Link ${candidate.label}`
                }
                accessibilityRole="button"
                disabled={busy}
                onPress={() =>
                  void onCommand({
                    type: "storyKnowledge.setKnowledgeLink",
                    fromId: knowledge.id,
                    toId: candidate.id,
                    kind: linkKind,
                    linked: !linked
                  })
                }
                style={({ pressed }) => [
                  styles.linkButton,
                  linked && styles.linkButtonOn,
                  pressed && styles.pressed
                ]}
              >
                <Text
                  style={[
                    styles.linkButtonText,
                    linked && styles.linkButtonTextOn
                  ]}
                >
                  {linked ? "Unlink" : "Link"}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>

      <Text style={styles.sectionTitle}>Scene presence</Text>
      {scenes.length === 0 ? (
        <Text style={styles.help}>
          No linked scenes yet. Link scenes from Context or the tree.
        </Text>
      ) : (
        scenes.map((scene) => (
          <Pressable
            accessibilityLabel={`Open draft for ${scene.title}`}
            accessibilityRole="button"
            disabled={busy || onOpenScene === undefined}
            key={scene.sceneId}
            onPress={() => onOpenScene?.(scene.sceneId)}
            style={({ pressed }) => [
              styles.sceneRow,
              pressed && styles.pressed
            ]}
          >
            <Text style={styles.linkLabel}>
              {scene.title}
              {scene.isPov ? " · POV" : ""}
            </Text>
            <Text style={styles.linkMeta}>
              {scene.status} · Open Draft
            </Text>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

function ConstellationList({
  peers,
  onOpenPeer
}: Readonly<{
  peers: readonly KnowledgeConstellationPeer[];
  onOpenPeer(id: StoryKnowledgeId): void;
}>) {
  const groups = groupConstellationPeersByKind(peers);
  return (
    <View style={styles.constellationList}>
      {groups.map((group) => (
        <View key={group.kind} style={styles.constellationGroup}>
          <Text style={styles.fieldLabel}>{group.kind}</Text>
          {group.peers.map((peer) => (
            <Pressable
              accessibilityLabel={`Open ${peer.label}`}
              accessibilityRole="button"
              key={`${peer.linkKind}:${peer.id}`}
              onPress={() => onOpenPeer(peer.id)}
              style={({ pressed }) => [
                styles.sceneRow,
                pressed && styles.pressed
              ]}
            >
              <Text style={styles.linkLabel}>{peer.label}</Text>
              <Text style={styles.linkMeta}>{peer.kind}</Text>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

function ConstellationMap({
  egoLabel,
  peers,
  onOpenPeer
}: Readonly<{
  egoLabel: string;
  peers: readonly KnowledgeConstellationPeer[];
  onOpenPeer(id: StoryKnowledgeId): void;
}>) {
  const size = 280;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 96;
  const count = Math.max(peers.length, 1);

  return (
    <View
      accessibilityLabel="Knowledge constellation"
      style={styles.constellationMap}
    >
      <Svg height={size} width={size}>
        {peers.map((peer, index) => {
          const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
          const x = cx + radius * Math.cos(angle);
          const y = cy + radius * Math.sin(angle);
          return (
            <Line
              key={`edge:${peer.linkKind}:${peer.id}`}
              stroke={colors.brandRule}
              strokeWidth={1}
              x1={cx}
              x2={x}
              y1={cy}
              y2={y}
            />
          );
        })}
        <Circle cx={cx} cy={cy} fill={colors.accentSoft} r={28} stroke={colors.accent} />
        <SvgText
          fill={colors.ink}
          fontFamily={fonts.uiSemibold}
          fontSize="10"
          textAnchor="middle"
          x={cx}
          y={cy + 3}
        >
          {egoLabel.length > 12 ? `${egoLabel.slice(0, 11)}…` : egoLabel}
        </SvgText>
        {peers.map((peer, index) => {
          const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
          const x = cx + radius * Math.cos(angle);
          const y = cy + radius * Math.sin(angle);
          return (
            <Circle
              cx={x}
              cy={y}
              fill={colors.panel}
              key={`node:${peer.linkKind}:${peer.id}`}
              onPress={() => onOpenPeer(peer.id)}
              r={22}
              stroke={colors.line}
            />
          );
        })}
        {peers.map((peer, index) => {
          const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
          const x = cx + radius * Math.cos(angle);
          const y = cy + radius * Math.sin(angle);
          return (
            <SvgText
              fill={colors.muted}
              fontFamily={fonts.ui}
              fontSize="8"
              key={`label:${peer.linkKind}:${peer.id}`}
              onPress={() => onOpenPeer(peer.id)}
              textAnchor="middle"
              x={x}
              y={y + 3}
            >
              {peer.label.length > 10 ? `${peer.label.slice(0, 9)}…` : peer.label}
            </SvgText>
          );
        })}
      </Svg>
      <View style={styles.peerKindLegend}>
        {peers.map((peer) => (
          <Pressable
            accessibilityLabel={`Open ${peer.label}, ${peer.linkKind}`}
            accessibilityRole="button"
            key={`legend:${peer.linkKind}:${peer.id}`}
            onPress={() => onOpenPeer(peer.id)}
            style={({ pressed }) => [styles.legendChip, pressed && styles.pressed]}
          >
            <Text style={styles.legendChipText}>
              {peer.linkKind} → {peer.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.canvas,
    flex: 1,
    minHeight: 0,
    minWidth: 0
  },
  body: {
    flex: 1,
    flexDirection: "row",
    minHeight: 0,
    minWidth: 0
  },
  bodyNarrow: {
    flexDirection: "column"
  },
  rosterPane: {
    borderColor: colors.line,
    borderRightWidth: 1,
    flexBasis: 260,
    flexGrow: 0,
    flexShrink: 0,
    gap: 8,
    maxWidth: 300,
    minWidth: 220,
    padding: 12
  },
  rosterPaneNarrow: {
    borderBottomWidth: 1,
    borderRightWidth: 0,
    flexBasis: "auto",
    maxHeight: 220,
    maxWidth: "100%",
    minWidth: 0,
    width: "100%"
  },
  rosterHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between"
  },
  rosterHeaderCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0
  },
  rosterTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 22
  },
  rosterScroll: {
    flex: 1,
    minHeight: 0
  },
  rosterRow: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 2,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  rosterRowSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent
  },
  rosterRowArchived: {
    opacity: 0.72
  },
  rosterLabel: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 13
  },
  rosterMeta: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 10
  },
  authorityChip: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 9,
    letterSpacing: 0.4,
    marginTop: 2,
    textTransform: "uppercase"
  },
  archivedBlock: {
    marginTop: 10
  },
  dossierPane: {
    flex: 1,
    minHeight: 0,
    minWidth: 0
  },
  dossierPaneNarrow: {
    width: "100%"
  },
  dossierScroll: {
    flex: 1,
    minHeight: 0
  },
  dossierContent: {
    gap: 8,
    padding: 16,
    paddingBottom: 40
  },
  dossierHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between"
  },
  dossierHeaderCopy: {
    flex: 1,
    minWidth: 0
  },
  dossierTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 28,
    marginTop: -2
  },
  emptyDetail: {
    gap: 8,
    padding: 24
  },
  emptyTitle: {
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 24
  },
  eyebrow: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    letterSpacing: 1.1,
    textTransform: "uppercase"
  },
  sectionTitle: {
    color: colors.kicker,
    fontFamily: fonts.uiSemibold,
    fontSize: 8,
    letterSpacing: 1.1,
    marginTop: 8,
    textTransform: "uppercase"
  },
  field: {
    gap: 3
  },
  fieldLabel: {
    color: colors.muted,
    fontFamily: fonts.uiSemibold,
    fontSize: 9,
    letterSpacing: 0.5,
    textTransform: "uppercase"
  },
  input: {
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 13,
    minHeight: 40,
    paddingHorizontal: 8,
    paddingVertical: 6,
    textAlignVertical: "top"
  },
  inputTall: {
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 13,
    minHeight: 64,
    paddingHorizontal: 8,
    paddingVertical: 6,
    textAlignVertical: "top"
  },
  help: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 11,
    lineHeight: 15
  },
  roleSummary: {
    backgroundColor: colors.wash,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: fonts.story,
    fontSize: 15,
    lineHeight: 22,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  kindRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4
  },
  kindChip: {
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5
  },
  kindChipSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent
  },
  kindChipText: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  kindChipTextSelected: {
    color: colors.accent
  },
  linkList: {
    gap: 4
  },
  linkRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8
  },
  linkLabelPress: {
    flex: 1,
    minWidth: 0
  },
  linkLabel: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 12
  },
  linkMeta: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 10
  },
  linkButton: {
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5
  },
  linkButtonOn: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent
  },
  linkButtonText: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 10
  },
  linkButtonTextOn: {
    color: colors.accent
  },
  sceneRow: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  constellationMap: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
    padding: 8
  },
  constellationList: {
    gap: 8
  },
  constellationGroup: {
    gap: 4
  },
  peerKindLegend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    justifyContent: "center"
  },
  legendChip: {
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  legendChipText: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 10
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  primaryButtonText: {
    color: colors.paper,
    fontFamily: fonts.uiSemibold,
    fontSize: 11
  },
  secondaryButton: {
    borderColor: colors.line,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  secondaryButtonText: {
    color: colors.ink,
    fontFamily: fonts.uiSemibold,
    fontSize: 11
  },
  pressed: {
    opacity: 0.72
  },
  disabled: {
    opacity: 0.45
  },
  visualGallery: {
    gap: 8,
    marginBottom: 4
  },
  visualGalleryHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between"
  },
  visualActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6
  },
  visualStrip: {
    maxHeight: 132
  },
  visualStripContent: {
    gap: 8,
    paddingVertical: 2
  },
  visualThumbWrap: {
    gap: 4,
    width: 96
  },
  visualThumb: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    height: 96,
    overflow: "hidden",
    width: 96
  },
  visualThumbSelected: {
    borderColor: colors.accent,
    borderWidth: 2
  },
  visualThumbImage: {
    height: "100%",
    width: "100%"
  },
  visualDelete: {
    alignSelf: "flex-start",
    paddingHorizontal: 2,
    paddingVertical: 2
  },
  visualDeleteText: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 11
  },
  visualOptionsBlock: {
    gap: 8
  },
  visualError: {
    color: colors.red,
    fontFamily: fonts.ui,
    fontSize: 12
  },
  visualModalBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(20, 16, 12, 0.82)",
    flex: 1,
    justifyContent: "center",
    padding: 24
  },
  visualModalImage: {
    borderRadius: 8,
    height: "80%",
    maxHeight: 560,
    maxWidth: 560,
    width: "90%"
  }
});
