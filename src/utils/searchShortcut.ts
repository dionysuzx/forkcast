const APPLE_PLATFORM_REGEX = /Mac|iPhone|iPad|iPod/i;

export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return APPLE_PLATFORM_REGEX.test(navigator.platform) || APPLE_PLATFORM_REGEX.test(navigator.userAgent);
}

export function getSearchShortcutLabel(): string {
  return isApplePlatform() ? '⌘K' : 'Ctrl+K';
}

export function getSearchShortcutAriaValue(): string {
  return isApplePlatform() ? 'Meta+K' : 'Control+K';
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    return true;
  }

  if ((target as HTMLElement).isContentEditable) {
    return true;
  }

  return Boolean(target.closest('[contenteditable]:not([contenteditable="false"])'));
}

export function shouldOpenSearchFromShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.altKey || event.shiftKey) {
    return false;
  }

  if (event.key.toLowerCase() !== 'k') {
    return false;
  }

  if (isEditableTarget(event.target)) {
    return false;
  }

  const isApple = isApplePlatform();
  return isApple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}
