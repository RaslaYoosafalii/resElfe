const express = require('express')
const router = express.Router();
const userController = require('../controllers/user/userController')


router.get('/pageNotFound', userController.pageNotFound);
router.get('/', userController.loadHome);
router.get('/signup',userController.loadSignupPage);
router.post('/signup', userController.signup);

module.exports = router;