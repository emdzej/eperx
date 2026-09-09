/// <reference lib="webworker" />
import { opfsRoot } from "./lib/opfs-namespace";

export {};

declare global {
  /**
   * The plugin's injection point. Declared as a global rather than by
   * redeclaring `self`, which `lib.webworker` already owns.
   */
  var __WB_MANIFEST: { url: string; revision: string | null }[];
}

/**
 * `self`, as what it actually is: `lib.webworker` types it as a
 * `WorkerGlobalScope`, which has no `registration`, `clients` or
 * `skipWaiting`.
 */
const sw = self as unknown as ServiceWorkerGlobalScope;
/*
 * eperx local data service worker.
 *
 * Serves an imported tree from the user's own machine over HTTP, so that
 * everything above it — `sqlite-wasm-http` and `HttpSource` alike — keeps
 * speaking `Range` and needs no local-file code path at all.
 *
 * Why a service worker rather than reading the files directly: SQLite's VFS
 * reads are **synchronous**, and the only synchronous file access a browser
 * offers is `createSyncAccessHandle()`, which works on OPFS files and nothing
 * else. A directory the user picked can only be read asynchronously. Answering
 * `fetch` is asynchronous by nature, so routing through a worker turns the
 * async file API into the one thing SQLite can consume: an HTTP range request.
 *
 * The alternative was copying `catalogue.sqlite` into OPFS just so SQLite
 * could read it — 568 MB duplicated to open a folder. This copies nothing.
 *
 * Two mounts, resolved the same way:
 *
 *   /__eperx/directory/...  a FileSystemDirectoryHandle the page sent over
 *   /__eperx/opfs/...       the origin private file system
 *
 * Anything not under `/__eperx/` is left alone, so Vite's dev client and HMR
 * are untouched.
 */

/*
 * Derived from the registration scope rather than hardcoded, so the worker
 * serves `/__eperx/...` at a domain root and `/eperx/__eperx/...` under a
 * repository-prefixed Pages deploy. Hardcoding the root path meant every
 * fetch fell through to the network on a prefixed deploy — a 404 that reads
 * as a missing file.
 */
const PREFIX = new URL("__eperx/", sw.registration.scope).pathname;

/** Mount name → FileSystemDirectoryHandle. */
const mounts = new Map();

/** Resolved file handles, keyed `mount:path`. Directory walks are not free. */
const handles = new Map();

sw.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll([...SHELL]);
      // Take over straight away: a page that registered the worker must not
      // have to reload before its own fetches are intercepted. There is no
      // half-updated state to protect — the shell holds no data, and a tree is
      // opened fresh on every load.
      await sw.skipWaiting();
    })(),
  );
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name !== CACHE && name.startsWith("eperx-shell-")) await caches.delete(name);
      }
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || typeof message !== "object") return;

  if (message.type === "mount") {
    mounts.set(message.mount, message.handle ?? null);
    // Handles for a previous mount of the same name are stale.
    for (const key of handles.keys()) {
      if (key.startsWith(`${message.mount}:`)) handles.delete(key);
    }
    event.source?.postMessage({ type: "mounted", mount: message.mount });
    return;
  }

  if (message.type === "ping") {
    event.source?.postMessage({ type: "pong", mounts: [...mounts.keys()] });
  }
});

/*
 * The second job: the app shell, so eperx opens with no network.
 *
 * Adding this to the *same* worker is not a choice — there is one worker per
 * scope, and this one already exists to serve local files. That makes the
 * ordering below load-bearing rather than tidy.
 *
 * **A cached `200` must never answer a `Range` request.** Every read of
 * `catalogue.sqlite` is "4 kB at this offset", and a worker that answered one
 * with a whole cached file would return the wrong bytes at every offset while
 * SQLite decoded plausible garbage and reported nothing. So: `/__eperx/` is
 * handled first and answers its own `206`; then ranges bail outright; and only
 * then is a *whitelist* of precached shell URLs consulted. A
 * "cache-first, network-fallback" default would eventually make exactly that
 * mistake.
 */

/** Bumped by the build, so a new release replaces the shell wholesale. */
const CACHE = `eperx-shell-${__APP_VERSION__}`;

/**
 * The shell, as absolute URLs — which is what `cache.match` compares against.
 *
 * `self.__WB_MANIFEST` is the injection point and the spelling is not
 * negotiable: the plugin scans the source for that literal and refuses the
 * build without it.
 */
const SHELL = new Set(
  self.__WB_MANIFEST.map((entry) => new URL(entry.url, self.location.href).href),
);

const INDEX = new URL("index.html", sw.registration.scope).href;

sw.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Local data, first and always. This is the reason the worker exists, and it
  // answers ranges itself.
  if (url.origin === self.location.origin && url.pathname.startsWith(PREFIX)) {
    event.respondWith(serve(request, url));
    return;
  }

  if (request.method !== "GET") return;

  /*
   * A ranged read belongs to whoever asked for it. Redundant given the
   * whitelist below — no shell file is ever fetched with a `Range` — and it
   * stays because it is the one mistake that would be silent. See above.
   */
  if (request.headers.has("range")) return;

  /*
   * A navigation is answered from the cached index so the app opens offline.
   * `index.html` rather than the requested URL, because the client is one page
   * and every path within it resolves to that document.
   */
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cached = await caches.match(INDEX, { cacheName: CACHE });
        return cached ?? fetch(request);
      })(),
    );
    return;
  }

  // Everything else is left alone unless it is part of the shell.
  if (!SHELL.has(url.href)) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(url.href, { cacheName: CACHE });
      if (cached) return cached;
      // Missing from the cache means a partial install: fetch it and put it
      // back rather than failing the load.
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(url.href, response.clone());
      }
      return response;
    })(),
  );
});

async function serve(request: Request, url: URL): Promise<Response> {
  const rest = url.pathname.slice(PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return new Response("bad mount path", { status: 400 });

  const mount = rest.slice(0, slash);
  const path = decodeURIComponent(rest.slice(slash + 1));

  let file;
  try {
    file = await resolve(mount, path);
  } catch (error) {
    return new Response(String(error), { status: 404 });
  }
  if (!file) return new Response(`${path} not found in ${mount}`, { status: 404 });

  const headers = {
    "Accept-Ranges": "bytes",
    "Content-Type": contentType(path),
    // A local file is immutable for the life of a mount, and the catalogue is
    // read a page at a time — letting the HTTP cache keep those pages saves
    // re-reading the same bytes off disk on every query.
    "Cache-Control": "no-store",
  };

  const range = request.headers.get("range");
  if (!range) {
    if (request.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: { ...headers, "Content-Length": String(file.size) },
      });
    }
    return new Response(file, { status: 200, headers });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match) {
    return new Response(null, {
      status: 416,
      headers: { ...headers, "Content-Range": `bytes */${file.size}` },
    });
  }

  let start;
  let end;
  if (match[1] === "") {
    // A suffix range: the last N bytes. This is how a ZIP's end-of-central
    // directory gets found, so it is not hypothetical.
    const suffix = Number(match[2]);
    start = Math.max(0, file.size - suffix);
    end = file.size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? file.size - 1 : Math.min(Number(match[2]), file.size - 1);
  }

  if (!Number.isFinite(start) || start > end || start >= file.size) {
    return new Response(null, {
      status: 416,
      headers: { ...headers, "Content-Range": `bytes */${file.size}` },
    });
  }

  const body = request.method === "HEAD" ? null : file.slice(start, end + 1);
  return new Response(body, {
    status: 206,
    headers: {
      ...headers,
      "Content-Range": `bytes ${start}-${end}/${file.size}`,
      "Content-Length": String(end - start + 1),
    },
  });
}

/** Resolve `path` inside a mount to a `File`. */
async function resolve(mount: string, path: string): Promise<File | undefined> {
  const cacheKey = `${mount}:${path}`;
  const cached = handles.get(cacheKey);
  if (cached) return cached.getFile();

  const root = mount === "opfs" ? await opfsRoot() : mounts.get(mount);
  if (!root) throw new Error(`${mount} is not mounted`);

  const segments = path.split("/").filter(Boolean);
  const name = segments.pop();
  if (!name) throw new Error("no file named");

  let directory = root;
  for (const segment of segments) {
    directory = await directory.getDirectoryHandle(segment);
  }
  const handle = await directory.getFileHandle(name);
  handles.set(cacheKey, handle);
  return handle.getFile();
}

function contentType(path: string): string {
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}
