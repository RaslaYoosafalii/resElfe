import express from 'express'
const router = express.Router();

import userController from '../controllers/user/userController.js'
import productController from '../controllers/user/productController.js'
import cartController from '../controllers/user/cartController.js'
import orderController from '../controllers/user/orderController.js';
import passport from '../config/passport.js'
import {userAuth, noCache} from "../middlewares/auth.js"
import { upload } from '../config/upload.js';

router.get('/pageNotFound', userController.pageNotFound);

router.get('/', noCache, userController.loadHome);

router.get('/signup',userController.loadSignupPage);
router.post('/signup', (req, res, next) => { console.log('[ROUTE] POST /signup', req.body?.email); next(); }, userController.signup);

router.post('/verify-otp', userController.verifyOtp)
router.post('/resend-otp', userController.resendOtp);

router.get('/login',noCache, userController.loadLoginPage)
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

router.get('/products', noCache, userAuth, productController.listProducts);        // All products page
router.get('/product/:id',noCache, userAuth, productController.productDetails); 

router.get('/profile', noCache, userAuth, userController.loadUserprofile);
router.get('/profile/change-password',noCache,userAuth,userController.loadChangePassword);
router.post('/profile/change-password', userAuth, userController.changeProfilePassword);
router.get('/profile/forgot-password', userController.loadProfileForgotPassword)
router.post('/profile/forgot-password', userController.profileForgotPasswordRequest)
router.post('/profile/forgot-password/verify', userController.profileForgotVerifyOtp)
router.post('/profile/forgot-password/reset', userController.profileForgotResetPassword)
router.post('/profile/change-email',userAuth,userController.requestEmailChange);
router.post('/profile/verify-email-otp',userAuth,userController.verifyEmailChangeOtp);
router.post('/profile/edit',userAuth, upload.single('profileImage'), userController.updateProfile);
router.get('/profile/edit', noCache, userAuth, userController.loadEditProfile);
router.delete('/profile/delete-image',userAuth,userController.deleteProfileImage);

// Address management
router.get('/address', noCache, userAuth, userController.loadManageAddress);
router.get('/address/add', noCache, userAuth, userController.loadAddAddress);
router.post('/address/add', userAuth, userController.addAddress);
router.get('/address/edit/:index', noCache, userAuth, userController.loadEditAddress);
router.post('/address/edit/:index', userAuth, userController.editAddress);
router.delete('/address/delete/:index', userAuth, userController.deleteAddress);


//cart management
router.get('/cart',noCache, userAuth, cartController.loadCart);
router.post('/cart/add',userAuth, cartController.addToCart);
router.post('/cart/update',userAuth, cartController.updateCartQty);
router.post('/cart/change-size', userAuth, cartController.changeCartSize);
router.post('/cart/remove',userAuth, cartController.removeCartItem);

// checkout management
router.get('/checkout', noCache, userAuth, orderController.loadCheckout);
router.post('/order/place', userAuth, orderController.placeOrder);
router.get('/order/success/:orderId', userAuth, orderController.orderSuccess);

//order management

router.get('/orders', userAuth, orderController.loadOrders);
router.get('/orders/:orderId', userAuth, orderController.getOrderDetails);
router.post('/orders/cancel', userAuth, orderController.cancelOrder);
router.post('/orders/return', userAuth, orderController.returnOrder);
router.get('/orders/invoice/:orderId', userAuth, orderController.downloadInvoice);
router.post('/orders/return-item', userAuth, orderController.returnSingleItem);


export default router;