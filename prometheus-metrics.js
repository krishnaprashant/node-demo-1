// Prometheus metrics setup
const client = require("prom-client");
const UAParser = require('ua-parser-js');
const geoip = require("geoip-lite");

// Create a counter for HTTP requests
// Create a counter for HTTP error rate
// Create a gauge for HTTP availability
const httpAvailabilityGauge = new client.Gauge({
  name: "http_availability",
  help: "Availability of HTTP service (1 = available, 0 = unavailable)",
  labelNames: ["route", "device_type"],
});
const httpErrorRateCounter = new client.Counter({
  name: "http_error_rate_total",
  help: "Total number of HTTP error responses (4xx and 5xx)",
  labelNames: ["method", "route", "statusCode", "device_type"],
});
const httpRequestCounter = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "statusCode", "device_type", "service", "country", "region"],
});

// Create a histogram for response times
const httpResponseTimeHistogram = new client.Histogram({
  name: "http_response_time",
  help: "Response time in seconds",
  labelNames: ["method", "route", "statusCode", "device_type"],
  buckets: [0.1, 1, 2, 3, 4, 5.1, 5.5, 6, 7, 8, 9, 10, 15, 20, 30, 60],
});
// Register all metrics with the client
client.register.registerMetric(httpAvailabilityGauge);
client.register.registerMetric(httpErrorRateCounter);
client.register.registerMetric(httpRequestCounter);
client.register.registerMetric(httpResponseTimeHistogram);

const httpThroughputCounter = new client.Counter(
  {
    "name": "http_throughput_total",
    "help": "Total number of HTTP requests",
    "labelNames": ["method", "route", "statusCode", "device_type"]
  }
)
client.register.registerMetric(httpThroughputCounter);

// Gauge for active users
const activeUsersGauge = new client.Gauge({
  name: "active_users",
  help: "Number of currently logged in users"
});
client.register.registerMetric(activeUsersGauge);


// Counter for session creation
const sessionCreatedTotal = new client.Counter({
  name: 'sessions_created_total',
  help: 'Total number of sessions created',
  labelNames: ['status'], // success or error
});
client.register.registerMetric(sessionCreatedTotal);

// Counter for session deletion
const sessionDeletedTotal = new client.Counter({
  name: 'sessions_deleted_total',
  help: 'Total number of sessions deleted',
  labelNames: ['status'], // success or error
});
client.register.registerMetric(sessionDeletedTotal);

// Histogram for session duration
const sessionDurationHistogram = new client.Histogram({
  name: 'session_duration_seconds',
  help: 'Duration of user sessions in seconds',
  labelNames: ['status'],
  buckets: [60, 300, 600, 1800, 3600, 7200, 14400], // Buckets for 1min, 5min, 10min, 30min, 1hr, 2hr, 4hr
});
client.register.registerMetric(sessionDurationHistogram);



// Middleware to collect metrics
const metricsMiddleware = (req, res, next) => {
  const start = process.hrtime();

  res.on("finish", () => {
    const diff = process.hrtime(start);
    const responseTimeInSeconds = diff[0] + diff[1] / 1e9;

    // Parse User-Agent
    const parser = new UAParser();
    const ua = req.headers['user-agent'] || '';
    parser.setUA(ua);
    const device = parser.getDevice();
    let device_type = 'Unknown';
    if (device.type === 'mobile') device_type = 'Mobile';
    else if (device.type === 'tablet') device_type = 'Tablet';
    else if (!device.type) device_type = 'Desktop';

    // Geo lookup
    const ip = req.ip || req.connection.remoteAddress;
    let geo = { country: 'Unknown', region: 'Unknown' };
    const geoLookup = geoip.lookup(ip);
    if (geoLookup) {
      geo.country = geoLookup.country || 'Unknown';
      geo.region = geoLookup.region || 'Unknown';
    }

    // Increment counters
    httpRequestCounter.inc({
      method: req.method,
      route: req.route ? req.route.path : req.path,
      statusCode: res.statusCode,
      device_type,
      service: 'demo-app',
      country: geo.country,
      region: geo.region
    });

    httpThroughputCounter.inc({
      method: req.method,
      route: req.route ? req.route.path : req.path,
      statusCode: res.statusCode,
      device_type
    });

    // ✅ Corrected histogram usage
    httpResponseTimeHistogram
      .labels(req.method, req.route ? req.route.path : req.path, res.statusCode, device_type)
      .observe(responseTimeInSeconds);

    // Error rate & availability
    if (res.statusCode >= 400) {
      httpErrorRateCounter.inc({
        method: req.method,
        route: req.route ? req.route.path : req.path,
        statusCode: res.statusCode,
        device_type
      });
      httpAvailabilityGauge.set({ route: req.route ? req.route.path : req.path, device_type }, 0);
    } else {
      httpAvailabilityGauge.set({ route: req.route ? req.route.path : req.path, device_type }, 1);
    }
  });

  next();
};




// Prometheus metrics for database queries
const dbQueryCounter = new client.Counter({
  name: "db_queries_total",
  help: "Total number of database queries",
  labelNames: ["operation", "collection", "status"],
});
client.register.registerMetric(dbQueryCounter);

// Counter for slow queries (>1s) to make it easy to alert/graph directly
const dbSlowQueryCounter = new client.Counter({
  name: "db_queries_slow_total",
  help: "Total number of slow database queries (>1s)",
  labelNames: ["operation", "collection"],
});
client.register.registerMetric(dbSlowQueryCounter);

const ErrorDbQueryCounter = new client.Counter({
  name: "db_queries_error_total",
  help: "Total number of database query errors",
  labelNames: ["operation", "collection", "status","error"],
});
client.register.registerMetric(ErrorDbQueryCounter);

const userRegisteredCounter = new client.Counter({
  name: 'user_registered_total',
  help: 'Total number of user registration events',
  labelNames: ['method', 'source'] // optional labels
});
client.register.registerMetric(userRegisteredCounter);

const userCountGauge = new client.Gauge({
  name: 'users_count',
  help: 'Current total number of users (exact, read from DB)'
});
client.register.registerMetric(userCountGauge);

// Pool Utilization
const dbPoolUtilizationGauge = new client.Gauge({
  name: 'db_pool_utilization',
  help: 'Number of active connections in the DB pool'
});
client.register.registerMetric(dbPoolUtilizationGauge);

//pool size
const dbPoolSizeGauge = new client.Gauge({
  name: 'db_pool_size',
  help: 'Total number of connections allowed in the DB pool'
});
client.register.registerMetric(dbPoolSizeGauge);

const dbPoolTargetGauge = new client.Gauge({
  name: 'db_pool_target',
  help: 'Target pool size for the DB'
});
client.register.registerMetric(dbPoolTargetGauge);

// Thread Pool Utilization
const threadPoolUtilizationGauge = new client.Gauge({
  name: 'node_thread_pool_utilization',
  help: 'Number of active libuv thread pool tasks'
});
client.register.registerMetric(threadPoolUtilizationGauge);

// Pool Recommended
const dbPoolRecommendedGauge = new client.Gauge({
  name: 'db_pool_recommended',
  help: 'Recommended pool size based on utilization'
});
client.register.registerMetric(dbPoolRecommendedGauge);

// Pool Scale Required
const dbPoolScaleRequiredGauge = new client.Gauge({
  name: 'db_pool_scale_required',
  help: 'Whether scaling is required (1 = true, 0 = false)'
});
client.register.registerMetric(dbPoolScaleRequiredGauge);


function updateThreadPoolUtilization() {
  // Node.js exposes thread pool size via process.env.UV_THREADPOOL_SIZE (default 4)
  // But active tasks are not directly exposed. We can use process._getActiveRequests() for a rough estimate.
  // Note: process._getActiveRequests() is not stable across Node.js versions
  try {
    if (typeof process._getActiveRequests === 'function') {
      const active = process._getActiveRequests().length;
      threadPoolUtilizationGauge.set(active);
    } else {
      // Fallback: set to 0 if method is not available
      threadPoolUtilizationGauge.set(0);
    }
  } catch (err) {
    // Safeguard: if the method throws an error, set to 0
    console.warn('Thread pool utilization monitoring failed:', err.message);
    threadPoolUtilizationGauge.set(0);
  }
}

// Call this function periodically (e.g., every 5 seconds)
setInterval(updateThreadPoolUtilization, 5000);


// Wrapper function to trace DB queries
async function traceDbQuery(operation, collection, queryFn) {
  const start = process.hrtime();
  let status = "success";
  try {
    const result = await queryFn();
    return result;
  } catch (err) {
    status = "error";
    throw err;
  } finally {
    const diff = process.hrtime(start);
    const duration = diff[0] + diff[1] / 1e9;
    if (duration > 1) {
      dbQueryCounter.inc({ operation, collection, status: "slow" });
      dbSlowQueryCounter.inc({ operation, collection });
    } else {
      dbQueryCounter.inc({ operation, collection, status });
    }
    dbQueryDurationHistogram.observe({ operation, collection, status: status === "slow" ? "slow" : status }, duration);
  }
}


// Histogram for DB query durations
const dbQueryDurationHistogram = new client.Histogram({
  name: "db_query_duration_seconds",
  help: "Duration of database queries in seconds",
  labelNames: ["operation", "collection", "status"],
});
client.register.registerMetric(dbQueryDurationHistogram);


module.exports = {
  httpAvailabilityGauge: httpAvailabilityGauge,
  metricsMiddleware: metricsMiddleware,
  httpRequestCounter: httpRequestCounter,
  client: client,
  dbQueryCounter: dbQueryCounter,
  httpResponseTimeHistogram: httpResponseTimeHistogram,
  httpErrorRateCounter: httpErrorRateCounter,

  dbQueryDurationHistogram: dbQueryDurationHistogram,
  traceDbQuery: traceDbQuery,
  dbPoolTargetGauge: dbPoolTargetGauge,
  dbPoolSizeGauge:dbPoolSizeGauge,
  dbPoolUtilizationGauge:dbPoolUtilizationGauge,
  dbPoolScaleRequiredGauge:dbPoolScaleRequiredGauge,
  dbPoolRecommendedGauge:dbPoolRecommendedGauge,
  ErrorDbQueryCounter:ErrorDbQueryCounter,
  threadPoolUtilizationGauge:threadPoolUtilizationGauge,
  activeUsersGauge:activeUsersGauge,
  sessionCreatedTotal:sessionCreatedTotal,
  sessionDeletedTotal:sessionDeletedTotal,
  sessionDurationHistogram:sessionDurationHistogram,
  dbSlowQueryCounter: dbSlowQueryCounter,
  userRegisteredCounter:userRegisteredCounter,
  userCountGauge:userCountGauge,
  httpThroughputCounter:httpThroughputCounter

};


