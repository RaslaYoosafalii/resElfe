import express from 'express'
const router = express.Router();

import userController from '../controllers/user/userController.js'
import productController from '../controllers/user/productController.js'
import cartController from '../controllers/user/cartController.js'
import orderController from '../controllers/user/orderController.js';
import wishlistController from '../controllers/user/wishlistController.js';
import walletController from "../controllers/user/walletController.js";
import passport from '../config/passport.js'
import {userAuth, noCache} from "../middlewares/auth.js"
import { upload } from '../config/upload.js';

router.get('/pageNotFound', userController.pageNotFound);

router.get('/', noCache, userController.loadHome);

router.get('/signup',userController.loadSignupPage);
router.post('/signup', (req, res, next) => { console.log('POST /signup', req.body?.email); next(); }, userController.signup);

router.post('/verify-otp', userController.verifyOtp)
router.post('/resend-otp', userController.resendOtp);

router.get('/login',noCache, userController.loadLoginPage)
router.post('/login', (req, res, next) => { console.log('POST /login', req.body?.email); next(); }, userController.login);

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

//product management
router.get('/products', noCache, productController.listProducts);        
router.get('/product/:id',noCache,productController.productDetails); 


//profile management
router.get('/profile', noCache, userAuth, userController.loadUserprofile);
router.get('/profile/change-password',noCache,userAuth,userController.loadChangePassword);
router.post('/profile/change-password', userAuth, noCache,userController.changeProfilePassword);
router.get('/profile/forgot-password',userAuth, noCache, userController.loadProfileForgotPassword)
router.post('/profile/forgot-password', userAuth, noCache, userController.profileForgotPasswordRequest)
router.post('/profile/forgot-password/verify',userAuth, noCache,  userController.profileForgotVerifyOtp)
router.post('/profile/forgot-password/reset',userAuth, noCache, userController.profileForgotResetPassword)
router.post('/profile/change-email',userAuth, noCache, userController.requestEmailChange);
router.post('/profile/verify-email-otp',userAuth, noCache, userController.verifyEmailChangeOtp);
router.patch('/profile/edit', userAuth, noCache, upload.single('profileImage'), userController.updateProfile);
router.get('/profile/edit', noCache, userAuth, userController.loadEditProfile);
router.delete('/profile/delete-image',userAuth,userController.deleteProfileImage);
router.get('/profile/referral', userAuth, userController.loadReferralPage);

// Address management
router.get('/address', noCache, userAuth, userController.loadManageAddress);
router.get('/address/add', noCache, userAuth, userController.loadAddAddress);
router.post('/address/add', userAuth, userController.addAddress);
router.get('/address/edit/:index', noCache, userAuth, userController.loadEditAddress);
router.patch('/address/edit/:index', userAuth, userController.editAddress);
router.delete('/address/delete/:index', userAuth, userController.deleteAddress);
router.post('/address/set-default/:index',userAuth,userController.setDefaultAddress);


//cart management
router.get('/cart',noCache, userAuth, cartController.loadCart);
router.post('/cart/add',userAuth, cartController.addToCart);
router.patch('/cart/update', userAuth, cartController.updateCartQty);
router.patch('/cart/change-size', userAuth, cartController.changeCartSize);
router.delete('/cart/remove', userAuth, cartController.removeCartItem);

// checkout management
router.get('/checkout', noCache, userAuth, orderController.loadCheckout);
router.post('/order/place', userAuth, orderController.placeOrder);



//order management
router.get('/orders', userAuth, orderController.loadOrders);
router.get('/orders/:orderId', userAuth, orderController.getOrderDetails);
router.patch('/orders/cancel', userAuth, orderController.cancelOrder);
router.patch('/orders/return', userAuth, orderController.returnOrder);
router.get('/orders/invoice/:orderId', userAuth, orderController.downloadInvoice);
router.patch('/orders/return-item', userAuth, orderController.returnSingleItem);
router.patch('/orders/cancel-return', userAuth, orderController.cancelReturnRequest);
router.patch('/order/verify-payment', userAuth, orderController.verifyPayment);
router.get('/order/success/:orderId', noCache, userAuth, orderController.orderSuccess);
router.get('/order/failure/:orderId', userAuth, orderController.orderFailure);
router.get('/orders/retry/:orderId', userAuth, orderController.retryPayment);
router.patch('/order/mark-failed', userAuth, orderController.markOrderFailed);



// wishlist management
router.get('/wishlist', userAuth, wishlistController.loadWishlist);
router.post('/wishlist/add', userAuth, wishlistController.addToWishlist);
router.delete('/wishlist/remove', userAuth, wishlistController.removeFromWishlist);


//wallet management 
router.get("/wallet", userAuth, walletController.loadWallet);
router.get("/wallet/history", userAuth, walletController.loadTransactions);
router.post("/wallet/create-order", userAuth, walletController.createWalletOrder);
router.patch("/wallet/verify", userAuth, walletController.verifyWalletPayment);


//coupen management
router.post('/coupon/apply', userAuth, orderController.applyCoupon);
router.delete('/coupon/remove', userAuth, orderController.removeCoupon);






export default router;