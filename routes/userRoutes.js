const express = require('express')
const router = express.Router();
const userController = require('../controllers/user/userController')
const passport = require('../config/passport');


router.get('/pageNotFound', userController.pageNotFound);

router.get('/', userController.loadHome);

router.get('/signup',userController.loadSignupPage);
router.post('/signup', userController.signup);

router.post('/verify-otp', userController.verifyOtp)
router.post('/resend-otp', userController.resendOtp);

router.get('/login', userController.loadLoginPage)
router.post('/login', userController.login);

router.get('/logout',userController.logout)

router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'], prompt: 'select_account'}))
router.get('/auth/google/callback', passport.authenticate('google', {failureRedirect: '/signup'}), async(req, res) => {
    try {
        req.session.user = req.user._id;
        res.redirect('/')
    } catch (error) {
        console.log('google login error', error);
        res.redirect('/signup')
    }
})

module.exports = router;