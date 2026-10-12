/* ===========================================================================
 * APP FACTORY
 * ---------------------------------------------------------------------------
 * Builds the express app from a settings object and a db handle. No listen(),
 * no side effects — so a test can build an app, drive it over supertest-style
 * requests, and throw it away without opening a port.
 * =========================================================================== */

const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const postRoutes = require("./routes/posts");
const commentRoutes = require("./routes/comments");
const modRoutes = require("./routes/mod");
const filter = require("./filter");
const { seed } = require("./seed");

function createApp(settings, db) {
  const app = express();
  app.set("settings", settings);
  app.set("db", db);

  const prod = settings.prod;
  app.use(
    cors({
      origin: settings.MODE === "prod" ? prod.corsOrigins : true,
      /* a phone PWA sends a bearer header, so credentials are unnecessary
         and disabling them keeps the surface smaller. */
      credentials: false,
    }),
  );
  app.use(express.json({ limit: "32kb" }));

  /* request log — never logs bodies, because a body can contain a slur and
     this file gets read by whoever is debugging at 11pm. */
  if (settings[settings.MODE].log === "verbose") {
    app.use((req, res, next) => {
      const t = Date.now();
      res.on("finish", () => {
        if (res.statusCode >= 500 || req.method !== "OPTIONS")
          console.log(
            "%s %s %s %dms",
            req.method,
            req.originalUrl,
            res.statusCode,
            Date.now() - t,
          );
      });
      next();
    });
  }

  /* ---------------------------- routes ---------------------------- */
  app.get("/health", (req, res) => {
    res.json({
      ok: true,
      mode: settings.MODE,
      db: db.mode,
      filter: {
        blockSlurs: settings.filter.blockSlurs,
        blockStyledFonts: settings.filter.blockStyledFonts,
        blockSafetyTerms: settings.filter.blockSafetyTerms,
        /* this one is the product's own rule, surfaced so nobody flips it
           by accident and then wonders why the app changed character */
        blockSwearTiers: settings.filter.blockSwearTiers,
      },
    });
  });

  /* the gate itself, so a client can check a draft without posting it */
  app.post("/filter/check", (req, res) => {
    const text = String((req.body || {}).text || "");
    const v = filter.check(text, settings.filter);
    res.json({ blocked: v.blocked, reasons: v.reasons, note: filter.explain(v) });
  });

  app.use("/auth", authRoutes);
  app.use("/posts", postRoutes);
  app.use("/posts/:postId/comments", commentRoutes);
  app.use("/mod", modRoutes);

  app.use((req, res) => res.status(404).json({ error: "no_route", path: req.originalUrl }));

  /* the error handler is last on purpose. a thrown error is a bug, so it
     never leaks a stack trace to a phone — it logs here and returns a
     generic 500. */
  app.use((err, req, res, next) => {
    console.error("[%s] %s", settings.MODE, err && err.stack ? err.stack : err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: "server_error" });
  });

  /* seed on boot in test mode only. prod never writes demo rows. */
  if (settings[settings.MODE].seed) {
    app.locals.ready = seed(db, settings).catch((e) => {
      console.error("seed failed:", e);
      throw e;
    });
  } else {
    app.locals.ready = Promise.resolve();
  }

  return app;
}

module.exports = { createApp };
