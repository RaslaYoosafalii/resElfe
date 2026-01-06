// controllers/admin/adminController.js
import User from '../../models/userSchema.js';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

// error page
const errorPage = async (req, res) => {
  res.render('admin/error-page');
};

// load login page
const loadLogin = async (req, res) => {
  if (req.session.admin) {
    return res.redirect('/admin');
  }
  res.render('admin-login', { message: req.session.message || null });
  delete req.session.message;
};

// login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const admin = await User.findOne({ isAdmin: true, email: email });

    if (!admin || !(await bcrypt.compare(password, admin.password))) {
      req.session.message = 'Invalid email or password';
      return res.redirect('/admin/login');
    }

    if (admin) {
      const passwordMatch = await bcrypt.compare(password, admin.password);

      if (passwordMatch) {
        req.session.admin = admin._id;
        return res.redirect('/admin');
      } else {
        return res.redirect('/admin/login');
      }
    } else {
      return res.redirect('/admin/login');
    }
  } catch (error) {
    console.log('Login Error', error);
    return res.redirect('/errorPage');
  }
};

// load Dashboard
const loadDashboard = async (req, res) => {
  if (req.session.admin) {
    try {
      res.set(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, proxy-revalidate, private'
      );
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');

      res.render('dashboard');
    } catch (error) {
      res.redirect('/errorPage');
    }
  } else {
    res.redirect('/admin/login');
  }
};

// logout
const logout = async (req, res) => {
  try {
    // capture admin id for logging before session is destroyed
    const adminId = req.session?.admin;

    req.session.destroy((err) => {
      if (err) {
        console.log('error destroying session', err);
        return res.redirect('/errorPage');
      }

      // clear the session cookie in the browser
      res.clearCookie('connect.sid', { path: '/' });

      res.set(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, proxy-revalidate, private'
      );
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');

      console.log('admin logged out');
      return res.redirect('/admin/login');
    });
  } catch (error) {
    console.log('Error logging out', error);
    return res.redirect('/errorPage');
  }
};

export {
  loadLogin,
  login,
  loadDashboard,
  errorPage,
  logout
};
export default{
  loadLogin,
  login,
  loadDashboard,
  errorPage,
  logout
};
