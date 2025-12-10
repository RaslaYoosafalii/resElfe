const express = require('express');
const router = express.Router()
const adminController = require('../controllers/admin/adminController')
const {adminAuth} = require('../middlewares/auth')


router.get('/errorPage', adminController.errorPage);

router.get('/login', adminController.loadLogin);
router.post('/login', adminController.login);
router.get('/', adminAuth, adminController.loadDashboard);
router.get('/logout', adminController.logout)



module.exports = router;