const User = require('../../models/userSchema')
const nodemailer = require('nodemailer');
const env = require('dotenv').config()
const bcrypt = require('bcrypt');



//not found page
const pageNotFound = async (req, res) => {
    try{

      return res.render('page-404')

    }catch(error){
      res.redirect('/pageNotFound')
    }
}


//load home page
const loadHome = async (req, res) => {
    try{
    
      const user = req.session.user;

      if(user){
        const userData = await User.findById(user);
        res.render('loggedinHome', {user: userData})
      }else{
        res.render('homepage')
      }

    }catch(error){

         console.log('home page not found');
         res.status(500).send('server error')
         
    }
}

//load login page
const loadLoginPage = async (req, res) => {
    try {
      if(!req.session.user){

          return res.render('login', {user: null})

      }else{
        res.redirect('/')
      }

    } catch (error) {
        res.redirect('/pagenotfound')
         console.log('page not found');
        
    }
}

//login
const login = async(req, res) => {
  try {
    console.log('[AUTH] login attempt', req.body?.email);

    const {email, password} = req.body;

    if (!email || !password) {
      console.log('[AUTH] login failed: missing email or password');
      return res.render('login', { message: 'Fill all required fields', user: null });
    }

    const user = await User.findOne({isAdmin:0, email: email})

    if(!user){
      console.log('[AUTH] login failed: user not found -', email);
      return res.render('login', {message: 'User not found', user: req.session.user || null})
    }

    if( !user || user.isBlocked){
      console.log('[AUTH] login failed: blocked or invalid -', email);
      return res.render('login', {
        message: user?.isBlocked
        ? 'You are blocked by admin' : 'Invalid email or password', user: null
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
     
    if(!passwordMatch){
      console.log('[AUTH] login failed: incorrect password -', email);
      return res.render('login', { message: 'incorrect password', user: null})
    }
    req.session.user = user._id;
    console.log('[AUTH] login success -', email);
    res.redirect('/');

  } catch (error) {

    console.error('Login Error',error);
    res.render('login',{message:'Login Failed Try again', user: null})
  }
}




//load signup page
const loadSignupPage = async (req, res) => {
  try{
    res.render('signup',{ user: null })
  }catch(error){
     console.log('Page Not Found', error.message)
     res.redirect('/pagenotfound')
  }
}

//generating random otp
function generateOTP() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}


//otp verification email sending
async function sendVerificationEmail(email, otp){
    try{
        
       const transporter = nodemailer.createTransport({
        service: 'gmail',
        port:587,
        secure:false,
        auth: {
          user: process.env.NODEMAILER_EMAIL,
          pass: process.env.NODEMAILER_PASSWORD
        }
       })
      
       await transporter.verify();

       const info = await transporter.sendMail({
            from: process.env.NODEMAILER_EMAIL, //app email
            to: email,                        //user email
            subject: 'Verify your account',
            text: `Your OTP is ${otp}`,
            html: `<b>Your OTP is ${otp}</b>`
        })

        console.log('nodemailer info:', info);

        // return info.accepted.length > 0
        return { ok: info.accepted && info.accepted.length > 0, info, rejected: info.rejected };

        
    } catch (error) {

         console.error("Error for sending email",error)
         return false;
    }
}

//signup
const signup = async (req, res) => {
  const { email, password, confirmPassword, refferalCode } = req.body;

  try {
    console.log("[AUTH] signup attempt", email);

    if (!email || !password || !confirmPassword) {
      console.log('[AUTH] signup failed: missing required fields');
      return res.render('signup', { message: 'Fill all required fields', user: null });
    }

    if (password !== confirmPassword) {
      console.log('[AUTH] signup failed: passwords do not match -', email);
      return res.render('signup', { message: 'Passwords do not match', user: null });
    }

    console.log("🔍 Searching for existing user...");
    const findUser = await User.findOne({ email: email.toLowerCase() });
    console.log("🔹 User search result:", findUser);

    if (findUser) {
      console.log('[AUTH] signup failed: user exists -', email);
      return res.render('signup', { message: 'User with this email already exists', user: null });
    }

    const otp = generateOTP();
    console.log("Generated OTP:", otp);

    const emailResult = await sendVerificationEmail(email, otp);
    console.log("Email result:", emailResult);

    if (!emailResult || !emailResult.ok) {
      console.error('Email sending failed detail:', emailResult);
      return res.render('signup', {
        message: 'Failed to send verification email. Check your email or try again later.',
        user: null
      });
    }

    // store sessions (make sure express-session is configured before routes)
    req.session.userOtp = otp;
    req.session.userData = { email: email.toLowerCase(), password, refferalCode };
    req.session.otpCreatedAt = Date.now();

    console.log('otp sent successfully', otp);
    return res.render('verify-otp', { email });

  } catch (error) {
    console.error('[AUTH] signup error:', error);
    return res.render('signup', { message: 'Signup failed, please try again.', user: null });
  }
};

//password hashing
const securePassword = async (password) => {
  try{

   const passwordHash = await bcrypt.hash(password, 10)
   return passwordHash;

  }catch (error) {

  }
}

//otp verification
const verifyOtp = async(req, res) => {

  try{

   const {otp} = req.body;
  console.log('[AUTH] verifyOtp received OTP:', otp);
  const email = req.session?.userData?.email || '';
  
   // Check if OTP exists in session
   if (!req.session.userOtp) {
      console.log('[AUTH] verifyOtp failed: OTP missing in session');
      return res.render('verify-otp', { email, message: 'OTP expired. Please resend.' });
    }

    const createdAt = req.session.otpCreatedAt;
    const TEN_MIN = 10 * 60 * 1000;
    if (createdAt && (Date.now() - createdAt > TEN_MIN)) {
      req.session.userOtp = null;
      console.log('[AUTH] verifyOtp failed: OTP expired');
      return res.render('verify-otp', { email, message: 'OTP expired. Please resend.' });
    }


   //checking if the otp matches
   if(otp===req.session.userOtp){
     const userData = req.session.userData;
           if (!userData) {
             console.log('[AUTH] verifyOtp failed: user data missing in session');
             return res.render('verify-otp', { email, message: 'User data missing in session.' });
           }

     const passwordHash = await securePassword(userData.password);

     const saveUserData = new User({
         email: userData.email,
         password: passwordHash,
        refferalcode: userData.refferalCode || undefined
     })
     
     await saveUserData.save()
     req.session.user = saveUserData._id

       // Clear OTP from session
      req.session.userOtp = null;
      req.session.userData = null;
      req.session.otpCreatedAt = null;

    return res.json({success:true, redirectUrl:'/login'})


   }else{
     console.log('[AUTH] verifyOtp failed: invalid OTP');
     return res.render('verify-otp', { email, message: 'Invalid OTP, please try again' });
   }

  } catch(error){
     console.error('[AUTH] verifyOtp error',error)
     const email = req.session?.userData?.email || '';
     return res.render('verify-otp', { email, message:'Server Error, please try again.' })
  }
  
}

//resent otp
const resendOtp = async (req, res) => {
   try {
    const { email } = req.body;
    console.log('[AUTH] resendOtp attempt -', email);

    // check email exists in session
    if (!req.session.userData || req.session.userData.email !== email) {
      console.log('[AUTH] resendOtp failed: email mismatch or missing session data');
      return res.render('verify-otp', { email: email || '', message: 'Invalid request' });
    }

    // Generate new OTP
    const otp = generateOTP();
    req.session.userOtp = otp;
    req.session.otpCreatedAt = Date.now();

    // Send email
    const emailSent = await sendVerificationEmail(email, otp);
    if (!emailSent) {
      console.log('[AUTH] resendOtp failed: email send error');
      return res.render('verify-otp', { email, message: 'Failed to send OTP' });
    }

    console.log('[AUTH] resendOtp success -', email);
    return res.json({ success: true, message: 'OTP resent successfully' });

  } catch (error) {
    console.error('[AUTH] resendOtp error', error);
    const email = req.session?.userData?.email || '';
    return res.render('verify-otp', { email, message: 'Server error' });
  }

};


//logout
// const logout = async (req, res) => {
//   try {
//     req.session.destroy((err) => {
//       if(err){
//            console.log("Session destruction error",err.message)
//            return res.redirect("/pagenotfound")
//       }
//       return res.redirect("/login")
//     })
//   } catch (error) {
//        console.log('Logout Error', error);
//        res.redirect('/pagenotfound');
//   }
// }
const logout = async (req, res) => {
  try {
    const finish = () => {
      res.clearCookie('connect.sid', { path: '/' });
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      return res.redirect('/login');
    };

    if (!req.session) return finish();

    req.session.destroy((err) => {
      if (err) {
        console.log('Session destruction error', err);
        return finish();
      }
      return finish();
    });
  } catch (error) {
    console.log('Logout Error', error);
    res.redirect('/pageNotFound');
  }
};


module.exports = {
   loadHome,
   pageNotFound,
   loadSignupPage,
   signup,
   sendVerificationEmail,
   verifyOtp,
   resendOtp,
   loadLoginPage,
   login,
   logout
 }