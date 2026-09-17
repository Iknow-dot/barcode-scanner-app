import {useCallback, useEffect, useRef, useState} from 'react';

/**
 * Local state for a text field that saves to the order after a pause in
 * typing (moved unchanged from OrderPanel, plus flush-on-unmount below).
 * Returns [value, onChange, flush]; call flush on blur so leaving the field
 * saves at once.
 *
 * DeliveryStep is one step of a wizard sheet, so unmounting mid-debounce
 * (switching steps, closing the sheet) is routine, not exceptional — without
 * this, an edit that never got a blur is silently dropped. onSave and the
 * latest value live in refs so the unmount cleanup (whose effect body only
 * runs once, on mount) never calls a stale onSave closure. flush() and the
 * cleanup share the same "is a save still pending" check (timerRef), so a
 * normal blur-then-unmount only saves once.
 *
 * The prop-sync effect below must never overwrite text the user is still
 * typing (DeliveryStep renders six of these off the same order, so a blur
 * on one field's immediate PATCH landing can re-render this one mid-edit).
 * Two guards: skip entirely while a debounce timer is pending, and while a
 * save this hook sent is still in flight. The in-flight marker is a plain
 * boolean cleared when that save's promise SETTLES — resolved or rejected —
 * not when some later prop happens to match what was sent: DeliveryStep's
 * own save() resolves (it never rejects) even when the PATCH is refused
 * server-side, simply skipping the order update, so `initialValue` would
 * never reach a value to match against and a match-based gate would wedge
 * shut for the rest of the field's life. Once the marker clears, any later,
 * genuinely different prop value (a real external change) syncs normally.
 */
const useDebouncedField = (initialValue, onSave, delay = 600) => {
    const [localValue, setLocalValue] = useState(initialValue);
    const timerRef = useRef(null);
    const latestValueRef = useRef(localValue);
    const onSaveRef = useRef(onSave);
    onSaveRef.current = onSave;
    // True from the moment a save is sent until its promise settles.
    const savingRef = useRef(false);

    // Calls onSave and tracks the result. A non-promise return (a test's
    // plain jest.fn(), or any synchronous onSave) clears the marker at
    // once, so no caller shape can leave it wedged. The `.catch(() => {})`
    // is on OUR OWN derived chain only — used solely to flip the marker back
    // — so it cannot swallow a rejection from the promise this function
    // returns to the caller, which callers (OrderSheet's confirm flush)
    // still see and can await/catch untouched.
    const trackSave = useCallback((result) => {
        if (result && typeof result.finally === 'function') {
            savingRef.current = true;
            result.finally(() => {
                savingRef.current = false;
            }).catch(() => {});
        } else {
            savingRef.current = false;
        }
        return result;
    }, []);

    useEffect(() => {
        if (timerRef.current || savingRef.current) return; // editing, or a save not yet settled; never clobber
        if (initialValue !== latestValueRef.current) {
            setLocalValue(initialValue);
            latestValueRef.current = initialValue;
        }
    }, [initialValue]);

    const handleChange = useCallback((value) => {
        setLocalValue(value);
        latestValueRef.current = value;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            trackSave(onSaveRef.current(value));
        }, delay);
    }, [delay, trackSave]);

    // Returns the pending save's promise (or undefined when nothing was
    // pending) so a caller that needs the save to land first — OrderSheet's
    // confirm path — can await it.
    const flush = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
            return trackSave(onSaveRef.current(latestValueRef.current));
        }
        return undefined;
    }, [trackSave]);

    useEffect(() => {
        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
                onSaveRef.current(latestValueRef.current);
            }
        };
    }, []);

    return [localValue, handleChange, flush];
};

export default useDebouncedField;
