import { z } from "zod";
import { browserScenarioEventSchema } from "../browserScenarioCaptureValues.js";
import { browserNetworkHeadersSchema } from "../browserNetworkEvidence.js";
import { decodeStrictUtf8, isStrictUtf8 } from "../strictUtf8.js";
import { isJson, mediaTypeEssence } from "./recordedMediaType.js";

type Event = z.output<typeof browserScenarioEventSchema>;
type ContentEvent = Extract<Event, { readonly kind: "network-content" }>;
type CapturedBody = Extract<
  ContentEvent["body"],
  { readonly state: "captured" }
>;

/** Media types whose bytes are text: text/*, JSON, XML, JavaScript and forms. */
export const isTextualMediaType = (reported: string | null): boolean => {
  if (reported === null) return false;
  const essence = mediaTypeEssence(reported);
  if (essence === null) return false;
  return (
    essence.startsWith("text/") ||
    isJson(essence) ||
    essence === "application/xml" ||
    essence.endsWith("+xml") ||
    essence === "application/javascript" ||
    essence === "application/ecmascript" ||
    essence === "application/x-www-form-urlencoded" ||
    essence === "application/graphql"
  );
};

/** The body's bytes as text, when they are valid UTF-8; undefined otherwise. */
const decodeText = (contentBase64: string): string | undefined => {
  const bytes = Buffer.from(contentBase64, "base64");
  // The recorded bytes are kept exactly, a leading BOM included.
  return isStrictUtf8(bytes) ? decodeStrictUtf8(bytes, "preserve") : undefined;
};

/**
 * A captured body delivered as text: the same bytes, digest and media type
 * as the recorded base64 body, decoded as UTF-8.
 */
export const textualBodySchema = z.strictObject({
  state: z.literal("captured"),
  representation: z.enum([
    "browser-exposed-request-bytes",
    "playwright-response-body-bytes",
    "browser-decoded-response-bytes",
  ]),
  encoding: z.literal("utf-8"),
  text: z.string(),
  bytes: z.int().min(0),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  media_type: z.string(),
  media_type_source: z.enum(["content-type-header", "independent"]).optional(),
  redacted: z.boolean(),
});

/** A network-content event whose textual body a view states as text. */
export const textualContentEventSchema = z.strictObject({
  sequence: z.int().min(1),
  step_index: z.int().min(0),
  kind: z.literal("network-content"),
  transaction_id: z.string().min(1),
  source_event_sequence: z.int().min(1),
  phase: z.enum(["request", "response"]),
  headers: browserNetworkHeadersSchema,
  body: textualBodySchema,
});

/**
 * Deliver a captured textual body as text. Bodies whose media type is not
 * textual, or whose bytes are not valid UTF-8, stay base64.
 */
export const withTextualBody = (event: Event): Event | TextualContentEvent => {
  if (event.kind !== "network-content" || event.body.state !== "captured")
    return event;
  const body: CapturedBody = event.body;
  if (!isTextualMediaType(body.media_type) || body.media_type === null)
    return event;
  const text = decodeText(body.content);
  if (text === undefined) return event;
  const { content: _content, encoding: _encoding, ...rest } = body;
  return {
    ...event,
    body: { ...rest, media_type: body.media_type, encoding: "utf-8", text },
  };
};

export type TextualContentEvent = Omit<ContentEvent, "body"> & {
  readonly body: z.output<typeof textualBodySchema>;
};
