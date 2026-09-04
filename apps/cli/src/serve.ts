import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join, normalize, resolve } from "node:path";

/**
 * Serve an imported tree over HTTP, honouring `Range`.
 *
 * This is the deployment story made runnable: the browser client needs nothing
 * but a static host that answers ranged requests, and this is the smallest
 * thing that is one. It also keeps the data independent of the dev server — a
 * tree can live on another disk, or another machine, without the app knowing.
 *
 * `Range` is not optional. Without it a client would have to download a
 * 568 MB database to read a few pages of it, so `HttpSource` refuses a host
 * that ignores the header — and a server that quietly answered `200` would
 * hide the very bug that check exists for.
 *
 * CORS is open, because the point is to be read by a page served from
 * somewhere else, and `Content-Range` has to be exposed or the client cannot
 * see what it was given. A read-only file server for data the user already
 * has is not a thing to lock down; it binds to localhost unless told
 * otherwise.
 */

export interface ServeOptions {
  /** Directory to serve — an imported tree. */
  root: string;
  port: number;
  /** Interface to bind. Localhost unless deliberately widened. */
  host: string;
  /** Log each request. */
  verbose?: boolean;
  onRequest?: (info: { path: string; status: number; bytes: number }) => void;
}

export interface Serving {
  url: string;
  close(): Promise<void>;
  /** Requests answered, and bytes sent. */
  stats(): { requests: number; bytes: number };
}

const TYPES: Record<string, string> = {
  ".json": "application/json",
  ".png": "image/png",
  ".sqlite": "application/octet-stream",
};

export async function serve(options: ServeOptions): Promise<Serving> {
  const root = resolve(options.root);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`${options.root} is not a directory`);
  }

  let requests = 0;
  let bytes = 0;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Range",
      // Without this the browser hides Content-Range from the page, and a
      // client that cannot read it cannot tell a partial answer from a whole
      // one.
      "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
    };

    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    // `normalize` collapses `..` before the prefix check, so a request cannot
    // climb out of the tree.
    const rel = normalize(decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/"));
    const path = join(root, rel);
    const done = (status: number, sent = 0) => {
      requests++;
      bytes += sent;
      if (options.verbose) console.log(`  ${status} ${rel}${sent ? ` ${sent}B` : ""}`);
      options.onRequest?.({ path: rel, status, bytes: sent });
    };

    if (!path.startsWith(root)) {
      res.writeHead(403, cors);
      res.end("outside the tree");
      done(403);
      return;
    }

    let size: number;
    try {
      const stat = statSync(path);
      if (!stat.isFile()) throw new Error("not a file");
      size = stat.size;
    } catch {
      res.writeHead(404, cors);
      res.end(`${rel} not found`);
      done(404);
      return;
    }

    const extension = rel.slice(rel.lastIndexOf("."));
    const headers = {
      ...cors,
      "Accept-Ranges": "bytes",
      "Content-Type": TYPES[extension] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    };

    if (req.method === "HEAD") {
      // A client asks HEAD first to learn the size. Falling through to the
      // body path here would try to stream 568 MB in answer to a HEAD.
      res.writeHead(200, { ...headers, "Content-Length": String(size) });
      res.end();
      done(200);
      return;
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (!match) {
      res.writeHead(200, { ...headers, "Content-Length": String(size) });
      createReadStream(path).pipe(res);
      done(200, size);
      return;
    }

    let start: number;
    let end: number;
    if (match[1] === "") {
      // A suffix range: the last N bytes. This is how a ZIP's end-of-central
      // directory gets found, so it is not hypothetical.
      start = Math.max(0, size - Number(match[2]));
      end = size - 1;
    } else {
      start = Number(match[1]);
      end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
    }

    if (!Number.isFinite(start) || start > end || start >= size) {
      res.writeHead(416, { ...headers, "Content-Range": `bytes */${size}` });
      res.end();
      done(416);
      return;
    }

    const length = end - start + 1;
    res.writeHead(206, {
      ...headers,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(length),
    });
    createReadStream(path, { start, end }).pipe(res);
    done(206, length);
  });

  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(options.port, options.host, () => ok());
  });

  return {
    url: `http://${options.host}:${options.port}`,
    stats: () => ({ requests, bytes }),
    close: () =>
      new Promise<void>((ok) => {
        server.close(() => ok());
      }),
  };
}
