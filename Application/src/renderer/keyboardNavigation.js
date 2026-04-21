const FOCUSABLE_SELECTOR = [
  'button',
  '[href]',
  'input',
  'select',
  'textarea',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const REGION_SHORTCUTS = {
  1: 'sidebar',
  2: 'header',
  3: 'view',
};

function toElement(target) {
  if (!target) {
    return null;
  }

  if (target.nodeType === 1) {
    return target;
  }

  if (target.tagName || target.isContentEditable || typeof target.closest === 'function') {
    return target;
  }

  return target.parentElement || null;
}

function getAttribute(element, name) {
  if (typeof element.getAttribute !== 'function') {
    return undefined;
  }

  return element.getAttribute(name);
}

function matches(element, selector) {
  return typeof element.matches === 'function' && element.matches(selector);
}

export function isEditableTarget(target) {
  const element = toElement(target);

  if (!element) {
    return false;
  }

  if (element.isContentEditable) {
    return true;
  }

  const tagName = String(element.tagName || '').toLowerCase();
  if (['input', 'textarea', 'select'].includes(tagName)) {
    return true;
  }

  if (typeof element.closest === 'function') {
    return Boolean(element.closest('input, textarea, select, [contenteditable="true"]'));
  }

  return false;
}

export function getRegionShortcutTarget(event) {
  if (
    !event ||
    event.defaultPrevented ||
    !event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    event.shiftKey ||
    isEditableTarget(event.target)
  ) {
    return null;
  }

  const key = String(event.key || '').replace('Digit', '');
  return REGION_SHORTCUTS[key] || null;
}

export function isElementFocusable(element) {
  if (!element || typeof element.focus !== 'function') {
    return false;
  }

  if (element.disabled || element.hidden) {
    return false;
  }

  if (getAttribute(element, 'disabled') !== undefined && getAttribute(element, 'disabled') !== null) {
    return false;
  }

  if (getAttribute(element, 'aria-disabled') === 'true' || getAttribute(element, 'aria-hidden') === 'true') {
    return false;
  }

  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }
  }

  const tagName = String(element.tagName || '').toLowerCase();
  const naturalFocusable = ['button', 'input', 'select', 'textarea'].includes(tagName) || matches(element, 'a[href]');

  return naturalFocusable || Number(element.tabIndex) >= 0 || matches(element, '[tabindex]');
}

export function getFocusableElements(container) {
  if (!container || typeof container.querySelectorAll !== 'function') {
    return [];
  }

  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(isElementFocusable);
}

export function focusFirstAvailable(container, preferredSelector = '') {
  if (!container) {
    return null;
  }

  const preferredElements =
    preferredSelector && typeof container.querySelectorAll === 'function'
      ? Array.from(container.querySelectorAll(preferredSelector))
      : [];
  const orderedElements = [...preferredElements, ...getFocusableElements(container)];
  const seen = new Set();

  for (const element of orderedElements) {
    if (seen.has(element) || !isElementFocusable(element)) {
      continue;
    }

    seen.add(element);
    element.focus({ preventScroll: true });
    return element;
  }

  return null;
}

export function getGridNavigationIndex({
  currentIndex,
  itemCount,
  columnCount,
  key,
}) {
  if (!Number.isFinite(currentIndex) || !Number.isFinite(itemCount) || itemCount <= 0) {
    return -1;
  }

  const safeColumnCount = Math.max(1, Number(columnCount) || 1);
  const safeIndex = Math.min(Math.max(0, currentIndex), itemCount - 1);
  const rowStart = Math.floor(safeIndex / safeColumnCount) * safeColumnCount;
  const rowEnd = Math.min(rowStart + safeColumnCount - 1, itemCount - 1);
  let nextIndex = safeIndex;

  if (key === 'ArrowLeft') {
    nextIndex = safeIndex - 1;
  } else if (key === 'ArrowRight') {
    nextIndex = safeIndex + 1;
  } else if (key === 'ArrowUp') {
    nextIndex = safeIndex - safeColumnCount;
  } else if (key === 'ArrowDown') {
    nextIndex = safeIndex + safeColumnCount;
  } else if (key === 'Home') {
    nextIndex = rowStart;
  } else if (key === 'End') {
    nextIndex = rowEnd;
  }

  return Math.min(Math.max(0, nextIndex), itemCount - 1);
}

export function isGridNavigationKey(key) {
  return ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key);
}

export function getRenderedGridColumnCount(container, fallbackColumnCount = 1) {
  if (
    !container ||
    typeof window === 'undefined' ||
    typeof window.getComputedStyle !== 'function'
  ) {
    return fallbackColumnCount;
  }

  const templateColumns = window.getComputedStyle(container).gridTemplateColumns;
  const count = templateColumns
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean).length;

  return count > 0 ? count : fallbackColumnCount;
}
