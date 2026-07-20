process.env.JWT_SECRET = 'test-secret-for-unit-tests';

const jwt = require('jsonwebtoken');
const { issueAuthResponse } = require('../authController');

const user = {
    _id: 'user-1',
    username: 'alice',
    email: 'alice@example.com',
    avatar: 'avatar.png',
    password: 'hashed-and-secret'
};

describe('issueAuthResponse', () => {
    it('signs a token carrying userId and username', () => {
        const { token } = issueAuthResponse(user);
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        expect(decoded.userId).toBe('user-1');
        expect(decoded.username).toBe('alice');
    });

    it('sets an expiry on the token', () => {
        const { token } = issueAuthResponse(user);
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        expect(decoded.exp).toBeGreaterThan(decoded.iat);
    });

    it('returns the public user fields', () => {
        const { user: publicUser } = issueAuthResponse(user);

        expect(publicUser).toEqual({
            id: 'user-1',
            username: 'alice',
            email: 'alice@example.com',
            avatar: 'avatar.png'
        });
    });

    // The response is spread straight into res.json, so anything extra on the
    // document would go over the wire.
    it('never leaks the password field', () => {
        const { user: publicUser } = issueAuthResponse(user);

        expect(publicUser.password).toBeUndefined();
        expect(Object.keys(publicUser)).not.toContain('password');
    });

    // Presence lives in Redis; the User model has no such field. Both original
    // copies asked for it and always got undefined.
    it('does not claim to report presence', () => {
        const { user: publicUser } = issueAuthResponse(user);

        expect(Object.keys(publicUser)).not.toContain('onlineStatus');
        expect(Object.keys(publicUser)).not.toContain('lastSeen');
    });
});
