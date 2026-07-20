const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const User = require("../models/User");

require("dotenv").config();

/**
 * Register and login answer with the same envelope: a freshly signed token and
 * a trimmed public view of the user. Only the surrounding `message` and status
 * code differ, so spread this into the response body.
 *
 * Note there is no `onlineStatus` here. Both copies used to include it, but the
 * User model has no such field - presence lives in Redis - so it was always
 * `undefined` and JSON.stringify dropped it before the response ever went out.
 * Carrying it into the shared helper would have made a phantom look canonical.
 */
const issueAuthResponse = (user) => ({
  token: jwt.sign(
    { userId: user._id, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES || "1h" }
  ),
  user: {
    id: user._id,
    username: user.username,
    email: user.email,
    avatar: user.avatar
  }
});

// Exported for unit testing - the route handlers are the real entry points.
exports.issueAuthResponse = issueAuthResponse;

//Register a new user
exports.register = [
  // Validate request body
  body("email").isEmail().withMessage("Please enter a valid email address.").normalizeEmail(),
  body("username")
    .isLength({ min: 3, max: 20})
    .trim()
    .withMessage("Username must be 3+ characters").escape(),
  body("password")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters long"),

  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ message: errors.array()[0].msg });
      }

      const { username, email, password } = req.body;

      //Check if user already exists
      const userExists = await User.findOne({ $or: [{ username }, { email }] });
      if (userExists)
        return res.status(400).json({ message: "User already exists" });

      //Create a new user
      const user = new User({ username, email, password });
      await user.save();

      res.status(201).json({
        message: "User registered successfully.",
        ...issueAuthResponse(user)
      });
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  },
];

exports.login = [
  body("email").isEmail().normalizeEmail().withMessage("Please enter a valid email address."),
  body("password").notEmpty().withMessage("Password is required"),

  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ message: errors.array()[0].msg });
      }

      const { email, password } = req.body;

      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user)
        return res.status(401).json({ message: "Invalid credentials" });

      const isMatch = await user.comparePassword(password);
      if (!isMatch)
        return res.status(401).json({ message: "Invalid credentials" });

      res.status(200).json({
        message: "User logged in successfully",
        ...issueAuthResponse(user)
      });
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  },
];

// Logout endpoint
exports.logout = async (req, res) => {
  try {
    // If you were using http-only cookies, you could clear them like:
    //    res.clearCookie('token');
    // With stateless JWTs, simply returning success is sufficient;
    // front-end will discard its copy of the token.
    return res.status(200).json({ message: "User logged out successfully." });
  } catch (error) {
    return res.status(500).json({ message: "Server error" });
  }
};
