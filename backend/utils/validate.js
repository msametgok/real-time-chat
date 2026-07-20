const { validationResult } = require('express-validator');

/**
 * Express middleware that ends the request with 400 if any validator in the
 * chain ahead of it failed. Drop it between the validators and the handler:
 *
 *   exports.createGroupChat = [
 *       body('chatName').trim().isLength({ min: 1 }),
 *       handleValidation,
 *       async (req, res) => { ... }
 *   ];
 *
 * Replaces ten hand-written blocks that came in two shapes:
 *
 *   { message: errors.array()[0].msg }              (auth routes)
 *   { errors: errors.array({onlyFirstError:true}) } (everything else)
 *
 * The response below is a superset of both, which is deliberate. The frontend's
 * api.js reads `error.response.data.message` and nothing else, so every
 * endpoint using the second shape surfaced axios's generic "Request failed with
 * status code 400" instead of the actual problem - the validation message was
 * computed, serialised, and then never shown to anyone. `message` fixes that;
 * `errors` keeps the per-field detail for anything that wants it.
 *
 * onlyFirstError caps it at one error per field, so a form with three bad
 * fields still reports all three - just not every rule each one broke.
 */
const handleValidation = (req, res, next) => {
    const errors = validationResult(req);
    if (errors.isEmpty()) return next();

    const details = errors.array({ onlyFirstError: true });

    return res.status(400).json({
        message: details[0]?.msg || 'Validation failed.',
        errors: details
    });
};

module.exports = { handleValidation };
