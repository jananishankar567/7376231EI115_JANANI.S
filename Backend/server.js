require("dotenv").config()
const express=require("express")
const app=express()
const PORT=process.env.PORT
const cors=require("cors")
app.use(cors())
app.get("/",(req,res)=>{
    res.send("server running")
})
app.listen(PORT,()=>{
    console.log(`server is running on port ${PORT}`)
})