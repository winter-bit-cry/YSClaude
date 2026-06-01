import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import { colors } from '../theme/colors';
import {
  registerWebViewHost,
  WebViewObservation,
  WebViewOpenOptions,
  WebViewTapResult,
} from '../services/webviewController';

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const REQUEST_TIMEOUT_MS = 12000;
const OPEN_TIMEOUT_MS = 20000;
const MAX_OBSERVE_TEXT = 12000;
const MAX_ELEMENTS = 40;
const PANEL_MARGIN = 12;
const DEFAULT_PANEL_HEIGHT = 420;
const DEFAULT_PANEL_WIDTH = Dimensions.get('window').width - PANEL_MARGIN * 2;
const MIN_PANEL_WIDTH = 260;
const MIN_PANEL_HEIGHT = 280;
const DESKTOP_WEBVIEW_MIN_WIDTH = 1280;
const DESKTOP_WEBVIEW_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

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
      viewport.setAttribute('content', 'width=' + minWidth + ', initial-scale=1');

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
        '  touch-action: pan-x pan-y;',
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

export function WebViewPanel() {
  const webViewRef = useRef<WebView>(null);
  const pendingRequests = useRef<Record<string, PendingRequest>>({});
  const pendingOpen = useRef<PendingRequest | null>(null);
  const urlRef = useRef('');
  const titleRef = useRef('');
  const userAgentRef = useRef<string | undefined>(undefined);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [webViewUserAgent, setWebViewUserAgent] = useState<string | undefined>(undefined);
  const [webViewReloadKey, setWebViewReloadKey] = useState(0);
  const [panelSize, setPanelSize] = useState({
    width: DEFAULT_PANEL_WIDTH,
    height: DEFAULT_PANEL_HEIGHT,
  });
  const [panelPosition, setPanelPosition] = useState(() => {
    const { height } = Dimensions.get('window');
    return { x: PANEL_MARGIN, y: Math.max(PANEL_MARGIN, height - DEFAULT_PANEL_HEIGHT - 92) };
  });
  const dragStart = useRef(panelPosition);
  const resizeStart = useRef(panelSize);

  const clampPanelSize = useCallback((width: number, height: number, x = panelPosition.x, y = panelPosition.y) => {
    const screen = Dimensions.get('window');
    return {
      width: Math.min(Math.max(MIN_PANEL_WIDTH, width), Math.max(MIN_PANEL_WIDTH, screen.width - x - PANEL_MARGIN)),
      height: Math.min(Math.max(MIN_PANEL_HEIGHT, height), Math.max(MIN_PANEL_HEIGHT, screen.height - y - PANEL_MARGIN)),
    };
  }, [panelPosition.x, panelPosition.y]);

  const clampPanelPosition = useCallback((x: number, y: number, size = panelSize) => {
    const { width, height } = Dimensions.get('window');
    return {
      x: Math.min(Math.max(PANEL_MARGIN, x), Math.max(PANEL_MARGIN, width - size.width - PANEL_MARGIN)),
      y: Math.min(Math.max(PANEL_MARGIN, y), Math.max(PANEL_MARGIN, height - size.height - PANEL_MARGIN)),
    };
  }, [panelSize]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) =>
        Math.abs(gestureState.dx) > 3 || Math.abs(gestureState.dy) > 3,
      onPanResponderGrant: () => {
        dragStart.current = panelPosition;
      },
      onPanResponderMove: (_, gestureState) => {
        setPanelPosition(
          clampPanelPosition(
            dragStart.current.x + gestureState.dx,
            dragStart.current.y + gestureState.dy
          )
        );
      },
      onPanResponderRelease: (_, gestureState) => {
        setPanelPosition(
          clampPanelPosition(
            dragStart.current.x + gestureState.dx,
            dragStart.current.y + gestureState.dy
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
        resizeStart.current = panelSize;
      },
      onPanResponderMove: (_, gestureState) => {
        setPanelSize(
          clampPanelSize(
            resizeStart.current.width + gestureState.dx,
            resizeStart.current.height + gestureState.dy
          )
        );
      },
      onPanResponderRelease: (_, gestureState) => {
        setPanelSize(
          clampPanelSize(
            resizeStart.current.width + gestureState.dx,
            resizeStart.current.height + gestureState.dy
          )
        );
      },
    })
  ).current;

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

  const open = useCallback(async (
    nextUrl: string,
    options?: WebViewOpenOptions
  ): Promise<WebViewObservation> => {
    const nextUserAgent = options?.userAgent === 'desktop'
      ? DESKTOP_WEBVIEW_USER_AGENT
      : undefined;

    if (visible && urlRef.current === nextUrl && userAgentRef.current === nextUserAgent) {
      setStatus('网页已打开，继续观察');
      return await observe();
    }

    setVisible(true);
    setLoading(true);
    setStatus('打开网页');
    setTitle('');
    titleRef.current = '';
    userAgentRef.current = nextUserAgent;
    setWebViewUserAgent(nextUserAgent);
    setWebViewReloadKey((key) => key + 1);
    urlRef.current = nextUrl;
    setUrl(nextUrl);

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
    return registerWebViewHost({ open, observe, tap, clickElement, clickSelector, wait });
  }, [clickElement, clickSelector, observe, open, tap, wait]);

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
  };

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
      }
      pending.resolve(payload.data);
    } else {
      pending.reject(new Error(payload.error || '网页操作失败'));
    }
  };

  if (!visible) return null;

  return (
    <View style={[styles.panel, { left: panelPosition.x, top: panelPosition.y, width: panelSize.width, height: panelSize.height }]}>
      <View style={styles.header} {...panResponder.panHandlers}>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {title || '网页交互'}
          </Text>
          <Text style={styles.url} numberOfLines={1}>
            {url}
          </Text>
        </View>
        {loading && <ActivityIndicator size="small" color={colors.primary} />}
        <Pressable style={styles.closeButton} onPress={() => setVisible(false)}>
          <Text style={styles.closeText}>关闭</Text>
        </Pressable>
      </View>
      <WebView
        key={webViewReloadKey}
        ref={webViewRef}
        source={{ uri: url }}
        style={styles.webview}
        javaScriptEnabled
        domStorageEnabled
        userAgent={webViewUserAgent}
        scrollEnabled
        showsHorizontalScrollIndicator
        showsVerticalScrollIndicator
        onLoadEnd={handleLoadEnd}
        onMessage={handleMessage}
        onNavigationStateChange={handleNavigationStateChange}
        injectedJavaScript={`${webViewUserAgent ? DESKTOP_LAYOUT_SCROLL_SCRIPT : ''}\n${LOGIN_OVERLAY_CLEANUP_SCRIPT}`}
        setSupportMultipleWindows={false}
      />
      <View style={styles.footer}>
        <Text style={styles.footerText} numberOfLines={1}>
          {status || '就绪'}
        </Text>
        <View style={styles.resizeHandle} {...resizeResponder.panHandlers}>
          <Text style={styles.resizeHandleText}>⌟</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
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
  webview: {
    flex: 1,
    backgroundColor: '#FFFFFF',
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
