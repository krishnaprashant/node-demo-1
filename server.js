// Demonstrate thread pool usage
const crypto = require('crypto');
const prom = require('./prometheus-metrics');


const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const uuid = require('uuid');
const User = require('./user');

const SUCCESS = 'success'
const FAILED = 'failed'
const client = prom.client;

const app = express();


app.get('/threadpool-demo', (req, res) => {
  const tasks = 8; // More than default thread pool size (4)
  let completed = 0;
  prom.threadPoolUtilizationGauge.inc(tasks); // Increment gauge by number of tasks started
  for (let i = 0; i < tasks; i++) {
    crypto.pbkdf2('password', 'salt', 100000, 64, 'sha512', () => {
      prom.threadPoolUtilizationGauge.dec(); // Decrement gauge when task completes
      completed++;
      if (completed === tasks) {
        res.json({ message: `${tasks} pbkdf2 tasks completed` });
      }
    });
  }
});



app.use(express.json());


// Use the middleware in your app (for Express)
if (typeof app !== 'undefined' && app.use) {
  app.use(prom.metricsMiddleware);
}


passport.use(new LocalStrategy(async (username, password, done) => {
  const user = await prom.traceDbQuery('findOne', 'users', () => User.findOne({ username }));
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
  const user = await prom.traceDbQuery('findById', 'users', () => User.findById(id));
  done(null, user);
});

mongoose.connect(
"mongodb+srv://preetham:Preetham1750@pegabits.0b2jh8j.mongodb.net/myFirstDB?retryWrites=true&w=majority&appName=pegabits"
);


// Middleware to track session creation
app.use(session({
  secret: 'demo-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }, // 24-hour max age
  store: new (require('express-session').MemoryStore)(), // Optional: Use a persistent store
  genid: (req) => {
    prom.sessionCreatedTotal.inc({ status: 'success' });
    return uuid.v4(); // Generate unique session ID
  }
}));
app.use(passport.initialize());
app.use(passport.session());


// Add after session middleware
app.use((req, res, next) => {
  if (req.session && !req.session.createdAt && req.user) {
    req.session.createdAt = Date.now();
  }
  next();
});


// Registration
app.post('/register', async (req, res) => {
  
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  const start = process.hrtime();
  const exists = await prom.traceDbQuery('findOne', 'users', () => User.findOne({ username }));
  if (exists) return res.status(409).json({ error: 'User exists' });
  const hash = await bcrypt.hash(password, 10);
  const user = new User({ username, password: hash });
  await prom.traceDbQuery('save', 'users', () => user.save());
  const diff = process.hrtime(start);

  const duration = diff[0] + diff[1] / 1e9;
  prom.dbQueryCounter.inc({
    operation: "register",
    collection: "users",
    status: SUCCESS
  });
  prom.dbQueryDurationHistogram.observe({
    operation: "register",
    collection: "users",
    status: SUCCESS
  }, duration);

  // incrementing for new user registrations
  prom.userRegisteredCounter.inc({ method: req.method, source: "api" });

  res.json({ message: 'User registered' });
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
app.post('/login', passport.authenticate('local'), (req, res) => {
  prom.dbQueryCounter.inc({
    operation:'login',
    collection:'users',
    status:SUCCESS
  });
  prom.activeUsersGauge.inc();
  req.session.createdAt = Date.now(); // Ensure createdAt is set
  res.json({ message: 'Logged in' });
});

// Logout endpoint
app.post('/logout', (req, res) => {
  if (req.session && req.session.createdAt) {
    const duration = (Date.now() - req.session.createdAt) / 1000;
    prom.sessionDurationHistogram.observe({ status: 'success' }, duration);
  }
  
  // Track session deletion
  prom.sessionDeletedTotal.inc({ status: 'success' });
  
  req.logout((err) => {
    if (err) {
      prom.dbQueryCounter.inc({
        operation: 'logout',
        collection: 'users',
        status: FAILED
      });
      return res.status(500).json({ error: 'Logout failed', details: err.message });
    }
    
    prom.dbQueryCounter.inc({
      operation: 'logout',
      collection: 'users',
      status: SUCCESS
    });
    
    // Safely decrement active users
    prom.activeUsersGauge.dec();
    
    // Destroy the session
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: 'Session destruction failed' });
      }
      res.json({ message: 'Logged out successfully' });
    });
  });
});


// List users
app.get('/users', async (req, res) => {
  const users = await prom.traceDbQuery('find', 'users', () => User.find({}, '-password'));
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
app.put('/users/:id', async (req, res) => {
try {
    const { username, password } = req.body;
    const update = {};
    if (username) update.username = username;
    if (password) update.password = await bcrypt.hash(password, 10);
  const user = await prom.traceDbQuery('findByIdAndUpdate', 'users', () => User.findByIdAndUpdate(req.params.id, update, { new: true }));
    // if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User updated', user });
} catch (err) {
    res.status(500).json({ error: 'Server error', details: err.message });
}
});

// Delete user
app.delete('/users/:id', async (req, res) => {
  const user = await prom.traceDbQuery('findByIdAndDelete', 'users', () => User.findByIdAndDelete(req.params.id));
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ message: 'User deleted' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics();


// Expose /metrics endpoint
if (typeof app !== 'undefined' && app.get) {
  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', client.register.contentType);
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


