import path from "node:path";
import {
  assertAllowedExistingPath,
  assertAllowedTargetPath,
} from "../security/pathGuard.js";
import {
  executePrimitive,
  getPrimitiveCatalog,
  PRIMITIVE_ABI_VERSION,
} from "../primitives/primitiveRuntime.js";
import { resourceArbiter } from "../runtime/resourceArbiter.js";
import { getProviderStatuses } from "../providers/registry.js";
import {
  createPersistentPrimitiveTask,
  type PrimitiveTaskStep,
} from "../tasks/taskRuntime.js";
import {
  cancelPersistentSchedule,
  createPrimitiveSchedule,
  deletePersistentSchedule,
  getPersistentSchedule,
  listPersistentSchedules,
} from "../runtime/scheduler.js";
import type {
  ScheduleStopWhen,
  ScheduleTrigger,
} from "../runtime/schedulerStore.js";

type JsonObject = Record<string, unknown>;

type SkillContract = {
  riskLevel: "low" | "medium" | "high" | "critical";
  idempotent: boolean;
  sideEffects: string[];
  requiresVerification: boolean;
  retryPolicy: "automatic" | "manual" | "never";
  resources: Array<{ key: string; mode: "shared" | "exclusive" }>;
};

type SkillDefinition = {
  id: string;
  domain: string;
  description: string;
  keywords: string[];
  contract: SkillContract;
  inputs: Record<string, string>;
  run: (args: JsonObject) => Promise<unknown>;
  dryRunPlan: (args: JsonObject) => unknown;
};

type SkillExecutionMode = "inline" | "durable";

type SkillRuntimeMetadata = {
  skillVersion: string;
  requiredPrimitiveAbi: number;
  requiredPrimitives: string[];
  executionMode: SkillExecutionMode;
  memoryPolicy: {
    working: "runtime";
    staging: "available_when_durable";
    episodic: "task_events_when_durable";
    semanticPromotion: "manual";
  };
};

const SKILL_RUNTIME_METADATA: Record<string, SkillRuntimeMetadata> = {
  "runtime.compile_task": {
    skillVersion: "0.1.0",
    requiredPrimitiveAbi: 1,
    requiredPrimitives: [],
    executionMode: "durable",
    memoryPolicy: {
      working: "runtime",
      staging: "available_when_durable",
      episodic: "task_events_when_durable",
      semanticPromotion: "manual",
    },
  },
  "runtime.schedule": {
    skillVersion: "0.1.0",
    requiredPrimitiveAbi: 1,
    requiredPrimitives: [],
    executionMode: "durable",
    memoryPolicy: {
      working: "runtime",
      staging: "available_when_durable",
      episodic: "task_events_when_durable",
      semanticPromotion: "manual",
    },
  },
  "wechat.read": {
    skillVersion: "0.2.0",
    requiredPrimitiveAbi: 1,
    requiredPrimitives: [
      "app.lifecycle",
      "clipboard",
      "ui.query",
      "vision.capture",
    ],
    executionMode: "inline",
    memoryPolicy: {
      working: "runtime",
      staging: "available_when_durable",
      episodic: "task_events_when_durable",
      semanticPromotion: "manual",
    },
  },
  "wechat.copy_selected": {
    skillVersion: "0.2.0",
    requiredPrimitiveAbi: 1,
    requiredPrimitives: ["app.lifecycle", "clipboard"],
    executionMode: "inline",
    memoryPolicy: {
      working: "runtime",
      staging: "available_when_durable",
      episodic: "task_events_when_durable",
      semanticPromotion: "manual",
    },
  },
  "wechat.copy_at": {
    skillVersion: "0.2.0",
    requiredPrimitiveAbi: 1,
    requiredPrimitives: ["app.lifecycle", "pointer.click", "clipboard"],
    executionMode: "inline",
    memoryPolicy: {
      working: "runtime",
      staging: "available_when_durable",
      episodic: "task_events_when_durable",
      semanticPromotion: "manual",
    },
  },
  "wechat.read_points": {
    skillVersion: "0.2.0",
    requiredPrimitiveAbi: 1,
    requiredPrimitives: ["app.lifecycle", "pointer.click", "clipboard"],
    executionMode: "inline",
    memoryPolicy: {
      working: "runtime",
      staging: "available_when_durable",
      episodic: "task_events_when_durable",
      semanticPromotion: "manual",
    },
  },
  "wechat.send": {
    skillVersion: "0.2.0",
    requiredPrimitiveAbi: 1,
    requiredPrimitives: [
      "app.lifecycle",
      "keyboard.press",
      "keyboard.type",
      "ui.query",
      "pointer.click",
    ],
    executionMode: "inline",
    memoryPolicy: {
      working: "runtime",
      staging: "available_when_durable",
      episodic: "task_events_when_durable",
      semanticPromotion: "manual",
    },
  },
  "xhs.publish": {
    skillVersion: "0.2.0",
    requiredPrimitiveAbi: 1,
    requiredPrimitives: ["web.open", "web.transfer", "web.act", "web.query"],
    executionMode: "inline",
    memoryPolicy: {
      working: "runtime",
      staging: "available_when_durable",
      episodic: "task_events_when_durable",
      semanticPromotion: "manual",
    },
  },
  "email.compose": {
    skillVersion: "0.2.0",
    requiredPrimitiveAbi: 1,
    requiredPrimitives: ["web.open", "web.act"],
    executionMode: "inline",
    memoryPolicy: {
      working: "runtime",
      staging: "available_when_durable",
      episodic: "task_events_when_durable",
      semanticPromotion: "manual",
    },
  },
  "media.transcode": {
    skillVersion: "0.2.0",
    requiredPrimitiveAbi: 1,
    requiredPrimitives: ["fs.manage", "sys.exec"],
    executionMode: "inline",
    memoryPolicy: {
      working: "runtime",
      staging: "available_when_durable",
      episodic: "task_events_when_durable",
      semanticPromotion: "manual",
    },
  },
};

const sleep = async (ms: number) =>
  await new Promise((resolve) => setTimeout(resolve, ms));

function requiredText(args: JsonObject, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required skill argument "${key}".`);
  }
  return value.trim();
}

function optionalBoolean(args: JsonObject, key: string, fallback: boolean): boolean {
  const value = args[key];
  return typeof value === "boolean" ? value : fallback;
}

function requiredNumber(args: JsonObject, key: string): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Missing required numeric skill argument "${key}".`);
  }
  return value;
}

function parsePrimitiveTaskSteps(
  raw: unknown,
  owner: string,
): PrimitiveTaskStep[] {
  const rawSteps = Array.isArray(raw) ? raw : [];
  if (rawSteps.length === 0) {
    throw new Error(`${owner} requires at least one Primitive step.`);
  }
  if (rawSteps.length > 50) {
    throw new Error(`${owner} accepts at most 50 Primitive steps.`);
  }

  return rawSteps.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Invalid Primitive task step at index ${index}.`);
    }
    const value = item as Record<string, unknown>;
    const id = typeof value.id === "string" ? value.id.trim() : "";
    const primitive =
      typeof value.primitive === "string" ? value.primitive.trim() : "";
    const op = typeof value.op === "string" ? value.op.trim() : "";

    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      throw new Error(
        `Invalid Primitive task step id at index ${index}: "${id}".`,
      );
    }
    if (!primitive) throw new Error(`Missing primitive for task step "${id}".`);
    if (!op) throw new Error(`Missing op for task step "${id}".`);

    const stepArgs =
      value.args && typeof value.args === "object" && !Array.isArray(value.args)
        ? (value.args as JsonObject)
        : {};
    const dependsOnRaw = Array.isArray(value.depends_on)
      ? value.depends_on
      : Array.isArray(value.dependsOn)
        ? value.dependsOn
        : [];
    const dependsOn = dependsOnRaw.filter(
      (dependency): dependency is string => typeof dependency === "string",
    );

    return { id, primitive, op, args: stepArgs, dependsOn };
  });
}

function parseScheduleTrigger(args: JsonObject): ScheduleTrigger {
  const raw =
    args.trigger && typeof args.trigger === "object" && !Array.isArray(args.trigger)
      ? (args.trigger as Record<string, unknown>)
      : args;
  const kind =
    typeof raw.kind === "string"
      ? raw.kind
      : typeof raw.trigger_kind === "string"
        ? raw.trigger_kind
        : "";

  if (kind === "once") {
    const at =
      typeof raw.at === "string"
        ? raw.at
        : typeof raw.start_at === "string"
          ? raw.start_at
          : "";
    if (!at) throw new Error("once schedule requires trigger.at.");
    return { kind: "once", at };
  }

  if (kind === "interval") {
    const every =
      typeof raw.every_ms === "number"
        ? raw.every_ms
        : typeof raw.everyMs === "number"
          ? raw.everyMs
          : typeof args.every_ms === "number"
            ? args.every_ms
            : undefined;
    if (every === undefined) {
      throw new Error("interval schedule requires every_ms.");
    }
    const startAt =
      typeof raw.start_at === "string"
        ? raw.start_at
        : typeof raw.startAt === "string"
          ? raw.startAt
          : optionalBoolean(args, "start_immediately", false)
            ? new Date().toISOString()
            : undefined;
    return {
      kind: "interval",
      everyMs: every,
      ...(startAt ? { startAt } : {}),
    };
  }

  if (kind === "daily") {
    const time =
      typeof raw.time === "string"
        ? raw.time
        : typeof raw.daily_at === "string"
          ? raw.daily_at
          : typeof args.daily_at === "string"
            ? args.daily_at
            : "";
    if (!time) throw new Error('daily schedule requires local time "HH:MM".');
    return { kind: "daily", time };
  }

  throw new Error('trigger.kind must be "once", "interval", or "daily".');
}

function parseStopWhen(args: JsonObject): ScheduleStopWhen | undefined {
  const raw =
    args.stop_when &&
    typeof args.stop_when === "object" &&
    !Array.isArray(args.stop_when)
      ? (args.stop_when as Record<string, unknown>)
      : null;
  if (!raw) return undefined;

  const ref = typeof raw.ref === "string" ? raw.ref.trim() : "";
  if (!ref) throw new Error("stop_when.ref is required.");
  const stop: ScheduleStopWhen = { ref };
  if (Object.prototype.hasOwnProperty.call(raw, "equals")) {
    stop.equals = raw.equals;
  }
  if (typeof raw.truthy === "boolean") stop.truthy = raw.truthy;
  return stop;
}

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

async function callPrimitive(
  primitive: string,
  op: string,
  args: JsonObject,
  bypassResourceKeys: string[] = [],
) {
  return (
    await executePrimitive(primitive, op, args, {
      bypassResourceKeys,
    })
  ).result;
}

async function withSkillResources<T>(
  skill: string,
  contract: SkillContract,
  operation: (heldKeys: string[]) => Promise<T>,
): Promise<T> {
  const lease = await resourceArbiter.acquire(skill, contract.resources);
  const heldKeys = lease.resources.map((item) => item.key);
  try {
    return await operation(heldKeys);
  } finally {
    lease.release();
  }
}

const DURABLE_TASK_CONTRACT: SkillContract = {
  riskLevel: "medium",
  idempotent: false,
  sideEffects: ["persistent_task_creation", "staging_creation"],
  requiresVerification: false,
  retryPolicy: "automatic",
  resources: [],
};

const SCHEDULER_CONTRACT: SkillContract = {
  riskLevel: "medium",
  idempotent: false,
  sideEffects: ["schedule_mutation", "persistent_task_creation"],
  requiresVerification: false,
  retryPolicy: "manual",
  resources: [],
};

const WECHAT_READ_CONTRACT: SkillContract = {
  riskLevel: "medium",
  idempotent: true,
  sideEffects: ["window_focus"],
  requiresVerification: false,
  retryPolicy: "automatic",
  resources: [
    { key: "desktop.focus", mode: "exclusive" },
    { key: "desktop.accessibility", mode: "shared" },
  ],
};

const WECHAT_COPY_AT_CONTRACT: SkillContract = {
  riskLevel: "medium",
  idempotent: true,
  sideEffects: ["window_focus", "ui_selection", "clipboard_capture"],
  requiresVerification: false,
  retryPolicy: "automatic",
  resources: [
    { key: "desktop.focus", mode: "exclusive" },
    { key: "desktop.input", mode: "exclusive" },
    { key: "desktop.clipboard", mode: "exclusive" },
  ],
};

const WECHAT_SEND_CONTRACT: SkillContract = {
  riskLevel: "high",
  idempotent: false,
  sideEffects: ["external_message", "window_focus", "keyboard_input"],
  requiresVerification: true,
  retryPolicy: "manual",
  resources: [
    { key: "desktop.focus", mode: "exclusive" },
    { key: "desktop.input", mode: "exclusive" },
    { key: "desktop.accessibility", mode: "exclusive" },
  ],
};

const BROWSER_PUBLISH_CONTRACT: SkillContract = {
  riskLevel: "high",
  idempotent: false,
  sideEffects: ["external_publish", "web_form_mutation"],
  requiresVerification: true,
  retryPolicy: "manual",
  resources: [{ key: "browser.session", mode: "exclusive" }],
};

const EMAIL_CONTRACT: SkillContract = {
  riskLevel: "high",
  idempotent: false,
  sideEffects: ["external_message", "web_form_mutation"],
  requiresVerification: true,
  retryPolicy: "manual",
  resources: [{ key: "browser.session", mode: "exclusive" }],
};

const MEDIA_CONTRACT: SkillContract = {
  riskLevel: "medium",
  idempotent: true,
  sideEffects: ["file_creation"],
  requiresVerification: false,
  retryPolicy: "automatic",
  resources: [{ key: "shell", mode: "exclusive" }],
};

const skills: SkillDefinition[] = [
  {
    id: "runtime.compile_task",
    domain: "runtime",
    description:
      "Compile a complex Primitive graph into an encrypted persistent task with Working Memory, Staging, Episodic events, pause/resume, and crash recovery.",
    keywords: [
      "durable",
      "persistent task",
      "complex task",
      "workflow",
      "复杂任务",
      "持久任务",
      "staging",
      "memory",
    ],
    contract: DURABLE_TASK_CONTRACT,
    inputs: {
      label: "Human-readable task label.",
      steps:
        "Array of Primitive steps: {id, primitive, op, args?, depends_on?}. $ref dependencies are supported.",
      max_concurrency: "Maximum parallel Primitive steps; default 4, max 8.",
      fail_fast: "Stop after the first failed execution wave; default true.",
    },
    dryRunPlan: (args) => ({
      durable: true,
      primitiveAbi: PRIMITIVE_ABI_VERSION,
      label: args.label ?? null,
      stepCount: Array.isArray(args.steps) ? args.steps.length : 0,
      steps: Array.isArray(args.steps) ? args.steps : [],
      memory: ["working", "staging", "episodic"],
      semanticPromotion: "manual",
    }),
    run: async (args) => {
      const label = requiredText(args, "label");
      const steps = parsePrimitiveTaskSteps(args.steps, "runtime.compile_task");

      return await createPersistentPrimitiveTask(label, steps, {
        maxConcurrency:
          typeof args.max_concurrency === "number"
            ? Math.min(Math.max(Math.trunc(args.max_concurrency), 1), 8)
            : 4,
        failFast: optionalBoolean(args, "fail_fast", true),
      });
    },
  },
  {
    id: "runtime.schedule",
    domain: "runtime",
    description:
      "Create, inspect, cancel, or delete persistent wake schedules that run Primitive graphs after the current ChatGPT/MCP request has ended.",
    keywords: [
      "schedule",
      "scheduler",
      "cron",
      "monitor",
      "watch",
      "定时",
      "监控",
      "循环",
      "wake",
    ],
    contract: SCHEDULER_CONTRACT,
    inputs: {
      op: "create | list | status | cancel | delete. Default: create.",
      label: "Human-readable schedule label for create.",
      trigger:
        'Trigger object: {kind:"once",at}, {kind:"interval",every_ms,start_at?}, or {kind:"daily",time:"HH:MM"}. Daily uses the computer local timezone.',
      steps:
        "Primitive graph template executed on every occurrence. A fresh Persistent Primitive Task is created for each occurrence.",
      stop_when:
        "Optional terminal condition: {ref:'stepId.path', equals:value} or {ref:'stepId.path', truthy:true|false}.",
      max_runs: "Optional maximum completed occurrences.",
      end_at: "Optional ISO date/time after which no new occurrence runs.",
      schedule_id: "Required for status/cancel/delete.",
    },
    dryRunPlan: (args) => ({
      durable: true,
      op: typeof args.op === "string" ? args.op : "create",
      label: args.label ?? null,
      trigger: args.trigger ?? null,
      stepCount: Array.isArray(args.steps) ? args.steps.length : 0,
      wakeModel: "persistent_local_scheduler",
      survivesMcpRequest: true,
      survivesRuntimeRestart: true,
    }),
    run: async (args) => {
      const operation =
        typeof args.op === "string" ? args.op.trim().toLowerCase() : "create";

      if (operation === "list") {
        return await listPersistentSchedules();
      }

      if (["status", "cancel", "delete"].includes(operation)) {
        const scheduleId = requiredText(args, "schedule_id");
        if (operation === "status") {
          return await getPersistentSchedule(scheduleId);
        }
        if (operation === "cancel") {
          return await cancelPersistentSchedule(scheduleId);
        }
        return await deletePersistentSchedule(scheduleId);
      }

      if (operation !== "create") {
        throw new Error(
          'runtime.schedule op must be "create", "list", "status", "cancel", or "delete".',
        );
      }

      const label = requiredText(args, "label");
      const steps = parsePrimitiveTaskSteps(args.steps, "runtime.schedule");
      const trigger = parseScheduleTrigger(args);
      const stopWhen = parseStopWhen(args);

      return await createPrimitiveSchedule({
        label,
        trigger,
        steps,
        taskLabel:
          typeof args.task_label === "string" ? args.task_label.trim() : label,
        maxConcurrency:
          typeof args.max_concurrency === "number"
            ? args.max_concurrency
            : undefined,
        failFast: optionalBoolean(args, "fail_fast", true),
        maxWaves:
          typeof args.max_waves === "number" ? args.max_waves : undefined,
        timeBudgetMs:
          typeof args.time_budget_ms === "number"
            ? args.time_budget_ms
            : undefined,
        ...(stopWhen ? { stopWhen } : {}),
        maxRuns:
          typeof args.max_runs === "number" ? args.max_runs : undefined,
        endAt: typeof args.end_at === "string" ? args.end_at : undefined,
      });
    },
  },
  {
    id: "wechat.read",
    domain: "communication",
    description:
      "Read WeChat with a clipboard-first fast path, falling back to Accessibility and optional screenshot perception.",
    keywords: ["wechat", "微信", "消息", "聊天", "read message"],
    contract: WECHAT_READ_CONTRACT,
    inputs: {
      clipboard_first: "Try Cmd+C on the current WeChat selection first; default true.",
      clipboard_timeout_ms: "Clipboard copy timeout in milliseconds; default 1200.",
      clipboard_only: "If true, return after the clipboard attempt without Accessibility fallback.",
      max_elements: "Maximum accessibility elements to scan (default 700).",
      screenshot_path: "Optional allowed output path for a WeChat window screenshot.",
    },
    dryRunPlan: (args) => ({
      steps: [
        {
          primitive: "app.lifecycle",
          op: "launch",
          args: { app_name: "com.tencent.xinWeChat" },
        },
        ...(optionalBoolean(args, "clipboard_first", true)
          ? [
              {
                primitive: "clipboard",
                op: "copy_selection",
                args: {
                  timeout_ms: args.clipboard_timeout_ms ?? 1200,
                  restore: true,
                },
              },
            ]
          : []),
        ...(!optionalBoolean(args, "clipboard_only", false)
          ? [
              {
                primitive: "ui.query",
                op: "tree",
                args: { app_name: "com.tencent.xinWeChat", max_elements: args.max_elements ?? 700 },
              },
            ]
          : []),
        ...(typeof args.screenshot_path === "string"
          ? [
              {
                primitive: "app.lifecycle",
                op: "bounds",
                args: { app_name: "com.tencent.xinWeChat" },
              },
              {
                primitive: "vision.capture",
                op: "region",
                args: "derived from window bounds",
              },
            ]
          : []),
      ],
    }),
    run: async (args) =>
      await withSkillResources("wechat.read", WECHAT_READ_CONTRACT, async (held) => {
        await callPrimitive("app.lifecycle", "launch", { app_name: "com.tencent.xinWeChat" }, held);
        await sleep(350);

        let clipboard: any = null;
        if (optionalBoolean(args, "clipboard_first", true)) {
          try {
            clipboard = await callPrimitive(
              "clipboard",
              "copy_selection",
              {
                timeout_ms:
                  typeof args.clipboard_timeout_ms === "number"
                    ? args.clipboard_timeout_ms
                    : 1200,
                restore: true,
              },
              held,
            );
          } catch (error) {
            clipboard = {
              copied: false,
              restored: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }

        const clipboardText =
          clipboard?.copied &&
          typeof clipboard?.text === "string" &&
          clipboard.text.length > 0
            ? clipboard.text
            : null;

        if (clipboardText && optionalBoolean(args, "clipboard_only", false)) {
          return {
            app: "WeChat",
            source: "clipboard",
            clipboardText,
            clipboard,
            textualElements: [],
            scanned: 0,
            screenshot: null,
            note:
              "Text came directly from the current WeChat selection through the clipboard fast path; the user's previous clipboard was restored with full-fidelity pasteboard data.",
          };
        }

        let tree: any = { elements: [] };
        if (!optionalBoolean(args, "clipboard_only", false)) {
          tree = (await callPrimitive(
            "ui.query",
            "tree",
            {
              app_name: "com.tencent.xinWeChat",
              max_elements:
                typeof args.max_elements === "number" ? args.max_elements : 700,
            },
            held,
          )) as any;
        }

        let screenshot: unknown = null;
        if (typeof args.screenshot_path === "string" && args.screenshot_path.trim()) {
          const bounds = (await callPrimitive(
            "app.lifecycle",
            "bounds",
            { app_name: "com.tencent.xinWeChat" },
            held,
          )) as any;
          screenshot = await callPrimitive(
            "vision.capture",
            "region",
            {
              path: args.screenshot_path,
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height,
            },
            held,
          );
        }

        const textual = Array.isArray(tree?.elements)
          ? tree.elements
              .filter(
                (item: any) =>
                  item?.name || item?.value || item?.description,
              )
              .slice(0, 180)
          : [];

        return {
          app: "WeChat",
          source: clipboardText ? "clipboard+accessibility" : "accessibility",
          clipboardText,
          clipboard,
          textualElements: textual,
          scanned: tree?.elements?.length ?? 0,
          screenshot,
          note: clipboardText
            ? "Clipboard fast path captured selected WeChat text and restored the previous clipboard with full-fidelity pasteboard data; Accessibility remains available as structural context."
            : "No clipboard selection was captured, so Accessibility is the primary text/structure source. If WeChat hides message text, use the optional screenshot with a vision-capable client.",
        };
      }),
  },
  {
    id: "wechat.copy_selected",
    domain: "communication",
    description:
      "Copy the currently selected WeChat text through the clipboard and restore the user's previous clipboard with full-fidelity pasteboard data.",
    keywords: ["wechat", "微信", "复制", "clipboard", "selected message"],
    contract: {
      riskLevel: "medium",
      idempotent: true,
      sideEffects: ["window_focus", "clipboard_capture"],
      requiresVerification: false,
      retryPolicy: "automatic",
      resources: [
        { key: "desktop.focus", mode: "exclusive" },
        { key: "desktop.input", mode: "exclusive" },
        { key: "desktop.clipboard", mode: "exclusive" },
      ],
    },
    inputs: {
      timeout_ms: "Clipboard copy timeout in milliseconds; default 1500.",
    },
    dryRunPlan: (args) => ({
      steps: [
        {
          primitive: "app.lifecycle",
          op: "launch",
          args: { app_name: "com.tencent.xinWeChat" },
        },
        {
          primitive: "clipboard",
          op: "copy_selection",
          args: { timeout_ms: args.timeout_ms ?? 1500, restore: true },
        },
      ],
    }),
    run: async (args) => {
      const contract = {
        riskLevel: "medium" as const,
        idempotent: true,
        sideEffects: ["window_focus", "clipboard_capture"],
        requiresVerification: false,
        retryPolicy: "automatic" as const,
        resources: [
          { key: "desktop.focus", mode: "exclusive" as const },
          { key: "desktop.input", mode: "exclusive" as const },
          { key: "desktop.clipboard", mode: "exclusive" as const },
        ],
      };
      return await withSkillResources(
        "wechat.copy_selected",
        contract,
        async (held) => {
          await callPrimitive("app.lifecycle", "launch", { app_name: "com.tencent.xinWeChat" }, held);
          await sleep(250);
          return await callPrimitive(
            "clipboard",
            "copy_selection",
            {
              timeout_ms:
                typeof args.timeout_ms === "number" ? args.timeout_ms : 1500,
              restore: true,
            },
            held,
          );
        },
      );
    },
  },
  {
    id: "wechat.copy_at",
    domain: "communication",
    description:
      "Click a visible WeChat text message multiple times (triple-click by default), copy its exact text through the clipboard, and restore the user's previous clipboard.",
    keywords: ["wechat", "微信", "复制", "clipboard", "visible message", "坐标"],
    contract: WECHAT_COPY_AT_CONTRACT,
    inputs: {
      x: "macOS logical screen X coordinate for a visible text message.",
      y: "macOS logical screen Y coordinate for a visible text message.",
      timeout_ms: "Clipboard copy timeout in milliseconds; default 1500.",
      click_count: "Number of rapid clicks before copy; default 3 because WeChat triple-click selects the whole text message.",
      click_interval_ms: "Delay between rapid clicks; default 80 ms.",
    },
    dryRunPlan: (args) => ({
      steps: [
        {
          primitive: "app.lifecycle",
          op: "launch",
          args: { app_name: "com.tencent.xinWeChat" },
        },
        {
          primitive: "pointer.click",
          op: "coordinate",
          args: {
            x: args.x,
            y: args.y,
            repeat: args.click_count ?? 3,
            interval_ms: args.click_interval_ms ?? 80,
          },
        },
        {
          primitive: "clipboard",
          op: "copy_selection",
          args: { timeout_ms: args.timeout_ms ?? 1500, restore: true },
        },
      ],
    }),
    run: async (args) => {
      const x = requiredNumber(args, "x");
      const y = requiredNumber(args, "y");
      const clickCount =
        typeof args.click_count === "number"
          ? Math.min(Math.max(Math.trunc(args.click_count), 1), 4)
          : 3;
      const clickIntervalMs =
        typeof args.click_interval_ms === "number"
          ? Math.min(Math.max(args.click_interval_ms, 20), 500)
          : 80;
      const timeoutMs =
        typeof args.timeout_ms === "number"
          ? Math.min(Math.max(args.timeout_ms, 100), 30_000)
          : 1500;

      return await withSkillResources(
        "wechat.copy_at",
        WECHAT_COPY_AT_CONTRACT,
        async (held) => {
          await callPrimitive(
            "app.lifecycle",
            "launch",
            { app_name: "com.tencent.xinWeChat" },
            held,
          );
          await sleep(250);

          for (let index = 0; index < clickCount; index += 1) {
            await callPrimitive("pointer.click", "coordinate", { x, y }, held);
            if (index + 1 < clickCount) await sleep(clickIntervalMs);
          }
          await sleep(120);

          const clipboard = await callPrimitive(
            "clipboard",
            "copy_selection",
            { timeout_ms: timeoutMs, restore: true },
            held,
          );

          return {
            x,
            y,
            clickCount,
            clickIntervalMs,
            clipboard,
            note:
              "This Skill is designed for visual-model workflows: inspect a desktop screenshot, choose a visible text-message coordinate, then call wechat.copy_at to obtain exact clipboard text.",
          };
        },
      );
    },
  },
  {
    id: "wechat.read_points",
    domain: "communication",
    description:
      "Read multiple visible WeChat text messages from screenshot-derived macOS screen coordinates using triple-click plus clipboard capture.",
    keywords: [
      "wechat",
      "微信",
      "读取消息",
      "visible messages",
      "clipboard",
      "screenshot coordinates",
    ],
    contract: WECHAT_COPY_AT_CONTRACT,
    inputs: {
      points:
        "Array of up to 20 macOS logical screen coordinate objects: [{x,y}, ...].",
      timeout_ms: "Clipboard copy timeout per point; default 1500.",
      click_count:
        "Rapid clicks per point; default 3 because WeChat triple-click selects the whole message text.",
      click_interval_ms: "Delay between rapid clicks; default 80 ms.",
    },
    dryRunPlan: (args) => ({
      steps: [
        {
          primitive: "app.lifecycle",
          op: "launch",
          args: { app_name: "com.tencent.xinWeChat" },
        },
        {
          action: "repeat",
          points: Array.isArray(args.points) ? args.points : [],
          perPoint: [
            "rapid click message coordinate",
            "Cmd+C",
            "read clipboard",
            "restore prior clipboard",
          ],
        },
      ],
    }),
    run: async (args) => {
      const rawPoints = Array.isArray(args.points) ? args.points : [];
      const points = rawPoints
        .slice(0, 20)
        .map((point, index) => {
          if (!point || typeof point !== "object") {
            throw new Error(`Invalid WeChat point at index ${index}.`);
          }
          const value = point as Record<string, unknown>;
          const x = value.x;
          const y = value.y;
          if (
            typeof x !== "number" ||
            !Number.isFinite(x) ||
            typeof y !== "number" ||
            !Number.isFinite(y)
          ) {
            throw new Error(
              `WeChat point ${index} must contain finite numeric x/y values.`,
            );
          }
          return { x, y };
        });

      if (points.length === 0) {
        throw new Error("wechat.read_points requires at least one coordinate.");
      }

      const clickCount =
        typeof args.click_count === "number"
          ? Math.min(Math.max(Math.trunc(args.click_count), 1), 4)
          : 3;
      const clickIntervalMs =
        typeof args.click_interval_ms === "number"
          ? Math.min(Math.max(args.click_interval_ms, 20), 500)
          : 80;
      const timeoutMs =
        typeof args.timeout_ms === "number"
          ? Math.min(Math.max(args.timeout_ms, 100), 30_000)
          : 1500;

      return await withSkillResources(
        "wechat.read_points",
        WECHAT_COPY_AT_CONTRACT,
        async (held) => {
          await callPrimitive(
            "app.lifecycle",
            "launch",
            { app_name: "com.tencent.xinWeChat" },
            held,
          );
          await sleep(250);

          const results: Array<Record<string, unknown>> = [];
          const seen = new Set<string>();

          for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
            const point = points[pointIndex]!;
            try {
              for (let index = 0; index < clickCount; index += 1) {
                await callPrimitive("pointer.click", "coordinate", point, held);
                if (index + 1 < clickCount) await sleep(clickIntervalMs);
              }
              await sleep(120);

              const clipboard = (await callPrimitive(
                "clipboard",
                "copy_selection",
                { timeout_ms: timeoutMs, restore: true },
                held,
              )) as any;

              const text =
                clipboard?.copied && typeof clipboard?.text === "string"
                  ? clipboard.text.trim()
                  : "";

              const duplicate = Boolean(text && seen.has(text));
              if (text) seen.add(text);

              results.push({
                pointIndex,
                ...point,
                copied: Boolean(text),
                duplicate,
                text: text || null,
                characters: text.length,
                reason: text ? null : clipboard?.reason ?? "No text copied.",
              });
            } catch (error) {
              results.push({
                pointIndex,
                ...point,
                copied: false,
                duplicate: false,
                text: null,
                characters: 0,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }

          return {
            requested: points.length,
            copied: results.filter((item) => item.copied).length,
            uniqueTexts: [...seen],
            results,
            clickCount,
            clickIntervalMs,
            note:
              "Coordinates should come from a recent desktop screenshot. The Skill restores the user's prior clipboard after every message capture.",
          };
        },
      );
    },
  },
  {
    id: "wechat.send",
    domain: "communication",
    description:
      "Navigate to a WeChat contact, verify an exact accessibility match, and optionally send a message.",
    keywords: ["wechat", "微信", "回复", "发送消息", "reply"],
    contract: WECHAT_SEND_CONTRACT,
    inputs: {
      contact_name: "Exact WeChat contact name.",
      message: "Message text.",
      send: "Must be true to physically type and send; default false prepares and verifies only.",
    },
    dryRunPlan: (args) => ({
      steps: [
        "focus WeChat",
        "Cmd+1",
        "Cmd+F",
        `search contact: ${String(args.contact_name ?? "")}`,
        "verify exact accessibility text match",
        optionalBoolean(args, "send", false)
          ? "focus message area, paste message, press Return"
          : "stop before typing/sending",
      ],
    }),
    run: async (args) => {
      const contactName = requiredText(args, "contact_name");
      const message = requiredText(args, "message");
      const shouldSend = optionalBoolean(args, "send", false);

      return await withSkillResources("wechat.send", WECHAT_SEND_CONTRACT, async (held) => {
        await callPrimitive("app.lifecycle", "launch", { app_name: "com.tencent.xinWeChat" }, held);
        await sleep(300);
        await callPrimitive(
          "keyboard.press",
          "key",
          { key: "1", modifiers: ["command"] },
          held,
        );
        await sleep(250);
        await callPrimitive(
          "keyboard.press",
          "key",
          { key: "f", modifiers: ["command"] },
          held,
        );
        await sleep(250);
        await callPrimitive("keyboard.type", "text", { text: contactName }, held);
        await sleep(700);
        await callPrimitive("keyboard.press", "key", { key: "return" }, held);
        await sleep(600);

        const bounds = (await callPrimitive(
          "app.lifecycle",
          "bounds",
          { app_name: "com.tencent.xinWeChat" },
          held,
        )) as any;
        const verification = (await callPrimitive(
          "ui.query",
          "find",
          {
            app_name: "com.tencent.xinWeChat",
            query: contactName,
            max_results: 30,
            max_elements: 800,
          },
          held,
        )) as any;

        const exact = Array.isArray(verification?.matches)
          ? verification.matches.filter((item: any) =>
              [item?.name, item?.value, item?.description]
                .filter((value: unknown) => typeof value === "string")
                .some(
                  (value: string) =>
                    value.trim().toLowerCase() === contactName.toLowerCase(),
                ),
            )
          : [];
        const headerMatches = exact.filter((item: any) => {
          if (typeof item?.x !== "number" || typeof item?.y !== "number") return false;
          const centerX = item.x + Math.max(Number(item.width) || 0, 1) / 2;
          const centerY = item.y + Math.max(Number(item.height) || 0, 1) / 2;
          return (
            centerX >= bounds.x + bounds.width * 0.4 &&
            centerY <= bounds.y + bounds.height * 0.28
          );
        });

        if (headerMatches.length === 0) {
          throw new Error(
            `WeChat active-chat verification failed for "${contactName}". An exact name was not found in the main chat header region; refusing to type or send.`,
          );
        }

        if (!shouldSend) {
          return {
            prepared: true,
            sent: false,
            contactName,
            verification: headerMatches.slice(0, 5),
            note: "The active chat header was verified. Set send=true only when you want to physically send the message.",
          };
        }

        const inputX = Math.round(bounds.x + bounds.width * 0.72);
        const inputY = Math.round(bounds.y + bounds.height * 0.84);
        await callPrimitive("pointer.click", "coordinate", { x: inputX, y: inputY }, held);
        await sleep(150);
        await callPrimitive("keyboard.type", "text", { text: message }, held);
        await sleep(250);
        await callPrimitive("keyboard.press", "key", { key: "return" }, held);

        return {
          prepared: true,
          sent: true,
          contactName,
          characters: message.length,
          verification: headerMatches.slice(0, 5),
        };
      });
    },
  },
  {
    id: "xhs.publish",
    domain: "publishing",
    description:
      "Prepare or publish a Xiaohongshu web note using the managed browser and local asset upload.",
    keywords: ["xhs", "xiaohongshu", "小红书", "笔记", "publish"],
    contract: BROWSER_PUBLISH_CONTRACT,
    inputs: {
      title: "Note title.",
      content: "Note body.",
      images: "Array of local image paths inside ALLOWED_DIRECTORIES.",
      publish: "Must be true to click the final publish button; default false.",
      headless: "Run managed Chrome headlessly; default true.",
    },
    dryRunPlan: (args) => ({
      url: "https://creator.xiaohongshu.com/publish/publish",
      headless: optionalBoolean(args, "headless", true),
      uploadCount: Array.isArray(args.images) ? args.images.length : 0,
      finalPublishClick: optionalBoolean(args, "publish", false),
    }),
    run: async (args) => {
      const title = requiredText(args, "title");
      const content = requiredText(args, "content");
      const images = Array.isArray(args.images)
        ? args.images.filter((item): item is string => typeof item === "string")
        : [];
      const publish = optionalBoolean(args, "publish", false);
      const headless = optionalBoolean(args, "headless", true);

      return await withSkillResources("xhs.publish", BROWSER_PUBLISH_CONTRACT, async (held) => {
        await callPrimitive(
          "web.open",
          "navigate",
          {
            url: "https://creator.xiaohongshu.com/publish/publish",
            wait_until: "domcontentloaded",
            headless,
          },
          held,
        );
        await sleep(1200);

        if (images.length > 0) {
          await callPrimitive(
            "web.transfer",
            "upload",
            {
              selector: 'input[type="file"]',
              files: images,
            },
            held,
          );
          await sleep(1000);
        }

        await callPrimitive(
          "web.act",
          "type",
          {
            selector:
              'input[placeholder*="标题"], input[placeholder*="title" i], input[type="text"]',
            text: title,
          },
          held,
        );

        await callPrimitive(
          "web.act",
          "type",
          {
            selector:
              'div[contenteditable="true"], textarea[placeholder*="正文"], textarea',
            text: content,
          },
          held,
        );

        if (!publish) {
          return {
            prepared: true,
            published: false,
            title,
            imageCount: images.length,
            headless,
            note: "Form prepared but final publish button was not clicked.",
          };
        }

        const selectors = [
          'button:has-text("发布")',
          'text="发布"',
          'button:has-text("Publish")',
          'button:has-text("Veröffentlichen")',
        ];
        let lastError = "";
        let clicked = false;
        for (const selector of selectors) {
          try {
            await callPrimitive("web.act", "click", { selector }, held);
            clicked = true;
            break;
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
          }
        }
        if (!clicked) {
          throw new Error(
            `Could not locate the Xiaohongshu publish button. ${lastError}`,
          );
        }

        await sleep(1200);
        const snapshot = await callPrimitive(
          "web.query",
          "snapshot",
          { max_chars: 6000 },
          held,
        );
        return {
          prepared: true,
          published: true,
          title,
          imageCount: images.length,
          headless,
          snapshot,
        };
      });
    },
  },
  {
    id: "email.compose",
    domain: "communication",
    description:
      "Prepare or send a Gmail web message through the managed browser.",
    keywords: ["email", "mail", "gmail", "邮件", "邮箱", "回复邮件"],
    contract: EMAIL_CONTRACT,
    inputs: {
      to: "Recipient email address.",
      subject: "Message subject.",
      body: "Message body.",
      send: "Must be true to click Send; default false leaves Gmail draft open.",
      headless: "Run managed Chrome headlessly; default true.",
    },
    dryRunPlan: (args) => ({
      url: "https://mail.google.com/mail/u/0/#inbox?compose=new",
      recipient: args.to ?? null,
      finalSendClick: optionalBoolean(args, "send", false),
      headless: optionalBoolean(args, "headless", true),
    }),
    run: async (args) => {
      const to = requiredText(args, "to");
      const subject = requiredText(args, "subject");
      const body = requiredText(args, "body");
      const send = optionalBoolean(args, "send", false);
      const headless = optionalBoolean(args, "headless", true);

      return await withSkillResources("email.compose", EMAIL_CONTRACT, async (held) => {
        await callPrimitive(
          "web.open",
          "navigate",
          {
            url: "https://mail.google.com/mail/u/0/#inbox?compose=new",
            wait_until: "domcontentloaded",
            headless,
          },
          held,
        );
        await sleep(1200);

        await callPrimitive(
          "web.act",
          "type",
          {
            selector:
              'input[peoplekit-id], input[aria-label^="To"], input[aria-label*="Recipients"], input[role="combobox"]',
            text: to,
            submit: true,
          },
          held,
        );
        await callPrimitive(
          "web.act",
          "type",
          {
            selector: 'input[name="subjectbox"]',
            text: subject,
          },
          held,
        );
        await callPrimitive(
          "web.act",
          "type",
          {
            selector:
              'div[aria-label="Message Body"], div[role="textbox"][contenteditable="true"]',
            text: body,
          },
          held,
        );

        if (!send) {
          return {
            prepared: true,
            sent: false,
            to,
            subject,
            headless,
            note: "Gmail draft prepared; final Send action was not triggered.",
          };
        }

        const selectors = [
          '[data-tooltip^="Send"]',
          '[aria-label^="Send"]',
          'div[role="button"]:has-text("Send")',
          'div[role="button"]:has-text("发送")',
          'div[role="button"]:has-text("Senden")',
        ];

        let lastError = "";
        let clicked = false;
        for (const selector of selectors) {
          try {
            await callPrimitive("web.act", "click", { selector }, held);
            clicked = true;
            break;
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
          }
        }
        if (!clicked) {
          throw new Error(`Could not locate Gmail Send control. ${lastError}`);
        }

        await sleep(800);
        return { prepared: true, sent: true, to, subject, headless };
      });
    },
  },
  {
    id: "media.transcode",
    domain: "media",
    description:
      "Transcode, trim, compress, crop to vertical/square, or extract audio with FFmpeg.",
    keywords: ["media", "video", "ffmpeg", "视频", "剪辑", "转码", "压缩"],
    contract: MEDIA_CONTRACT,
    inputs: {
      input_path: "Existing input file inside ALLOWED_DIRECTORIES.",
      output_path: "Output path inside ALLOWED_DIRECTORIES.",
      mode: "copy | compress | vertical | square | audio",
      start_seconds: "Optional trim start.",
      duration_seconds: "Optional trim duration.",
    },
    dryRunPlan: (args) => ({
      mode: args.mode ?? "compress",
      input: args.input_path ?? null,
      output: args.output_path ?? null,
      engine: "ffmpeg",
    }),
    run: async (args) => {
      const inputPath = await assertAllowedExistingPath(
        requiredText(args, "input_path"),
      );
      const outputPath = await assertAllowedTargetPath(
        requiredText(args, "output_path"),
      );
      const mode =
        typeof args.mode === "string" ? args.mode.trim().toLowerCase() : "compress";
      if (!["copy", "compress", "vertical", "square", "audio"].includes(mode)) {
        throw new Error("Unsupported media mode.");
      }

      const parent = path.dirname(outputPath);
      await callPrimitive("fs.manage", "mkdir", { path: parent, recursive: true });

      const prefix: string[] = ["ffmpeg", "-y"];
      if (typeof args.start_seconds === "number" && args.start_seconds >= 0) {
        prefix.push("-ss", String(args.start_seconds));
      }
      prefix.push("-i", inputPath);
      if (typeof args.duration_seconds === "number" && args.duration_seconds > 0) {
        prefix.push("-t", String(args.duration_seconds));
      }

      if (mode === "copy") {
        prefix.push("-c", "copy");
      } else if (mode === "compress") {
        prefix.push(
          "-c:v",
          "libx264",
          "-crf",
          "23",
          "-preset",
          "medium",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
        );
      } else if (mode === "vertical") {
        prefix.push(
          "-vf",
          "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
          "-c:v",
          "libx264",
          "-crf",
          "21",
          "-c:a",
          "aac",
        );
      } else if (mode === "square") {
        prefix.push(
          "-vf",
          "scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080",
          "-c:v",
          "libx264",
          "-crf",
          "21",
          "-c:a",
          "aac",
        );
      } else if (mode === "audio") {
        prefix.push("-vn", "-c:a", "aac", "-b:a", "192k");
      }
      prefix.push(outputPath);

      const command = prefix.map(shellQuote).join(" ");

      return await withSkillResources(
        "media.transcode",
        MEDIA_CONTRACT,
        async (held) => {
          const shellResult = await callPrimitive(
            "sys.exec",
            "run",
            {
              command,
              cwd: parent,
              timeout_ms: 600000,
            },
            held,
          );
          return {
            mode,
            inputPath,
            outputPath,
            command,
            shellResult,
          };
        },
      );
    },
  },
];

const byId = new Map(skills.map((skill) => [skill.id, skill]));

function metadataForSkill(skill: SkillDefinition): SkillRuntimeMetadata {
  const metadata = SKILL_RUNTIME_METADATA[skill.id];
  if (!metadata) {
    throw new Error(`Missing Skill Runtime metadata for "${skill.id}".`);
  }
  return metadata;
}

function assertSkillCompatibility(skill: SkillDefinition): SkillRuntimeMetadata {
  const metadata = metadataForSkill(skill);
  if (metadata.requiredPrimitiveAbi > PRIMITIVE_ABI_VERSION) {
    throw new Error(
      `Skill "${skill.id}" requires Primitive ABI ${metadata.requiredPrimitiveAbi}, but runtime ABI is ${PRIMITIVE_ABI_VERSION}.`,
    );
  }

  const available = new Set(
    getPrimitiveCatalog()
      .filter((entry: any) => entry.canonical === true)
      .map((entry: any) => entry.id),
  );
  const missing = metadata.requiredPrimitives.filter(
    (primitive) => !available.has(primitive),
  );
  if (missing.length > 0) {
    throw new Error(
      `Skill "${skill.id}" requires unavailable Primitive(s): ${missing.join(", ")}.`,
    );
  }
  return metadata;
}

export function getSkillCatalog() {
  return skills.map(
    ({ run: _run, dryRunPlan: _dryRunPlan, keywords: _keywords, ...skill }) => ({
      ...skill,
      ...metadataForSkill(skill as SkillDefinition),
    }),
  );
}

export async function executeSkill(
  skillId: string,
  args: JsonObject = {},
  dryRun = false,
) {
  const skill = byId.get(skillId);
  if (!skill) {
    throw new Error(
      `Unknown skill "${skillId}". Call skill_catalog for supported skills.`,
    );
  }

  const runtimeMetadata = assertSkillCompatibility(skill);

  if (dryRun) {
    return {
      dryRun: true,
      skill: skill.id,
      domain: skill.domain,
      runtime: runtimeMetadata,
      contract: skill.contract,
      plan: skill.dryRunPlan(args),
    };
  }

  const startedAt = Date.now();
  const result = await skill.run(args);
  return {
    skill: skill.id,
    domain: skill.domain,
    runtime: runtimeMetadata,
    contract: skill.contract,
    durationMs: Date.now() - startedAt,
    result,
  };
}

function skillScore(goal: string, skill: SkillDefinition): number {
  const normalized = goal.toLowerCase();
  let score = 0;
  for (const keyword of skill.keywords) {
    if (normalized.includes(keyword.toLowerCase())) score += 1;
  }
  return score;
}

export async function getCapabilityManifest(goal = "") {
  const recommended = [...skills]
    .map((skill) => ({ skill, score: skillScore(goal, skill) }))
    .filter((item) => !goal.trim() || item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ skill, score }) => ({
      id: skill.id,
      domain: skill.domain,
      description: skill.description,
      inputs: skill.inputs,
      runtime: metadataForSkill(skill),
      contract: skill.contract,
      relevanceScore: score,
    }));

  return {
    goal: goal || null,
    architecture: {
      name: "AgentOS Runtime",
      planner: "ChatGPT",
      layerModel: "L3 Planner → L2 Skill → L1 Primitive ISA → L0.5 Action → L0 Provider",
      skillRuntime: "v0.9",
      primitiveAbi: {
        version: 1,
        stability: "candidate",
      },
      skillAbi: {
        runtimeMetadata: [
          "skillVersion",
          "requiredPrimitiveAbi",
          "requiredPrimitives",
          "executionMode",
          "memoryPolicy",
        ],
        executionContract: [
          "riskLevel",
          "idempotent",
          "sideEffects",
          "requiresVerification",
          "retryPolicy",
          "resources",
        ],
      },
      memoryPlane: {
        working: "durable task step outputs + $ref",
        staging: "file-backed task artifacts",
        episodic: "task-local event history",
        semantic: "planned explicit promotion",
      },
      persistentTasks: "v0.8 + v0.9.5 Primitive-task path",
      persistentScheduler: "v0.9.6 wake scheduler + scheduled Primitive graphs",
      dependencyGraph: "v0.7",
      providerRouter: "v0.6",
      providers: "v0.5",
    },
    recommendedSkills: recommended,
    primitives: getPrimitiveCatalog(),
    providers: await getProviderStatuses(),
    guidance:
      "Prefer a matching L2 Skill for known workflows. Use the L1 Primitive ISA for novel composition. Treat sys.exec as a privileged escape hatch, and use routed L0.5 Actions only for debugging or compatibility.",
  };
}
