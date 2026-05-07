import type Anthropic from "@anthropic-ai/sdk";

type Tool = NonNullable<Anthropic.Messages.MessageCreateParams["tools"]>[number];

const conceptTool: Tool = {
  name: "submit_concept",
  description:
    "Submit the project's concept (what / why / vision / audience). All fields must be grounded in the repo-context.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["what", "why", "vision", "audience"],
    properties: {
      what: { type: "string", minLength: 40 },
      why: { type: "string", minLength: 40 },
      vision: { type: "string", minLength: 20 },
      audience: {
        type: "array",
        minItems: 1,
        maxItems: 5,
        items: { type: "string" },
      },
    },
  },
};

const interactionSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["do", "selector"],
      properties: { do: { const: "click" }, selector: { type: "string" } },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["do", "selector", "text"],
      properties: { do: { const: "fill" }, selector: { type: "string" }, text: { type: "string" } },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["do", "selector"],
      properties: { do: { const: "hover" }, selector: { type: "string" } },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["do", "selector"],
      properties: { do: { const: "scrollTo" }, selector: { type: "string" } },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["do", "ms"],
      properties: { do: { const: "wait" }, ms: { type: "integer", minimum: 0, maximum: 10000 } },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["do", "key"],
      properties: { do: { const: "press" }, key: { type: "string" } },
    },
  ],
} as const;

const shotSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "kind", "target", "route", "caption", "importance"],
      properties: {
        id: { type: "string" },
        kind: { const: "screenshot" },
        target: { const: "live-app" },
        route: { type: "string" },
        viewport: {
          type: "object",
          properties: { w: { type: "integer" }, h: { type: "integer" } },
          required: ["w", "h"],
        },
        waitFor: { type: "string" },
        interactions: { type: "array", items: interactionSchema },
        fullPage: { type: "boolean" },
        caption: { type: "string" },
        importance: { type: "integer", enum: [1, 2, 3] },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "kind", "target", "caption", "importance"],
      properties: {
        id: { type: "string" },
        kind: { const: "screenshot" },
        target: { const: "github-readme" },
        section: { type: "string" },
        caption: { type: "string" },
        importance: { type: "integer", enum: [1, 2, 3] },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "kind", "target", "diagramSpec", "caption", "importance"],
      properties: {
        id: { type: "string" },
        kind: { const: "screenshot" },
        target: { const: "code-architecture" },
        diagramSpec: {
          type: "object",
          required: ["mermaid"],
          properties: { mermaid: { type: "string" } },
        },
        caption: { type: "string" },
        importance: { type: "integer", enum: [1, 2, 3] },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "kind", "target", "route", "script", "caption"],
      properties: {
        id: { type: "string" },
        kind: { const: "video" },
        target: { const: "live-app" },
        route: { type: "string" },
        script: { type: "array", minItems: 1, items: interactionSchema },
        maxDurationMs: { type: "integer", minimum: 2000, maximum: 30000 },
        caption: { type: "string" },
      },
    },
  ],
} as const;

const capturePlanTool: Tool = {
  name: "submit_capture_plan",
  description: "Submit the capture plan: 4-10 shots that together let a reader see this project.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["shots"],
    properties: {
      shots: { type: "array", minItems: 1, maxItems: 10, items: shotSchema },
    },
  },
};

const technicalTool: Tool = {
  name: "submit_technical",
  description: "Submit the technical write-up grounded in the repo-context.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["stack", "architecture", "dataFlow", "keyModules", "gettingStarted"],
    properties: {
      stack: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["technology", "evidence"],
          properties: {
            technology: { type: "string" },
            evidence: { type: "string" },
          },
        },
      },
      architecture: { type: "string", minLength: 40 },
      dataFlow: { type: "string", minLength: 20 },
      keyModules: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["path", "role", "oneLineSummary"],
          properties: {
            path: { type: "string" },
            role: { type: "string" },
            oneLineSummary: { type: "string" },
            citations: { type: "array", items: { type: "string" } },
          },
        },
      },
      gettingStarted: { type: "array", minItems: 1, items: { type: "string" } },
    },
  },
};

const captionsTool: Tool = {
  name: "submit_captions",
  description: "Submit one caption per successful capture; each caption <=60 words.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["captions"],
    properties: {
      captions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["shotId", "markdown"],
          properties: {
            shotId: { type: "string" },
            markdown: { type: "string", maxLength: 500 },
          },
        },
      },
    },
  },
};

const summaryTool: Tool = {
  name: "submit_summary",
  description: "Submit the deck title-slide summary.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["oneLiner", "tldr"],
    properties: {
      oneLiner: { type: "string", maxLength: 140 },
      tldr: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } },
    },
  },
};

export const TOOL_DEFINITIONS = {
  conceptTool,
  capturePlanTool,
  technicalTool,
  captionsTool,
  summaryTool,
};
