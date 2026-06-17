import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Linking,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { randomUUID } from 'expo-crypto';
import { captureRef } from 'react-native-view-shot';
import { lightColors, useThemeColors, type ThemeColors } from '../theme/colors';

import { sqliteStorage } from '../db/kv-storage';
import {
  registerWebViewHost,
  WebViewObservation,
  WebViewOpenOptions,
  WebViewScreenshot,
  WebViewTapResult,
} from '../services/webviewController';


let colors = lightColors;
type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const REQUEST_TIMEOUT_MS = 12000;
const OPEN_TIMEOUT_MS = 20000;
const MAX_OBSERVE_TEXT = 12000;
const MAX_ELEMENTS = 40;
const FLOATING_MARGIN = 12;
const DEFAULT_PANEL_WIDTH_RATIO = 0.9;
const DEFAULT_PANEL_HEIGHT = 460;
const MIN_PANEL_WIDTH = 280;
const MIN_PANEL_HEIGHT = 300;
const COLLAPSED_ICON_SIZE = 48;
const WEB_BOOKMARKS_KEY = 'ysclaude-web-bookmarks';
const MAX_WEB_BOOKMARKS = 80;
const DESKTOP_WEBVIEW_MIN_WIDTH = 1280;
const DESKTOP_WEBVIEW_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const EXTERNAL_AUTH_OPEN_COOLDOWN_MS = 2500;

interface WebBookmark {
  id: string;
  title: string;
  url: string;
  createdAt: number;
}

function buildClickScript(target: { index?: number; selector?: string }): string {
  const targetJson = JSON.stringify(target);
  return `
    (function () {
      var id = __REQUEST_ID__;
      var target = ${targetJson};
      var baseSelector = 'button,a,input,textarea,select,[role="button"],[onclick],canvas';
      var el = null;
      if (typeof target.index === 'number') {
        el = Array.prototype.slice.call(document.querySelectorAll(baseSelector), 0, ${MAX_ELEMENTS})[target.index] || null;
      } else if (target.selector) {
        try {
          el = document.querySelector(target.selector);
        } catch (e) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            source: 'ysclaude-webview',
            id: id,
            ok: false,
            error: '选择器格式不正确: ' + e.message
          }));
          return true;
        }
      }
      if (!el) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          source: 'ysclaude-webview',
          id: id,
          ok: false,
          error: '未找到要点击的元素'
        }));
        return true;
      }
      function textOf(node) {
        return ((node.innerText || node.textContent || node.getAttribute('aria-label') || node.title || '') + '')
          .replace(/\\s+/g, ' ')
          .trim()
          .slice(0, 120);
      }
      function cssEscape(value) {
        if (window.CSS && window.CSS.escape) return window.CSS.escape(value);
        return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
      }
      function selectorOf(node) {
        if (node.id) return '#' + cssEscape(node.id);
        var parts = [];
        var current = node;
        while (current && current.nodeType === 1 && current !== document.body && parts.length < 5) {
          var tag = (current.tagName || '').toLowerCase();
          if (!tag) break;
          var part = tag;
          var parent = current.parentElement;
          if (parent) {
            var siblings = Array.prototype.filter.call(parent.children, function (child) {
              return child.tagName === current.tagName;
            });
            if (siblings.length > 1) {
              part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
            }
          }
          parts.unshift(part);
          current = parent;
        }
        return parts.join(' > ');
      }
      try {
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      } catch (e) {
        try { el.scrollIntoView(true); } catch (err) {}
      }
      setTimeout(function () {
        var rect = el.getBoundingClientRect();
        var x = Math.round(rect.left + rect.width / 2);
        var y = Math.round(rect.top + rect.height / 2);
        var opts = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: x,
          clientY: y,
          screenX: x,
          screenY: y
        };
        try { el.focus && el.focus(); } catch (e) {}
        try {
          if (window.TouchEvent) {
            var touch = new Touch({
              identifier: Date.now(),
              target: el,
              clientX: x,
              clientY: y,
              screenX: x,
              screenY: y,
              pageX: x + window.scrollX,
              pageY: y + window.scrollY
            });
            el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch], targetTouches: [touch], changedTouches: [touch] }));
            el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [touch] }));
          }
        } catch (e) {}
        try {
          if (window.PointerEvent) {
            el.dispatchEvent(new PointerEvent('pointerdown', opts));
            el.dispatchEvent(new PointerEvent('pointerup', opts));
          }
        } catch (e) {}
        try {
          el.dispatchEvent(new MouseEvent('mousedown', opts));
          el.dispatchEvent(new MouseEvent('mouseup', opts));
          el.dispatchEvent(new MouseEvent('click', opts));
        } catch (e) {}
        try { el.click && el.click(); } catch (e) {}
        window.ReactNativeWebView.postMessage(JSON.stringify({
          source: 'ysclaude-webview',
          id: id,
          ok: true,
          data: {
            x: x,
            y: y,
            target: (el.tagName || '').toLowerCase(),
            text: textOf(el),
            selector: selectorOf(el)
          }
        }));
      }, 80);
    })();
    true;
  `;
}

const LOGIN_OVERLAY_CLEANUP_SCRIPT = `
  (function () {
    try {
      if (!window.__ysClaudeCleanupLoginOverlays) {
        window.__ysClaudeCleanupLoginOverlays = function () {
          var loginPattern = /(\\u767b\\u5f55|\\u767b\\u9646|\\u6ce8\\u518c|\\u7acb\\u5373\\u767b\\u5f55|\\u624b\\u673a\\u53f7|\\u77ed\\u4fe1\\u9a8c\\u8bc1|\\u6253\\u5f00\\s*(app|APP)|\\u4e0b\\u8f7d\\s*(app|APP|\\u5ba2\\u6237\\u7aef)|sign\\s*in|log\\s*in|login|register|open\\s*app|download\\s*app)/i;
          var closePattern = /^(\\u00d7|x|X|\\u5173\\u95ed|\\u5173\\u6389|\\u53d6\\u6d88|\\u7a0d\\u540e|\\u6682\\u4e0d|\\u4ee5\\u540e\\u518d\\u8bf4|close|dismiss|not now|later|skip)$/i;
          var overlayClassPattern = /(modal|popup|pop|dialog|mask|overlay|backdrop|login|signin|sign-in|register|passport|app-download|download-app)/i;
          var sensitivePattern = /(payment|checkout|order|captcha|cookie|privacy|consent|adult|\\u652f\\u4ed8|\\u4ed8\\u6b3e|\\u8ba2\\u5355|\\u8d2d\\u4e70|\\u9690\\u79c1|\\u540c\\u610f|\\u6210\\u4eba)/i;
          var viewportArea = Math.max(1, (window.innerWidth || 0) * (window.innerHeight || 0));
          var pageText = ((document.body && document.body.innerText) || '').slice(0, 3000);
          var pageHasLoginPrompt = loginPattern.test(pageText);

          function textOf(el) {
            return ((el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('class') || el.id || '') + '')
              .replace(/\\s+/g, ' ')
              .trim();
          }
          function isVisible(el) {
            var rect = el.getBoundingClientRect();
            var style = window.getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.05;
          }
          function looksLikeOverlay(el) {
            if (!isVisible(el)) return false;
            var rect = el.getBoundingClientRect();
            var style = window.getComputedStyle(el);
            var classBits = ((el.className || '') + ' ' + (el.id || '') + ' ' + (el.getAttribute('role') || '') + ' ' + (el.getAttribute('aria-modal') || '')).toString();
            var text = textOf(el);
            var areaRatio = (rect.width * rect.height) / viewportArea;
            var fixedLike = style.position === 'fixed' || style.position === 'sticky';
            var dialogLike = el.getAttribute('role') === 'dialog' || el.getAttribute('aria-modal') === 'true' || overlayClassPattern.test(classBits);
            var bottomSheetLike = fixedLike && rect.width >= (window.innerWidth || 0) * 0.75 && rect.height >= 80;
            var loginLike = loginPattern.test(text + ' ' + classBits);
            var maskLike = pageHasLoginPrompt && overlayClassPattern.test(classBits) && areaRatio > 0.35;
            if (sensitivePattern.test(text + ' ' + classBits)) return false;
            return (loginLike && (dialogLike || fixedLike || areaRatio > 0.18 || bottomSheetLike)) || maskLike;
          }
          function clickCloseButton(root) {
            var buttons = Array.prototype.slice.call(root.querySelectorAll('button,a,[role="button"],[aria-label],[title],[class*="close"],[class*="Close"],[class*="cancel"],[class*="dismiss"]'), 0, 24);
            for (var i = 0; i < buttons.length; i += 1) {
              var button = buttons[i];
              if (!isVisible(button)) continue;
              var text = textOf(button);
              var classBits = ((button.className || '') + ' ' + (button.id || '')).toString();
              if (closePattern.test(text) || /close|dismiss|cancel/i.test(classBits)) {
                try { button.click(); return true; } catch (e) {}
              }
            }
            return false;
          }

          var candidates = Array.prototype.slice.call(document.querySelectorAll('[role="dialog"],[aria-modal="true"],.modal,.popup,.dialog,.mask,.overlay,.backdrop,.login,.signin,.sign-in,.register,.passport,.app-download,[class*="modal"],[class*="popup"],[class*="dialog"],[class*="mask"],[class*="overlay"],[class*="backdrop"],[class*="login"],[class*="signin"],[class*="passport"],[class*="download"]'));
          Array.prototype.slice.call(document.body ? document.body.children : [], 0).forEach(function (child) {
            try {
              var style = window.getComputedStyle(child);
              var zIndex = parseInt(style.zIndex || '0', 10);
              if ((style.position === 'fixed' || style.position === 'sticky') && zIndex >= 10) candidates.push(child);
            } catch (e) {}
          });

          var cleaned = false;
          candidates.forEach(function (el) {
            if (!el || el === document.body || el === document.documentElement || el.getAttribute('data-ysclaude-hidden') === '1') return;
            if (!looksLikeOverlay(el)) return;
            if (clickCloseButton(el)) {
              cleaned = true;
              return;
            }
            try {
              el.setAttribute('data-ysclaude-hidden', '1');
              el.style.setProperty('display', 'none', 'important');
              el.style.setProperty('visibility', 'hidden', 'important');
              cleaned = true;
            } catch (e) {}
          });

          if (cleaned) {
            try {
              document.documentElement.style.setProperty('overflow', 'auto', 'important');
              document.body.style.setProperty('overflow', 'auto', 'important');
              if (window.getComputedStyle(document.body).position === 'fixed') {
                document.body.style.setProperty('position', 'static', 'important');
              }
            } catch (e) {}
          }
        };
      }

      window.__ysClaudeCleanupLoginOverlays();

      if (!window.__ysClaudeCleanupLoginOverlayObserver && window.MutationObserver) {
        window.__ysClaudeCleanupLoginOverlayObserver = true;
        var cleanupUntil = Date.now() + 10000;
        var cleanupTimer = null;
        var observer = new MutationObserver(function () {
          if (Date.now() > cleanupUntil) {
            try { observer.disconnect(); } catch (e) {}
            return;
          }
          clearTimeout(cleanupTimer);
          cleanupTimer = setTimeout(function () {
            try { window.__ysClaudeCleanupLoginOverlays(); } catch (e) {}
          }, 120);
        });
        try {
          observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
          setTimeout(function () { try { observer.disconnect(); } catch (e) {} }, 11000);
        } catch (e) {}
      }
    } catch (e) {}
  })();
  true;
`;

const DESKTOP_LAYOUT_SCROLL_SCRIPT = `
  (function () {
    try {
      var minWidth = ${DESKTOP_WEBVIEW_MIN_WIDTH};
      var viewport = document.querySelector('meta[name="viewport"]');
      if (!viewport) {
        viewport = document.createElement('meta');
        viewport.setAttribute('name', 'viewport');
        (document.head || document.documentElement).appendChild(viewport);
      }
      viewport.setAttribute('content', 'width=' + minWidth + ', initial-scale=1, minimum-scale=0.25, maximum-scale=5, user-scalable=yes');

      var style = document.getElementById('ysclaude-desktop-scroll-style');
      if (!style) {
        style = document.createElement('style');
        style.id = 'ysclaude-desktop-scroll-style';
        (document.head || document.documentElement).appendChild(style);
      }
      style.textContent = [
        'html, body {',
        '  min-width: ' + minWidth + 'px !important;',
        '  overflow-x: auto !important;',
        '  overflow-y: auto !important;',
        '}',
        'body {',
        '  width: auto !important;',
        '  -webkit-overflow-scrolling: touch;',
        '  touch-action: pan-x pan-y pinch-zoom;',
        '  overscroll-behavior: auto;',
        '}',
        '::-webkit-scrollbar {',
        '  width: 10px !important;',
        '  height: 10px !important;',
        '}',
        '::-webkit-scrollbar-thumb {',
        '  background: rgba(0,0,0,0.35) !important;',
        '  border-radius: 8px !important;',
        '}',
        '::-webkit-scrollbar-track {',
        '  background: rgba(0,0,0,0.08) !important;',
        '}'
      ].join('\\n');
    } catch (e) {}
  })();
  true;
`;

const CLEAR_CURRENT_SITE_DATA_SCRIPT = `
  (function () {
    try {
      var cookies = document.cookie ? document.cookie.split(';') : [];
      var expires = 'Thu, 01 Jan 1970 00:00:00 GMT';
      var hostname = window.location.hostname || '';
      var domainParts = hostname.split('.');
      var domains = [''];
      for (var i = 0; i < domainParts.length - 1; i += 1) {
        domains.push('.' + domainParts.slice(i).join('.'));
      }

      cookies.forEach(function (cookie) {
        var name = cookie.split('=')[0].trim();
        if (!name) return;
        domains.forEach(function (domain) {
          var domainPart = domain ? ';domain=' + domain : '';
          document.cookie = name + '=;expires=' + expires + ';path=/' + domainPart;
        });
      });

      try { window.localStorage && window.localStorage.clear(); } catch (e) {}
      try { window.sessionStorage && window.sessionStorage.clear(); } catch (e) {}
      try {
        if (window.caches && window.caches.keys) {
          window.caches.keys().then(function (keys) {
            keys.forEach(function (key) { window.caches.delete(key); });
          });
        }
      } catch (e) {}
      try {
        if (window.indexedDB && window.indexedDB.databases) {
          window.indexedDB.databases().then(function (databases) {
            databases.forEach(function (database) {
              if (database && database.name) window.indexedDB.deleteDatabase(database.name);
            });
          });
        }
      } catch (e) {}
    } catch (e) {}
    true;
  })();
`;

const GOOGLE_TRANSLATE_PAGE_URL = 'https://translate.google.com/translate';

function normalizeAddressInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const looksLikeHost =
    /^https?:\/\//i.test(trimmed) ||
    /^localhost(?::\d+)?(?:[/?#].*)?$/i.test(trimmed) ||
    /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:[/?#].*)?$/.test(trimmed) ||
    /^(?:[\p{L}\p{N}-]+\.?)+[.\u3002](?:[\p{L}\p{N}-]{2,})(?::\d+)?(?:[/?#].*)?$/u.test(trimmed);

  if (!looksLikeHost) return null;

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function buildGoogleTranslateUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    let targetUrl = parsed.toString();

    if (parsed.hostname === 'translate.google.com' && parsed.pathname === '/translate') {
      targetUrl = parsed.searchParams.get('u') || targetUrl;
    }

    const target = new URL(targetUrl);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      return null;
    }

    return `${GOOGLE_TRANSLATE_PAGE_URL}?sl=auto&tl=zh-CN&hl=zh-CN&u=${encodeURIComponent(target.toString())}`;
  } catch {
    return null;
  }
}

function normalizeExternalBrowserUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function shouldOpenGoogleAuthExternally(value: string): boolean {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();

    if (hostname === 'accounts.google.com' || hostname === 'accounts.youtube.com') {
      return true;
    }

    if ((hostname === 'www.google.com' || hostname === 'google.com') && (
      pathname.startsWith('/accounts') ||
      pathname.startsWith('/o/oauth2') ||
      pathname.startsWith('/signin')
    )) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

function clampPanelSize(width: number, height: number) {
  const screen = Dimensions.get('window');
  return {
    width: Math.min(Math.max(MIN_PANEL_WIDTH, width), screen.width - FLOATING_MARGIN * 2),
    height: Math.min(Math.max(MIN_PANEL_HEIGHT, height), screen.height - FLOATING_MARGIN * 4),
  };
}

function clampPanelPosition(x: number, y: number, size: { width: number; height: number }, topInset: number) {
  const screen = Dimensions.get('window');
  const minY = topInset + FLOATING_MARGIN;
  return {
    x: Math.min(Math.max(FLOATING_MARGIN, x), Math.max(FLOATING_MARGIN, screen.width - size.width - FLOATING_MARGIN)),
    y: Math.min(Math.max(minY, y), Math.max(minY, screen.height - size.height - FLOATING_MARGIN)),
  };
}

function snapCollapsedIcon(x: number, y: number, topInset: number) {
  const screen = Dimensions.get('window');
  const snappedX = x + COLLAPSED_ICON_SIZE / 2 < screen.width / 2
    ? FLOATING_MARGIN
    : screen.width - COLLAPSED_ICON_SIZE - FLOATING_MARGIN;
  const minY = topInset + FLOATING_MARGIN;
  const maxY = Math.max(minY, screen.height - COLLAPSED_ICON_SIZE - FLOATING_MARGIN);
  return {
    x: snappedX,
    y: Math.min(Math.max(minY, y), maxY),
  };
}

async function loadWebBookmarks(): Promise<WebBookmark[]> {
  const raw = await sqliteStorage.getItem(WEB_BOOKMARKS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.url === 'string')
      .map((item) => ({
        id: typeof item.id === 'string' ? item.id : randomUUID(),
        title: typeof item.title === 'string' ? item.title : item.url,
        url: item.url,
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
      }));
  } catch {
    return [];
  }
}

async function saveWebBookmarks(bookmarks: WebBookmark[]): Promise<void> {
  await sqliteStorage.setItem(WEB_BOOKMARKS_KEY, JSON.stringify(bookmarks.slice(0, MAX_WEB_BOOKMARKS)));
}

export function WebViewPanel() {
  colors = useThemeColors();
  styles = useMemo(() => createStyles(colors), [colors]);

  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const webViewCaptureRef = useRef<View>(null);
  const pendingRequests = useRef<Record<string, PendingRequest>>({});
  const pendingOpen = useRef<PendingRequest | null>(null);
  const urlRef = useRef('');
  const titleRef = useRef('');
  const userAgentRef = useRef<string | undefined>(undefined);
  const lastExternalAuthOpenRef = useRef<{ url: string; openedAt: number } | null>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState('');
  const [addressInput, setAddressInput] = useState('');
  const [homeSearch, setHomeSearch] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [canGoBack, setCanGoBack] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [panelSize, setPanelSize] = useState(() => {
    const screen = Dimensions.get('window');
    return clampPanelSize(
      Math.round(screen.width * DEFAULT_PANEL_WIDTH_RATIO),
      Math.min(DEFAULT_PANEL_HEIGHT, screen.height - FLOATING_MARGIN * 4)
    );
  });
  const [panelPosition, setPanelPosition] = useState(() => {
    const screen = Dimensions.get('window');
    const size = clampPanelSize(
      Math.round(screen.width * DEFAULT_PANEL_WIDTH_RATIO),
      Math.min(DEFAULT_PANEL_HEIGHT, screen.height - FLOATING_MARGIN * 4)
    );
    return {
      x: Math.max(FLOATING_MARGIN, screen.width - size.width - FLOATING_MARGIN),
      y: insets.top + FLOATING_MARGIN,
    };
  });
  const [collapsedIconPosition, setCollapsedIconPosition] = useState(() => ({
    x: FLOATING_MARGIN,
    y: insets.top + FLOATING_MARGIN,
  }));
  const [bookmarks, setBookmarks] = useState<WebBookmark[]>([]);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showWebMenu, setShowWebMenu] = useState(false);
  const [showClearDataMenu, setShowClearDataMenu] = useState(false);
  const [webViewUserAgent, setWebViewUserAgent] = useState<string | undefined>(undefined);
  const [webViewReloadKey, setWebViewReloadKey] = useState(0);
  const panelPositionRef = useRef(panelPosition);
  const panelSizeRef = useRef(panelSize);
  const collapsedIconPositionRef = useRef(collapsedIconPosition);
  const insetTopRef = useRef(insets.top);
  const webViewCaptureSizeRef = useRef({ width: 0, height: 0 });
  const dragStart = useRef(panelPosition);
  const resizeStart = useRef(panelSize);
  const collapsedDragStart = useRef(collapsedIconPosition);

  const rejectPendingRequest = useCallback((id: string, reason: string) => {
    const pending = pendingRequests.current[id];
    if (!pending) return;
    clearTimeout(pending.timeout);
    delete pendingRequests.current[id];
    pending.reject(new Error(reason));
  }, []);

  const runScriptRequest = useCallback(
    <T,>(script: string): Promise<T> => {
      if (!visible || !urlRef.current) {
        return Promise.reject(new Error('尚未打开网页'));
      }

      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const wrappedScript = script.replace(/__REQUEST_ID__/g, JSON.stringify(id));
      return new Promise<T>((resolve, reject) => {
        pendingRequests.current[id] = {
          resolve,
          reject,
          timeout: setTimeout(() => rejectPendingRequest(id, '网页操作超时'), REQUEST_TIMEOUT_MS),
        };
        webViewRef.current?.injectJavaScript(wrappedScript);
      });
    },
    [rejectPendingRequest, visible]
  );

  const injectPageAdjustments = useCallback(() => {
    webViewRef.current?.injectJavaScript(
      `${webViewUserAgent ? DESKTOP_LAYOUT_SCROLL_SCRIPT : ''}\n${LOGIN_OVERLAY_CLEANUP_SCRIPT}`
    );
  }, [webViewUserAgent]);

  const dragResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) =>
        Math.abs(gestureState.dx) > 3 || Math.abs(gestureState.dy) > 3,
      onPanResponderGrant: () => {
        dragStart.current = panelPositionRef.current;
      },
      onPanResponderMove: (_, gestureState) => {
        setPanelPosition(
          clampPanelPosition(
            dragStart.current.x + gestureState.dx,
            dragStart.current.y + gestureState.dy,
            panelSizeRef.current,
            insetTopRef.current
          )
        );
      },
      onPanResponderRelease: (_, gestureState) => {
        setPanelPosition(
          clampPanelPosition(
            dragStart.current.x + gestureState.dx,
            dragStart.current.y + gestureState.dy,
            panelSizeRef.current,
            insetTopRef.current
          )
        );
      },
    })
  ).current;

  const resizeResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) =>
        Math.abs(gestureState.dx) > 3 || Math.abs(gestureState.dy) > 3,
      onPanResponderGrant: () => {
        resizeStart.current = panelSizeRef.current;
      },
      onPanResponderMove: (_, gestureState) => {
        const nextSize = clampPanelSize(
          resizeStart.current.width + gestureState.dx,
          resizeStart.current.height + gestureState.dy
        );
        setPanelSize(nextSize);
        setPanelPosition((current) => clampPanelPosition(current.x, current.y, nextSize, insetTopRef.current));
      },
      onPanResponderRelease: (_, gestureState) => {
        const nextSize = clampPanelSize(
          resizeStart.current.width + gestureState.dx,
          resizeStart.current.height + gestureState.dy
        );
        setPanelSize(nextSize);
        setPanelPosition((current) => clampPanelPosition(current.x, current.y, nextSize, insetTopRef.current));
      },
    })
  ).current;

  const collapsedIconResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) =>
        Math.abs(gestureState.dx) > 3 || Math.abs(gestureState.dy) > 3,
      onPanResponderGrant: () => {
        collapsedDragStart.current = collapsedIconPositionRef.current;
      },
      onPanResponderMove: (_, gestureState) => {
        const screen = Dimensions.get('window');
        setCollapsedIconPosition({
          x: Math.min(
            Math.max(FLOATING_MARGIN, collapsedDragStart.current.x + gestureState.dx),
            screen.width - COLLAPSED_ICON_SIZE - FLOATING_MARGIN
          ),
          y: Math.min(
            Math.max(insetTopRef.current + FLOATING_MARGIN, collapsedDragStart.current.y + gestureState.dy),
            screen.height - COLLAPSED_ICON_SIZE - FLOATING_MARGIN
          ),
        });
      },
      onPanResponderRelease: (_, gestureState) => {
        setCollapsedIconPosition(
          snapCollapsedIcon(
            collapsedDragStart.current.x + gestureState.dx,
            collapsedDragStart.current.y + gestureState.dy,
            insetTopRef.current
          )
        );
      },
    })
  ).current;

  const show = useCallback(() => {
    setVisible(true);
    setCollapsed(false);
    setStatus('');
  }, []);

  useEffect(() => {
    panelPositionRef.current = panelPosition;
  }, [panelPosition]);

  useEffect(() => {
    panelSizeRef.current = panelSize;
  }, [panelSize]);

  useEffect(() => {
    collapsedIconPositionRef.current = collapsedIconPosition;
  }, [collapsedIconPosition]);

  useEffect(() => {
    insetTopRef.current = insets.top;
  }, [insets.top]);

  useEffect(() => {
    if (!showWebMenu) {
      setShowClearDataMenu(false);
    }
  }, [showWebMenu]);

  useEffect(() => {
    let cancelled = false;
    loadWebBookmarks()
      .then((items) => {
        if (!cancelled) setBookmarks(items);
      })
      .catch((err) => console.warn('[WebView] load bookmarks failed:', err));
    return () => {
      cancelled = true;
    };
  }, []);

  const observe = useCallback(async (): Promise<WebViewObservation> => {
    setStatus('观察网页');
    return await runScriptRequest<WebViewObservation>(`
      ${webViewUserAgent ? DESKTOP_LAYOUT_SCROLL_SCRIPT : ''}
      ${LOGIN_OVERLAY_CLEANUP_SCRIPT}
      (function () {
        var id = __REQUEST_ID__;
        function textOf(el) {
          return ((el.innerText || el.textContent || el.getAttribute('aria-label') || el.title || '') + '')
            .replace(/\\s+/g, ' ')
            .trim();
        }
        function cssEscape(value) {
          if (window.CSS && window.CSS.escape) return window.CSS.escape(value);
          return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
        }
        function selectorOf(el) {
          if (el.id) return '#' + cssEscape(el.id);
          var parts = [];
          var current = el;
          while (current && current.nodeType === 1 && current !== document.body && parts.length < 5) {
            var tag = (current.tagName || '').toLowerCase();
            if (!tag) break;
            var part = tag;
            var parent = current.parentElement;
            if (parent) {
              var siblings = Array.prototype.filter.call(parent.children, function (child) {
                return child.tagName === current.tagName;
              });
              if (siblings.length > 1) {
                part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
              }
            }
            parts.unshift(part);
            current = parent;
          }
          return parts.join(' > ');
        }
        var selectors = 'button,a,input,textarea,select,[role="button"],[onclick],canvas';
        var nodes = Array.prototype.slice.call(document.querySelectorAll(selectors), 0, ${MAX_ELEMENTS});
        var elements = nodes.map(function (el, index) {
          var rect = el.getBoundingClientRect();
          return {
            index: index,
            tag: (el.tagName || '').toLowerCase(),
            text: textOf(el).slice(0, 120),
            role: el.getAttribute('role') || '',
            selector: selectorOf(el),
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          };
        }).filter(function (el) {
          return el.width > 0 && el.height > 0;
        });
        window.ReactNativeWebView.postMessage(JSON.stringify({
          source: 'ysclaude-webview',
          id: id,
          ok: true,
          data: {
            title: document.title || '',
            url: location.href,
            text: ((document.body && document.body.innerText) || '').slice(0, ${MAX_OBSERVE_TEXT}),
            viewport: {
              width: Math.round(window.innerWidth || 0),
              height: Math.round(window.innerHeight || 0)
            },
            elements: elements
          }
        }));
      })();
      true;
    `);
  }, [runScriptRequest, webViewUserAgent]);

  const isOpen = useCallback(() => {
    return visible && !!urlRef.current;
  }, [visible]);

  const observeIfOpen = useCallback(async (): Promise<WebViewObservation | null> => {
    if (!visible || !urlRef.current) {
      return null;
    }
    return await observe();
  }, [observe, visible]);

  const tap = useCallback(
    async (x: number, y: number): Promise<WebViewTapResult> => {
      setStatus(`点击 ${Math.round(x)}, ${Math.round(y)}`);
      return await runScriptRequest<WebViewTapResult>(`
        (function () {
          var id = __REQUEST_ID__;
          var x = ${JSON.stringify(x)};
          var y = ${JSON.stringify(y)};
          var el = document.elementFromPoint(x, y);
          if (!el) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              source: 'ysclaude-webview',
              id: id,
              ok: false,
              error: '坐标位置没有可点击元素'
            }));
            return true;
          }
          var opts = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
            screenX: x,
            screenY: y
          };
          try { el.focus && el.focus(); } catch (e) {}
          try {
            if (window.PointerEvent) {
              el.dispatchEvent(new PointerEvent('pointerdown', opts));
              el.dispatchEvent(new PointerEvent('pointerup', opts));
            }
          } catch (e) {}
          try {
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            el.dispatchEvent(new MouseEvent('click', opts));
          } catch (e) {}
          try { el.click && el.click(); } catch (e) {}
          window.ReactNativeWebView.postMessage(JSON.stringify({
            source: 'ysclaude-webview',
            id: id,
            ok: true,
            data: {
              x: x,
              y: y,
              target: (el.tagName || '').toLowerCase(),
              text: ((el.innerText || el.textContent || el.getAttribute('aria-label') || el.title || '') + '')
                .replace(/\\s+/g, ' ')
                .trim()
                .slice(0, 120)
            }
          }));
        })();
        true;
      `);
    },
    [runScriptRequest]
  );

  const clickElement = useCallback(
    async (index: number): Promise<WebViewTapResult> => {
      setStatus(`点击元素 ${index}`);
      return await runScriptRequest<WebViewTapResult>(buildClickScript({ index }));
    },
    [runScriptRequest]
  );

  const clickSelector = useCallback(
    async (selector: string): Promise<WebViewTapResult> => {
      setStatus(`点击选择器 ${selector}`);
      return await runScriptRequest<WebViewTapResult>(buildClickScript({ selector }));
    },
    [runScriptRequest]
  );

  const wait = useCallback(
    async (ms: number): Promise<WebViewObservation> => {
      const safeMs = Math.min(Math.max(Math.floor(ms), 200), 10000);
      setStatus(`等待 ${safeMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, safeMs));
      return await observe();
    },
    [observe]
  );

  const screenshot = useCallback(async (): Promise<WebViewScreenshot> => {
    if (!visible || !urlRef.current) {
      throw new Error('尚未打开网页');
    }
    if (!webViewCaptureRef.current) {
      throw new Error('网页截图区域尚未准备好');
    }

    setStatus('截取网页画面');
    if (collapsed) {
      setCollapsed(false);
      await new Promise((resolve) => setTimeout(resolve, 220));
    } else {
      await new Promise((resolve) => setTimeout(resolve, 80));
    }

    const dataUrl = await captureRef(webViewCaptureRef.current, {
      format: 'jpg',
      quality: 0.72,
      result: 'data-uri',
    });
    const size = webViewCaptureSizeRef.current;
    setStatus('网页截图已返回给 AI');
    return {
      title: titleRef.current || title,
      url: urlRef.current,
      dataUrl,
      format: 'jpg',
      viewport: {
        width: Math.round(size.width || panelSizeRef.current.width),
        height: Math.round(size.height || panelSizeRef.current.height),
      },
      capturedAt: Date.now(),
    };
  }, [collapsed, title, visible]);

  const open = useCallback(async (
    nextUrl: string,
    options?: WebViewOpenOptions
  ): Promise<WebViewObservation> => {
    const nextUserAgent = options?.userAgent === 'desktop'
      ? DESKTOP_WEBVIEW_USER_AGENT
      : undefined;

    if (visible && urlRef.current === nextUrl && userAgentRef.current === nextUserAgent) {
      setCollapsed(false);
      setStatus('网页已打开，继续观察');
      return await observe();
    }

    setVisible(true);
    setCollapsed(false);
    setLoading(true);
    setStatus('打开网页');
    setTitle('');
    titleRef.current = '';
    setCanGoBack(false);
    userAgentRef.current = nextUserAgent;
    setWebViewUserAgent(nextUserAgent);
    setWebViewReloadKey((key) => key + 1);
    urlRef.current = nextUrl;
    setUrl(nextUrl);
    setAddressInput(nextUrl);

    return await new Promise<WebViewObservation>((resolve, reject) => {
      if (pendingOpen.current) {
        clearTimeout(pendingOpen.current.timeout);
        pendingOpen.current.reject(new Error('新的网页打开请求已开始'));
      }
      pendingOpen.current = {
        resolve,
        reject,
        timeout: setTimeout(() => {
          pendingOpen.current = null;
          setLoading(false);
          reject(new Error('网页加载超时'));
        }, OPEN_TIMEOUT_MS),
      };
    });
  }, [observe, visible]);

  useEffect(() => {
    return registerWebViewHost({ show, isOpen, observeIfOpen, open, observe, tap, clickElement, clickSelector, wait, screenshot });
  }, [clickElement, clickSelector, isOpen, observe, observeIfOpen, open, show, tap, wait, screenshot]);

  useEffect(() => {
    urlRef.current = url;
  }, [url]);

  const handleLoadEnd = async () => {
    setLoading(false);
    setStatus('网页已打开');
    injectPageAdjustments();
    if (pendingOpen.current) {
      const pending = pendingOpen.current;
      pendingOpen.current = null;
      clearTimeout(pending.timeout);
      try {
        await new Promise((resolve) => setTimeout(resolve, 120));
        const observation = await observe();
        pending.resolve(observation);
      } catch (err) {
        pending.reject(err);
      }
    }
  };

  const handleNavigationStateChange = (navState: any) => {
    const nextTitle = navState.title || '';
    const nextUrl = navState.url || urlRef.current;
    titleRef.current = nextTitle;
    urlRef.current = nextUrl;
    setTitle(nextTitle);
    setUrl(nextUrl);
    setAddressInput(nextUrl);
    setCanGoBack(!!navState.canGoBack);
  };

  const openInSystemBrowser = useCallback(async (targetUrl = urlRef.current, nextStatus = '已在系统浏览器打开') => {
    const externalUrl = normalizeExternalBrowserUrl(targetUrl);
    setShowWebMenu(false);
    setShowClearDataMenu(false);
    setShowBookmarks(false);

    if (!externalUrl) {
      setStatus('当前网址无法用系统浏览器打开');
      return;
    }

    try {
      setStatus('正在打开系统浏览器');
      await Linking.openURL(externalUrl);
      setStatus(nextStatus);
    } catch (err) {
      console.warn('[WebView] open external browser failed:', err);
      setStatus('无法打开系统浏览器');
    }
  }, []);

  const handleShouldStartLoadWithRequest = useCallback((request: any) => {
    const requestUrl = typeof request?.url === 'string' ? request.url : '';
    if (!requestUrl || requestUrl === 'about:blank') {
      return true;
    }

    if (shouldOpenGoogleAuthExternally(requestUrl)) {
      const now = Date.now();
      const lastOpen = lastExternalAuthOpenRef.current;
      if (!lastOpen || lastOpen.url !== requestUrl || now - lastOpen.openedAt > EXTERNAL_AUTH_OPEN_COOLDOWN_MS) {
        lastExternalAuthOpenRef.current = { url: requestUrl, openedAt: now };
        void openInSystemBrowser(requestUrl, 'Google 登录已转到系统浏览器');
      }
      setStatus('Google 登录需要系统浏览器');
      return false;
    }

    return true;
  }, [openInSystemBrowser]);

  const handleMessage = (event: WebViewMessageEvent) => {
    let payload: any;
    try {
      payload = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (payload?.source !== 'ysclaude-webview' || !payload.id) return;

    const pending = pendingRequests.current[payload.id];
    if (!pending) return;
    clearTimeout(pending.timeout);
    delete pendingRequests.current[payload.id];

    if (payload.ok) {
      if (payload.data?.title !== undefined) {
        titleRef.current = payload.data.title;
        setTitle(payload.data.title);
      }
      if (payload.data?.url) {
        urlRef.current = payload.data.url;
        setUrl(payload.data.url);
        setAddressInput(payload.data.url);
      }
      pending.resolve(payload.data);
    } else {
      pending.reject(new Error(payload.error || '网页操作失败'));
    }
  };

  const openUrl = (nextUrl: string, nextTitle = '') => {
    urlRef.current = nextUrl;
    setUrl(nextUrl);
    setAddressInput(nextUrl);
    setTitle(nextTitle);
    titleRef.current = nextTitle;
    setCanGoBack(false);
    setLoading(true);
    setStatus('打开网页');
    setShowBookmarks(false);
    setShowWebMenu(false);
    setWebViewReloadKey((key) => key + 1);
  };

  const handleSubmitAddress = () => {
    const nextUrl = normalizeAddressInput(addressInput);
    if (!nextUrl) {
      setStatus('请输入有效网址');
      return;
    }
    openUrl(nextUrl);
  };

  const handleSubmitHomeSearch = () => {
    const query = homeSearch.trim();
    if (!query) return;
    const directUrl = normalizeAddressInput(query);
    const nextUrl = directUrl || `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
    openUrl(nextUrl);
  };

  const handleGoBack = () => {
    if (!canGoBack) return;
    setShowWebMenu(false);
    webViewRef.current?.goBack();
  };

  const handleReload = () => {
    if (!urlRef.current) return;
    setShowWebMenu(false);
    setLoading(true);
    setStatus('刷新网页');
    webViewRef.current?.reload();
  };

  const handleTranslateCurrentPage = () => {
    const translatedUrl = buildGoogleTranslateUrl(urlRef.current);
    if (!translatedUrl) {
      setStatus('当前网页无法翻译');
      setShowWebMenu(false);
      return;
    }
    openUrl(translatedUrl, titleRef.current ? `${titleRef.current} - Google 翻译` : 'Google 翻译');
    setStatus('正在使用 Google 翻译打开');
  };

  const clearBrowserCache = () => {
    webViewRef.current?.clearCache(true);
    setShowClearDataMenu(false);
    setShowWebMenu(false);
    setStatus('已清除网页缓存');
  };

  const clearAllBrowserData = () => {
    webViewRef.current?.clearCache(true);
    if (urlRef.current) {
      webViewRef.current?.injectJavaScript(CLEAR_CURRENT_SITE_DATA_SCRIPT);
      setTimeout(() => {
        if (urlRef.current) {
          setWebViewReloadKey((key) => key + 1);
        }
      }, 120);
    }
    setShowClearDataMenu(false);
    setShowWebMenu(false);
    setStatus('已清除缓存和当前站点数据');
  };

  const toggleUserAgent = () => {
    const nextUserAgent = webViewUserAgent ? undefined : DESKTOP_WEBVIEW_USER_AGENT;
    userAgentRef.current = nextUserAgent;
    setWebViewUserAgent(nextUserAgent);
    setShowWebMenu(false);
    setShowClearDataMenu(false);
    if (urlRef.current) {
      setLoading(true);
      setStatus(nextUserAgent ? '切换为网页端 UA' : '切换为移动端 UA');
      setWebViewReloadKey((key) => key + 1);
    }
  };

  const handleCollapse = () => {
    const currentPosition = panelPositionRef.current;
    const currentSize = panelSizeRef.current;
    setCollapsedIconPosition(
      snapCollapsedIcon(
        currentPosition.x + currentSize.width / 2 - COLLAPSED_ICON_SIZE / 2,
        currentPosition.y,
        insetTopRef.current
      )
    );
    setCollapsed(true);
    setShowWebMenu(false);
    setShowClearDataMenu(false);
  };

  const handleClose = () => {
    setVisible(false);
    setCollapsed(false);
    urlRef.current = '';
    titleRef.current = '';
    setUrl('');
    setAddressInput('');
    setHomeSearch('');
    setTitle('');
    setCanGoBack(false);
    setLoading(false);
    setShowBookmarks(false);
    userAgentRef.current = undefined;
    setWebViewUserAgent(undefined);
    setShowWebMenu(false);
    setShowClearDataMenu(false);
  };

  const persistBookmarkList = async (nextBookmarks: WebBookmark[]) => {
    setBookmarks(nextBookmarks);
    try {
      await saveWebBookmarks(nextBookmarks);
    } catch (err) {
      console.warn('[WebView] save bookmarks failed:', err);
      setStatus('收藏保存失败');
    }
  };

  const openBookmark = (bookmark: WebBookmark) => {
    openUrl(bookmark.url, bookmark.title);
  };

  const removeBookmark = async (id: string) => {
    await persistBookmarkList(bookmarks.filter((bookmark) => bookmark.id !== id));
  };

  const toggleBookmark = async () => {
    const currentUrl = urlRef.current;
    if (!currentUrl) {
      setStatus('先打开网页再收藏');
      setShowWebMenu(false);
      return;
    }

    const existing = bookmarks.find((bookmark) => bookmark.url === currentUrl);
    if (existing) {
      await persistBookmarkList(bookmarks.filter((bookmark) => bookmark.id !== existing.id));
      setStatus('已取消收藏');
      setShowWebMenu(false);
      return;
    }

    const nextBookmark: WebBookmark = {
      id: randomUUID(),
      title: titleRef.current || title || currentUrl,
      url: currentUrl,
      createdAt: Date.now(),
    };
    await persistBookmarkList([
      nextBookmark,
      ...bookmarks.filter((bookmark) => bookmark.url !== currentUrl),
    ].slice(0, MAX_WEB_BOOKMARKS));
    setStatus('已收藏网页');
    setShowWebMenu(false);
  };

  if (!visible) return null;

  const isCurrentBookmarked = !!url && bookmarks.some((bookmark) => bookmark.url === url);
  const expandedPanelStyle = [
    styles.panel,
    {
      left: panelPosition.x,
      top: panelPosition.y,
      width: panelSize.width,
      height: panelSize.height,
    },
  ];
  const panelStyle = collapsed
    ? [
        styles.hiddenPanel,
        {
          width: panelSize.width,
          height: panelSize.height,
        },
      ]
    : expandedPanelStyle;

  return (
    <>
    <View style={panelStyle} pointerEvents={collapsed ? 'none' : 'auto'}>
      <View style={styles.header} {...dragResponder.panHandlers}>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {title || '网页交互'}
          </Text>
          <Text style={styles.url} numberOfLines={1}>
            {url}
          </Text>
        </View>
        {loading && <ActivityIndicator size="small" color={colors.primary} />}
        <Pressable style={styles.modeButton} onPress={handleCollapse}>
          <Text style={styles.modeButtonText}>收起</Text>
        </Pressable>
        <Pressable style={styles.closeButton} onPress={handleClose}>
          <Text style={styles.closeText}>关闭</Text>
        </Pressable>
      </View>
      <View style={styles.addressRow}>
        <TextInput
          value={addressInput}
          onChangeText={setAddressInput}
          onSubmitEditing={handleSubmitAddress}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          placeholder="输入网址"
          placeholderTextColor={colors.textTertiary}
          style={styles.addressInput}
        />
        <Pressable style={styles.menuButton} onPress={() => setShowWebMenu((current) => !current)}>
          <Text style={styles.menuButtonText}>⋯</Text>
        </Pressable>
      </View>
      {showWebMenu && (
        <View style={styles.webMenu}>
          <Pressable
            style={[styles.webMenuItem, !canGoBack && styles.webMenuItemDisabled]}
            onPress={handleGoBack}
            disabled={!canGoBack}
          >
            <Text style={[styles.webMenuText, !canGoBack && styles.webMenuTextDisabled]}>回退</Text>
          </Pressable>
          <Pressable
            style={[styles.webMenuItem, !url && styles.webMenuItemDisabled]}
            onPress={handleReload}
            disabled={!url}
          >
            <Text style={[styles.webMenuText, !url && styles.webMenuTextDisabled]}>刷新</Text>
          </Pressable>
          <Pressable
            style={[styles.webMenuItem, !url && styles.webMenuItemDisabled]}
            onPress={toggleBookmark}
            disabled={!url}
          >
            <Text style={[styles.webMenuText, !url && styles.webMenuTextDisabled]}>
              {isCurrentBookmarked ? '取消收藏' : '收藏网页'}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.webMenuItem, !url && styles.webMenuItemDisabled]}
            onPress={handleTranslateCurrentPage}
            disabled={!url}
          >
            <Text style={[styles.webMenuText, !url && styles.webMenuTextDisabled]}>翻译当前页</Text>
          </Pressable>
          <Pressable
            style={[styles.webMenuItem, !url && styles.webMenuItemDisabled]}
            onPress={() => openInSystemBrowser()}
            disabled={!url}
          >
            <Text style={[styles.webMenuText, !url && styles.webMenuTextDisabled]}>系统浏览器打开</Text>
          </Pressable>
          <Pressable style={styles.webMenuItem} onPress={toggleUserAgent}>
            <Text style={styles.webMenuText}>{webViewUserAgent ? '切换移动端 UA' : '切换网页端 UA'}</Text>
          </Pressable>
          <Pressable
            style={[styles.webMenuItem, showBookmarks && styles.webMenuItemActive]}
            onPress={() => {
              setShowBookmarks((current) => !current);
              setShowWebMenu(false);
            }}
          >
            <Text style={styles.webMenuText}>收藏夹</Text>
          </Pressable>
          <Pressable
            style={[
              styles.webMenuItem,
              showClearDataMenu && styles.webMenuItemActive,
              !url && styles.webMenuItemDisabled,
            ]}
            onPress={() => {
              setShowBookmarks(false);
              setShowClearDataMenu((current) => !current);
            }}
            disabled={!url}
          >
            <Text style={[styles.webMenuText, !url && styles.webMenuTextDisabled]}>清除浏览数据</Text>
          </Pressable>
          {showClearDataMenu && (
            <View style={styles.clearDataOptions}>
              <Pressable style={styles.clearDataItem} onPress={clearBrowserCache}>
                <Text style={styles.clearDataTitle}>清除缓存</Text>
                <Text style={styles.clearDataDescription}>图片和网页缓存</Text>
              </Pressable>
              <Pressable style={styles.clearDataItem} onPress={clearAllBrowserData}>
                <Text style={styles.clearDataTitle}>清除所有数据</Text>
                <Text style={styles.clearDataDescription}>缓存、Cookie 和当前站点存储</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}
      {showBookmarks && (
        <View style={styles.bookmarkPanel}>
          {bookmarks.length === 0 ? (
            <Text style={styles.emptyBookmarksText}>暂无收藏网页</Text>
          ) : (
            <ScrollView style={styles.bookmarkList} keyboardShouldPersistTaps="handled">
              {bookmarks.map((bookmark) => (
                <View key={bookmark.id} style={styles.bookmarkItem}>
                  <Pressable style={styles.bookmarkTextBlock} onPress={() => openBookmark(bookmark)}>
                    <Text style={styles.bookmarkTitle} numberOfLines={1}>
                      {bookmark.title || bookmark.url}
                    </Text>
                    <Text style={styles.bookmarkUrl} numberOfLines={1}>
                      {bookmark.url}
                    </Text>
                  </Pressable>
                  <Pressable style={styles.bookmarkDeleteButton} onPress={() => removeBookmark(bookmark.id)}>
                    <Text style={styles.bookmarkDeleteText}>删除</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      )}
      {url ? (
        <View
          ref={webViewCaptureRef}
          collapsable={false}
          style={styles.webviewCapture}
          onLayout={(event) => {
            webViewCaptureSizeRef.current = {
              width: event.nativeEvent.layout.width,
              height: event.nativeEvent.layout.height,
            };
          }}
        >
          <WebView
            key={webViewReloadKey}
            ref={webViewRef}
            source={{ uri: url }}
            style={styles.webview}
            javaScriptEnabled
            domStorageEnabled
            userAgent={webViewUserAgent}
            scrollEnabled
            nestedScrollEnabled
            scalesPageToFit
            setBuiltInZoomControls
            setDisplayZoomControls={false}
            directionalLockEnabled={false}
            bounces
            overScrollMode="always"
            showsHorizontalScrollIndicator
            showsVerticalScrollIndicator
            onLoadEnd={handleLoadEnd}
            onMessage={handleMessage}
            onNavigationStateChange={handleNavigationStateChange}
            onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
            injectedJavaScript={`${webViewUserAgent ? DESKTOP_LAYOUT_SCROLL_SCRIPT : ''}\n${LOGIN_OVERLAY_CLEANUP_SCRIPT}`}
            setSupportMultipleWindows={false}
          />
        </View>
      ) : (
        <ScrollView
          style={styles.homeView}
          contentContainerStyle={styles.homeContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.homeTitle}>网页首页</Text>
          <View style={styles.homeSearchRow}>
            <TextInput
              value={homeSearch}
              onChangeText={setHomeSearch}
              onSubmitEditing={handleSubmitHomeSearch}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              placeholder="使用 Bing 搜索或输入网址"
              placeholderTextColor={colors.textTertiary}
              style={styles.homeSearchInput}
            />
          </View>
          <Text style={styles.homeSectionTitle}>快捷方式</Text>
          {bookmarks.length === 0 ? (
            <Text style={styles.emptyWebViewText}>暂无收藏网页</Text>
          ) : (
            <View style={styles.shortcutGrid}>
              {bookmarks.map((bookmark) => (
                <Pressable
                  key={bookmark.id}
                  style={styles.shortcutItem}
                  onPress={() => openBookmark(bookmark)}
                >
                  <Text style={styles.shortcutIcon}>
                    {(bookmark.title || bookmark.url).trim().slice(0, 1).toUpperCase()}
                  </Text>
                  <Text style={styles.shortcutTitle} numberOfLines={2}>
                    {bookmark.title || bookmark.url}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      )}
      <View style={styles.footer}>
        <Text style={styles.footerText} numberOfLines={1}>
          {status || '就绪'}
        </Text>
        <View style={styles.resizeHandle} {...resizeResponder.panHandlers}>
          <Text style={styles.resizeHandleText}>⌟</Text>
        </View>
      </View>
    </View>
    {collapsed && (
      <View
        style={[styles.collapsedIconWrap, { left: collapsedIconPosition.x, top: collapsedIconPosition.y }]}
        {...collapsedIconResponder.panHandlers}
      >
        <Pressable style={styles.collapsedIconButton} onPress={() => setCollapsed(false)}>
          <Image source={require('../../assets/web.png')} style={styles.collapsedIconImage} resizeMode="contain" />
        </Pressable>
      </View>
    )}
    </>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  panel: {
    position: 'absolute',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  hiddenPanel: {
    position: 'absolute',
    left: -10000,
    top: 0,
    opacity: 0,
    overflow: 'hidden',
  },
  header: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerText: {
    flex: 1,
  },
  title: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  url: {
    marginTop: 2,
    color: colors.textTertiary,
    fontSize: 11,
  },
  closeButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  closeText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
  modeButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  modeButtonText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  menuButtonText: {
    color: colors.textSecondary,
    fontSize: 22,
    fontWeight: '600',
    lineHeight: 24,
  },
  addressInput: {
    flex: 1,
    minHeight: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBackground,
    color: colors.text,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
  },
  webMenu: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  webMenuItem: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  webMenuItemActive: {
    backgroundColor: colors.primary,
  },
  webMenuItemDisabled: {
    opacity: 0.45,
  },
  webMenuText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  webMenuTextDisabled: {
    color: colors.textTertiary,
  },
  webviewCapture: {
    flex: 1,
    backgroundColor: colors.background,
  },
  clearDataOptions: {
    width: '100%',
    gap: 8,
    paddingTop: 2,
  },
  clearDataItem: {
    minHeight: 54,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  clearDataTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  clearDataDescription: {
    marginTop: 3,
    color: colors.textTertiary,
    fontSize: 11,
  },
  bookmarkPanel: {
    maxHeight: 220,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  bookmarkList: {
    maxHeight: 220,
  },
  bookmarkItem: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  bookmarkTextBlock: {
    flex: 1,
  },
  bookmarkTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  bookmarkUrl: {
    marginTop: 3,
    color: colors.textTertiary,
    fontSize: 11,
  },
  bookmarkDeleteButton: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  bookmarkDeleteText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '500',
  },
  emptyBookmarksText: {
    paddingHorizontal: 12,
    paddingVertical: 14,
    color: colors.textTertiary,
    fontSize: 13,
    textAlign: 'center',
  },
  webview: {
    flex: 1,
    backgroundColor: colors.background,
  },
  homeView: {
    flex: 1,
    backgroundColor: colors.background,
  },
  homeContent: {
    padding: 18,
  },
  homeTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 14,
  },
  homeSearchRow: {
    marginBottom: 18,
  },
  homeSearchInput: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBackground,
    color: colors.text,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 15,
  },
  homeSectionTitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 10,
  },
  shortcutGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  shortcutItem: {
    width: 92,
    minHeight: 94,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  shortcutIcon: {
    width: 34,
    height: 34,
    lineHeight: 34,
    borderRadius: 17,
    overflow: 'hidden',
    backgroundColor: colors.inputBackground,
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  shortcutTitle: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
    textAlign: 'center',
  },
  emptyWebViewText: {
    color: colors.textTertiary,
    fontSize: 13,
  },
  collapsedIconWrap: {
    position: 'absolute',
    width: COLLAPSED_ICON_SIZE,
    height: COLLAPSED_ICON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collapsedIconButton: {
    width: COLLAPSED_ICON_SIZE,
    height: COLLAPSED_ICON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  collapsedIconImage: {
    width: 24,
    height: 24,
  },
  footer: {
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerText: {
    flex: 1,
    color: colors.textTertiary,
    fontSize: 11,
  },
  resizeHandle: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -10,
  },
  resizeHandleText: {
    color: colors.textTertiary,
    fontSize: 18,
    lineHeight: 20,
  },
});

let styles = createStyles(colors);
