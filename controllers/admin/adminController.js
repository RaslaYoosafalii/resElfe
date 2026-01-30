// controllers/admin/adminController.js
import User from '../../models/userSchema.js';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import nodemailer from 'nodemailer';


const OTP_COOLDOWN = 60 * 1000;
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

      res.render('dashboard', { allowRender: true });

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
    
    const adminId = req.session?.admin;

     delete req.session.admin; 

      res.set(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, proxy-revalidate, private'
      );
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');

      console.log('admin logged out');
     return res.redirect(303, '/admin/login');
    
  } catch (error) {
    console.log('Error logging out', error);
    return res.redirect('/errorPage');
  }
};

const generateOTP = () => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

const sendVerificationEmail = async (email, otp) => {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.NODEMAILER_EMAIL,
        pass: process.env.NODEMAILER_PASSWORD
      }
    });

    await transporter.sendMail({
      from: process.env.NODEMAILER_EMAIL,
      to: email,
      subject: 'Admin Password Reset OTP',
      html: `<b>Your admin OTP is ${otp}</b>`
    });

    return true;
  } catch (error) {
    console.error('Admin OTP email error', error);
    return false;
  }
};
const loadAdminForgotPassword = async (req, res) => {
  res.render('admin-forgot-password', { message: null });
};

const adminForgotPasswordRequest = async (req, res) => {
  try {
    const { email } = req.body;
    
    if (
      req.session.adminForgotLastRequest &&
      Date.now() - req.session.adminForgotLastRequest < OTP_COOLDOWN
    ) {
      const remaining = Math.ceil(
        (OTP_COOLDOWN - (Date.now() - req.session.adminForgotLastRequest)) / 1000
      );

      return res.render('admin-forgot-password', {
        message: `Please wait ${remaining}s before requesting again`
      });
    }
    const admin = await User.findOne({
      email: email.toLowerCase(),
      isAdmin: true
    });

    if (!admin) {
      return res.render('admin-forgot-password', {
        message: 'Admin not found'
      });
    }

    const otp = generateOTP();

    req.session.adminResetOtp = otp;
    req.session.adminResetEmail = email.toLowerCase();
    req.session.adminOtpCreatedAt = Date.now();
    req.session.adminForgotLastRequest = Date.now(); 

    const emailSent = await sendVerificationEmail(email, otp);
    if (!emailSent) {
      return res.render('admin-forgot-password', {
        message: 'Failed to send OTP'
      });
    }

    return res.redirect('/admin/verify-otp');
  } catch (error) {
    console.error(error);
    res.render('admin-forgot-password', {
      message: 'Server error'
    });
  }
};

const loadAdminOtpPage = async (req, res) => {
  res.render('admin-verify-otp', {
    email: req.session.adminResetEmail,
    message: null
  });
};



const adminVerifyOtp = async (req, res) => {
  const { otp } = req.body;
  const email = req.session.adminResetEmail;

  if (!email || !req.session.adminResetOtp) {
    return res.render('admin-verify-otp', {
      email: null,
      message: 'OTP expired'
    });
  }

  const TEN_MIN = 10 * 60 * 1000;
  if (Date.now() - req.session.adminOtpCreatedAt > TEN_MIN) {
    req.session.adminResetOtp = null;
    return res.render('admin-verify-otp', {
      email,
      message: 'OTP expired'
    });
  }

  if (otp === req.session.adminResetOtp) {
    req.session.adminResetOtp = null;
    return res.redirect('/admin/change-password');
  }

  return res.render('admin-verify-otp', {
    email,
    message: 'Invalid OTP'
  });
};



const adminChangePassword = async (req, res) => {
  try {
    const { newPassword, confirmPassword } = req.body;
    const email = req.session.adminResetEmail;

    if (!email) {
      return res.status(401).json({
        success: false,
        message: 'Session expired'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match'
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await User.updateOne(
      { email, isAdmin: true },
      { $set: { password: hashedPassword } }
    );

    req.session.adminResetEmail = null;
    req.session.adminOtpCreatedAt = null;

    return res.json({
      success: true
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

const adminResendOtp = async (req, res) => {
  try {
    const { email } = req.body;

    if (
      !req.session.adminResetEmail ||
      req.session.adminResetEmail !== (email && email.toLowerCase())
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request'
      });
    }

    if (
      req.session.adminOtpLastSentAt &&
      Date.now() - req.session.adminOtpLastSentAt < OTP_COOLDOWN
    ) {
      return res.status(429).json({
        success: false,
        message: 'Please wait before resending OTP'
      });
    }

    const otp = generateOTP();
    req.session.adminResetOtp = otp;
    req.session.adminOtpCreatedAt = Date.now();
    req.session.adminOtpLastSentAt = Date.now();

    const emailSent = await sendVerificationEmail(email, otp);
    if (!emailSent) {
      return res.status(500).json({
        success: false,
        message: 'Failed to send OTP'
      });
    }
    console.log('otp sent: ', otp)
    return res.json({
      success: true,
      message: 'OTP resent successfully'
    });
  } catch (error) {
    console.error('adminResendOtp error', error);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};




export {
  loadLogin,
  login,
  loadDashboard,
  errorPage,
  logout,
  loadAdminForgotPassword,
  adminForgotPasswordRequest,
  loadAdminOtpPage,
  adminVerifyOtp,
  adminChangePassword,
  adminResendOtp
};
export default{
  loadLogin,
  login,
  loadDashboard,
  errorPage,
  logout,
  loadAdminForgotPassword,
  adminForgotPasswordRequest,
  loadAdminOtpPage,
  adminVerifyOtp,
  adminChangePassword,
  adminResendOtp
};
