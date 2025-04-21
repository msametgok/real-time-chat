const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const User = require("../models/User");

require("dotenv").config();

//Register a new user
exports.register = [
  // Validate request body
  body("email").isEmail().normalizeEmail().withMessage("Invalid email"),
  body("username")
    .isLength({ min: 3 })
    .trim()
    .withMessage("Username must be 3+ characters"),
  body("password")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters long"),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { username, email, password } = req.body;

      //Check if user already exists
      const userExists = await User.findOne({ $or: [{ username }, { email }] });
      if (userExists)
        return res.status(400).json({ message: "User already exists" });

      //Hash the password
      const hashedPassword = await bcrypt.hash(password, 10);

      //Create a new user
      const user = new User({ username, email, password: hashedPassword });
      await user.save();

      // Generate JWT token
      const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES,
      });

      res.status(201).json({ message: "User registered successfully", token });
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  },
];

exports.login = [
  body("email").isEmail().normalizeEmail().withMessage("Invalid email"),
  body("password").notEmpty().withMessage("Password is required"),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const { email, password } = req.body;
      const user = await User.findOne({ email });
      if (!user)
        return res.status(400).json({ message: "Invalid credentials" });
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch)
        return res.status(400).json({ message: "Invalid credentials" });
      const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES,
      });
      res.status(201).json({ message: "User logged in successfully", token });
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  },
];
