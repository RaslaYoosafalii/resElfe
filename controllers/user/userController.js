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
        const userData = await User.findOne({_id: user._id})
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
    
    const {email, password} = req.body;

    const user = await User.findOne({isAdmin:0, email: email})

    if(!user){
      return res.render('login', {message: 'User not found', user: req.session.user || null})
    }

    if( !user || user.isBlocked){
      return res.render('login', {
        message: user?.isBlocked
        ? 'You are blocked by admin' : 'Invalid email or password', user: null
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
     
    if(!passwordMatch){
      return res.render('login', { message: 'incorrect password', user: null})
    }
    req.session.user = user._id;
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
    console.log("req.body:", req.body);

    if (!email || !password || !confirmPassword) {
      return res.render('signup', { message: 'Fill all required fields', user: null });
    }

    if (password !== confirmPassword) {
      return res.render('signup', { message: 'Passwords do not match', user: null });
    }

    console.log("🔍 Searching for existing user...");
    const findUser = await User.findOne({ email: email.toLowerCase() });
    console.log("🔹 User search result:", findUser);

    if (findUser) {
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
    console.error('signup error', error);
    return res.redirect('/pageNotFound');
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
  console.log('Received OTP:', otp);
  
   // Check if OTP exists in session
   if (!req.session.userOtp) {
      return res.status(400).json({ success: false, message: 'OTP expired. Please resend.' });
    }

    const createdAt = req.session.otpCreatedAt;
    const TEN_MIN = 10 * 60 * 1000;
    if (createdAt && (Date.now() - createdAt > TEN_MIN)) {
      req.session.userOtp = null;
      return res.status(400).json({ success: false, message: 'OTP expired. Please resend.' });
    }


   //checking if the otp matches
   if(otp===req.session.userOtp){
     const userData = req.session.userData;
           if (!userData) return res.status(400).json({ success: false, message: 'User data missing in session.' });

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
     res.send(400).json({success: false, message: 'Invalid OTP, please try again'})
   }

  } catch(error){
     console.error('Error verifying OTP',error)
     return res.status(500).json({success:false, message:'Server Error'})
  }
  
}

//resent otp
const resendOtp = async (req, res) => {
   try {
    const { email } = req.body;

    // check email exists in session
    if (!req.session.userData || req.session.userData.email !== email) {
      return res.status(400).json({ success: false, message: 'Invalid request' });
    }

    // Generate new OTP
    const otp = generateOTP();
    req.session.userOtp = otp;
    req.session.otpCreatedAt = Date.now();

    // Send email
    const emailSent = await sendVerificationEmail(email, otp);
    if (!emailSent) {
      return res.status(500).json({ success: false, message: 'Failed to send OTP' });
    }

    return res.json({ success: true, message: 'OTP resent successfully' });

  } catch (error) {
    console.error('Error resending OTP', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }

};


//logout
const logout = async (req, res) => {
  try {
    req.session.destroy((err) => {
      if(err){
           console.log("Session destruction error",err.message)
           return res.redirect("/pagenotfound")
      }
      return res.redirect("/login")
    })
  } catch (error) {
       console.log('Logout Error', error);
       res.redirect('/pagenotfound');
  }
}

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