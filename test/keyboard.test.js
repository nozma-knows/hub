import { describe, expect, test } from "bun:test";

import { isSendShortcut } from "../src/lib/keyboard";

describe("isSendShortcut", () => {
  test("Cmd+Enter sends", () => {
    expect(isSendShortcut({ key: "Enter", metaKey: true })).toBe(true);
  });

  test("Ctrl+Enter sends", () => {
    expect(isSendShortcut({ key: "Enter", ctrlKey: true })).toBe(true);
  });

  test("Enter alone does not send", () => {
    expect(isSendShortcut({ key: "Enter" })).toBe(false);
  });

  test("Shift+Enter does not send", () => {
    expect(isSendShortcut({ key: "Enter", shiftKey: true, ctrlKey: true })).toBe(false);
  });

  test("IME composition prevents send", () => {
    expect(isSendShortcut({ key: "Enter", ctrlKey: true, isComposing: true })).toBe(false);
    expect(isSendShortcut({ key: "Enter", ctrlKey: true, nativeEvent: { isComposing: true } })).toBe(false);
  });
});
