# Demo Node.js Project for Monitoring Application

This project provides a simple RESTful API for user authentication and management, suitable for testing monitoring applications. It includes:

- User registration
- Login/logout
- Listing users
- Editing/deleting users
- Basic CRUD operations

## Tech Stack
- Node.js
- Express.js
- MongoDB (Mongoose)
- Passport.js (local strategy)

## Getting Started
1. Install dependencies:
   ```cmd
   npm install
   ```
2. Start MongoDB (local or Atlas).
3. Run the server:
   ```cmd
   npm start
   ```

## API Endpoints
- `POST /register` - Register a new user
- `POST /login` - Login
- `POST /logout` - Logout
- `GET /users` - List all users
- `PUT /users/:id` - Edit user
- `DELETE /users/:id` - Delete user

## Notes
- This is a demo project. Do not use in production.
- Replace placeholder secrets and connection strings before use.
