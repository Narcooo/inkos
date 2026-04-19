export interface ComposerCaretState {
  readonly visible: boolean;
  readonly shouldAnimate: boolean;
}

export function resolveComposerCaretState(params: {
  readonly inputValue: string;
  readonly isSubmitting: boolean;
  readonly blinkTick: number;
}): ComposerCaretState {
  if (params.isSubmitting) {
    return {
      visible: false,
      shouldAnimate: false,
    };
  }

  return {
    visible: true,
    shouldAnimate: false,
  };
}
