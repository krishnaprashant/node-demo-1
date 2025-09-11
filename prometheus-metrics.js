// Prometheus metrics setup
const client = require("prom-client");


// Create a counter for HTTP requests
const httpRequestCounter = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "statusCode"],
});

// Create a histogram for response times
const httpResponseTime = new client.Histogram({
  name: "http_response_time",
  help: "Response time in seconds",
  labelNames: ["method", "route", "statusCode"],
  buckets: [0.1, 0.5, 1, 2, 5, 10]
});

const httpThroughputCounter = new client.Counter(
  {
    "name": "http_throughput_total",
    "help": "Total number of HTTP requests",
    "labelNames": ["method", "route", "statusCode"]
  }
)

// Middleware to collect metrics
const metricsMiddleware = (req, res, next) => {
  const start = process.hrtime();
  res.on("finish", () => {
    const diff = process.hrtime(start);
    const responseTimeInSeconds = diff[0] + diff[1] / 1e9;
    
    httpRequestCounter.inc({
      method: req.method,
      route: req.route ? req.route.path : req.path,
      statusCode: res.statusCode
    });

    httpThroughputCounter.inc({
      method: req.method,
      route: req.route ? req.route.path : req.path,
      statusCode: res.statusCode,
    });

    httpResponseTime.observe({
      method: req.method,
      route: req.route ? req.route.path : req.path,
      statusCode: res.statusCode
    }, responseTimeInSeconds);
  });
  next();
};



module.exports = {
  metricsMiddleware: metricsMiddleware,
  client: client,
};
