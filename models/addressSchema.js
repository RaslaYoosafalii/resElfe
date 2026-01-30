// models/addressSchema.js
import mongoose from 'mongoose';
const { Schema } = mongoose;

const addressSchema = new Schema({
    userId: {
      type: Schema.Types.ObjectId,
      ref:'User',
      required: true
    },
    address: [{
        address: {
        type: String,
        required: true
        },
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
         isDefault: {
            type: Boolean,
            default: false
        }
    }],

})

const Address = mongoose.model('Address', addressSchema);

export default Address;