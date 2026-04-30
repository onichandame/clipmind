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
import { AskUserQuestionWidget } from './AskUserQuestionWidget';
import { HotspotsCarouselWidget } from './HotspotsCarouselWidget';

export interface WidgetProps {
  part: any;        // the typed tool part: { type, toolCallId, state, input, output }
  projectId: string;
  onSubmit?: (message: string) => void;  // sends a user message into the chat
  // The text of the next user message after this widget's message, if any.
  // Widgets that need an "answered/locked" state (e.g. AskUserQuestionWidget) read this.
  answer?: string;
}

export const WIDGET_TOOL_NAMES = new Set<string>([
  'tool-request_asset_import',
  'tool-ask_user_question',
  'tool-show_hotspots',
]);

// Side-channel tools that fire a transient effect (toast) but do NOT render in the
// transcript and do NOT show a status pill. Used to keep the AI's silent
// background writes (long-term user memory, etc.) out of the conversation surface.
export const SILENT_TOOL_NAMES = new Set<string>([
  'tool-update_user_memory',
]);

export const widgetRegistry: Record<string, ComponentType<WidgetProps>> = {
  'tool-request_asset_import': AssetPickerWidget,
  'tool-ask_user_question': AskUserQuestionWidget,
  'tool-show_hotspots': HotspotsCarouselWidget,
};
