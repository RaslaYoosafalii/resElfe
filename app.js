// app.js
const express = require('express');
const app = express();
const path = require('path');
require('dotenv').config();
const session = require('express-session');
const passport = require('./config/passport');
const db = require('./config/db');
db();

const userRouter = require('./routes/userRoutes');
const adminRouter = require('./routes/adminRoutes');

// --- Body parsers ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Session (must be before routes) ---
app.use(
  session({
    name: 'connect.sid', // explicit cookie name for clarity
    secret: process.env.SESSION_SECRET || 'dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // set true if using HTTPS
      httpOnly: true,
      maxAge: 72 * 60 * 60 * 1000 // 72 hours
    }
  })
);

// --- Passport ---
app.use(passport.initialize());
app.use(passport.session());

// --- Strong no-cache middleware (must run BEFORE static files and routes) ---
const noCache = (req, res, next) => {
  // Prevent caching so Back/Forward won't show protected pages from cache
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
};
app.use(noCache);

// --- Global request logger (useful while debugging) ---
app.use((req, res, next) => {
  console.log(new Date().toISOString(), req.method, req.originalUrl);
  next();
});

// --- Static files (after no-cache) ---
app.use(express.static(path.join(__dirname, 'public')));

// --- View engine setup ---
app.set('view engine', 'ejs');
app.set('views', [path.join(__dirname, 'views/user'), path.join(__dirname, 'views/admin')]);

// --- Quick ping route for smoke testing ---
app.get('/ping', (req, res) => {
  console.log('PING endpoint hit');
  res.send('pong');
});

// --- Mount routers ---
app.use('/', userRouter);
app.use('/admin', adminRouter);

// --- Global error logger (keeps UI unchanged, just logs and renders fallback) ---
app.use((err, req, res, next) => {
  console.error('[ERROR] Unhandled error for', req.method, req.originalUrl, err);
  if (res.headersSent) return next(err);
  return res.status(500).render('page-404', { message: 'Something went wrong', user: null });
});

// --- Start server ---
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`server running on http://localhost:${port}`);
});

module.exports = app;
