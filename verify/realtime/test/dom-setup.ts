// Browser-like globals for the client test: jsdom for React, the `eventsource` package for EventSource
import { EventSource as NodeEventSource, type EventSourceInit } from 'eventsource';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
export const browser = { cookie: '' };   // what the browser's cookie jar would send

// Node has no cookie jar: send the session cookie the way a browser does with withCredentials
class CookieEventSource extends NodeEventSource {
  constructor(url: string | URL, init?: EventSourceInit) {
    super(url, { ...init, fetch: (u, i) => fetch(u, { ...i, headers: { ...i.headers, cookie: browser.cookie } }) });
  }
}

Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  EventSource: CookieEventSource,
  IS_REACT_ACT_ENVIRONMENT: false,
});
