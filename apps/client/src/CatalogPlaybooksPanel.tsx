import {
  CATALOG_AGENT_IDS,
  catalogAgentPlaybook,
  type CatalogAgentId,
  type CatalogAgentStage
} from "@ghostwriter/core";
import { ghostwriterTheme } from "@ghostwriter/ui";
import { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import {
  getCatalogPlaybook,
  listCatalogPlaybooks,
  resetCatalogPlaybookOverride,
  saveCatalogPlaybookOverride,
  type CatalogPlaybookDetailResponse,
  type CatalogPlaybookSummaryResponse
} from "./api.js";

const { colors, fonts } = ghostwriterTheme;
const STAGES: readonly CatalogAgentStage[] = [
  "brainstorm",
  "structure",
  "writing",
  "editing",
  "commercial"
];

/** Always-available rail from built-in catalog — never wait on the network to click. */
const BUILTIN_RAIL = CATALOG_AGENT_IDS.map((agentId) => {
  const builtIn = catalogAgentPlaybook(agentId);
  return Object.freeze({
    agentId,
    label: builtIn.label,
    stage: builtIn.stage
  });
});

export function CatalogPlaybooksPanel({
  projectId
}: Readonly<{ projectId?: string }>) {
  const [summaries, setSummaries] = useState<
    readonly CatalogPlaybookSummaryResponse[]
  >([]);
  const [selectedId, setSelectedId] = useState<CatalogAgentId>("idea-midwife");
  const [detail, setDetail] = useState<CatalogPlaybookDetailResponse>();
  const [steering, setSteering] = useState("");
  const [sectionNotes, setSectionNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  const selectedBuiltIn = useMemo(
    () => catalogAgentPlaybook(selectedId),
    [selectedId]
  );

  async function refreshList(id: CatalogAgentId = selectedId) {
    if (projectId === undefined) return;
    const [nextSummaries, nextDetail] = await Promise.all([
      listCatalogPlaybooks(projectId),
      getCatalogPlaybook({ projectId, agentId: id })
    ]);
    setSummaries(nextSummaries);
    setDetail(nextDetail);
    setSteering(nextDetail.override?.doctrine ?? "");
    setSectionNotes(
      Object.fromEntries(
        nextDetail.builtIn.sections.map((section) => [
          section.heading,
          nextDetail.override?.sections?.find(
            (candidate) => candidate.heading === section.heading
          )?.note ?? ""
        ])
      )
    );
  }

  useEffect(() => {
    setProblem(undefined);
    if (projectId === undefined) return;
    setBusy(true);
    void refreshList(selectedId)
      .catch((error: unknown) => {
        setProblem(
          error instanceof Error
            ? error.message
            : "Could not load playbook overrides."
        );
      })
      .finally(() => setBusy(false));
    // Only re-fetch when the project changes; agent selection has its own loader.
  }, [projectId]);

  const byStage = useMemo(
    () =>
      STAGES.map((stage) => ({
        stage,
        agents: BUILTIN_RAIL.filter((agent) => agent.stage === stage)
      })),
    []
  );

  const overriddenIds = useMemo(
    () =>
      new Set(
        summaries.filter((summary) => summary.overridden).map((s) => s.agentId)
      ),
    [summaries]
  );

  if (projectId === undefined) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>
          Open a project to add agent steering.
        </Text>
        <Text style={styles.muted}>
          Writer steering sits on top of Ghostwriter’s built-in playbooks for that
          story — it never replaces product constraints.
        </Text>
      </View>
    );
  }

  async function select(agentId: CatalogAgentId) {
    setSelectedId(agentId);
    setBusy(true);
    setProblem(undefined);
    try {
      await refreshList(agentId);
    } catch (error) {
      setDetail(undefined);
      setSteering("");
      setSectionNotes(
        Object.fromEntries(
          catalogAgentPlaybook(agentId).sections.map((section) => [
            section.heading,
            ""
          ])
        )
      );
      setProblem(
        error instanceof Error ? error.message : "Could not load the playbook."
      );
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (projectId === undefined) return;
    const sections = selectedBuiltIn.sections.flatMap((section) => {
      const note = sectionNotes[section.heading]?.trim();
      return note === undefined || note.length === 0
        ? []
        : [{ heading: section.heading, note }];
    });
    if (steering.trim().length === 0 && sections.length === 0) {
      setProblem(
        "Add steering text or a section note, or reset to clear overrides."
      );
      return;
    }
    setBusy(true);
    setProblem(undefined);
    try {
      await saveCatalogPlaybookOverride({
        projectId,
        agentId: selectedId,
        ...(steering.trim().length === 0 ? {} : { doctrine: steering }),
        ...(sections.length === 0 ? {} : { sections }),
        ...(detail?.override == null
          ? {}
          : { expectedVersion: detail.override.version })
      });
      await refreshList(selectedId);
    } catch (error) {
      setProblem(
        error instanceof Error ? error.message : "Could not save steering."
      );
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (projectId === undefined) return;
    setBusy(true);
    setProblem(undefined);
    try {
      await resetCatalogPlaybookOverride({ projectId, agentId: selectedId });
      await refreshList(selectedId);
    } catch (error) {
      setProblem(
        error instanceof Error ? error.message : "Could not reset steering."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <ScrollView
        accessibilityLabel="Catalog agents"
        style={styles.agentRail}
        contentContainerStyle={styles.agentRailContent}
      >
        {byStage.map(({ stage, agents }) => (
          <View key={stage} style={styles.stage}>
            <Text style={styles.stageLabel}>{stage}</Text>
            {agents.map((agent) => {
              const selected = selectedId === agent.agentId;
              const overridden = overriddenIds.has(agent.agentId);
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={agent.agentId}
                  onPress={() => void select(agent.agentId)}
                  style={({ pressed }) => [
                    styles.agentButton,
                    selected && styles.agentButtonSelected,
                    pressed && styles.agentButtonPressed
                  ]}
                >
                  <Text
                    style={[
                      styles.agentLabel,
                      selected && styles.agentLabelSelected
                    ]}
                  >
                    {agent.label}
                  </Text>
                  {overridden ? (
                    <Text style={styles.overrideMark}>Steering on</Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>
      <ScrollView
        style={styles.editor}
        contentContainerStyle={styles.editorContent}
      >
        <Text accessibilityRole="header" style={styles.heading}>
          {selectedBuiltIn.label}
        </Text>
        <Text style={styles.muted}>
          Built-in playbook stays in force. Your steering sits on top — tone,
          emphasis, house rules — and cannot override product constraints (propose
          only, no fabricated quotes).
        </Text>
        {problem === undefined ? null : (
          <Text style={styles.problem}>{problem}</Text>
        )}
        <Text style={styles.label}>Built-in playbook</Text>
        <ScrollView
          accessibilityLabel="Built-in playbook text"
          nestedScrollEnabled
          style={styles.builtIn}
          contentContainerStyle={styles.builtInContent}
        >
          <Text style={styles.builtInText}>{selectedBuiltIn.doctrine}</Text>
        </ScrollView>
        <Text style={styles.label}>Your steering</Text>
        <TextInput
          accessibilityLabel="Writer steering for this agent"
          editable={!busy}
          multiline
          onChangeText={setSteering}
          placeholder="Optional. e.g. Prefer quiet literary stakes; never suggest YA voice; keep Wren’s dialect intact…"
          placeholderTextColor={colors.muted}
          style={styles.textarea}
          value={steering}
        />
        <Text style={styles.label}>Section emphasis (optional)</Text>
        <Text style={styles.muted}>
          Leave blank to keep the built-in section notes. Filled notes replace
          that section’s note in drafts while the system playbook remains below.
        </Text>
        {selectedBuiltIn.sections.map((section) => (
          <View key={section.heading} style={styles.sectionEditor}>
            <Text style={styles.sectionHeading}>{section.heading}</Text>
            <Text style={styles.builtInNote}>{section.note}</Text>
            <TextInput
              accessibilityLabel={`Steering note for ${section.heading}`}
              editable={!busy}
              multiline
              onChangeText={(note) =>
                setSectionNotes((current) => ({
                  ...current,
                  [section.heading]: note
                }))
              }
              placeholder="Optional emphasis for this section…"
              placeholderTextColor={colors.muted}
              style={styles.noteInput}
              value={sectionNotes[section.heading] ?? ""}
            />
          </View>
        ))}
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void save()}
            style={({ pressed }) => [
              styles.primary,
              (busy || pressed) && styles.pressed
            ]}
          >
            <Text style={styles.primaryText}>
              {busy ? "Saving…" : "Save steering"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy || !overriddenIds.has(selectedId)}
            onPress={() => void reset()}
            style={({ pressed }) => [
              styles.secondary,
              (busy || pressed) && styles.pressed,
              !overriddenIds.has(selectedId) && styles.disabled
            ]}
          >
            <Text style={styles.secondaryText}>Clear steering</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row", gap: 20, minHeight: 0 },
  empty: {
    alignItems: "center",
    flex: 1,
    gap: 8,
    justifyContent: "center",
    padding: 32
  },
  emptyTitle: { color: colors.ink, fontFamily: fonts.uiMedium, fontSize: 18 },
  muted: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 13,
    lineHeight: 19
  },
  agentRail: {
    borderRightColor: colors.line,
    borderRightWidth: 1,
    flexGrow: 0,
    flexShrink: 0,
    minWidth: 200,
    width: 230
  },
  agentRailContent: { gap: 14, paddingBottom: 24, paddingRight: 12 },
  stage: { gap: 4 },
  stageLabel: {
    color: colors.kicker,
    fontFamily: fonts.uiMedium,
    fontSize: 11,
    letterSpacing: 0.4,
    paddingHorizontal: 10,
    textTransform: "uppercase"
  },
  agentButton: {
    borderRadius: 8,
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  agentButtonSelected: { backgroundColor: colors.accentSoft },
  agentButtonPressed: { opacity: 0.88 },
  agentLabel: { color: colors.ink, fontFamily: fonts.uiMedium, fontSize: 13 },
  agentLabelSelected: { color: colors.kicker },
  overrideMark: { color: colors.kicker, fontFamily: fonts.ui, fontSize: 11 },
  editor: { flex: 1, minWidth: 0 },
  editorContent: { gap: 12, paddingBottom: 32, paddingLeft: 4 },
  heading: { color: colors.ink, fontFamily: fonts.story, fontSize: 25 },
  label: {
    color: colors.ink,
    fontFamily: fonts.uiMedium,
    fontSize: 13,
    marginTop: 6
  },
  builtIn: {
    backgroundColor: colors.wash,
    borderRadius: 8,
    maxHeight: 180
  },
  builtInContent: { padding: 12 },
  builtInText: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 18
  },
  textarea: {
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 13,
    minHeight: 120,
    padding: 12,
    textAlignVertical: "top"
  },
  sectionEditor: { gap: 6 },
  sectionHeading: { color: colors.ink, fontFamily: fonts.uiMedium, fontSize: 13 },
  builtInNote: {
    color: colors.muted,
    fontFamily: fonts.ui,
    fontSize: 12,
    lineHeight: 17
  },
  noteInput: {
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 13,
    minHeight: 64,
    padding: 10,
    textAlignVertical: "top"
  },
  problem: { color: colors.red, fontFamily: fonts.ui, fontSize: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 6 },
  primary: {
    backgroundColor: colors.ink,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9
  },
  primaryText: { color: colors.paper, fontFamily: fonts.uiMedium, fontSize: 13 },
  secondary: {
    borderColor: colors.line,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 9
  },
  secondaryText: { color: colors.ink, fontFamily: fonts.uiMedium, fontSize: 13 },
  pressed: { opacity: 0.88 },
  disabled: { opacity: 0.45 }
});
