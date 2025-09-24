const pageNotFound = async (req, res) => {
    try{

      return res.render('page-404')

    }catch(error){
      res.redirect('/pageNotFound')
    }
}





const loadHome = async (req, res) => {
    try{

      return res.render('user/homepage')

    }catch(error){

         console.log('home page not found');
         res.status(500).send('server error')
         
    }
}

module.exports = { loadHome, pageNotFound }