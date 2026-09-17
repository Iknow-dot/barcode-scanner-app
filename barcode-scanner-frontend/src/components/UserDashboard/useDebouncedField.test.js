import {act, renderHook} from '@testing-library/react';
import useDebouncedField from './useDebouncedField';

describe('useDebouncedField', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('does not save before the delay elapses', () => {
        const onSave = jest.fn();
        const {result} = renderHook(() => useDebouncedField('', onSave, 600));

        act(() => {
            result.current[1]('a');
        });
        act(() => {
            jest.advanceTimersByTime(599);
        });

        expect(onSave).not.toHaveBeenCalled();
    });

    it('saves the latest value once the delay elapses', () => {
        const onSave = jest.fn();
        const {result} = renderHook(() => useDebouncedField('', onSave, 600));

        act(() => {
            result.current[1]('a');
        });
        act(() => {
            jest.advanceTimersByTime(600);
        });

        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onSave).toHaveBeenCalledWith('a');
    });

    it('resets the timer on rapid edits and saves once with the final value', () => {
        const onSave = jest.fn();
        const {result} = renderHook(() => useDebouncedField('', onSave, 600));

        act(() => {
            result.current[1]('a');
        });
        act(() => {
            jest.advanceTimersByTime(400);
        });
        act(() => {
            result.current[1]('ab');
        });
        act(() => {
            jest.advanceTimersByTime(400);
        });
        act(() => {
            result.current[1]('abc');
        });
        act(() => {
            jest.advanceTimersByTime(600);
        });

        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onSave).toHaveBeenCalledWith('abc');
    });

    it('flushes a pending edit exactly once on unmount', () => {
        const onSave = jest.fn();
        const {result, unmount} = renderHook(() => useDebouncedField('', onSave, 600));

        act(() => {
            result.current[1]('unsaved');
        });
        unmount();

        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onSave).toHaveBeenCalledWith('unsaved');

        // Advancing time past the original delay must not save again — the
        // pending timer was cleared by the unmount flush.
        act(() => {
            jest.advanceTimersByTime(600);
        });
        expect(onSave).toHaveBeenCalledTimes(1);
    });

    it('does not save twice when a manual flush is followed by unmount', () => {
        const onSave = jest.fn();
        const {result, unmount} = renderHook(() => useDebouncedField('', onSave, 600));

        act(() => {
            result.current[1]('typed then blurred');
        });
        act(() => {
            result.current[2](); // flush(), as a blur handler would call
        });
        unmount();

        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onSave).toHaveBeenCalledWith('typed then blurred');
    });
});
