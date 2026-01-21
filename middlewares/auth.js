// middlewares/auth.js
import User from '../models/userSchema.js';

const noCache = (req, res, next) => {
res.setHeader(
  'Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, private, max-age=0'
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
     if (!user) {
  return res.redirect('/login');
}

if (user.isBlocked) {
  delete req.session.user; 

  return res.redirect('/?blocked=1');
}


      req.user = user;
      next();
    })
    .catch(err => {
      console.log('Error in User Auth Middleware', err.message);
      return res.status(500).send('Internal Server Error');
    });
};

// const adminAuth = (req, res, next) => {
//   res.setHeader(
//     'Cache-Control',
//     'no-store, no-cache, must-revalidate, proxy-revalidate, private'
//   );
//   res.setHeader('Pragma', 'no-cache');
//   res.setHeader('Expires', '0');

//   if (req.session && req.session.admin) {
//     User.findById(req.session.admin)
//       .then(admin => {
//         if (admin && admin.isAdmin) {
//           return next();
//         } else {
//           req.session.destroy(() => {
//             res.clearCookie('connect.sid', { path: '/' });
//             return res.redirect('/admin/login');
//           });
//         }
//       })
//       .catch(err => {
//         console.error('Error in Admin Auth Middleware', err);
//         return res.status(500).send('Internal Server Error');
//       });
//   } else {
//   res.setHeader(
//     'Cache-Control',
//     'no-store, no-cache, must-revalidate, proxy-revalidate, private, max-age=0'
//   );
//   res.setHeader('Pragma', 'no-cache');
//   res.setHeader('Expires', '0');

//   return res.redirect('/admin/login');
// }

// };
const adminAuth = async (req, res, next) => {
  res.setHeader(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate, private, max-age=0'
  );
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (!req.session || !req.session.admin) {
    //no session means NO PAGE
    return res.redirect('/admin/login');
  }

  try {
    const admin = await User.findById(req.session.admin);

    if (!admin || !admin.isAdmin) {
      req.session.destroy(() => {
        res.clearCookie('connect.sid', { path: '/' });
        return res.redirect('/admin/login');
      });
      return;
    }

  req.admin = admin;
req.allowRender = true;
next();

  } catch (err) {
    console.error('AdminAuth error:', err);
    return res.redirect('/admin/login');
  }
};


export {
  userAuth,
  adminAuth,
  noCache
};
