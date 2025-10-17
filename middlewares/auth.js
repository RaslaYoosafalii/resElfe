const User = require("../models/userSchema");

const userAuth = (req, res, next) => {
    if(req.session.user){
        User.findById(req.session.user)
        .then(user => {
            if(user && user.isBlocked){
                next();
            }else{
                res.redirect('/login')
            }
        }).catch(err =>{
            console.log('Error in User Auth Middleware', err.message);
            return res.status(500).send("Internal Server Error");
        })
    }else{
        return res.redirect('/login')
    }
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