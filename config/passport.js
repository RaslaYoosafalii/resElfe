const env = require('dotenv').config();
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/userSchema');

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: 'http://localhost:5023/auth/google/callback'
},
async (accessToken, refreshToken, profile, done) =>{
    try {

        let user = await User.findOne({ $or: [{ googleId: profile.id }, { email: profile.emails[0].value }] });

     if(user){
        if(!user.googleId){ // If user exists but doesn't have googleId, update it
            user.googleId = profile.id;
            await user.save()// updates googleId on existing user
        }
        return done(null, user);
     }else{
        user = new User({
            name: profile.displayName,
            email: profile.emails[0].value.toLowerCase(),
            googleId: profile.id
        })
        await user.save();
        return done(null, user)
     }

    } catch (error) {

         return done(error, null)
    }
  }
))  

//assigning user details into session
passport.serializeUser((user, done) => {
    done(null, user.id);
});

//to fetch user data from session
passport.deserializeUser((id, done) => {
    User.findById(id)
    .then(user => {
        done(null, user);
    }).catch(err => {
        done(err, null)
    })
});

module.exports = passport;