// validationResult reads internals express-validator attaches to `req` during
// the validator chain, so it's mocked rather than driving a real chain here.
jest.mock('express-validator', () => ({ validationResult: jest.fn() }));

const { validationResult } = require('express-validator');
const { handleValidation } = require('../validate');

const buildRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

/** Stub the result object handleValidation expects back. */
const withErrors = (...errors) => {
    validationResult.mockReturnValue({
        isEmpty: () => errors.length === 0,
        array: jest.fn().mockReturnValue(errors)
    });
};

beforeEach(() => jest.clearAllMocks());

describe('handleValidation', () => {
    it('calls next and answers nothing when validation passed', () => {
        withErrors();
        const res = buildRes();
        const next = jest.fn();

        handleValidation({}, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });

    it('answers 400 and does NOT call next when validation failed', () => {
        withErrors({ msg: 'Invalid Chat ID format.', path: 'chatId' });
        const res = buildRes();
        const next = jest.fn();

        handleValidation({}, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
    });

    // The frontend's api.js reads response.data.message and nothing else. The
    // eight endpoints that answered with only an `errors` array surfaced
    // axios's generic "Request failed with status code 400" instead - the real
    // message was computed and then thrown away.
    it('includes a top-level message, which is what the client reads', () => {
        withErrors({ msg: 'Invalid Chat ID format.', path: 'chatId' });
        const res = buildRes();

        handleValidation({}, res, jest.fn());

        expect(res.json.mock.calls[0][0].message).toBe('Invalid Chat ID format.');
    });

    it('keeps the per-field errors array for callers that want detail', () => {
        const errors = [
            { msg: 'Username must be 3+ characters', path: 'username' },
            { msg: 'Please enter a valid email address.', path: 'email' }
        ];
        withErrors(...errors);
        const res = buildRes();

        handleValidation({}, res, jest.fn());

        expect(res.json.mock.calls[0][0].errors).toEqual(errors);
    });

    it('reports the first failure as the message when several fields are bad', () => {
        withErrors(
            { msg: 'Username must be 3+ characters', path: 'username' },
            { msg: 'Please enter a valid email address.', path: 'email' }
        );
        const res = buildRes();

        handleValidation({}, res, jest.fn());

        expect(res.json.mock.calls[0][0].message).toBe('Username must be 3+ characters');
    });

    it('caps at one error per field', () => {
        withErrors({ msg: 'whatever', path: 'x' });
        handleValidation({}, buildRes(), jest.fn());

        const result = validationResult.mock.results[0].value;
        expect(result.array).toHaveBeenCalledWith({ onlyFirstError: true });
    });

    // Defensive: isEmpty() false with an empty array shouldn't produce
    // `message: undefined`, which the client would render as a blank error.
    it('falls back to a generic message rather than undefined', () => {
        validationResult.mockReturnValue({
            isEmpty: () => false,
            array: jest.fn().mockReturnValue([])
        });
        const res = buildRes();

        handleValidation({}, res, jest.fn());

        expect(res.json.mock.calls[0][0].message).toBe('Validation failed.');
    });
});
