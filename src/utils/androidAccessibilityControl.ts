export const ANDROID_ACCESSIBILITY_CONTROL_MARKER = '[ANDROID_ACCESSIBILITY_CONTROL_SESSION]';
export const ANDROID_ACCESSIBILITY_CAPTURE_NOTICE_PREFIX = 'Accessibility mode: captured screen from';
export const ANDROID_SCREENSHOT_CAPTURE_NOTICE_PREFIX = 'Screen share mode: captured screenshot';

interface AccessibilityNodeLike {
  id?: string;
  className?: string;
  packageName?: string;
  text?: string;
  contentDescription?: string;
  viewIdResourceName?: string;
  bounds?: {
    left?: number;
    top?: number;
    right?: number;
    bottom?: number;
    width?: number;
    height?: number;
    centerX?: number;
    centerY?: number;
  };
  clickable?: boolean;
  longClickable?: boolean;
  scrollable?: boolean;
  editable?: boolean;
  enabled?: boolean;
  visibleToUser?: boolean;
  actionable?: boolean;
  children?: AccessibilityNodeLike[];
}

interface AccessibilityWindowLike {
  root?: AccessibilityNodeLike;
}

interface AccessibilityScreenLike {
  activePackage?: string;
  display?: unknown;
  windows?: AccessibilityWindowLike[];
}

interface InteractiveElement {
  id: string;
  label: string;
  className: string;
  bounds: string;
  center: string;
  flags: string;
}

function parseNodeTree(nodeTree: string): unknown {
  try {
    return JSON.parse(nodeTree);
  } catch {
    return null;
  }
}

function compactText(value: unknown, maxLength = 56): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}...`;
}

function shortClassName(className: string): string {
  const parts = className.split('.');
  return parts[parts.length - 1] || className || 'View';
}

function collectDescendantLabel(node: AccessibilityNodeLike, depth = 0): string {
  const own = compactText(node.text || node.contentDescription);
  if (own || depth >= 2 || !Array.isArray(node.children)) return own;

  for (const child of node.children) {
    const label = collectDescendantLabel(child, depth + 1);
    if (label) return label;
  }
  return '';
}

function addUniqueText(output: string[], value: unknown, maxLength = 60): void {
  const text = compactText(value, maxLength);
  if (!text || output.includes(text)) return;
  output.push(text);
}

function formatBounds(node: AccessibilityNodeLike): { bounds: string; center: string; area: number } | null {
  const bounds = node.bounds;
  if (!bounds) return null;
  const left = Number(bounds.left);
  const top = Number(bounds.top);
  const right = Number(bounds.right);
  const bottom = Number(bounds.bottom);
  const width = Number(bounds.width ?? right - left);
  const height = Number(bounds.height ?? bottom - top);
  if (![left, top, right, bottom, width, height].every(Number.isFinite)) return null;
  if (width <= 0 || height <= 0) return null;
  const centerX = Number.isFinite(Number(bounds.centerX)) ? Number(bounds.centerX) : Math.round((left + right) / 2);
  const centerY = Number.isFinite(Number(bounds.centerY)) ? Number(bounds.centerY) : Math.round((top + bottom) / 2);
  return {
    bounds: `[${left},${top} - ${right},${bottom}]`,
    center: `(${centerX},${centerY})`,
    area: width * height,
  };
}

function walkInteractiveElements(
  node: AccessibilityNodeLike | undefined,
  activePackage: string,
  output: InteractiveElement[],
  depth = 0
): void {
  if (!node || output.length >= 35 || depth > 12) return;

  const isVisible = node.visibleToUser !== false;
  const isEnabled = node.enabled !== false;
  const isAppNode = !activePackage || !node.packageName || node.packageName === activePackage;
  const isInteractive = !!(node.actionable || node.clickable || node.longClickable || node.scrollable || node.editable);
  const bounds = formatBounds(node);

  if (isVisible && isEnabled && isAppNode && isInteractive && bounds) {
    const flags = [
      node.clickable ? 'click' : null,
      node.longClickable ? 'long' : null,
      node.scrollable ? 'scroll' : null,
      node.editable ? 'edit' : null,
    ].filter(Boolean).join(',');
    output.push({
      id: String(node.id || ''),
      label: compactText(node.contentDescription || node.text || collectDescendantLabel(node) || node.viewIdResourceName || ''),
      className: shortClassName(String(node.className || 'View')),
      bounds: bounds.bounds,
      center: bounds.center,
      flags,
    });
  }

  if (Array.isArray(node.children)) {
    node.children.forEach((child) => walkInteractiveElements(child, activePackage, output, depth + 1));
  }
}

export function buildAndroidAccessibilityElementSummary(screen: unknown, activePackage = ''): string {
  const parsed = typeof screen === 'string' ? parseNodeTree(screen) : screen;
  const screenObject = parsed && typeof parsed === 'object' ? parsed as AccessibilityScreenLike : null;
  const packageName = activePackage || screenObject?.activePackage || '';
  const elements: InteractiveElement[] = [];

  if (Array.isArray(screenObject?.windows)) {
    screenObject.windows.forEach((window) => walkInteractiveElements(window.root, packageName, elements));
  }

  if (elements.length === 0) {
    return 'No reliable interactive elements were found in the accessibility tree.';
  }

  return elements
    .slice(0, 25)
    .map((element, index) =>
      `${index + 1}. id=${element.id} label="${element.label || '(no label)'}" class=${element.className} flags=${element.flags || 'none'} center=${element.center} bounds=${element.bounds}`
    )
    .join('\n');
}

function collectVisibleTexts(node: AccessibilityNodeLike | undefined, output: string[], depth = 0): void {
  if (!node || output.length >= 35 || depth > 10) return;
  if (node.visibleToUser !== false) {
    addUniqueText(output, node.text || node.contentDescription);
  }
  if (Array.isArray(node.children)) {
    node.children.forEach((child) => collectVisibleTexts(child, output, depth + 1));
  }
}

export function buildAndroidAccessibilityScreenSummary(screen: unknown, activePackage = ''): string {
  const parsed = typeof screen === 'string' ? parseNodeTree(screen) : screen;
  const screenObject = parsed && typeof parsed === 'object' ? parsed as AccessibilityScreenLike : null;
  const texts: string[] = [];

  if (Array.isArray(screenObject?.windows)) {
    screenObject.windows.forEach((window) => collectVisibleTexts(window.root, texts));
  }

  return JSON.stringify({
    activePackage: activePackage || screenObject?.activePackage || 'unknown',
    display: screenObject?.display || null,
    visibleTexts: texts.slice(0, 25),
  }, null, 2);
}

export function buildAndroidAccessibilityRuntimeContext(
  screenSummary: string,
  interactiveElements: string,
  activePackage: string
): string {
  return [
    ANDROID_ACCESSIBILITY_CONTROL_MARKER,
    `Current Android app package: ${activePackage || 'unknown'}`,
    'The user captured the current Android screen with the floating ball camera button.',
    'Use the attached screenshot plus the compact accessibility summary for this API call only.',
    'You may use Android accessibility tools to observe, click, or swipe if the user asks for action.',
    'Do not estimate tap coordinates from the screenshot. Coordinate taps are often wrong on Android screenshots.',
    'First choose from the Interactive elements list and call click_android_node with that id.',
    'For visible editable/input elements, use set_android_text with the node id to replace field text.',
    'After tapping/clicking an input field and focusing it, use set_focused_android_text to write into the current focused field.',
    'If an input is visible but missing from the accessibility tree, tap it first, then try ime_commit_android_text through YSClaude IME.',
    'When ime_commit_android_text needs YSClaude IME, it will try to switch to YSClaude IME automatically if the IME has already been enabled in Android settings.',
    'If ime_commit_android_text says YSClaude IME is not enabled or no input connection is ready, first focus an input and call switch_android_input_method_to_ysclaude; only ask the user to enable YSClaude IME in settings if the picker cannot find it.',
    'If the target is visible but missing from the accessibility tree, use tap_android_relative with x_ratio/y_ratio from 0 to 1.',
    'Use tap_android_screen absolute pixels only as the final fallback. Do not convert screenshot pixels yourself.',
    'Prefer scroll_android_node for scrollable nodes; use swipe_android_screen when node scrolling fails.',
    'Before sensitive actions such as deleting, paying, granting permissions, calling, or publishing, ask the user for confirmation. Sending ordinary chat text does not require extra permission when the user asked you to send it.',
    '',
    'Interactive elements to use for clicks or scrolling:',
    interactiveElements,
    '',
    'Compact screen summary:',
    screenSummary,
  ].join('\n');
}

export function buildAndroidScreenshotRuntimeContext(): string {
  return '用户邀请你共享屏幕，请根据附带截图和对话上下文回应。';
}

export function buildAndroidAccessibilityCaptureNotice(activePackage: string): string {
  return `${ANDROID_ACCESSIBILITY_CAPTURE_NOTICE_PREFIX} ${activePackage || 'current app'}`;
}

export function buildAndroidScreenshotCaptureNotice(): string {
  return ANDROID_SCREENSHOT_CAPTURE_NOTICE_PREFIX;
}
