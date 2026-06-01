export interface WebViewObservation {
  title: string;
  url: string;
  text: string;
  viewport: {
    width: number;
    height: number;
  };
  elements: {
    index: number;
    tag: string;
    text: string;
    role: string;
    selector: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
}

export interface WebViewTapResult {
  x: number;
  y: number;
  target: string;
  text: string;
  selector?: string;
}

export interface WebViewOpenOptions {
  userAgent?: 'desktop';
}

export interface WebViewHostActions {
  open: (url: string, options?: WebViewOpenOptions) => Promise<WebViewObservation>;
  observe: () => Promise<WebViewObservation>;
  tap: (x: number, y: number) => Promise<WebViewTapResult>;
  clickElement: (index: number) => Promise<WebViewTapResult>;
  clickSelector: (selector: string) => Promise<WebViewTapResult>;
  wait: (ms: number) => Promise<WebViewObservation>;
}

let hostActions: WebViewHostActions | null = null;

export function registerWebViewHost(actions: WebViewHostActions): () => void {
  hostActions = actions;
  return () => {
    if (hostActions === actions) {
      hostActions = null;
    }
  };
}

function getHostActions(): WebViewHostActions {
  if (!hostActions) {
    throw new Error('网页交互面板尚未就绪');
  }
  return hostActions;
}

export async function openWebView(
  url: string,
  options?: WebViewOpenOptions
): Promise<WebViewObservation> {
  return getHostActions().open(url, options);
}

export async function observeWebView(): Promise<WebViewObservation> {
  return getHostActions().observe();
}

export async function tapWebView(x: number, y: number): Promise<WebViewTapResult> {
  return getHostActions().tap(x, y);
}

export async function clickWebViewElement(index: number): Promise<WebViewTapResult> {
  return getHostActions().clickElement(index);
}

export async function clickWebViewSelector(selector: string): Promise<WebViewTapResult> {
  return getHostActions().clickSelector(selector);
}

export async function waitWebView(ms: number): Promise<WebViewObservation> {
  return getHostActions().wait(ms);
}
