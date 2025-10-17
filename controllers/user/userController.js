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
      
       const info = await transporter.sendMail({
            from: process.env.NODEMAILER_EMAIL, //app email
            to: email,                        //user email
            subject: 'Verify your account',
            text: `Your OTP is ${otp}`,
            html: `<b>Your OTP is ${otp}</b>`
        })

        return info.accepted.length > 0
    } catch (error) {

         console.error("Error for sending email",error)
         return false;
    }
}

//signup
const signup = async (req, res) => {
  const {email, password, confirmPassword, refferalCode } = req.body;

  try{ 

    console.log("req.body:", req.body); 

    //password check
     if( password !==  confirmPassword ){
            return res.render('signup',{message:'Password do not matched',user: null})
        }
      //checking user
      console.log("🔍 Searching for existing user...");
      const findUser = await User.findOne({email:email})
      console.log("🔹 User search result:", findUser);

      //if user with same email exists
      if(findUser){
            return res.render('signup',{message:'User with this email already exists',user: null})
        }  
      
      //generating random otp 
      const otp = generateOTP();
      console.log("Generated OTP:", otp);

      //sending verification email
      const emailSent = await sendVerificationEmail(email,otp);
      console.log("Email sent:", emailSent); 

      //if error occured while sending verification email
      if(!emailSent){
         return res.json("email-error")
      }
      //keep session after successfully sending otp
      req.session.userOtp = otp;
      //keep session of user data
      req.session.userData = {email, password, refferalCode};
      //keep session of otp creation time
      req.session.otpCreatedAt = Date.now()

      console.log('otp send successfully', otp)
      //rendering verify otp page
      res.render('verify-otp', {email});
      
      

  }catch(error){
      console.error('signup error',error)
      return res.redirect('/pageNotFound');
  }

}

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

   //checking if the otp matches
   if(otp===req.session.userOtp){
     const user = req.session.userData;
     const passwordHash = await securePassword(user.password);

     const saveUserData = new User({
         email: user.email,
         password: passwordHash,
        //  refferalcode: refferalCode,
     })
     
     await saveUserData.save()
     req.session.user = saveUserData._id

       // Clear OTP from session
      req.session.userOtp = null;
    
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
   verifyOtp,
   resendOtp,
   loadLoginPage,
   login,
   logout
 }