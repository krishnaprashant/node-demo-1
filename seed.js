// This script seeds the database with demo users for testing
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('./user');

async function seed() {
  await mongoose.connect(
    "mongodb+srv://db-user:hYderabadindIa_234@video-clip-project.lgpxgl2.mongodb.net/",
    { useNewUrlParser: true, useUnifiedTopology: true }
  );
  await User.deleteMany({});
  const users = [
    { username: 'alice', password: 'password1' },
    { username: 'bob', password: 'password2' },
    { username: 'charlie', password: 'password3' }
  ];
  for (const u of users) {
    const hash = await bcrypt.hash(u.password, 10);
    await new User({ username: u.username, password: hash }).save();
  }
  console.log('Seeded demo users');
  mongoose.disconnect();
}

seed();
