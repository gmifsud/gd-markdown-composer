import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Documents are sent whole on every save, so the default 100kb limit is far too small.
const BODY_LIMIT = "25mb";

app.use(
  express.json({
    limit: BODY_LIMIT,
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: BODY_LIMIT }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

// Log method, path, status and timing only. Response bodies hold full
// document content, so serialising them here is slow and leaks content to logs.
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    if (path.startsWith("/api")) {
      log(`${req.method} ${path} ${res.statusCode} in ${Date.now() - start}ms`);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // Serve API and client on PORT (default 5000). HOST defaults to 0.0.0.0 for
  // hosted/web use; the desktop app sets HOST=127.0.0.1 so documents aren't
  // reachable from the network. With PORT_FALLBACK=1 a busy port falls back to
  // a free one picked by the OS.
  const port = parseInt(process.env.PORT || "5000", 10);
  const host = process.env.HOST || "0.0.0.0";
  const allowFallback = process.env.PORT_FALLBACK === "1";

  const listen = (p: number) =>
    httpServer.listen({
      port: p,
      host,
      // reusePort: true, // disabled on windows since it may cause ENOTSUP
    });

  // One handler for both attempts: a callback passed to a failed listen()
  // would stay registered and fire again on the retry.
  httpServer.once("listening", () => {
    const address = httpServer.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    log(`serving on ${host}:${actualPort}`);
    // Machine-readable line the Electron shell waits for.
    console.log(`MDC_SERVER_READY port=${actualPort}`);
  });

  httpServer.once("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && allowFallback && port !== 0) {
      log(`port ${port} is in use, picking a free port`);
      listen(0);
      return;
    }
    throw err;
  });

  listen(port);
})();
