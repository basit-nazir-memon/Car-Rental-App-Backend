const admin = (req, res, next) => {
    if (req.user && req.user.role === 'Admin') {
        next();
    } else {
        return res.status(403).json({ msg: 'Access denied. Admin privileges required.' });
    }
}

module.exports = admin;


