/**
 * The bug this guards is a *missing* option, which is invisible by nature:
 * everything works until Mongo is unreachable, and then the failure takes 30s
 * to surface instead of 5. Nothing crashes, so only asserting the option is
 * passed will catch a regression.
 */
jest.mock('mongoose', () => ({ connect: jest.fn() }));

const mongoose = require('mongoose');
const connectDB = require('../db');

describe('connectDB', () => {
    let exitSpy;
    let logSpy;
    let errorSpy;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/test';
        // connectDB exits the process on failure - stub it or a failing test
        // would tear down the jest worker.
        exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        exitSpy.mockRestore();
        logSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it('bounds server selection so an unreachable Mongo fails fast', async () => {
        mongoose.connect.mockResolvedValue();

        await connectDB();

        const [, options] = mongoose.connect.mock.calls[0];
        expect(options.serverSelectionTimeoutMS).toBe(5000);
    });

    it('still passes the pool size', async () => {
        mongoose.connect.mockResolvedValue();

        await connectDB();

        const [uri, options] = mongoose.connect.mock.calls[0];
        expect(uri).toBe('mongodb://127.0.0.1:27017/test');
        expect(options.maxPoolSize).toBe(10);
    });

    it('exits when the initial connection fails', async () => {
        mongoose.connect.mockRejectedValue(new Error('ECONNREFUSED'));

        await connectDB();

        expect(exitSpy).toHaveBeenCalledWith(1);
    });
});
