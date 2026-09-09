import {
  EventSourceType,
  OsEventTypeList,
} from "@evenrealities/even_hub_sdk";

export type EvenActionKind =
  | "click"
  | "double-click"
  | "scroll-up"
  | "scroll-down"
  | "long-press"
  | "long-press-release";

export type EvenAction = {
  kind: EvenActionKind;
  envelope: "text" | "list" | "system";
  source?: EventSourceType;
  containerId?: number;
  selectedIndex?: number;
};

type RawContainerEvent = {
  eventType?: unknown;
  containerID?: number;
  currentSelectItemIndex?: number;
};

type RawSystemEvent = {
  eventType?: unknown;
  eventSource?: unknown;
};

type RawEvenHubEvent = {
  textEvent?: RawContainerEvent;
  listEvent?: RawContainerEvent;
  sysEvent?: RawSystemEvent;
  [key: string]: unknown;
};

const ACTION_BY_EVENT = new Map<OsEventTypeList, EvenActionKind>([
  [OsEventTypeList.CLICK_EVENT, "click"],
  [OsEventTypeList.DOUBLE_CLICK_EVENT, "double-click"],
  [OsEventTypeList.SCROLL_TOP_EVENT, "scroll-up"],
  [OsEventTypeList.SCROLL_BOTTOM_EVENT, "scroll-down"],
  [OsEventTypeList.LONG_PRESS_EVENT, "long-press"],
  [OsEventTypeList.LONG_PRESS_RELEASE_EVENT, "long-press-release"],
]);

function actionKind(raw: unknown): EvenActionKind | undefined {
  const event = OsEventTypeList.fromJson(raw);
  return event === undefined ? undefined : ACTION_BY_EVENT.get(event);
}

/**
 * Keeps host routing discrepancies at one boundary. Some G2 builds report a
 * container tap as a system event, while others use the documented container
 * envelope. Product state consumes only this normalized action.
 */
export function normalizeEvenAction(event: RawEvenHubEvent): EvenAction | null {
  if (event.listEvent) {
    const kind = actionKind(event.listEvent.eventType);
    return kind
      ? {
          kind,
          envelope: "list",
          containerId: event.listEvent.containerID,
          selectedIndex: event.listEvent.currentSelectItemIndex,
        }
      : null;
  }

  if (event.textEvent) {
    const kind = actionKind(event.textEvent.eventType);
    return kind
      ? {
          kind,
          envelope: "text",
          containerId: event.textEvent.containerID,
        }
      : null;
  }

  if (event.sysEvent) {
    const kind = actionKind(event.sysEvent.eventType);
    return kind
      ? {
          kind,
          envelope: "system",
          source: EventSourceType.fromJson(event.sysEvent.eventSource),
        }
      : null;
  }

  return null;
}
