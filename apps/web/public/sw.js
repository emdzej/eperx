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

const PREFIX = "/__eperx/";

/** Mount name → FileSystemDirectoryHandle. */
const mounts = new Map();

/** Resolved file handles, keyed `mount:path`. Directory walks are not free. */
const handles = new Map();

self.addEventListener("install", () => {
  // Take over straight away: a page that registered the worker must not have
  // to reload before its own fetches are intercepted.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
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

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(PREFIX)) return;
  event.respondWith(serve(event.request, url));
});

async function serve(request, url) {
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
async function resolve(mount, path) {
  const cacheKey = `${mount}:${path}`;
  const cached = handles.get(cacheKey);
  if (cached) return cached.getFile();

  const root = mount === "opfs" ? await navigator.storage.getDirectory() : mounts.get(mount);
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

function contentType(path) {
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}
