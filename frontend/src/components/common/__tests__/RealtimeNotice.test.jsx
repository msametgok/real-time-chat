import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const chatState = vi.hoisted(() => ({ current: {} }));

vi.mock('../../../hooks/useChat', () => ({
    useChat: () => chatState.current
}));

import RealtimeNotice from '../RealtimeNotice';

const dismiss = vi.fn();

const setState = over => {
    chatState.current = {
        connectionError: null,
        realtimeError: null,
        dismissRealtimeError: dismiss,
        ...over
    };
};

beforeEach(() => {
    vi.clearAllMocks();
    setState({});
});

afterEach(() => {
    vi.useRealTimers();
});

describe('RealtimeNotice', () => {
    it('renders nothing when there is no error', () => {
        const { container } = render(<RealtimeNotice />);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows a transient realtime error', () => {
        setState({ realtimeError: { message: 'Access denied.', key: 1 } });
        render(<RealtimeNotice />);
        expect(screen.getByRole('status')).toHaveTextContent('Access denied.');
    });

    it('auto-dismisses after the timeout', () => {
        vi.useFakeTimers();
        setState({ realtimeError: { message: 'Access denied.', key: 1 } });
        render(<RealtimeNotice />);

        expect(dismiss).not.toHaveBeenCalled();
        act(() => vi.advanceTimersByTime(6000));
        expect(dismiss).toHaveBeenCalled();
    });

    // The countdown is keyed on `key`, not the text: a second identical failure
    // must get its own full timeout rather than inheriting the remainder of the
    // first one's.
    it('restarts the countdown when an identical message repeats', () => {
        vi.useFakeTimers();
        setState({ realtimeError: { message: 'same', key: 1 } });
        const { rerender } = render(<RealtimeNotice />);

        act(() => vi.advanceTimersByTime(5000));
        expect(dismiss).not.toHaveBeenCalled();

        setState({ realtimeError: { message: 'same', key: 2 } });
        rerender(<RealtimeNotice />);

        // 5s already elapsed; without the restart this would fire here.
        act(() => vi.advanceTimersByTime(2000));
        expect(dismiss).not.toHaveBeenCalled();

        act(() => vi.advanceTimersByTime(4000));
        expect(dismiss).toHaveBeenCalled();
    });

    it('can be dismissed by hand', async () => {
        const user = userEvent.setup();
        setState({ realtimeError: { message: 'Access denied.', key: 1 } });
        render(<RealtimeNotice />);

        await user.click(screen.getByRole('button', { name: /dismiss/i }));
        expect(dismiss).toHaveBeenCalled();
    });

    // A dead socket explains the rejection, so it wins - and it is not
    // dismissible, because dismissing it would not reconnect anything.
    it('prefers a connection error and hides the dismiss button', () => {
        setState({
            connectionError: 'Could not connect to the server.',
            realtimeError: { message: 'Access denied.', key: 1 }
        });
        render(<RealtimeNotice />);

        expect(screen.getByRole('status')).toHaveTextContent('Could not connect to the server.');
        expect(screen.queryByText('Access denied.')).toBeNull();
        expect(screen.queryByRole('button', { name: /dismiss/i })).toBeNull();
    });
});
