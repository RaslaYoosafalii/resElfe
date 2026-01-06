// controllers/user/userController.js
import User from '../../models/userSchema.js';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';

dotenv.config();

// not found page
const pageNotFound = async (req, res) => {
  try {
    return res.render('page-404');
  } catch (error) {
    res.redirect('/pageNotFound');
  }
};

// load home page
const loadHome = async (req, res) => {
  try {
    const user = req.session.user;

    if (user) {
      const userData = await User.findById(user);
      res.render('loggedinHome', { user: userData });
    } else {
      res.render('homepage');
    }
  } catch (error) {
    console.log('home page not found');
    res.status(500).send('server error');
  }
};

// load login page
const loadLoginPage = async (req, res) => {
  try {
    if (!req.session.user) {
      return res.render('login', { user: null });
    } else {
      res.redirect('/');
    }
  } catch (error) {
    console.log('page not found');
    res.redirect('/pagenotfound');
  }
};

// login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.render('login', {
        message: 'Fill all required fields',
        user: null
      });
    }

    const user = await User.findOne({ isAdmin: 0, email });

    if (!user || user.isBlocked) {
      return res.render('login', {
        message: user?.isBlocked
          ? 'You are blocked by admin'
          : 'Invalid email or password',
        user: null
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.render('login', {
        message: 'incorrect password',
        user: null
      });
    }

    req.session.user = user._id;
    res.redirect('/');
  } catch (error) {
    console.error('Login Error', error);
    res.render('login', {
      message: 'Login Failed Try again',
      user: null
    });
  }
};

const forgotPasswordRequest = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.render('forgot-password', {
        message: 'Please provide your email.'
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.render('forgot-password', {
        message: 'User with this email does not exist',
        email: email.toLowerCase()
      });
    }

    const otp = generateOTP();
    req.session.resetOtp = otp;
    req.session.resetEmail = email.toLowerCase();
    req.session.otpCreatedAt = Date.now();

    const emailResult = await sendVerificationEmail(email, otp);
    if (!emailResult || !emailResult.ok) {
      return res.render('forgot-password', {
        message: 'Failed to send OTP. Try again later.',
        email
      });
    }

    return res.render('forgot-password-otp', {
      email,
      message: 'OTP sent successfully'
    });
  } catch (error) {
    console.error('forgotPasswordRequest error', error);
    return res.render('forgot-password', {
      message: 'Server error. Please try again.'
    });
  }
};

const forgotVerifyOtp = async (req, res) => {
  try {
    const { otp } = req.body;
    const email = req.session.resetEmail || req.body.email || '';

    if (!req.session.resetOtp) {
      return res.render('forgot-password-otp', {
        email,
        message: 'OTP expired. Please request again.'
      });
    }

    const TEN_MIN = 10 * 60 * 1000;
    if (Date.now() - req.session.otpCreatedAt > TEN_MIN) {
      req.session.resetOtp = null;
      req.session.resetEmail = null;
      req.session.otpCreatedAt = null;
      return res.render('forgot-password-otp', {
        email: '',
        message: 'OTP expired. Please request again.'
      });
    }

    if (String(otp) === String(req.session.resetOtp)) {
      req.session.resetOtp = null;
      req.session.otpCreatedAt = null;
      return res.render('change-password', { message: null });
    } else {
      return res.render('forgot-password-otp', {
        email,
        message: 'Invalid OTP, please try again'
      });
    }
  } catch (error) {
    console.error('forgotVerifyOtp error', error);
    return res.render('forgot-password-otp', {
      email: req.session.resetEmail || '',
      message: 'Server Error, please try again.'
    });
  }
};

const forgotResendOtp = async (req, res) => {
  try {
    const { email } = req.body;

    if (
      !req.session.resetEmail ||
      req.session.resetEmail !== (email && email.toLowerCase())
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request'
      });
    }

    const otp = generateOTP();
    req.session.resetOtp = otp;
    req.session.otpCreatedAt = Date.now();

    const emailResult = await sendVerificationEmail(email, otp);
    if (!emailResult || !emailResult.ok) {
      return res.status(500).json({
        success: false,
        message: 'Failed to send OTP'
      });
    }

    return res.json({
      success: true,
      message: 'OTP resent successfully'
    });
  } catch (error) {
    console.error('forgotResendOtp error', error);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

const forgotChangePassword = async (req, res) => {
  try {
    const { newPassword, confirmPassword } = req.body;
    const email = req.session.resetEmail;

    if (!email) {
      return res.render('change-password', {
        message: 'Session expired. Please retry the flow.'
      });
    }

    if (!newPassword || !confirmPassword) {
      return res.render('change-password', {
        message: 'Fill all required fields'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.render('change-password', {
        message: 'Passwords do not match'
      });
    }

    if (newPassword.length < 6) {
      return res.render('change-password', {
        message: 'Password too short'
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      req.session.resetEmail = null;
      return res.render('forgot-password', {
        message: 'User not found. Please register.'
      });
    }

    user.password = await securePassword(newPassword);
    await user.save();

    req.session.resetEmail = null;
    req.session.resetOtp = null;
    req.session.otpCreatedAt = null;

    return res.json({
      success: true,
      redirectUrl: '/login',
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('forgotChangePassword error', error);
    return res.render('change-password', {
      message: 'Server error. Please try again.'
    });
  }
};

// load signup page
const loadSignupPage = async (req, res) => {
  try {
    res.render('signup', { user: null });
  } catch (error) {
    res.redirect('/pagenotfound');
  }
};

// helpers
function generateOTP() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

async function sendVerificationEmail(email, otp) {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      port: 587,
      secure: false,
      auth: {
        user: process.env.NODEMAILER_EMAIL,
        pass: process.env.NODEMAILER_PASSWORD
      }
    });

    await transporter.verify();

    const info = await transporter.sendMail({
      from: process.env.NODEMAILER_EMAIL,
      to: email,
      subject: 'Verify your account',
      html: `<b>Your OTP is ${otp}</b>`
    });

    return {
      ok: Array.isArray(info.accepted) && info.accepted.length > 0,
      info,
      rejected: info.rejected
    };
  } catch (error) {
    console.error('Error for sending email', error);
    return false;
  }
}

// signup
const signup = async (req, res) => {
  const { email, password, confirmPassword, refferalCode } = req.body;

  try {
    if (!email || !password || !confirmPassword) {
      return res.render('signup', {
        message: 'Fill all required fields',
        user: null
      });
    }

    if (password !== confirmPassword) {
      return res.render('signup', {
        message: 'Passwords do not match',
        user: null
      });
    }

    const findUser = await User.findOne({ email: email.toLowerCase() });
    if (findUser) {
      return res.render('signup', {
        message: 'User with this email already exists',
        user: null
      });
    }

    const otp = generateOTP();
    const emailResult = await sendVerificationEmail(email, otp);

    if (!emailResult || !emailResult.ok) {
      return res.render('signup', {
        message:
          'Failed to send verification email. Check your email or try again later.',
        user: null
      });
    }

    req.session.userOtp = otp;
    req.session.userData = {
      email: email.toLowerCase(),
      password,
      refferalCode
    };
    req.session.otpCreatedAt = Date.now();

    return res.render('verify-otp', { email });
  } catch (error) {
    console.error('signup error:', error);
    return res.render('signup', {
      message: 'Signup failed, please try again.',
      user: null
    });
  }
};

const securePassword = async (password) => {
  return bcrypt.hash(password, 10);
};

const verifyOtp = async (req, res) => {
  try {
    const { otp } = req.body;
    const email = req.session?.userData?.email || '';

    if (!req.session.userOtp) {
      return res.render('verify-otp', {
        email,
        message: 'OTP expired. Please resend.'
      });
    }

    const TEN_MIN = 10 * 60 * 1000;
    if (Date.now() - req.session.otpCreatedAt > TEN_MIN) {
      req.session.userOtp = null;
      return res.render('verify-otp', {
        email,
        message: 'OTP expired. Please resend.'
      });
    }

    if (otp === req.session.userOtp) {
      const userData = req.session.userData;
      const passwordHash = await securePassword(userData.password);

      const saveUserData = new User({
        email: userData.email,
        password: passwordHash,
        refferalcode: userData.refferalCode || undefined
      });

      await saveUserData.save();
      req.session.user = saveUserData._id;

      req.session.userOtp = null;
      req.session.userData = null;
      req.session.otpCreatedAt = null;

      return res.json({ success: true, redirectUrl: '/login' });
    } else {
      return res.render('verify-otp', {
        email,
        message: 'Invalid OTP, please try again'
      });
    }
  } catch (error) {
    console.error('verifyOtp error', error);
    return res.render('verify-otp', {
      email: req.session?.userData?.email || '',
      message: 'Server Error, please try again.'
    });
  }
};

const resendOtp = async (req, res) => {
  try {
    const { email } = req.body;

    if (!req.session.userData || req.session.userData.email !== email) {
      return res.render('verify-otp', {
        email: email || '',
        message: 'Invalid request'
      });
    }

    const otp = generateOTP();
    req.session.userOtp = otp;
    req.session.otpCreatedAt = Date.now();

    const emailSent = await sendVerificationEmail(email, otp);
    if (!emailSent) {
      return res.render('verify-otp', {
        email,
        message: 'Failed to send OTP'
      });
    }

    return res.json({ success: true, message: 'OTP resent successfully' });
  } catch (error) {
    console.error('resendOtp error', error);
    return res.render('verify-otp', {
      email: req.session?.userData?.email || '',
      message: 'Server error'
    });
  }
};

const loadUserprofile = async () => {};

const logout = async (req, res) => {
  try {
    req.session.destroy(() => {
      res.clearCookie('connect.sid', { path: '/' });
      res.setHeader(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, proxy-revalidate, private'
      );
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      return res.redirect('/login');
    });
  } catch (error) {
    console.log('Logout Error', error);
    res.redirect('/pageNotFound');
  }
};

export {
  loadHome,
  pageNotFound,
  loadSignupPage,
  forgotPasswordRequest,
  forgotVerifyOtp,
  forgotResendOtp,
  forgotChangePassword,
  signup,
  sendVerificationEmail,
  verifyOtp,
  resendOtp,
  loadLoginPage,
  login,
  loadUserprofile,
  logout
};

export default{
  loadHome,
  pageNotFound,
  loadSignupPage,
  forgotPasswordRequest,
  forgotVerifyOtp,
  forgotResendOtp,
  forgotChangePassword,
  signup,
  sendVerificationEmail,
  verifyOtp,
  resendOtp,
  loadLoginPage,
  login,
  loadUserprofile,
  logout
};