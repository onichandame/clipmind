// In-chat HITL widget registry.
//
// Architecture: AI SDK typed tool parts (`tool-<name>`) double as widget descriptors.
// When the AI calls a no-op widget tool (e.g. request_asset_import), or the server
// seeds the same shape into a message at project init, ChatPanel routes the part
// through this registry instead of rendering it as a status pill.
//
// Adding a new HITL widget:
//   1. Define the no-op tool in apps/server/src/routes/chat.ts (outside isFreeChat gate
//      if the widget should also work in freechat).
//   2. Add `tool-<name>` to WIDGET_TOOL_NAMES.
//   3. Map it to a React component in widgetRegistry.
//
// Widget state should be derived from server (queries) or persisted by appending a
// synthesized user message on submit — never by mutating the tool part in place.

import type { ComponentType } from 'react';
import { AssetPickerWidget } from './AssetPickerWidget';

export interface WidgetProps {
  part: any;        // the typed tool part: { type, toolCallId, state, input, output }
  projectId: string;
}

export const WIDGET_TOOL_NAMES = new Set<string>([
  'tool-request_asset_import',
]);

export const widgetRegistry: Record<string, ComponentType<WidgetProps>> = {
  'tool-request_asset_import': AssetPickerWidget,
};
