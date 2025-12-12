const express = require('express')
const router = express.Router();
const userController = require('../controllers/user/userController')
const productController = require('../controllers/user/productController')
const passport = require('../config/passport');
const {userAuth} = require("../middlewares/auth")

router.get('/pageNotFound', userController.pageNotFound);

router.get('/', userController.loadHome);

router.get('/signup',userController.loadSignupPage);
router.post('/signup', (req, res, next) => { console.log('[ROUTE] POST /signup', req.body?.email); next(); }, userController.signup);

router.post('/verify-otp', userController.verifyOtp)
router.post('/resend-otp', userController.resendOtp);

router.get('/login', userController.loadLoginPage)
router.post('/login', (req, res, next) => { console.log('[ROUTE] POST /login', req.body?.email); next(); }, userController.login);

router.get('/forgot-password', (req,res) => res.render('forgot-password'));
router.post('/forgot-password', userController.forgotPasswordRequest);
router.post('/forgot-verify', userController.forgotVerifyOtp);
router.post('/forgot-password-otp', userController.forgotResendOtp);
router.get('/change-password', (req,res) => res.render('change-password'));
router.post('/change-password', userController.forgotChangePassword);


router.get('/logout', userAuth, userController.logout);

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

router.get('/products', productController.listProducts);        // All products page
router.get('/product/:id', productController.productDetails); 

module.exports = router;