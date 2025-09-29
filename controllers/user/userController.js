const User = require('../../models/userSchema')


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

      return res.render('user/homepage')

    }catch(error){

         console.log('home page not found');
         res.status(500).send('server error')
         
    }
}

//load signup page
const loadSignupPage = async (req, res) => {
  try{
    res.render('user/signup',{ user: null })
  }catch(error){
     console.log('Page Not Found', error.message)
     res.redirect('/pagenotfound')
  }
}

//signup
const signup = async (req, res) => {
  const {email, password, confirmPassword, refferalCode} = req.body;
  try{ 
    const newUser = new User({email, password})
    console.log(newUser);

    await newUser.save();

    return res.redirect('/signup')

  }catch(error){
      console.error('signup error',error)
      res.redirect('/signup')
  }

}




module.exports = {
   loadHome,
   pageNotFound,
   loadSignupPage,
   signup
 }