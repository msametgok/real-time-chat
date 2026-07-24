import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import MessageInput from '../MessageInput';

/**
 * `typingTimeout` used to be a plain `let` at component scope. setInputValue
 * re-renders on every keystroke, resetting it to null - so clearTimeout was
 * always a no-op. Result: one uncancellable 2s timer PER keystroke, each
 * firing onTypingStop mid-typing, making the indicator flicker.
 */
describe('MessageInput typing debounce', () => {
    let onSendMessage, onTypingStart, onTypingStop, user;

    beforeEach(() => {
        // shouldAdvanceTime lets userEvent's internal awaits resolve against the
        // fake clock - without it every `await user.type(...)` deadlocks.
        vi.useFakeTimers({ shouldAdvanceTime: true });
        user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        onSendMessage = vi.fn();
        onTypingStart = vi.fn();
        onTypingStop = vi.fn();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const setup = () => {
        render(
            <MessageInput
                onSendMessage={onSendMessage}
                onTypingStart={onTypingStart}
                onTypingStop={onTypingStop}
            />
        );
        return screen.getByRole('textbox');
    };

    it('announces typing once per burst, not once per keystroke', async () => {
        const input = setup();

        await user.type(input, 'hello');

        expect(input).toHaveValue('hello');
        expect(onTypingStart).toHaveBeenCalledTimes(1);
    });

    it('does not fire onTypingStop while the user is still typing', async () => {
        const input = setup();

        await user.type(input, 'hello');
        act(() => { vi.advanceTimersByTime(1500); }); // under the 2s threshold

        expect(onTypingStop).not.toHaveBeenCalled();
    });

    it('fires onTypingStop exactly once after 2s of inactivity', async () => {
        const input = setup();

        await user.type(input, 'hello');
        act(() => { vi.advanceTimersByTime(2100); });

        expect(onTypingStop).toHaveBeenCalledTimes(1);
    });

    it('restarts the countdown on each keystroke', async () => {
        const input = setup();

        await user.type(input, 'ab');
        act(() => { vi.advanceTimersByTime(1800); });
        expect(onTypingStop).not.toHaveBeenCalled();

        await user.type(input, 'c');            // resets the timer
        act(() => { vi.advanceTimersByTime(1800); });
        expect(onTypingStop).not.toHaveBeenCalled();

        act(() => { vi.advanceTimersByTime(500); });
        expect(onTypingStop).toHaveBeenCalledTimes(1);
    });

    it('starts a new burst after the previous one ended', async () => {
        const input = setup();

        await user.type(input, 'hi');
        act(() => { vi.advanceTimersByTime(2100); });
        expect(onTypingStop).toHaveBeenCalledTimes(1);

        await user.type(input, 'more');
        expect(onTypingStart).toHaveBeenCalledTimes(2);
    });

    it('stops typing immediately on send and clears the input', async () => {
        const input = setup();

        await user.type(input, 'hello{Enter}');

        expect(onSendMessage).toHaveBeenCalledWith('hello');
        expect(onTypingStop).toHaveBeenCalledTimes(1);
        expect(input).toHaveValue('');
    });

    it('does not fire a stray onTypingStop after sending', async () => {
        const input = setup();

        await user.type(input, 'hello{Enter}');
        act(() => { vi.advanceTimersByTime(5000); });

        // Exactly one - the pending timer must have been cleared, not left to fire.
        expect(onTypingStop).toHaveBeenCalledTimes(1);
    });

    // The input used to be a single-line <input type="text">: long text could
    // never wrap, and Enter submitted no matter what. As a textarea, Enter
    // still sends but Shift+Enter has to make a new line instead.
    it('inserts a newline on Shift+Enter instead of sending', async () => {
        const input = setup();

        await user.type(input, 'ab{Shift>}{Enter}{/Shift}cd');

        expect(onSendMessage).not.toHaveBeenCalled();
        expect(input).toHaveValue('ab\ncd');
    });

    it('sends multiline content with its line breaks intact', async () => {
        const input = setup();

        await user.type(input, 'ab{Shift>}{Enter}{/Shift}cd{Enter}');

        expect(onSendMessage).toHaveBeenCalledWith('ab\ncd');
        expect(input).toHaveValue('');
    });

    it('ignores an empty or whitespace-only send', async () => {
        const input = setup();

        await user.type(input, '   {Enter}');

        expect(onSendMessage).not.toHaveBeenCalled();
    });

    it('does not fire onTypingStop after unmount', async () => {
        const { unmount } = render(
            <MessageInput
                onSendMessage={onSendMessage}
                onTypingStart={onTypingStart}
                onTypingStop={onTypingStop}
            />
        );

        await user.type(screen.getByRole('textbox'), 'hi');
        unmount();
        act(() => { vi.advanceTimersByTime(5000); });

        expect(onTypingStop).not.toHaveBeenCalled();
    });
});
