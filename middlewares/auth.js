const User = require("../models/userSchema");

const userAuth = (req, res, next) => {
    const userId = req.session.user;
    if (!userId) return res.redirect('/login');

    User.findById(userId)
        .then(user => {
            if (!user || user.isBlocked) {
                return res.redirect('/login');
            }
            req.user = user;
            next();
        })
        .catch(err => {
            console.log('Error in User Auth Middleware', err.message);
            return res.status(500).send("Internal Server Error");
        });
};




const adminAuth = (req, res, next) => {
    
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

    if (req.session && req.session.admin) {
    // Validate that the session refers to an actual admin user
    User.findById(req.session.admin)
      .then(admin => {
        if (admin && admin.isAdmin) {
          return next();
        } else {
          // invalid session — destroy and redirect to login
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
}




module.exports = {
    userAuth,
    adminAuth
}