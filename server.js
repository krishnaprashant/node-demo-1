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

// Define status constants
const SUCCESS = "success";
const FAILED = "failed";

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


passport.use(new LocalStrategy(async (username, password, done) => {
  const user = await User.findOne({ username });
  // success
  prom.dbQueryCounter.inc({
    operation:"Login",
    collection:"users",
    status:SUCCESS
  })
  if (!user) return done(null, false, { message: 'Incorrect username.' });
  const match = await bcrypt.compare(password, user.password);
  if (!match) return done(null, false, { message: 'Incorrect password.' });
  return done(null, user);
}));
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  const user = User.findById(id);
  done(null, user);
});

mongoose.connect(
  "mongodb+srv://db-user:hYderabadindIa_234@video-clip-project.lgpxgl2.mongodb.net/"
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
  startTime = Date.now();
  const { username, password } = req.body;
  if (!username || !password) {
    prom.httpErrorRateCounter.inc({
      method: req.method,
      route: req.route ? req.route.path : req.path,
      statusCode: 400
    });
    return res.status(400).json({ error: "Missing fields" });
  }
  const exists = await User.findOne({ username });
  if (exists) {
    prom.httpErrorRateCounter.inc({
      method: req.method,
      route: req.route ? req.route.path : req.path,
      statusCode: 409
    });
    return res.status(409).json({ error: "User exists" });
  }
  const hash = await bcrypt.hash(password, 10);
  const user = new User({ username, password: hash });
  await user.save();
  endTime = Date.now();
  const duration = (endTime - startTime) / 1000; // in seconds
  prom.dbQueryHistogram.labels('save', 'users', SUCCESS).observe(duration);
  res.json({ message: "User registered" });
});



app.get("/slow-db-query-demo", (req, res) => {
  // sample query
  prom.dbQueryHistogram.labels("slow-demo-get", "users", SUCCESS).observe(2495);
  res.json({ message: "Slow DB query demo recorded" });
});

app.get("/slow-db-query-demo-2", (req, res) => {
  // sample query
  prom.dbQueryHistogram.labels("slow-demo-get-2", "users", SUCCESS).observe(1495);
  res.json({ message: "Slow DB query demo recorded" });
});

app.get("/slow-db-query-demo-11", (req, res) => {
  // sample query
  prom.dbQueryHistogram.labels("slow-demo-get-11", "users", SUCCESS).observe(3495);
  res.json({ message: "Slow DB query demo recorded" });
});

app.get("/slow-db-query-demo-22", (req, res) => {
  // sample query
  prom.dbQueryHistogram.labels("slow-demo-get-22", "users", SUCCESS).observe(6795);
  res.json({ message: "Slow DB query demo recorded" });
});



app.post('/register-exception', async (req, res) => {
  prom.ErrorDbQueryCounter.inc({
    operation:'save',
    collection:'users',
    status:FAILED,
    error:'Sample Exception'
  })
  res.json({ message: 'User registered' });
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
app.get('/users', async (req, res) => {
  const users = await User.find({}, '-password');
  prom.dbQueryCounter.inc({
    operation: 'find',
    collection: 'users',
    status: SUCCESS
  });
  res.json(users);
});

// Error handler to track session creation errors
app.use((err, req, res, next) => {
  prom.ErrorDbQueryCounter.inc({
    operation: 'error',
    collection: 'none',
    status: FAILED,
    error: err.message
  });
  if (err.message.includes('session')) {
    prom.sessionsCreatedTotal.inc({ status: 'error' });
  }
  prom.httpAvailabilityGauge.set({ route: req.route ? req.route.path : req.path }, 0);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

//response time 

// Edit user
app.put("/users/:id", async (req, res) => {
  try {
    const { username, password } = req.body;
    const update = {};
    if (username) update.username = username;
    if (password) update.password = await bcrypt.hash(password, 10);
  const user = await prom.traceDbQuery('findByIdAndUpdate', 'users', () => User.findByIdAndUpdate(req.params.id, update, { new: true }));
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
// // Pool Utilization
// const { MongoClient } = require('mongodb');

// // Get underlying client from mongoose
// mongoose.connection.on('connected', () => {
//   const client = mongoose.connection.getClient();

//   // Access monitoring
//   const topology = client.topology;

//   let activeConnections = 0;
//   let totalConnections = client.options.maxPoolSize || 100; // default max pool size

//   // Pool created
//   topology.on('connectionPoolCreated', (event) => {
//     totalConnections = event.options.maxPoolSize || totalConnections;
//     prom.dbPoolSizeGauge.set(totalConnections);
//   });

//   // Connection checked out (borrowed from pool)
//   topology.on('connectionCheckedOut', () => {
//     activeConnections++;
//     prom.dbPoolUtilizationGauge.set(activeConnections);

//     // scale recommendation
//     let recommendedSize = totalConnections;
//     let scaleRequired = 0;
//     if (totalConnections > 0 && activeConnections >= 0.95 * totalConnections) {
//       recommendedSize = Math.round(totalConnections * 1.2);
//       scaleRequired = 1;
//     }
//     prom.dbPoolRecommendedGauge.set(recommendedSize);
//     prom.dbPoolScaleRequiredGauge.set(scaleRequired);
//   });

//   // Connection checked in (returned to pool)
//   topology.on('connectionCheckedIn', () => {
//     activeConnections = Math.max(activeConnections - 1, 0);
//     prom.dbPoolUtilizationGauge.set(activeConnections);
//   });
// });


app.get('/slow-demo', async (req, res) => {
  // Simulate a slow operation (e.g., 5 seconds)
  const start = process.hrtime();
  await new Promise(resolve => setTimeout(resolve, 5000));
  const diff = process.hrtime(start);
  const responseTimeInSeconds = diff[0] + diff[1] / 1e9;
  prom.httpRequestCounter.inc({
    method: req.method,
    route: req.route ? req.route.path : req.path,
    statusCode: 200
  });
  prom.httpAvailabilityGauge.set({ route: req.route ? req.route.path : req.path }, 1);
  res.json({ message: 'This response was intentionally delayed by 5 seconds.' });
});


// app.get('/total-slow-queries', async (req, res) => {
//   try {
//     // Sum dedicated slow counter
//     const slowCounterMetric = prom.dbSlowQueryCounter;
//     const slowSeries = slowCounterMetric.get().values || [];
//     const slowTotal = slowSeries.reduce((sum, s) => sum + (s.value || 0), 0);

//     // Also compute from general counter where status="slow" for comparison
//     const dbCounterMetric = prom.dbQueryCounter;
//     const dbSeries = dbCounterMetric.get().values || [];
//     const slowLabeledTotal = dbSeries
//       .filter(s => s.labels && s.labels.status === 'slow')
//       .reduce((sum, s) => sum + (s.value || 0), 0);

//     res.json({
//       total_slow_queries: slowTotal,
//       total_slow_queries_from_status_label: slowLabeledTotal,
//       series_count: slowSeries.length
//     });
//   } catch (err) {
//     res.status(500).json({ error: 'Failed to fetch slow queries', details: err.message });
//   }
// });



// DB Pool demo - attaches temporary pool listeners and fires parallel queries
app.get('/db-pool-demo', async (req, res) => {
  const tasks = Math.max(1, Math.min(500, Number(req.query.tasks) || 50));
  prom.dbPoolTargetGauge.set(tasks);

  const client = mongoose.connection.getClient();
  const topology = client.topology;

  let activeConnections = 0;
  let totalConnections = client.options.maxPoolSize || 100;

  // Ensure pool size gauge is set even if no events fire
  prom.dbPoolSizeGauge.set(totalConnections);

  const onCreated = (event) => {
    totalConnections = event?.options?.maxPoolSize || totalConnections;
    prom.dbPoolSizeGauge.set(totalConnections);
  };
  const onCheckedOut = () => {
    activeConnections++;
    prom.dbPoolUtilizationGauge.set(activeConnections);

    let recommendedSize = totalConnections;
    let scaleRequired = 0;
    if (totalConnections > 0 && activeConnections >= 0.95 * totalConnections) {
      recommendedSize = Math.round(totalConnections * 1.2);
      scaleRequired = 1;
    }
    prom.dbPoolRecommendedGauge.set(recommendedSize);
    prom.dbPoolScaleRequiredGauge.set(scaleRequired);
  };
  const onCheckedIn = () => {
    activeConnections = Math.max(activeConnections - 1, 0);
    prom.dbPoolUtilizationGauge.set(activeConnections);
  };

  // Attach listeners for the duration of this request
  try {
    if (topology && topology.on) {
      topology.on('connectionPoolCreated', onCreated);
      topology.on('connectionCheckedOut', onCheckedOut);
      topology.on('connectionCheckedIn', onCheckedIn);
    }

    const operations = [];
    let peakActive = 0;
    for (let i = 0; i < tasks; i++) {
      operations.push((async () => {
        // Manual utilization tracking in case driver pool events don't emit
        activeConnections++;
        peakActive = Math.max(peakActive, activeConnections);
        prom.dbPoolUtilizationGauge.set(activeConnections);

        let recommendedSize = totalConnections;
        let scaleRequired = 0;
        if (totalConnections > 0 && activeConnections >= 0.95 * totalConnections) {
          recommendedSize = Math.round(totalConnections * 1.2);
          scaleRequired = 1;
        }
        prom.dbPoolRecommendedGauge.set(recommendedSize);
        prom.dbPoolScaleRequiredGauge.set(scaleRequired);

        try {
          return await prom.traceDbQuery('findOne', 'users', () =>
            User.findOne({ username: `__pool_demo__${i}` }).lean()
          );
        } finally {
          activeConnections = Math.max(activeConnections - 1, 0);
          prom.dbPoolUtilizationGauge.set(activeConnections);
        }
      })());
    }

    const results = await Promise.allSettled(operations);
    const fulfilled = results.filter(r => r.status === 'fulfilled').length;
    const rejected = results.length - fulfilled;

    res.json({ message: `Executed ${tasks} parallel queries`, fulfilled, rejected, totalConnections, peakActive });
  } catch (err) {
    res.status(500).json({ error: 'Pool demo failed', details: err.message });
  } finally {
    if (topology && topology.off) {
      topology.off('connectionPoolCreated', onCreated);
      topology.off('connectionCheckedOut', onCheckedOut);
      topology.off('connectionCheckedIn', onCheckedIn);
    } else if (topology && topology.removeListener) {
      topology.removeListener('connectionPoolCreated', onCreated);
      topology.removeListener('connectionCheckedOut', onCheckedOut);
      topology.removeListener('connectionCheckedIn', onCheckedIn);
    }
  }
});


// HTTP error rate endpoint
app.get('/http-error-rate', async (req, res) => {
  try {
    // Get all metric values
    const errorMetrics = prom.httpErrorRateCounter.get();
    const requestMetrics = prom.httpRequestCounter.get();

    let totalErrors = 0;
    let totalRequests = 0;

    if (errorMetrics && errorMetrics.values) {
      errorMetrics.values.forEach(v => totalErrors += v.value);
    }
    if (requestMetrics && requestMetrics.values) {
      requestMetrics.values.forEach(v => totalRequests += v.value);
    }

    const rate = totalRequests > 0 ? totalErrors / totalRequests : 0;

    res.json({
      http_error_rate: rate,
      total_errors: totalErrors,
      total_requests: totalRequests,
      message: "HTTP error rate fetched from Node"
    });
  } catch (err) {
    console.error('Failed to compute error rate:', err);
    res.status(500).json({
      error: 'Internal server error',
      details: err.message
    });
  }
});


app.get('/error/sync', (req, res) => {
  throw new Error('Synchronous error demo');
});

app.get('/error/async', async (req, res, next) => {
  try {
    await Promise.reject(new Error('Async error demo'));
  } catch (err) {
    next(err);
  }
});

app.get('/error/notfound', (req, res) => {
  prom.httpAvailabilityGauge.set({ route: req.route ? req.route.path : req.path }, 0);
  res.status(404).json({ error: 'Resource not found' });
});

app.get('/error/validation', (req, res) => {
  prom.httpAvailabilityGauge.set({ route: req.route ? req.route.path : req.path }, 0);
  res.status(400).json({ error: 'Validation failed', details: { field: 'username', message: 'Required' } });
});

// Total slow queries (in-process metric sum)
app.get('/total-slow-queries', async (req, res) => {
  try {
    // Sum dedicated slow counter
    const slowCounterMetric = prom.dbSlowQueryCounter;
    const slowSeries = slowCounterMetric.get().values || [];
    const slowTotal = slowSeries.reduce((sum, s) => sum + (s.value || 0), 0);

    // Also compute from general counter where status="slow" for comparison
    const dbCounterMetric = prom.dbQueryCounter;
    const dbSeries = dbCounterMetric.get().values || [];
    const slowLabeledTotal = dbSeries
      .filter(s => s.labels && s.labels.status === 'slow')
      .reduce((sum, s) => sum + (s.value || 0), 0);

    res.json({
      total_slow_queries: slowTotal,
      total_slow_queries_from_status_label: slowLabeledTotal,
      series_count: slowSeries.length
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch slow queries', details: err.message });
  }
});

// Express error handler middleware
app.use((err, req, res, next) => {
  prom.ErrorDbQueryCounter.inc({
    operation: 'error',
    collection: 'none',
    status: FAILED,
    error: err.message
  });
  prom.httpAvailabilityGauge.set({ route: req.route ? req.route.path : req.path }, 0);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});



// app.get("/test-get",(req, res) => {
//   res.json({message:"Welcome get"})
// });
// app.post("/test-post",(req, res) => {
//   res.json({message:"Welcome post"})
// });


