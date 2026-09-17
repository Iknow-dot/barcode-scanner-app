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

    describe('syncing from a refreshed initialValue prop', () => {
        // F1: DeliveryStep renders six of these hooks off the same order. A
        // blur on one field PATCHes immediately; while that request is in
        // flight the consultant may already be typing in another field. The
        // response's order re-render must not clobber what they are typing.
        const renderField = (initialValue, onSave = jest.fn()) => {
            const utils = renderHook(
                ({value}) => useDebouncedField(value, onSave, 600),
                {initialProps: {value: initialValue}},
            );
            return {onSave, ...utils};
        };

        it('keeps a pending edit when the prop refreshes to a different value mid-debounce', () => {
            const {result, rerender, onSave} = renderField('');

            act(() => {
                result.current[1]('typed last name');
            });
            // A sibling field's save lands and DeliveryStep re-renders with
            // the order it got back, carrying a different value for THIS
            // field (e.g. a stale snapshot from before the current edit).
            rerender({value: 'stale server value'});

            expect(result.current[0]).toBe('typed last name');

            act(() => {
                jest.advanceTimersByTime(600);
            });
            expect(onSave).toHaveBeenCalledWith('typed last name');
        });

        it('does not reset or resave once the prop catches up to the value just flushed', () => {
            const {result, rerender, onSave} = renderField('');

            act(() => {
                result.current[1]('saved on blur');
            });
            act(() => {
                result.current[2](); // flush(), as onBlur does
            });
            expect(onSave).toHaveBeenCalledTimes(1);

            rerender({value: 'saved on blur'});

            expect(result.current[0]).toBe('saved on blur');
            expect(onSave).toHaveBeenCalledTimes(1);
        });

        it('adopts a later, genuinely different prop value once the flushed save is confirmed', () => {
            const {result, rerender} = renderField('');

            act(() => {
                result.current[1]('mine');
            });
            act(() => {
                result.current[2](); // flush() -> saves 'mine'
            });

            // The order carrying our own save's result lands first...
            rerender({value: 'mine'});
            // ...then a later, unrelated external edit changes the field
            // again (another user, or a value the server itself computed).
            // This is the legitimate syncing the fix must not break.
            rerender({value: 'someone else changed it'});

            expect(result.current[0]).toBe('someone else changed it');
        });

        it('adopts a later, different prop value after a save settles without ever changing the field (a failed save)', async () => {
            // F1 follow-up: DeliveryStep's real save() resolves (never
            // rejects) even when the PATCH is rejected server-side — it just
            // skips calling onOrderUpdate, so initialValue never catches up
            // to what was typed. A gate that only clears on a matching echo
            // wedges shut forever in exactly this case.
            let resolveSave;
            const onSave = jest.fn(() => new Promise((resolve) => {
                resolveSave = resolve;
            }));
            const {result, rerender} = renderField('', onSave);

            act(() => {
                result.current[1]('typed value');
            });
            act(() => {
                jest.advanceTimersByTime(600); // debounce fires; save() called, still pending
            });
            expect(onSave).toHaveBeenCalledWith('typed value');

            await act(async () => {
                resolveSave(); // the save "fails" the DeliveryStep way: resolves, order unchanged
                await Promise.resolve();
                await Promise.resolve();
            });

            // A later, genuinely different external change must still land.
            rerender({value: 'someone else changed it'});

            expect(result.current[0]).toBe('someone else changed it');
        });
    });
});
