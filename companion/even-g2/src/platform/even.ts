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
  | "long-press-release"
  | "foreground-enter"
  | "foreground-exit"
  | "abnormal-exit"
  | "system-exit";

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
  containerName?: string;
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
  [OsEventTypeList.FOREGROUND_ENTER_EVENT, "foreground-enter"],
  [OsEventTypeList.FOREGROUND_EXIT_EVENT, "foreground-exit"],
  [OsEventTypeList.ABNORMAL_EXIT_EVENT, "abnormal-exit"],
  [OsEventTypeList.SYSTEM_EXIT_EVENT, "system-exit"],
]);

function actionKind(raw: unknown, omittedMeansClick = false): EvenActionKind | undefined {
  if (raw === undefined && omittedMeansClick) return "click";
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
    const kind = actionKind(event.listEvent.eventType, true);
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
    const kind = actionKind(event.textEvent.eventType, true);
    return kind
      ? {
          kind,
          envelope: "text",
          containerId: event.textEvent.containerID,
        }
      : null;
  }

  if (event.sysEvent) {
    const source = EventSourceType.fromJson(event.sysEvent.eventSource);
    const kind = actionKind(
      event.sysEvent.eventType,
      event.sysEvent.eventType === undefined && source !== undefined,
    );
    return kind
      ? {
          kind,
          envelope: "system",
          source,
        }
      : null;
  }

  return null;
}
