export function renderComposerDisplay(
  inputValue: string,
  placeholder: string,
  showCursor: boolean,
): {
  readonly textBeforeCursor: string;
  readonly textAfterCursor: string;
  readonly cursor: string;
  readonly isPlaceholder: boolean;
} {
  if (!inputValue) {
    return {
      textBeforeCursor: showCursor ? "" : placeholder,
      textAfterCursor: showCursor ? placeholder : "",
      cursor: showCursor ? "│" : "",
      isPlaceholder: true,
    };
  }

  return {
    textBeforeCursor: inputValue,
    textAfterCursor: "",
    cursor: showCursor ? "│" : "",
    isPlaceholder: false,
  };
}
