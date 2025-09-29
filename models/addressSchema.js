const mongoose = require('mongoose')
const { schema } = mongoose;

const addressSchema = new Schema({
    userId: {
      type:Schema.Types.ObjectId,
      ref:'User',
      required: true
    },
    address: [{
        state:{
            type:String,
            required:true
        },
        locality:{
            type:String,
            required:true
        },
         pincode:{
            type: Number,
            required:true
        },
         city:{
            type:String,
            required:true
        },
         landmark:{
            type:String,
            required:true
        },
        name:{
            type:String,
            required:true
        },
        mobileNumber:{
            type: Number,
            required:true
        },
        alternativeNumber:{
            type: Number,
            required: false
        },
         addressType:{
            type:String,
            required:true
        },
    }],

})

const Address = mongoose.model('Address', addressSchema);

module.exports = Address;