import React, { useEffect, useMemo, useState } from "react";

export type MotdStyle = {
  bold?: boolean;
  italic?: boolean;
  obfuscated?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
};

export type MotdColor =
  | "black"
  | "dark_blue"
  | "dark_green"
  | "dark_aqua"
  | "dark_red"
  | "dark_purple"
  | "gold"
  | "gray"
  | "dark_gray"
  | "blue"
  | "green"
  | "aqua"
  | "red"
  | "light_purple"
  | "yellow"
  | "white";

export type MotdSegment = {
  color: MotdColor;
  style: MotdStyle;
  text: string;
};

export type MotdLine = {
  segments: MotdSegment[];
};

export type MotdDocument = {
  line1: MotdLine;
  line2: MotdLine;
};

export type MotdIssue = {
  level: "error" | "warning";
  message: string;
};

export type MotdSettingsState = {
  document: MotdDocument;
  helperEndpoint: {
    host: string;
    port: number;
  };
  issues: MotdIssue[];
  raw: string;
  roundTrippable: boolean;
  serialized: string;
  serverRunning: boolean;
};

type MotdEditorProps = {
  error: string;
  message: string;
  motd: MotdSettingsState;
  pending: boolean;
  onReload: () => void;
  onSave: (raw: string) => void;
};

type ParsedMotd = {
  document: MotdDocument;
  issues: MotdIssue[];
  normalizedRaw: string;
  roundTrippable: boolean;
  valid: boolean;
};

const colorCodeMap = {
  "0": "black",
  "1": "dark_blue",
  "2": "dark_green",
  "3": "dark_aqua",
  "4": "dark_red",
  "5": "dark_purple",
  "6": "gold",
  "7": "gray",
  "8": "dark_gray",
  "9": "blue",
  a: "green",
  b: "aqua",
  c: "red",
  d: "light_purple",
  e: "yellow",
  f: "white"
} as const satisfies Record<string, MotdColor>;

const reverseColorCodeMap = Object.fromEntries(
  Object.entries(colorCodeMap).map(([code, color]) => [color, code])
) as Record<MotdColor, string>;

const styleCodeMap = {
  k: "obfuscated",
  l: "bold",
  m: "strikethrough",
  n: "underline",
  o: "italic"
} as const satisfies Record<string, keyof MotdStyle>;

const previewColorMap: Record<MotdColor, string> = {
  black: "#000000",
  dark_blue: "#0000aa",
  dark_green: "#00aa00",
  dark_aqua: "#00aaaa",
  dark_red: "#aa0000",
  dark_purple: "#aa00aa",
  gold: "#ffaa00",
  gray: "#aaaaaa",
  dark_gray: "#555555",
  blue: "#5555ff",
  green: "#55ff55",
  aqua: "#55ffff",
  red: "#ff5555",
  light_purple: "#ff55ff",
  yellow: "#ffff55",
  white: "#ffffff"
};

const colorOptions: Array<{ label: string; value: MotdColor }> = [
  { label: "Black", value: "black" },
  { label: "Dark Blue", value: "dark_blue" },
  { label: "Dark Green", value: "dark_green" },
  { label: "Dark Aqua", value: "dark_aqua" },
  { label: "Dark Red", value: "dark_red" },
  { label: "Dark Purple", value: "dark_purple" },
  { label: "Gold", value: "gold" },
  { label: "Gray", value: "gray" },
  { label: "Dark Gray", value: "dark_gray" },
  { label: "Blue", value: "blue" },
  { label: "Green", value: "green" },
  { label: "Aqua", value: "aqua" },
  { label: "Red", value: "red" },
  { label: "Light Purple", value: "light_purple" },
  { label: "Yellow", value: "yellow" },
  { label: "White", value: "white" }
];

const styleOptions: Array<{ key: keyof MotdStyle; label: string }> = [
  { key: "bold", label: "Bold" },
  { key: "italic", label: "Italic" },
  { key: "underline", label: "Underline" },
  { key: "strikethrough", label: "Strike" },
  { key: "obfuscated", label: "Obfuscated" }
];

const defaultSegment = (): MotdSegment => ({
  color: "white",
  style: {},
  text: ""
});

const normalizeRawInput = (value: string) => value
  .replace(/\r\n?/g, "\n")
  .replace(/&([0-9a-fklmnor])/gi, (_match, code: string) => `§${code.toLowerCase()}`);

const pushSegment = (line: MotdLine, segment: MotdSegment) => {
  if (!segment.text) {
    return;
  }

  line.segments.push({
    color: segment.color,
    style: { ...segment.style },
    text: segment.text
  });
};

const serializeLine = (line: MotdLine) => line.segments
  .filter((segment) => segment.text.length > 0)
  .map((segment, index) => {
    const isPlainLeadingSegment = index === 0
      && segment.color === "white"
      && !Object.values(segment.style).some(Boolean);
    const styleCodes = Object.entries(styleCodeMap)
      .filter(([, styleKey]) => segment.style[styleKey])
      .map(([code]) => `§${code}`)
      .join("");

    const colorPrefix = isPlainLeadingSegment ? "" : `§${reverseColorCodeMap[segment.color]}`;
    return `${colorPrefix}${styleCodes}${segment.text}`;
  })
  .join("");

const serializeMotdDocument = (document: MotdDocument) => {
  const line1 = serializeLine(document.line1);
  const line2 = serializeLine(document.line2);

  if (!line2) {
    return line1;
  }

  return `${line1}\n${line2}`;
};

const parseRawMotd = (value: string): ParsedMotd => {
  const normalizedRaw = normalizeRawInput(value);
  const lines: [MotdLine, MotdLine] = [
    { segments: [] },
    { segments: [] }
  ];
  const issues: MotdIssue[] = [];
  let lineIndex = 0;
  let current = defaultSegment();

  const flush = () => {
    pushSegment(lines[lineIndex], current);
    current = {
      color: current.color,
      style: { ...current.style },
      text: ""
    };
  };

  for (let index = 0; index < normalizedRaw.length; index += 1) {
    const character = normalizedRaw[index];

    if (character === "\n") {
      flush();
      if (lineIndex === 1) {
        issues.push({
          level: "error",
          message: "Minecraft MOTDs support only two lines."
        });
        continue;
      }

      lineIndex += 1;
      current = defaultSegment();
      continue;
    }

    if (character === "§") {
      const next = normalizedRaw[index + 1]?.toLowerCase();

      if (!next) {
        issues.push({
          level: "error",
          message: "Legacy formatting codes must end with a color or style code."
        });
        current.text += character;
        continue;
      }

      if (next in colorCodeMap) {
        flush();
        current = {
          color: colorCodeMap[next as keyof typeof colorCodeMap],
          style: {},
          text: ""
        };
        index += 1;
        continue;
      }

      if (next in styleCodeMap) {
        flush();
        current = {
          color: current.color,
          style: {
            ...current.style,
            [styleCodeMap[next as keyof typeof styleCodeMap]]: true
          },
          text: ""
        };
        index += 1;
        continue;
      }

      if (next === "r") {
        flush();
        current = defaultSegment();
        index += 1;
        continue;
      }

      issues.push({
        level: "error",
        message: `Unsupported legacy formatting code: §${next}`
      });
      current.text += `§${next}`;
      index += 1;
      continue;
    }

    current.text += character;
  }

  flush();

  const document: MotdDocument = {
    line1: {
      segments: lines[0].segments.length > 0 ? lines[0].segments : [defaultSegment()]
    },
    line2: {
      segments: lines[1].segments.length > 0 ? lines[1].segments : [defaultSegment()]
    }
  };

  const hasVisibleText = [document.line1, document.line2]
    .some((line) => line.segments.some((segment) => segment.text.length > 0));

  if (!hasVisibleText) {
    issues.push({
      level: "error",
      message: "Enter at least one visible character for the server MOTD."
    });
  }

  const canonicalRaw = serializeMotdDocument(document);
  const valid = issues.every((issue) => issue.level !== "error");

  if (valid && canonicalRaw !== normalizedRaw) {
    issues.push({
      level: "warning",
      message: "The raw MOTD is valid, but the visual builder cannot preserve it exactly."
    });
  }

  return {
    document,
    issues,
    normalizedRaw,
    roundTrippable: valid && canonicalRaw === normalizedRaw,
    valid
  };
};

const createUpdatedDocument = (
  document: MotdDocument,
  lineKey: keyof MotdDocument,
  updater: (line: MotdLine) => MotdLine
) => ({
  ...document,
  [lineKey]: updater(document[lineKey])
});

const renderSegment = (segment: MotdSegment, index: number) => {
  const style: React.CSSProperties = {
    color: previewColorMap[segment.color],
    fontStyle: segment.style.italic ? "italic" : "normal",
    fontWeight: segment.style.bold ? 700 : 400,
    textDecoration: [
      segment.style.underline ? "underline" : "",
      segment.style.strikethrough ? "line-through" : ""
    ].filter(Boolean).join(" ")
  };

  return (
    <span
      className={segment.style.obfuscated ? "motd-preview-segment is-obfuscated" : "motd-preview-segment"}
      key={`${segment.color}-${segment.text}-${index}`}
      style={style}
    >
      {segment.text || "\u00a0"}
    </span>
  );
};

const renderPreviewLine = (line: MotdLine) => {
  const content = line.segments.filter((segment) => segment.text.length > 0);
  return content.length > 0 ? content.map(renderSegment) : <span className="motd-preview-empty">Blank line</span>;
};

const measureLineLength = (line: MotdLine) => line.segments.reduce((total, segment) => total + segment.text.length, 0);

const MotdLineEditor = ({
  disabled,
  label,
  line,
  onAddSegment,
  onRemoveSegment,
  onUpdateSegment
}: {
  disabled: boolean;
  label: string;
  line: MotdLine;
  onAddSegment: () => void;
  onRemoveSegment: (index: number) => void;
  onUpdateSegment: (index: number, updater: (segment: MotdSegment) => MotdSegment) => void;
}) => (
  <section className="motd-line-editor">
    <div className="motd-line-heading">
      <strong>{label}</strong>
      <span className="setting-mode">{measureLineLength(line)} visible characters</span>
    </div>
    <div className="motd-segment-list">
      {line.segments.map((segment, index) => (
        <div className="motd-segment-card" key={`${label}-${index}`}>
          <div className="motd-segment-header">
            <strong>Segment {index + 1}</strong>
            <div className="motd-segment-actions">
              <button className="secondary-button" disabled={disabled} onClick={onAddSegment} type="button">Add</button>
              <button className="secondary-button" disabled={disabled || line.segments.length === 1} onClick={() => onRemoveSegment(index)} type="button">Remove</button>
            </div>
          </div>
          <div className="motd-segment-fields">
            <input
              className="setting-input"
              disabled={disabled}
              onChange={(event) => onUpdateSegment(index, (current) => ({ ...current, text: event.target.value }))}
              placeholder="Segment text"
              value={segment.text}
            />
            <select
              className="setting-input"
              disabled={disabled}
              onChange={(event) => onUpdateSegment(index, (current) => ({ ...current, color: event.target.value as MotdColor }))}
              value={segment.color}
            >
              {colorOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="motd-style-row">
            {styleOptions.map((styleOption) => (
              <button
                className={segment.style[styleOption.key] ? "motd-style-toggle is-active" : "motd-style-toggle"}
                disabled={disabled}
                key={styleOption.key}
                onClick={() => onUpdateSegment(index, (current) => ({
                  ...current,
                  style: {
                    ...current.style,
                    [styleOption.key]: !current.style[styleOption.key]
                  }
                }))}
                type="button"
              >
                {styleOption.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  </section>
);

export const MotdEditor = ({
  error,
  message,
  motd,
  pending,
  onReload,
  onSave
}: MotdEditorProps) => {
  const [mode, setMode] = useState<"builder" | "raw">("builder");
  const [document, setDocument] = useState<MotdDocument>(motd.document);
  const [raw, setRaw] = useState(motd.raw);
  const [builderLocked, setBuilderLocked] = useState(!motd.roundTrippable);

  useEffect(() => {
    setDocument(motd.document);
    setRaw(motd.raw);
    setBuilderLocked(!motd.roundTrippable);
    setMode(motd.roundTrippable ? "builder" : "raw");
  }, [motd]);

  const rawParse = useMemo(() => parseRawMotd(raw), [raw]);
  const previewDocument = builderLocked ? rawParse.document : document;
  const saveDisabled = pending || raw === motd.raw || !rawParse.valid;
  const infoIssues = builderLocked ? rawParse.issues : motd.issues;
  const previewWarnings = [
    measureLineLength(previewDocument.line1) > 59 ? "Line 1 is long for the multiplayer server list." : "",
    measureLineLength(previewDocument.line2) > 59 ? "Line 2 is long for the multiplayer server list." : ""
  ].filter(Boolean);

  const commitDocument = (nextDocument: MotdDocument) => {
    setDocument(nextDocument);
    if (!builderLocked) {
      setRaw(serializeMotdDocument(nextDocument));
    }
  };

  const updateLine = (lineKey: keyof MotdDocument, updater: (line: MotdLine) => MotdLine) => {
    commitDocument(createUpdatedDocument(document, lineKey, updater));
  };

  return (
    <article className="panel-card motd-card">
      <div className="motd-header">
        <div>
          <p className="eyebrow">Server List MOTD</p>
          <h1>MOTD Builder</h1>
          <p className="body-copy">
            The panel now owns MOTD persistence in <code>server.properties</code>. When the server is running, saves also attempt a live apply through the local NeoForge helper on {motd.helperEndpoint.host}:{motd.helperEndpoint.port}.
          </p>
        </div>
        <div className="motd-status-badges">
          <span className={motd.serverRunning ? "tag live-tag" : "tag restart-tag"}>
            {motd.serverRunning ? "Server Running" : "Server Offline"}
          </span>
          <span className={builderLocked ? "tag restart-tag" : "tag live-tag"}>
            {builderLocked ? "Builder Locked" : "Builder Editable"}
          </span>
        </div>
      </div>
      {builderLocked ? (
        <p className="notice-text">
          {rawParse.valid && rawParse.roundTrippable
            ? "Raw mode has unsaved edits. Save or discard them before editing in the visual builder again."
            : "Raw formatting is active and the visual builder is read-only until you discard or save a supported round-trip state."}
        </p>
      ) : null}
      {message ? <p className="success-text">{message}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
      {infoIssues.map((issue) => (
        <p className={issue.level === "error" ? "error-text" : "notice-text"} key={issue.message}>{issue.message}</p>
      ))}
      {previewWarnings.map((warning) => (
        <p className="notice-text" key={warning}>{warning}</p>
      ))}
      <div className="file-view-tabs motd-tabs">
        <button className={mode === "builder" ? "nav-link active" : "nav-link"} onClick={() => setMode("builder")} type="button">Visual Builder</button>
        <button className={mode === "raw" ? "nav-link active" : "nav-link"} onClick={() => setMode("raw")} type="button">Raw Codes</button>
      </div>
      <div className="motd-workspace">
        <div className="motd-editor-pane">
          {mode === "builder" ? (
            <div className="motd-builder-grid">
              <MotdLineEditor
                disabled={builderLocked}
                label="Line 1"
                line={document.line1}
                onAddSegment={() => updateLine("line1", (line) => ({ ...line, segments: [...line.segments, defaultSegment()] }))}
                onRemoveSegment={(index) => updateLine("line1", (line) => ({
                  ...line,
                  segments: line.segments.filter((_segment, segmentIndex) => segmentIndex !== index)
                }))}
                onUpdateSegment={(index, updater) => updateLine("line1", (line) => ({
                  ...line,
                  segments: line.segments.map((segment, segmentIndex) => segmentIndex === index ? updater(segment) : segment)
                }))}
              />
              <MotdLineEditor
                disabled={builderLocked}
                label="Line 2"
                line={document.line2}
                onAddSegment={() => updateLine("line2", (line) => ({ ...line, segments: [...line.segments, defaultSegment()] }))}
                onRemoveSegment={(index) => updateLine("line2", (line) => ({
                  ...line,
                  segments: line.segments.filter((_segment, segmentIndex) => segmentIndex !== index)
                }))}
                onUpdateSegment={(index, updater) => updateLine("line2", (line) => ({
                  ...line,
                  segments: line.segments.map((segment, segmentIndex) => segmentIndex === index ? updater(segment) : segment)
                }))}
              />
            </div>
          ) : (
            <div className="motd-raw-pane">
              <textarea
                className="motd-raw-editor"
                onChange={(event) => {
                  setRaw(event.target.value);
                  setBuilderLocked(true);
                }}
                placeholder={"§6Line one\n§aLine two"}
                value={raw}
              />
              <p className="setting-mode">
                Use legacy Minecraft formatting codes. `&` codes are normalized to `§` on save, and new lines are written as a two-line MOTD.
              </p>
            </div>
          )}
          <div className="action-grid">
            <button className={pending ? "primary-button is-loading" : "primary-button"} disabled={saveDisabled} onClick={() => onSave(raw)} type="button">
              {pending ? "Saving..." : "Save MOTD"}
            </button>
            <button className="secondary-button" disabled={pending} onClick={onReload} type="button">Reload</button>
            <button
              className="secondary-button"
              disabled={pending || (raw === motd.raw && !builderLocked)}
              onClick={() => {
                setDocument(motd.document);
                setRaw(motd.raw);
                setBuilderLocked(!motd.roundTrippable);
              }}
              type="button"
            >
              Discard Draft
            </button>
          </div>
        </div>
        <aside className="motd-preview-card">
          <p className="eyebrow">Preview</p>
          <h2>Server List Card</h2>
          <div className="motd-preview-frame">
            <div className="motd-preview-copy">
              <div className="motd-preview-title">Better MC [NEOFORGE] Server</div>
              <div className="motd-preview-line">{renderPreviewLine(previewDocument.line1)}</div>
              <div className="motd-preview-line">{renderPreviewLine(previewDocument.line2)}</div>
            </div>
            <div className="motd-preview-meta">
              <strong>0/20</strong>
              <span>1.21.1</span>
            </div>
          </div>
          <p className="setting-mode">Persisted value: {motd.serialized || "(empty)"}</p>
        </aside>
      </div>
    </article>
  );
};
