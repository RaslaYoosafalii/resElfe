// middlewares/auth.js
import User from '../models/userSchema.js';

const noCache = (req, res, next) => {
  res.setHeader(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate, private'
  );
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
};

const userAuth = (req, res, next) => {
  res.setHeader(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate, private'
  );
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const userId = req.session.user;
  if (!userId) return res.redirect('/login');

  User.findById(userId)
    .then(user => {
      if (!user || user.isBlocked) {
  return req.session.destroy(() => {
    res.clearCookie('connect.sid', { path: '/' });
    return res.redirect('/login');
  });
}

      req.user = user;
      next();
    })
    .catch(err => {
      console.log('Error in User Auth Middleware', err.message);
      return res.status(500).send('Internal Server Error');
    });
};

const adminAuth = (req, res, next) => {
  res.setHeader(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate, private'
  );
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.session && req.session.admin) {
    User.findById(req.session.admin)
      .then(admin => {
        if (admin && admin.isAdmin) {
          return next();
        } else {
          req.session.destroy(() => {
            res.clearCookie('connect.sid', { path: '/' });
            return res.redirect('/admin/login');
          });
        }
      })
      .catch(err => {
        console.error('Error in Admin Auth Middleware', err);
        return res.status(500).send('Internal Server Error');
      });
  } else {
    return res.redirect('/admin/login');
  }
};

export {
  userAuth,
  adminAuth,
  noCache
};
