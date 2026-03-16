import { getContainerState } from "./control";
import { config } from "./config";
import { readServerProperties, writeServerProperties } from "./server-properties";

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

export type ApplyResult = "live-and-persisted" | "persisted-only" | "live-apply-failed";

export type MotdSettings = {
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

type ParsedMotd = {
  document: MotdDocument;
  issues: MotdIssue[];
  normalizedRaw: string;
  roundTrippable: boolean;
  valid: boolean;
};

const defaultColor: MotdColor = "white";

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

const defaultSegment = (): MotdSegment => ({
  color: defaultColor,
  style: {},
  text: ""
});

const createEmptyDocument = (): MotdDocument => ({
  line1: { segments: [defaultSegment()] },
  line2: { segments: [defaultSegment()] }
});

const normalizeRawInput = (value: string) => value
  .replace(/\r\n?/g, "\n")
  .replace(/&([0-9a-fklmnor])/gi, (_match, code: string) => `§${code.toLowerCase()}`);

const encodePersistedMotd = (value: string) => normalizeRawInput(value).replace(/\n/g, "\\n");

const decodePersistedMotd = (value: string) => value.replace(/\\n/g, "\n");

const hasVisibleText = (document: MotdDocument) => [document.line1, document.line2]
  .some((line) => line.segments.some((segment) => segment.text.length > 0));

const hasLineContent = (line: MotdLine) => line.segments.some((segment) => segment.text.length > 0);

const pushSegment = (
  lines: MotdLine[],
  lineIndex: number,
  segment: MotdSegment
) => {
  if (!segment.text) {
    return;
  }

  lines[lineIndex].segments.push({
    color: segment.color,
    style: { ...segment.style },
    text: segment.text
  });
};

const serializeLine = (line: MotdLine) => line.segments
  .filter((segment) => segment.text.length > 0)
  .map((segment, index) => {
    const isPlainLeadingSegment = index === 0
      && segment.color === defaultColor
      && !Object.values(segment.style).some(Boolean);
    const styleCodes = Object.entries(styleCodeMap)
      .filter(([, styleKey]) => segment.style[styleKey])
      .map(([code]) => `§${code}`)
      .join("");

    const colorPrefix = isPlainLeadingSegment ? "" : `§${reverseColorCodeMap[segment.color]}`;
    return `${colorPrefix}${styleCodes}${segment.text}`;
  })
  .join("");

export const serializeMotdDocument = (document: MotdDocument) => {
  const line1 = serializeLine(document.line1);
  const line2 = serializeLine(document.line2);

  if (!line2) {
    return line1;
  }

  return `${line1}\n${line2}`;
};

export const parseRawMotd = (value: string): ParsedMotd => {
  const normalizedRaw = normalizeRawInput(value);
  const lines: MotdLine[] = [
    { segments: [] },
    { segments: [] }
  ];
  const issues: MotdIssue[] = [];
  let lineIndex = 0;
  let current = defaultSegment();

  const flush = () => {
    pushSegment(lines, lineIndex, current);
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

  if (!hasVisibleText(document)) {
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

export const renderMotdForDisplay = (value: string) => decodePersistedMotd(value).replace(/§[0-9a-fklmnor]/gi, "");

const readStoredMotd = async () => {
  const properties = await readServerProperties();
  const serialized = properties.motd ?? "";
  const raw = decodePersistedMotd(serialized);
  const parsed = parseRawMotd(raw);

  return {
    parsed,
    raw,
    serialized
  };
};

const applyLiveMotd = async (raw: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);

  try {
    const response = await fetch(`http://${config.motdHelperHost}:${config.motdHelperPort}/motd`, {
      body: JSON.stringify({ motd: raw }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST",
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({})) as {
      applied?: boolean;
      error?: string;
    };

    if (!response.ok || !payload.applied) {
      throw new Error(payload.error || `helper returned ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
};

export class MotdValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MotdValidationError";
  }
}

export const getMotdSettings = async (serverRunningOverride?: boolean): Promise<MotdSettings> => {
  const [{ parsed, raw, serialized }, state] = await Promise.all([
    readStoredMotd(),
    serverRunningOverride === undefined ? getContainerState() : Promise.resolve({ Running: serverRunningOverride })
  ]);

  return {
    document: parsed.document,
    helperEndpoint: {
      host: config.motdHelperHost,
      port: config.motdHelperPort
    },
    issues: parsed.issues,
    raw,
    roundTrippable: parsed.roundTrippable,
    serialized,
    serverRunning: state.Running
  };
};

export const updateMotd = async (raw: string) => {
  const parsed = parseRawMotd(raw);

  if (!parsed.valid) {
    throw new MotdValidationError(parsed.issues
      .filter((issue) => issue.level === "error")
      .map((issue) => issue.message)
      .join(" "));
  }

  await writeServerProperties({
    motd: encodePersistedMotd(parsed.normalizedRaw)
  });

  const state = await getContainerState();

  if (!state.Running) {
    return {
      applyResult: "persisted-only" as ApplyResult
    };
  }

  try {
    await applyLiveMotd(parsed.normalizedRaw);
    return {
      applyResult: "live-and-persisted" as ApplyResult
    };
  } catch {
    return {
      applyResult: "live-apply-failed" as ApplyResult
    };
  }
};

export const getPersistedMotdDisplay = async () => {
  const { serialized } = await readStoredMotd();
  return renderMotdForDisplay(serialized);
};

export const getMotdPreviewMetrics = (document: MotdDocument) => ({
  line1Length: serializeLine(document.line1).replace(/§[0-9a-fklmnor]/gi, "").length,
  line2Length: serializeLine(document.line2).replace(/§[0-9a-fklmnor]/gi, "").length,
  twoLines: hasLineContent(document.line2)
});
