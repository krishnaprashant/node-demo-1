const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const User = require('./user');

const prom = require('./prometheus-metrics')

const client = prom.client;

const app = express();
app.use(express.json());
app.use(session({ secret: 'demo-secret', resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());



// Use the middleware in your app (for Express)
if (typeof app !== 'undefined' && app.use) {
  app.use(prom.metricsMiddleware);
}


passport.use(new LocalStrategy(async (username, password, done) => {
  const user = await User.findOne({ username });
  if (!user) return done(null, false, { message: 'Incorrect username.' });
  const match = await bcrypt.compare(password, user.password);
  if (!match) return done(null, false, { message: 'Incorrect password.' });
  return done(null, user);
}));
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  const user = await User.findById(id);
  done(null, user);
});

mongoose.connect(
  "mongodb+srv://db-user:hYderabadindIa_234@video-clip-project.lgpxgl2.mongodb.net/",
  { useNewUrlParser: true, useUnifiedTopology: true }
);

// Registration
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  const exists = await User.findOne({ username });
  if (exists) return res.status(409).json({ error: 'User exists' });
  const hash = await bcrypt.hash(password, 10);
  const user = new User({ username, password: hash });
  await user.save();
  res.json({ message: 'User registered' });
});

// Login
app.post('/login', passport.authenticate('local'), (req, res) => {
  res.json({ message: 'Logged in' });
});

// Logout
app.post('/logout', (req, res) => {
  req.logout(() => {
    res.json({ message: 'Logged out' });
  });
});

// List users
app.get('/users', async (req, res) => {
  const users = await User.find({}, '-password');
  res.json(users);
});

// Edit user
app.put('/users/:id', async (req, res) => {
try {
    const { username, password } = req.body;
    const update = {};
    if (username) update.username = username;
    if (password) update.password = await bcrypt.hash(password, 10);
    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true });
    // if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User updated', user });
} catch (err) {
    res.status(500).json({ error: 'Server error', details: err.message });
}
});

// Delete user
app.delete('/users/:id', async (req, res) => {
  const user = await User.findByIdAndDelete(req.params.id);
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
