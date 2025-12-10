const User = require("../models/userSchema");

const userAuth = (req, res, next) => {
    const userId = req.session.user;
    if (!userId) return res.redirect('/login');

    User.findById(userId)
        .then(user => {
            if (!user || user.isBlocked) {
                return res.redirect('/login');
            }
            req.user = user;
            next();
        })
        .catch(err => {
            console.log('Error in User Auth Middleware', err.message);
            return res.status(500).send("Internal Server Error");
        });
};




const adminAuth = (req, res, next) => {
     if (req.session.admin){
         User.findOne({isAdmin: true})
         .then(admin => {
             if (admin && admin.isAdmin) { 
                next();
            }else{
                req.session.destroy(); // Clear invalid session
                res.redirect('/admin/login');
            }
         }).catch(err => {
             console.error("Error in Admin Auth Middleware", err);
             res.status(500).send("Internal Server Error");
         })
     }else{
        res.redirect('/admin/login');
     }
}




module.exports = {
    userAuth,
    adminAuth
}