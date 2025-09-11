const api = require("@opentelemetry/api");
const tracer = require("./tracing")("MyService");
const fs = require("fs");
const https = require("https");

const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const bcrypt = require("bcrypt");
const User = require("./user");

const prom = require("./prometheus-metrics");

const client = prom.client;

const app = express();
app.use(express.json());
app.use(
  session({ secret: "demo-secret", resave: false, saveUninitialized: false })
);
app.use(passport.initialize());
app.use(passport.session());

// Use the middleware in your app (for Express)
if (typeof app !== "undefined" && app.use) {
  app.use(prom.metricsMiddleware);
}

passport.use(
  new LocalStrategy(async (username, password, done) => {
    const user = await User.findOne({ username });
    if (!user) return done(null, false, { message: "Incorrect username." });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return done(null, false, { message: "Incorrect password." });
    return done(null, user);
  })
);
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  const user = await User.findById(id);
  done(null, user);
});

mongoose.connect(
  "mongodb+srv://db-user:hYderabadindIa_234@video-clip-project.lgpxgl2.mongodb.net/",
  { useNewUrlParser: true, useUnifiedTopology: true }
);

app.get("/", (req, res) => {
  const currentSpan = api.trace.getActiveSpan();
  // display traceid in the terminal
  const traceId = currentSpan.spanContext().traceId;
  console.log(`traceId: ${traceId}`);
  const span = tracer.startSpan("Homepage", {
    kind: 1, // server
    attributes: { key: "value" },
  });
  // Annotate our span to capture metadata about the operation

  res.send("Hello Observability!");
  span.end();
});

// Registration
app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: "Missing fields" });
  const exists = await User.findOne({ username });
  if (exists) return res.status(409).json({ error: "User exists" });
  const hash = await bcrypt.hash(password, 10);
  const user = new User({ username, password: hash });
  await user.save();
  res.json({ message: "User registered" });
});

// Login
app.post("/login", (req, res, next) => {
  passport.authenticate("local", (err, user, info) => {
    const currentSpan = api.trace.getActiveSpan();
    const traceId = currentSpan ? currentSpan.spanContext().traceId : "N/A";
    const span = tracer.startSpan("Login", {
      kind: 1, // server
      attributes: { key: "value", traceId },
    });

    if (err) {
      span.setAttribute("error", true);
      span.setAttribute("error.message", err.message);
      res.status(500).json({ error: "Server error" });
      span.end();
      return;
    }
    if (!user) {
      span.setAttribute("error", true);
      span.setAttribute("error.message", info ? info.message : "Unauthorized");
      res.status(401).json({ error: info ? info.message : "Unauthorized" });
      span.end();
      return;
    }
    req.login(user, (err) => {
      if (err) {
        span.setAttribute("error", true);
        span.setAttribute("error.message", err.message);
        res.status(500).json({ error: "Login error" });
        span.end();
        return;
      }
      res.json({ message: "Logged in" });
      span.end();
    });
  })(req, res, next);
});

// Logout
app.post("/logout", (req, res) => {
  req.logout(() => {
    res.json({ message: "Logged out" });
  });
});

// List users
app.get("/users", async (req, res) => {
  const users = await User.find({}, "-password");
  res.json(users);
});

// Edit user
app.put("/users/:id", async (req, res) => {
  try {
    const { username, password } = req.body;
    const update = {};
    if (username) update.username = username;
    if (password) update.password = await bcrypt.hash(password, 10);
    const user = await User.findByIdAndUpdate(req.params.id, update, {
      new: true,
    });
    // if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ message: "User updated", user });
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// add method that returns a dummy response but with random delay between 1-5 seconds but also include the delay in reponse
app.get("/dummy", async (req, res) => {
  const delay = Math.floor(Math.random() * 5000) + 1000; // Random delay between 1-5 seconds
  await new Promise((resolve) => setTimeout(resolve, delay));
  res.json({ message: "Dummy response", delay });
});

// Delete user
app.delete("/users/:id", async (req, res) => {
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ message: "User deleted" });
});

function logTraceIdAndName(name) {
  const currentSpan = api.trace.getActiveSpan();
  if (currentSpan) {
    const traceId = currentSpan.spanContext().traceId;
    console.log(`traceId: ${traceId}, method: ${name}`);
  }
}

function capitalizeText(text) {
  const parentSpan = api.trace.getActiveSpan();
  const ctx = parentSpan ? api.trace.setSpan(api.context.active(), parentSpan) : api.context.active();
  const span = tracer.startSpan("capitalizeText", undefined, ctx);
  const start = Date.now();
  while (Date.now() - start < 2000);
  const result = text.charAt(0).toUpperCase() + text.slice(1);
  span.end();
  return result;
}

function getName(name) {
  const parentSpan = api.trace.getActiveSpan();
  const ctx = parentSpan ? api.trace.setSpan(api.context.active(), parentSpan) : api.context.active();
  const span = tracer.startSpan("getName", undefined, ctx);
  const start = Date.now();
  while (Date.now() - start < 3000);
  const capitalized = capitalizeText(name);
  span.end();
  return capitalized;
}

app.get("/distributed-tracing-example", (req, res) => {
  const rootSpan = tracer.startSpan("DistributedTracingExample", { kind: 1 });
  api.context.with(api.trace.setSpan(api.context.active(), rootSpan), () => {
    const name = "Sample Name";
    res.send(`Hello ${getName(name)}, Distributed Tracing!`);
    rootSpan.end();
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics();

// Expose /metrics endpoint
if (typeof app !== "undefined" && app.get) {
  app.get("/metrics", async (req, res) => {
    res.set("Content-Type", client.register.contentType);
    res.end(await client.register.metrics());
  });
}



