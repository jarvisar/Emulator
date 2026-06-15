const TEXT_ENTRY_SELECTOR = "input, textarea, select, [contenteditable='true']";

export function isTextEntryTarget(target) {
  return Boolean(target && typeof target.closest === "function" && target.closest(TEXT_ENTRY_SELECTOR));
}
