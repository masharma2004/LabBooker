const jwt = require('jsonwebtoken');
const User = require('../models/User');

const verifyToken= (req, res, next) => {
   const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ msg: 'No token, authorization denied' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded.user;
    next();
  } catch (err) {
    res.status(401).json({ msg: 'Token is not valid' });
  }
};

// Must run after verifyToken. Reads isAdmin from the DB rather than the token
// so a demoted admin loses access immediately.
const requireAdmin = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('isAdmin');
    if (!user || !user.isAdmin) {
      return res.status(403).json({ msg: 'Admin access required' });
    }
    next();
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};

const generateToken = (user) => {
  const payload = {
    user: {
      id: user._id,
      isAdmin: user.isAdmin || false
    }
  };
  return jwt.sign(
    payload,
    process.env.JWT_SECRET,
    { expiresIn: '2h' }
  );
};


module.exports = { verifyToken, requireAdmin, generateToken };