// controllers/user/userController.js
import User from '../../models/userSchema.js';
import Address from '../../models/addressSchema.js';
import Order from '../../models/orderSchema.js';

import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import path from 'path';
import fs from 'fs';

dotenv.config();

const OTP_COOLDOWN = 60 * 1000;
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
      res.render('homepage', {
  query: req.query
});

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

    if (
      req.session.otpLastSentAt &&
      Date.now() - req.session.otpLastSentAt < OTP_COOLDOWN
    ) {
      return res.render('forgot-password', {
        message: 'Please wait before requesting another OTP.',
        email: email.toLowerCase()
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
    req.session.otpLastSentAt = Date.now(); 

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
        if (
      req.session.otpLastSentAt &&
      Date.now() - req.session.otpLastSentAt < OTP_COOLDOWN
    ) {
      return res.status(429).json({
        success: false,
        message: 'Please wait before resending OTP'
      });
    }
    const otp = generateOTP();
    req.session.resetOtp = otp;
    req.session.otpCreatedAt = Date.now();
    req.session.otpLastSentAt = Date.now();

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


// detect fetch / ajax request
if (req.headers['content-type']?.includes('application/json')) {
  return res.json({
    success: true,
    message: 'Password changed successfully',
    redirectUrl: '/login'
  });
}

  return res.render('profile-reset-password', {
  success: true
});

  } catch (error) {

    console.error('forgotChangePassword error', error);

  if (req.headers['content-type']?.includes('application/json')) {
  return res.status(500).json({
    success: false,
    message: 'Unable to change password. Please try again later.'
  });
}

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
    
if (
  req.session.otpLastSentAt &&
  Date.now() - req.session.otpLastSentAt < 60 * 1000
) {
  return res.render('signup', {
    message: 'Please wait before requesting another OTP',
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
    req.session.otpLastSentAt = Date.now();


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

const loadUserprofile = async (req, res) => {
  try {
    const userId = req.session.user;

    const user = await User.findById(userId).lean();
    const addressData = await Address.findOne({ userId }).lean();
    const orders = await Order.find({ userId }).sort({ createdAt: -1 }).lean();

   res.render('profile', {
  user,
  addresses: addressData?.address || [],
  orders,
  passwordChanged: req.query.passwordChanged === '1'
});

  } catch (error) {
    console.error('loadUserprofile error', error);
    res.redirect('/pageNotFound');
  }
};
const loadEditProfile = async (req, res) => {
  try {
    const user = await User.findById(req.session.user).lean();
    res.render('edit-profile', { user, message: null });
  } catch (error) {
    console.error(error);
    res.redirect('/pageNotFound');
  }
};


const updateProfile = async (req, res) => {
  try {
    const { name, mobileNumber, email } = req.body || {};
    const userId = req.session.user;
    const deleteImage = req.body?.deleteImage;


    const user = await User.findById(userId);
   const file = req.file;
    // email change detect-> otp flow
    if (email && email !== user.email) {
      const existing = await User.findOne({ email: email.toLowerCase() });
      if (existing) {
        return res.render('edit-profile', {
          user,
          message: 'Email already in use'
        });
      }

      const otp = generateOTP();
      
      req.session.emailChangeOtp = otp;
      req.session.newEmail = email.toLowerCase();
      req.session.otpCreatedAt = Date.now();
      req.session.otpLastSentAt = Date.now();

      console.log('EMAIL CHANGE OTP:', otp);

      await sendVerificationEmail(email, otp);
      const pendingUpdatedFields = new Set();

if (name && name !== user.name) pendingUpdatedFields.add('name');
if (
  mobileNumber &&
  String(mobileNumber) !== String(user.mobileNumber || '')
) {
  pendingUpdatedFields.add('number');
}


req.session.pendingUpdatedFields = Array.from(pendingUpdatedFields);
req.session.pendingProfileUpdates = {};

if (name && name !== user.name) {
  req.session.pendingProfileUpdates.name = name;
}

if (
  mobileNumber &&
  String(mobileNumber) !== String(user.mobileNumber || '')
) {
  req.session.pendingProfileUpdates.mobileNumber = mobileNumber;
}


      return res.render('verify-email-otp', {
        email,
        otpSent: true,
        message: 'OTP sent to your new email'
      });
    }

// profile image handling
let imageUpdated = false;

if (file) {
  // delete old image if exists
  if (user.profileImage) {
    const oldPath = path.join(
      process.cwd(),
      'public',
      user.profileImage
    );
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }

  user.profileImage = `/uploads/products/${file.filename}`;
  imageUpdated = true;
}

// delete image request
if (deleteImage === 'true' && user.profileImage) {

  const oldPath = path.join(
    process.cwd(),
    'public',
    user.profileImage
  );
  if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);

  user.profileImage = null;
  imageUpdated = true;
}    

const updatedFields = new Set();
if (imageUpdated) updatedFields.add('profile photo');


if (name && name !== user.name) updatedFields.add('name');
if (
  mobileNumber &&
  String(mobileNumber) !== String(user.mobileNumber || '')
) {
  updatedFields.add('number');
}
// apply changes
if (name && name !== user.name) {
  user.name = name;
}

if (
  mobileNumber &&
  String(mobileNumber) !== String(user.mobileNumber || '')
) {
  user.mobileNumber = mobileNumber;
}




// EMAIL change already handled by OTP flow → do NOT include here

await user.save();
if (updatedFields.size === 0) {
  updatedFields.add('profile');
}


return res.render('edit-profile', {
  user: await User.findById(userId).lean(),
  updatedFields: Array.from(updatedFields)
});



  } catch (error) {
    console.error('updateProfile error', error);

      if (
    error instanceof Error &&
    (error.message.includes('JPG') ||
     error.message.includes('PNG') ||
     error.message.includes('file size'))
  ) {
    const user = await User.findById(req.session.user).lean();
    return res.render('edit-profile', {
      user,
      message: error.message
    });
  }
    res.redirect('/pageNotFound');
  }
};
const deleteProfileImage = async (req, res) => {
  try {
    const userId = req.session.user;
    const user = await User.findById(userId);

    if (!user || !user.profileImage) {
      return res.json({ success: false, message: 'No image to delete' });
    }

    const imagePath = path.join(
      process.cwd(),
      'public',
      user.profileImage
    );

    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }

    user.profileImage = null;
    await user.save();

    return res.json({ success: true });
  } catch (error) {
    console.error('deleteProfileImage error', error);
    return res.status(500).json({ success: false });
  }
};


const loadChangePassword = async (req, res) => {
  try {
    const user = await User.findById(req.session.user).lean();

    res.render('profile-change-password', {
      user,
      message: null
    });
  } catch (error) {
    console.error('loadChangePassword error', error);
    res.redirect('/pageNotFound');
  }
};


const changeProfilePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const user = await User.findById(req.session.user).lean();

    // 1️⃣ Current password empty
    if (!currentPassword) {
      return res.render('profile-change-password', {
        user,
        message: 'Enter current password'
      });
    }

    const userWithPassword = await User.findById(req.session.user);

    const isMatch = await bcrypt.compare(
      currentPassword,
      userWithPassword.password
    );

    // 2️⃣ Old password incorrect
    if (!isMatch) {
      return res.render('profile-change-password', {
        user,
        message: 'Old password incorrect'
      });
    }

    // New password mismatch
    if (!newPassword || newPassword !== confirmPassword) {
      return res.render('profile-change-password', {
        user,
        message: 'Passwords do not match'
      });
    }

    userWithPassword.password = await bcrypt.hash(newPassword, 10);
    await userWithPassword.save();

    // 4️⃣ Success → SweetAlert trigger
    res.render('profile-change-password', {
      user,
      success: true
    });
  } catch (error) {
    console.error('changeProfilePassword error', error);

    // 3️⃣ Unexpected error
    res.render('profile-change-password', {
      user: null,
      fatalError: true
    });
  }
};



const requestEmailChange = async (req, res) => {
  try {
    const { email } = req.body;
    const userId = req.session.user;

    const user = await User.findById(userId);

    if (!email || email === user.email) {
      return res.render('edit-profile', {
        user,
        message: 'Please enter a new email address'
      });
    }

    // check email already exists
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.render('edit-profile', {
        user,
        message: 'Email already in use'
      });
    }

    const otp = generateOTP();

    req.session.emailChangeOtp = otp;
    req.session.newEmail = email.toLowerCase();
    req.session.otpCreatedAt = Date.now();
    req.session.otpLastSentAt = Date.now();

    await sendVerificationEmail(email, otp);

    res.render('verify-email-otp', {
      email,
      message: 'OTP sent to your new email'
    });
  } catch (error) {
    console.error('requestEmailChange error', error);
    res.redirect('/pageNotFound');
  }
};

const verifyEmailChangeOtp = async (req, res) => {
  try {
    const { otp } = req.body;

    if (!req.session.emailChangeOtp || !req.session.newEmail) {
      return res.redirect('/profile/edit');
    }

    const TEN_MIN = 10 * 60 * 1000;
    if (Date.now() - req.session.otpCreatedAt > TEN_MIN) {
      req.session.emailChangeOtp = null;
      req.session.newEmail = null;
      return res.render('verify-email-otp', {
        message: 'OTP expired'
      });
    }

    if (otp !== req.session.emailChangeOtp) {
      return res.render('verify-email-otp', {
        message: 'Invalid OTP'
      });
    }

  const updateData = {
  email: req.session.newEmail,
  updatedAt: Date.now()
};

if (req.session.pendingProfileUpdates) {
  Object.assign(updateData, req.session.pendingProfileUpdates);
}

await User.findByIdAndUpdate(req.session.user, updateData);
req.session.pendingProfileUpdates = null;


    req.session.emailChangeOtp = null;
    req.session.newEmail = null;

const user = await User.findById(req.session.user).lean();

const updatedFields = new Set(['email']);

if (Array.isArray(req.session.pendingUpdatedFields)) {
  req.session.pendingUpdatedFields.forEach(f => updatedFields.add(f));
}

req.session.pendingUpdatedFields = null;


return res.render('verify-email-otp', {
  emailVerified: true,
  updatedFields: Array.from(updatedFields)
});


  } catch (error) {
    console.error('verifyEmailChangeOtp error', error);
    res.redirect('/profile');
  }
};

// load email page
const loadProfileForgotPassword = (req,res)=>{
  res.render('profile-forgot-password',{message:null})
};

// after email submit
const profileForgotPasswordRequest = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findById(req.session.user).lean();
    if (!user) {
      return res.redirect('/login');
    }

    // ✅ REQUIRED VALIDATION
    if (!email || email.toLowerCase() !== user.email.toLowerCase()) {
      return res.render('profile-forgot-password', {
        message: 'Please enter your registered email address'
      });
    }

    // OTP cooldown check
    if (
      req.session.profileReset?.otpLastSentAt &&
      Date.now() - req.session.profileReset.otpLastSentAt < OTP_COOLDOWN
    ) {
      return res.render('profile-forgot-password', {
        message: 'Please wait before requesting another OTP'
      });
    }

    const otp = generateOTP();

req.session.profileReset = {
  email: user.email,
  otp,
  otpCreatedAt: Date.now(),
  otpLastSentAt: Date.now(),
  allowed: true
};


    await sendVerificationEmail(user.email, otp);
    console.log('profile forgot password otp:', otp);

    return res.render('profile-forgot-otp', {
      email: user.email,
      message: 'OTP sent to your email'
    });
  } catch (err) {
    console.error('profileForgotPasswordRequest error', err);
    return res.render('profile-forgot-password', {
      message: 'Failed to send OTP'
    });
  }
};


// OTP page
const profileForgotVerifyOtp = async (req, res) => {
  const { otp } = req.body;
  const reset = req.session.profileReset;


  if (!reset || !reset.allowed) {
  return res.redirect('/profile/change-password');
}

  if (!reset) {
    return res.render('profile-forgot-password', {
      message: 'Session expired'
    });
  }

  if (String(otp) !== String(reset.otp)) {
    return res.render('profile-forgot-otp', {
      email: reset.email,
      message: 'Invalid OTP'
    });
  }

  res.render('profile-reset-password');
};


// reset password
const profileForgotResetPassword = async (req, res) => {
  const { newPassword, confirmPassword } = req.body;
  const reset = req.session.profileReset;

 if (!req.session.profileReset || !req.session.profileReset.allowed) {
  return res.redirect('/profile/change-password');
}

  if (!reset) {
    return res.render('profile-forgot-password', {
      message: 'Session expired'
    });
  }

  if (!newPassword || newPassword !== confirmPassword) {
    return res.render('profile-reset-password', {
      message: 'Passwords do not match'
    });
  }

  await User.findOneAndUpdate(
    { email: reset.email },
    { password: await bcrypt.hash(newPassword, 10) }
  );


req.session.profileReset = null;

return res.redirect('/profile?passwordChanged=1');

};



const loadManageAddress = async (req, res) => {
  try {
    const userId = req.session.user;
    const user = await User.findById(userId).lean();
    const addressDoc = await Address.findOne({ userId }).lean();

    res.render('manage-address', {
      user,
      addresses: addressDoc?.address || []
    });
  } catch (error) {
    console.error('loadManageAddress error', error);
    res.redirect('/pageNotFound');
  }
};
const loadAddAddress = async (req, res) => {
  try {
    const user = await User.findById(req.session.user).lean();
    res.render('add-address', { user });
  } catch (error) {
    console.error('loadAddAddress error', error);
    res.redirect('/pageNotFound');
  }
};
const addAddress = async (req, res) => {
  try {
    const userId = req.session.user;
    const {
      name,
      mobileNumber,
      pincode,
      locality,
      city,
      state,
      landmark,
      alternativeNumber,
      addressType,
      address
    } = req.body;

    // 🔐 Validation
    if (
      !name ||
      !mobileNumber ||
      !pincode ||
      !locality ||
      !city ||
      !state ||
      !landmark ||
      !addressType
    ) {
      return res.render('add-address', {
        user: await User.findById(userId).lean(),
        error: 'All required fields must be filled'
      });
    }

    const newAddress = {
      name,
      mobileNumber,
      pincode,
      locality,
      city,
      state,
      landmark,
      alternativeNumber: alternativeNumber || null,
      addressType,
      address
    };

    let addressDoc = await Address.findOne({ userId });

    if (!addressDoc) {
      addressDoc = new Address({
        userId,
        address: [newAddress]
      });
    } else {
      addressDoc.address.push(newAddress);
    }
    if (
  alternativeNumber &&
  String(alternativeNumber) === String(mobileNumber)
) {
  return res.redirect('/address?error=sameNumber');
}


    await addressDoc.save();

    res.redirect('/address?success=added');
  } catch (error) {
    console.error('addAddress error', error);
    return res.redirect('/address?error=saveFailed');
  }
};
const setDefaultAddress = async (req, res) => {
  try {
    const userId = req.session.user;
    const index = parseInt(req.params.index);

    const addressDoc = await Address.findOne({ userId });
    if (!addressDoc || !addressDoc.address[index]) {
      return res.json({ success: false });
    }

    // 🔁 Clear previous default
    addressDoc.address.forEach(a => (a.isDefault = false));

    // ✅ Set new default
    addressDoc.address[index].isDefault = true;

    await addressDoc.save();
    res.json({ success: true });
  } catch (err) {
    console.error('setDefaultAddress error', err);
    res.json({ success: false });
  }
};


const loadEditAddress = async (req, res) => {
  try {
    const userId = req.session.user;
    const index = parseInt(req.params.index);

    const user = await User.findById(userId).lean();
    const addressDoc = await Address.findOne({ userId }).lean();

    if (!addressDoc || !addressDoc.address[index]) {
      return res.redirect('/address');
    }

    res.render('edit-address', {
      user,
      address: addressDoc.address[index],
      index
    });
  } catch (error) {
    console.error('loadEditAddress error', error);
    res.redirect('/pageNotFound');
  }
};
const editAddress = async (req, res) => {
  try {
    const userId = req.session.user;
    const index = parseInt(req.params.index);

    const {
      name,
      mobileNumber,
      pincode,
      locality,
      city,
      state,
      landmark,
      alternativeNumber,
      addressType,
      address
    } = req.body;

    if (
      !name ||
      !mobileNumber ||
      !pincode ||
      !locality ||
      !city ||
      !state ||
      !landmark ||
      !addressType
    ) {
      return res.redirect(`/address/edit/${index}?error=invalid`);
    }

    const addressDoc = await Address.findOne({ userId });

    if (!addressDoc || !addressDoc.address[index]) {
      return res.redirect('/address');
    }
    if (
  alternativeNumber &&
  String(alternativeNumber) === String(mobileNumber)
) {
  return res.redirect('/address?error=sameNumber');
}


addressDoc.address[index] = {
  ...addressDoc.address[index].toObject(),
  name,
  mobileNumber,
  pincode,
  locality,
  city,
  state,
  landmark,
  alternativeNumber: alternativeNumber || null,
  addressType,
  address
};


    await addressDoc.save();

    res.redirect('/address?success=updated');
  } catch (error) {
    console.error('editAddress error', error);
    res.redirect('/address');
  }
};

const deleteAddress = async (req, res) => {
  try {
    const userId = req.session.user;
    const index = parseInt(req.params.index);

    const addressDoc = await Address.findOne({ userId });

    if (!addressDoc || !addressDoc.address[index]) {
      return res.status(400).json({ success: false });
    }

    addressDoc.address.splice(index, 1);
    await addressDoc.save();

    res.json({ success: true, type: 'deleted'  });
  } catch (error) {
    console.error('deleteAddress error', error);
    res.status(500).json({ success: false });
  }
};



const logout = async (req, res) => {
  try {
    delete req.session.user; 

    res.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate, private'
    );
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    return res.redirect('/');
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
  loadEditProfile,
  updateProfile,
  loadChangePassword,
  changeProfilePassword,
  requestEmailChange,
  verifyEmailChangeOtp,
  loadProfileForgotPassword,
  profileForgotPasswordRequest,
  profileForgotVerifyOtp,
  profileForgotResetPassword,
  deleteProfileImage,
  loadManageAddress,
  loadAddAddress,
  setDefaultAddress,
  addAddress,
  loadEditAddress,
  editAddress,
  deleteAddress,
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
  loadEditProfile,
  updateProfile,
  loadChangePassword,
  changeProfilePassword,
  requestEmailChange,
  verifyEmailChangeOtp,
  loadProfileForgotPassword,
  profileForgotPasswordRequest,
  profileForgotVerifyOtp,
  profileForgotResetPassword,
  deleteProfileImage,
  loadManageAddress,
  loadAddAddress,
  addAddress,
  setDefaultAddress,
  loadEditAddress,
  editAddress,
  deleteAddress,
  logout
};